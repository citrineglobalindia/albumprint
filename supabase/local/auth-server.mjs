// Local stand-in for Supabase (development/testing only): GoTrue-compatible auth endpoints + a proxy to PostgREST.
// supabase-js talks to it exactly as it would to <project>.supabase.co, so the app can be tested end to end offline.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 54321);
const REST = process.env.POSTGREST_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.JWT_SECRET ?? "local-dev-secret-local-dev-secret-0123456789";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@/albumprint_local?host=/var/tmp&port=5433" });

const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (payload) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64(JSON.stringify(payload)); return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const verify = (t) => { try { const [h, p, s] = t.split("."); if (crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null; const d = JSON.parse(Buffer.from(p, "base64url")); return d.exp * 1000 > Date.now() ? d : null; } catch { return null; } };
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, app_metadata: { provider: "email" }, user_metadata: {}, created_at: u.created_at });
const session = (u) => {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: sign({ aud: "authenticated", role: "authenticated", sub: u.id, email: u.email, iat: now, exp: now + 3600 }), token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    refresh_token: sign({ typ: "refresh", sub: u.id, exp: now + 86400 * 30 }), user: userJson(u) };
};
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", ...cors }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const bearerUser = async (req) => { const t = (req.headers.authorization ?? "").replace(/^Bearer /i, ""); const c = verify(t); if (!c?.sub) return null; return (await db.query("select id, email, created_at from auth.users where id = $1", [c.sub])).rows[0] ?? null; };

// ───────── Storage stand-in (/storage/v1/object/…): bytes on disk under supabase/local/.storage/<port>/, access decided by the real
// storage.objects row-level-security policies, evaluated as the caller (set role authenticated + request.jwt.claims — same as PostgREST).
const STORE = process.env.STORAGE_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".storage", String(PORT));
const sErr = (res, code, error, message) => send(res, code, { statusCode: String(code), error, message });
const diskPath = (bucket, name) => { const p = path.join(STORE, bucket, ...name.split("/")); return p.startsWith(path.join(STORE, bucket) + path.sep) ? p : null; };
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", zip: "application/zip", tif: "image/tiff", tiff: "image/tiff", psd: "image/vnd.adobe.photoshop" };
/** Run fn(client) inside a transaction as the signed-in user, so RLS on storage.objects applies exactly like on Supabase. */
async function asUser(sub, fn) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub, role: "authenticated" }), sub]);
    const r = await fn(c); await c.query("commit"); return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const canRead = (sub, bucket, name) => asUser(sub, async (c) => (await c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rowCount > 0);
async function serveFile(req, res, bucket, name, download) {
  const fp = diskPath(bucket, name); let st;
  try { st = fp && (await fs.stat(fp)); } catch { st = null; }
  if (!st) return sErr(res, 404, "not_found", "Object not found");
  const ext = name.split(".").pop().toLowerCase();
  const h = { "content-type": MIME[ext] ?? "application/octet-stream", "content-length": st.size, "cache-control": "private, max-age=0", etag: `"${st.size}-${st.mtimeMs}"`, ...cors };
  if (download !== null) h["content-disposition"] = `attachment; filename="${(download || name.split("/").pop()).replace(/"/g, "")}"`;
  res.writeHead(200, h); if (req.method === "HEAD") return res.end(); return res.end(await fs.readFile(fp));
}
async function storage(req, res, url) {
  const rest = url.pathname.slice("/storage/v1".length);
  const seg = rest.split("/").filter(Boolean).map(decodeURIComponent);                      // ["object", …]
  if (seg[0] === "object" && seg[1] === "sign" && req.method === "GET" && seg.length > 3) {   // signed download link: no Authorization header, the token is the credential
    const bucket = seg[2], name = seg.slice(3).join("/"); const c = verify(url.searchParams.get("token") ?? "");
    if (!c || c.url !== `${bucket}/${name}`) return sErr(res, 400, "InvalidJWT", "Invalid or expired signed URL");
    return serveFile(req, res, bucket, name, url.searchParams.has("download") ? url.searchParams.get("download") : null);
  }
  const u = await bearerUser(req); if (!u) return sErr(res, 401, "Unauthorized", "Invalid JWT");
  if (seg[0] === "object" && seg[1] === "sign" && req.method === "POST") {                   // create signed URL(s)
    const body = JSON.parse((await readBody(req)).toString() || "{}"); const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60);
    const mk = (b, n) => `/object/sign/${b}/${n}?token=${sign({ url: `${b}/${n}`, iat: Math.floor(Date.now() / 1000), exp })}`;
    if (seg.length === 3) {                                                                   // POST /object/sign/<bucket> { paths }
      const out = []; for (const n of body.paths ?? []) out.push((await canRead(u.id, seg[2], n)) ? { path: n, error: null, signedURL: mk(seg[2], n) } : { path: n, error: "Either the object does not exist or you do not have access to it", signedURL: null });
      return send(res, 200, out);
    }
    const bucket = seg[2], name = seg.slice(3).join("/");
    if (!(await canRead(u.id, bucket, name))) return sErr(res, 404, "not_found", "Object not found");
    return send(res, 200, { signedURL: mk(bucket, name) });
  }
  if (seg[0] === "object" && seg[1] === "list" && req.method === "POST") {
    const bucket = seg[2]; const b = JSON.parse((await readBody(req)).toString() || "{}"); const prefix = b.prefix ? b.prefix.replace(/\/?$/, "/") : "";
    const rows = await asUser(u.id, async (c) => (await c.query("select name, id, owner from storage.objects where bucket_id = $1 and name like $2 order by name limit $3", [bucket, prefix.replace(/[%_]/g, "\\$&") + "%", b.limit ?? 100])).rows);
    return send(res, 200, rows.map((r) => ({ name: r.name.slice(prefix.length), id: r.id, metadata: {} })));
  }
  if (seg[0] === "object" && seg.length >= 3) {
    const authIdx = seg[1] === "authenticated" ? 2 : 1; const bucket = seg[authIdx], name = seg.slice(authIdx + 1).join("/");
    if (!bucket || !name) return sErr(res, 400, "InvalidKey", "Invalid object key");
    if (req.method === "GET" || req.method === "HEAD") {
      if (!(await canRead(u.id, bucket, name))) return sErr(res, 404, "not_found", "Object not found");
      return serveFile(req, res, bucket, name, null);
    }
    if (req.method === "POST" || req.method === "PUT") {
      const fp = diskPath(bucket, name); if (!fp) return sErr(res, 400, "InvalidKey", "Invalid object key");
      const raw = await readBody(req); const ct = req.headers["content-type"] ?? ""; let bytes = raw;
      if (ct.startsWith("multipart/form-data")) {                                              // supabase-js sends a FormData with the file under the empty field name
        const fd = await new Response(raw, { headers: { "content-type": ct } }).formData(); bytes = null;
        for (const v of fd.values()) if (typeof v !== "string") bytes = Buffer.from(await v.arrayBuffer());
        if (!bytes) return sErr(res, 400, "InvalidRequest", "No file in the request");
      }
      const upsert = req.headers["x-upsert"] === "true"; const exists = (await db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rowCount > 0;
      if (exists && !upsert) return sErr(res, 409, "Duplicate", "The resource already exists");
      try {
        const id = await asUser(u.id, async (c) => {
          const lim = (await c.query("select file_size_limit from storage.buckets where id = $1", [bucket])).rows[0];
          if (!lim) { const e = new Error("Bucket not found"); e.http = 404; throw e; }
          if (lim.file_size_limit && bytes.length > Number(lim.file_size_limit)) { const e = new Error("The object exceeded the maximum allowed size"); e.http = 413; throw e; }
          if (exists) return (await c.query("update storage.objects set name = name where bucket_id = $1 and name = $2 returning id", [bucket, name])).rows[0]?.id;   // needs update policy, like Supabase
          return (await c.query("insert into storage.objects(bucket_id, name, owner) values ($1, $2, auth.uid()) returning id", [bucket, name])).rows[0].id;
        });
        if (!id) return sErr(res, 403, "Unauthorized", "new row violates row-level security policy");
        await fs.mkdir(path.dirname(fp), { recursive: true }); await fs.writeFile(fp, bytes);
        return send(res, 200, { Id: id, Key: `${bucket}/${name}` });
      } catch (e) {
        if (e.http) return sErr(res, e.http, e.http === 404 ? "not_found" : "Payload too large", e.message);
        if (e.code === "42501" || /row-level security/.test(e.message)) return sErr(res, 403, "Unauthorized", "new row violates row-level security policy");
        throw e;
      }
    }
  }
  return sErr(res, 404, "not_found", "Not found");
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  try {
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      if (url.searchParams.get("grant_type") === "password") {
        const { rows } = await db.query("select id, email, created_at from auth.users where lower(email) = lower($1) and encrypted_password = crypt($2, encrypted_password)", [body.email, body.password]);
        if (!rows[0]) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: 400, msg: "Invalid login credentials" });
        return send(res, 200, session(rows[0]));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const c = verify(body.refresh_token ?? ""); const u = c && (await db.query("select id, email, created_at from auth.users where id = $1", [c.sub])).rows[0];
        return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      }
    }
    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      const { email, password } = JSON.parse((await readBody(req)).toString());
      const ex = await db.query("select 1 from auth.users where lower(email) = lower($1)", [email]);
      if (ex.rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const { rows } = await db.query("insert into auth.users(id, email, encrypted_password) values (gen_random_uuid(), lower($1), crypt($2, gen_salt('bf'))) returning id, email, created_at", [email, password]);
      return send(res, 200, session(rows[0]));
    }
    if (url.pathname === "/auth/v1/user") {
      const u = await bearerUser(req); if (!u) return send(res, 401, { code: 401, msg: "invalid JWT" });
      if (req.method === "PUT") { const b = JSON.parse((await readBody(req)).toString()); if (b.password) await db.query("update auth.users set encrypted_password = crypt($1, gen_salt('bf')) where id = $2", [b.password, u.id]); }
      return send(res, 200, userJson(u));
    }
    if (url.pathname === "/auth/v1/logout") return send(res, 204);
    if (url.pathname === "/auth/v1/recover") return send(res, 200, {});
    if (url.pathname.startsWith("/storage/v1/")) return await storage(req, res, url);
    if (url.pathname.startsWith("/rest/v1/")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const headers = { ...req.headers, host: new URL(REST).host }; delete headers["content-length"];
      const r = await fetch(REST + url.pathname.replace("/rest/v1", "") + url.search, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer()); const h = Object.fromEntries(r.headers); delete h["content-encoding"]; delete h["transfer-encoding"]; delete h["content-length"];
      res.writeHead(r.status, { ...h, ...cors }); return res.end(out);
    }
    send(res, 404, { error: "not found", path: url.pathname });
  } catch (e) { send(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, () => console.log(`local supabase stand-in on :${PORT}`));
