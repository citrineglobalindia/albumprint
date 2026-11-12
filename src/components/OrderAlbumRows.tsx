import type { Order } from "../lib/data";
import { Pill, cx } from "./ui";
import { WORK_STATUS, photosGiven, photosGraded, progressOf, statusLabel, type Dept, type WorkStatus } from "../lib/jobProgress";
import { LAB_STATUS_LABEL, albumLab, labName } from "../lib/labs";
import { albumStatus } from "../lib/albumFlow";

// Orders list: each album of an order on its own line under the order — its grading, design and lab status and who has it —
// and the order's progress over its albums, so a multi-album order is easy to track.
const tone = (s?: WorkStatus) => WORK_STATUS.find((x) => x.key === s)?.tone ?? "slate";
const finished = (s?: WorkStatus) => s === "done" || s === "client_approved";

/** Where the order's albums are: how many are finished per department, and the share done for the stage the order is at. */
export function albumProgress(o: Order) {
  const n = Math.max(1, o.albums?.length ?? 0);
  const count = (d: Dept) => Array.from({ length: n }, (_, i) => i + 1).filter((k) => finished(albumStatus(o, d, k).status)).length;
  const lab = Array.from({ length: n }, (_, i) => i + 1).filter((k) => albumLab(o.id, k)?.status === "received").length;
  const graded = count("grading"), designed = count("design");
  const cur = ["new_order", "files_received", "colour_grading", "admin_approval"].includes(o.stage) ? graded
    : ["designing", "client_review"].includes(o.stage) ? designed : o.stage === "printing" ? lab : n;
  const flowDone = ["final_approval", "printing", "qc", "ready_for_delivery", "delivered", "closed"].includes(o.stage);
  // photos and sheets: what the people entered (graded of photos given; sheets designed of the albums' sheets)
  const given = photosGiven(o.id) ?? 0, gradedPhotos = Math.min(given || Infinity, photosGraded(o.id) ?? 0) || (given && graded === n ? given : 0);
  const sheets = (o.albums ?? []).reduce((s, a) => s + (Number(a.sheets) || 0), 0);
  const sheetsDone = Array.from({ length: n }, (_, i) => i + 1).reduce((s, k) => s + (progressOf(o.id, "design", k)?.count ?? 0), 0) || (n === 1 ? progressOf(o.id, "design")?.count ?? 0 : 0);
  let pct = Math.round(((flowDone && o.stage !== "printing" ? n : cur) / n) * 100);
  if (["colour_grading"].includes(o.stage) && given > 0) pct = Math.min(100, Math.round((gradedPhotos / given) * 100));
  if (["designing", "client_review"].includes(o.stage) && sheets > 0 && sheetsDone > 0) pct = Math.max(pct, Math.min(100, Math.round((sheetsDone / sheets) * 100)));
  return { n, graded, designed, lab, pct, given, gradedPhotos, sheets, sheetsDone };
}

export function OrderAlbumRows({ o, colSpan, onOpen }: { o: Order; colSpan: number; onOpen: () => void }) {
  const albums = o.albums ?? [];
  if (albums.length < 2) return null;
  const p = albumProgress(o), design = o.workflow !== "Printing";
  const cell = (d: Dept, k: number) => {
    const x = progressOf(o.id, d, k), st = albumStatus(o, d, k);
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {st.status ? <Pill tone={tone(st.status)}>{statusLabel(st.status)}</Pill> : <span className="text-sub">Not started</span>}
        {x?.count != null && <span className="text-[11px] font-semibold">{x.count}{d === "design" && albums[k - 1]?.sheets ? `/${albums[k - 1]!.sheets}` : ""}</span>}
        {x?.assignee && <span className="text-[11px] text-sub">· {x.assignee}</span>}
      </span>
    );
  };
  return (
    <>
      <tr className="bg-slate-50/70" data-testid={`order-albums-${o.id}`}>
        <td />
        <td colSpan={colSpan - 1} className="px-3 py-1.5 text-[11px]">
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2"><span className="h-1.5 w-28 overflow-hidden rounded bg-line"><span className="block h-full bg-emerald-500" style={{ width: `${p.pct}%` }} /></span><b>{p.pct}%</b> of this stage</span>
            {design && <span>Graded <b>{p.given ? `${p.gradedPhotos}/${p.given} photos` : `${p.graded}/${p.n} albums`}</b></span>}
            {design && <span>Designed <b>{p.designed}/{p.n} albums</b>{p.sheets ? <> · <b>{p.sheetsDone}/{p.sheets} sheets</b></> : null}</span>}
            <span>Back from lab <b>{p.lab}/{p.n} albums</b></span>
          </span>
        </td>
      </tr>
      {albums.map((a, i) => { const k = i + 1, al = albumLab(o.id, k); return (
        <tr key={k} onClick={onOpen} className="cursor-pointer bg-slate-50/70 hover:bg-brand-soft/40" data-testid={`order-album-${o.id}-${k}`}>
          <td />
          <td colSpan={colSpan - 1} className="px-3 py-1.5 text-xs">
            <span className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(150px,1.2fr)_repeat(3,minmax(140px,1fr))]">
              <span className="font-semibold"><span className="mr-1 text-sub">↳</span>{a.title || `Album ${k}`}{a.sheets ? <span className="ml-1 font-normal text-sub">· {a.sheets} sheets</span> : null}</span>
              {design ? <span><span className="mr-1 text-[10px] font-bold uppercase text-sub">Grading</span>{cell("grading", k)}</span> : <span />}
              {design ? <span><span className="mr-1 text-[10px] font-bold uppercase text-sub">Design</span>{cell("design", k)}</span> : <span />}
              <span><span className="mr-1 text-[10px] font-bold uppercase text-sub">Lab</span>{al?.labId ? <span className={cx("text-[11px] font-semibold", al.status === "received" ? "text-emerald-700" : al.status === "sent" ? "text-amber-700" : "text-sub")}>{labName(al.labId)} · {LAB_STATUS_LABEL[al.status]}</span> : <span className="text-sub">—</span>}</span>
            </span>
          </td>
        </tr>); })}
    </>
  );
}
