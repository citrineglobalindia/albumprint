// Local stand-in for Supabase (development/testing only): GoTrue-compatible auth endpoints + a proxy to PostgREST.
// supabase-js talks to it exactly as it would to <project>.supabase.co, so the app can be tested end to end offline.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

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
