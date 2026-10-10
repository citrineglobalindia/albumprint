import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { Archive, ChevronDown, ChevronRight, Download, Eye, FileText, HardDrive, Lock, UploadCloud, FilePlus2 } from "lucide-react";
import { Pagination, PageHeader, Panel, Pill, SearchInput, SlideOver, Td, Th, Toggle, tableCls, trCls, cx } from "../components/ui";
import { Combobox, FilterChips, MultiSelect, SortTh, sortRows, type SortState } from "../components/controls";
import { orderOpt } from "../components/pageKit";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { RowMenu } from "../components/RowMenu";
import { ORDERS, type Tone } from "../lib/data";
import { FILES, ALLOWED_EXT, MAX_BYTES, addFile, archiveFile, downloadFile, fmtSize, lockFile, previewUrl, type FileCategory, type FileRec, type FileState } from "../lib/files";
import { proofApproved } from "../lib/proofs";
import { currentActor, onAudit } from "../lib/audit";
import { notify, useStore } from "../lib/store";
import { fmtDate } from "../lib/format";

const CATS: FileCategory[] = ["Source Photos", "Graded", "Design Draft", "Final Print", "Cover", "QC Evidence", "Invoice", "Other"];
const STATES: FileState[] = ["Draft", "Submitted", "Approved", "Rejected", "Locked"];
const STATE_TONE: Record<FileState, Tone> = { Draft: "slate", Submitted: "blue", Approved: "green", Rejected: "red", Locked: "indigo" };
const QUOTA = 500 * 1024 ** 3;
const custOf = (orderId: string) => ORDERS.find((o) => o.id === orderId)?.customer ?? "—";

interface Group { key: string; latest: FileRec; versions: FileRec[] }

export default function FilesPage() {
  useStore();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onAudit(bump), []);
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const role = currentActor().role;
  const admin = role === "admin";
  const canUpload = ["admin", "reception", "colour", "designer", "printing", "qc"].includes(role);   // mirrors the storage/order_files insert policies (accounts: view only)

  const [q, setQ] = useState("");
  const [fOrder, setFOrder] = useState<string[]>([]);
  const [fCat, setFCat] = useState<string[]>([]);
  const [fState, setFState] = useState<string[]>([]);
  const [fBy, setFBy] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "at", dir: -1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FileRec | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  useEffect(() => { setPreviewSrc(null); if (preview && /^(jpe?g|png)$/.test(preview.ext)) void previewUrl(preview).then(setPreviewSrc); }, [preview]);

  const [upOrder, setUpOrder] = useState("");
  const [upCat, setUpCat] = useState<FileCategory>("Source Photos");
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const verRef = useRef<HTMLInputElement>(null);
  const verTarget = useRef<Group | null>(null);

  /* ---- grouping: one row per (order, category, name), newest version on top ---- */
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, FileRec[]>();
    FILES.filter((f) => showArchived || !f.archived).forEach((f) => { const k = `${f.orderId}|${f.category}|${f.name}`; (m.get(k) ?? m.set(k, []).get(k)!).push(f); });
    return [...m.entries()].map(([key, vs]) => { const versions = [...vs].sort((a, b) => b.version - a.version); return { key, latest: versions[0]!, versions }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [FILES.length, showArchived, FILES.map((f) => f.state + (f.archived ? "a" : "") + (f.pending ? "p" : "") + f.version).join("")]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = groups.filter(({ latest: f }) => {
      if (fOrder.length && !fOrder.includes(f.orderId)) return false;
      if (fCat.length && !fCat.includes(f.category)) return false;
      if (fState.length && !fState.includes(f.state)) return false;
      if (fBy.length && !fBy.includes(f.by)) return false;
      return !t || f.name.toLowerCase().includes(t) || f.orderId.toLowerCase().includes(t) || custOf(f.orderId).toLowerCase().includes(t) || f.id.toLowerCase().includes(t);
    });
    return sortRows(l, sort, (g, k) => { const f = g.latest; return k === "name" ? f.name.toLowerCase() : k === "order" ? f.orderId : k === "cat" ? f.category : k === "ver" ? f.version : k === "size" ? f.size : k === "state" ? f.state : k === "by" ? f.by : f.at; });
  }, [groups, q, fOrder, fCat, fState, fBy, sort]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, maxPage);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const orderIds = [...new Set(FILES.map((f) => f.orderId))].sort();
  const uploaders = [...new Set(FILES.map((f) => f.by))].sort();

  /* ---- actions ---- */
  const upload = (files: FileList | File[]) => {
    if (!canUpload) { show(`Your role (${role}) cannot upload files`); return; }
    if (!upOrder) { show("Choose the order these files belong to first"); return; }
    let ok = 0; const errs: string[] = [];
    Array.from(files).forEach((f) => { const r = addFile(upOrder, upCat, f.name, f.size, f); if (r.ok) ok++; else errs.push(`${f.name}: ${r.error}`); });
    notify(); bump();
    show(errs.length ? `${ok} uploaded, ${errs.length} rejected. ${errs[0]}` : `${ok} file${ok === 1 ? "" : "s"} uploaded to ${upOrder} (${upCat})`);
    if (inputRef.current) inputRef.current.value = "";
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files); };
  const newVersion = (g: Group) => {
    const go = () => { verTarget.current = g; verRef.current?.click(); };
    if (g.latest.state === "Locked") confirm({ title: "File is locked", message: `v${g.latest.version} of ${g.latest.name} is locked (released to printing). A new version is created as a separate Draft. The locked version is never overwritten.`, confirmLabel: "Add new version" }, go);
    else go();
  };
  const onVersionPicked = (file: File | undefined) => {
    const g = verTarget.current; if (verRef.current) verRef.current.value = "";
    if (!file || !g) return;
    if (!canUpload) { show(`Your role (${role}) cannot upload files`); return; }
    const r = addFile(g.latest.orderId, g.latest.category, g.latest.name, file.size, file);
    notify(); bump();
    show(r.ok ? `${g.latest.name} is now v${r.file.version}` : r.error);
  };
  const download = async (f: FileRec) => { show((await downloadFile(f)).msg); };
  const lock = (f: FileRec) => {
    if (!admin) { show("Only an admin can lock a print file"); return; }
    if (f.category !== "Final Print") { show("Only Final Print files can be locked"); return; }
    if (!proofApproved(f.orderId)) { show(`Final client approval is required before locking (${f.orderId} has no approved proof)`); return; }
    confirm({ title: "Lock final print file", message: `Lock ${f.name} v${f.version} as the exact file released to Printing? It can no longer be archived or replaced.`, confirmLabel: "Lock file" }, () => { lockFile(f.id); notify(); bump(); show(`${f.name} v${f.version} locked`); });
  };
  const archive = (f: FileRec) => {
    if (!admin) { show("Only an admin can archive files"); return; }
    if (f.state === "Locked") { show("Locked files cannot be archived"); return; }
    confirm({ title: "Archive file", message: `Remove ${f.name} v${f.version} from active lists? It is retained with its audit history.`, confirmLabel: "Archive", danger: true }, () => { const ok = archiveFile(f.id); notify(); bump(); show(ok ? `${f.name} archived` : "Locked files cannot be archived"); });
  };

  /* ---- storage usage (§7.2) ---- */
  const live = FILES.filter((f) => !f.archived);
  const used = live.reduce((a, f) => a + f.size, 0);
  const bucket = (key: (f: FileRec) => string) => { const m = new Map<string, number>(); live.forEach((f) => m.set(key(f), (m.get(key(f)) ?? 0) + f.size)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const byOrder = bucket((f) => f.orderId).slice(0, 6), byCust = bucket((f) => custOf(f.orderId)).slice(0, 6), byCat = bucket((f) => f.category);
  const Bars = ({ title, data }: { title: string; data: [string, number][] }) => {
    const max = Math.max(1, ...data.map((d) => d[1]));
    return (
      <div><h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">{title}</h4>
        <ul className="space-y-1.5">{data.map(([k, v]) => (
          <li key={k} className="text-xs"><div className="flex justify-between"><span className="truncate font-semibold">{k}</span><span className="text-sub">{fmtSize(v)}</span></div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></div></li>
        ))}{data.length === 0 && <li className="text-xs text-sub">No data</li>}</ul></div>
    );
  };

  const chips = [
    ...(q.trim() ? [{ label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...fOrder.map((v) => ({ label: `Order: ${v}`, onRemove: () => setFOrder(fOrder.filter((x) => x !== v)) })),
    ...fCat.map((v) => ({ label: `Category: ${v}`, onRemove: () => setFCat(fCat.filter((x) => x !== v)) })),
    ...fState.map((v) => ({ label: `State: ${v}`, onRemove: () => setFState(fState.filter((x) => x !== v)) })),
    ...fBy.map((v) => ({ label: `By: ${v}`, onRemove: () => setFBy(fBy.filter((x) => x !== v)) })),
  ];
  const clear = () => { setQ(""); setFOrder([]); setFCat([]); setFState([]); setFBy([]); setPage(1); };
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const th = (k: string, l: string) => <SortTh k={k} sort={sort} onSort={setSort}>{l}</SortTh>;
  const menu = (g: Group) => {
    const f = g.latest;
    return [
      { label: "Preview", icon: Eye, onClick: () => setPreview(f) },
      { label: "Download", icon: Download, onClick: () => download(f) },
      ...(canUpload ? [{ label: "New version", icon: FilePlus2, onClick: () => newVersion(g) }] : []),
      ...(admin ? [{ label: "Lock final print", icon: Lock, onClick: () => lock(f) }, { label: "Archive", icon: Archive, danger: true, onClick: () => archive(f) }] : []),
    ];
  };

  return (
    <div className="min-w-0">
      {toast}{dialog}
      <input ref={verRef} type="file" className="hidden" data-testid="version-input" onChange={(e) => onVersionPicked(e.target.files?.[0])} />
      <PageHeader title="Files" subtitle="Global file register with versions, locking and storage usage (SRS §7)" />

      <Panel title="Upload files" subtitle={canUpload ? `Allowed: ${ALLOWED_EXT.join(", ")} · max ${fmtSize(MAX_BYTES)} per file` : `Your role (${role}) can view and download files but not upload them`} className="mb-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_200px_minmax(0,1fr)]">
          <div><span className="mb-1.5 block text-[13px] font-semibold">Order <span className="text-rose-500">*</span></span><Combobox options={ORDERS.map(orderOpt)} value={upOrder} onChange={setUpOrder} placeholder="Select order…" /></div>
          <div><span className="mb-1.5 block text-[13px] font-semibold">Category</span>
            <select aria-label="Upload category" value={upCat} onChange={(e) => setUpCat(e.target.value as FileCategory)} className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div data-testid="drop-zone" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={cx("grid min-h-[84px] place-items-center rounded-xl border-2 border-dashed px-4 py-3 text-center text-xs text-sub", drag ? "border-brand bg-brand-soft" : "border-line bg-slate-50")}>
            <label className="cursor-pointer"><UploadCloud className="mx-auto mb-1 size-6 text-slate-400" /><b className="text-ink">Drop files here</b> or <span className="font-bold text-brand">browse</span>
              <input ref={inputRef} type="file" multiple disabled={!canUpload} data-testid="file-input" className="hidden" onChange={(e) => e.target.files?.length && upload(e.target.files)} /></label>
          </div>
        </div>
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="File register" subtitle={`${filtered.length} file${filtered.length === 1 ? "" : "s"} · ${FILES.length} versions`} bodyClassName="pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput className="w-64" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search file, order, customer…" />
            <MultiSelect className="w-36" label="Order" options={orderIds} value={fOrder} onChange={(v) => { setFOrder(v); setPage(1); }} />
            <MultiSelect className="w-36" label="Category" options={CATS} value={fCat} onChange={(v) => { setFCat(v); setPage(1); }} />
            <MultiSelect className="w-32" label="State" options={STATES} value={fState} onChange={(v) => { setFState(v); setPage(1); }} />
            <MultiSelect className="w-36" label="Uploader" options={uploaders} value={fBy} onChange={(v) => { setFBy(v); setPage(1); }} />
            <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold"><Toggle on={showArchived} onChange={setShowArchived} />Show archived</label>
          </div>
          <FilterChips chips={chips} onClearAll={clear} />
          <div className="overflow-x-auto">
            <table className={tableCls} data-testid="file-register">
              <thead><tr><Th className="w-8"> </Th>{th("name", "File")}{th("order", "Order")}{th("cat", "Category")}{th("ver", "Version")}{th("size", "Size")}{th("state", "State")}{th("at", "Uploaded")}<Th>Actions</Th></tr></thead>
              <tbody>
                {rows.map((g) => {
                  const f = g.latest, isOpen = open.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr className={cx(trCls, f.archived && "opacity-60")} data-testid="file-row">
                        <Td><button aria-label={isOpen ? "Hide versions" : "Show versions"} onClick={() => toggleOpen(g.key)} className="grid size-6 place-items-center rounded text-sub hover:bg-slate-100">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></Td>
                        <Td><span className="flex items-center gap-2"><FileText className="size-4 text-sub" /><span><b>{f.name}</b><span className="block text-[11px] uppercase text-sub">{f.ext}{f.archived ? " · archived" : ""}</span></span></span></Td>
                        <Td><Link to={`/orders/${f.orderId}`} className="font-bold text-brand hover:underline">{f.orderId}</Link><span className="block text-xs text-sub">{custOf(f.orderId)}</span></Td>
                        <Td>{f.category}</Td>
                        <Td>v{f.version}{g.versions.length > 1 && <span className="text-xs text-sub"> ({g.versions.length} versions)</span>}</Td>
                        <Td>{fmtSize(f.size)}</Td>
                        <Td>{f.pending ? <Pill tone="amber">Uploading…</Pill> : <Pill tone={STATE_TONE[f.state]} icon={f.state === "Locked" ? Lock : undefined}>{f.state}</Pill>}</Td>
                        <Td className="whitespace-nowrap text-xs">{f.by}<span className="block text-sub">{fmtDate(f.at)}</span></Td>
                        <Td><span className="flex items-center gap-1">
                          <button aria-label={`Download ${f.name}`} onClick={() => download(f)} className="grid size-8 place-items-center rounded-lg text-sub hover:bg-brand-soft hover:text-brand"><Download className="size-4" /></button>
                          <button aria-label={`Preview ${f.name}`} onClick={() => setPreview(f)} className="grid size-8 place-items-center rounded-lg text-sub hover:bg-brand-soft hover:text-brand"><Eye className="size-4" /></button>
                          <RowMenu items={menu(g)} label={`Actions for ${f.name}`} />
                        </span></Td>
                      </tr>
                      {isOpen && g.versions.map((v) => (
                        <tr key={v.id} className="border-t border-line bg-slate-50/70 text-xs" data-testid="version-row">
                          <Td> </Td><Td className="pl-8 text-sub">version history</Td><Td> </Td><Td> </Td>
                          <Td className="font-semibold">v{v.version}</Td><Td>{fmtSize(v.size)}</Td><Td><Pill tone={STATE_TONE[v.state]}>{v.state}</Pill></Td><Td>{v.by}<span className="block text-sub">{fmtDate(v.at)}</span></Td>
                          <Td><button onClick={() => download(v)} className="font-bold text-brand hover:underline">Download</button></Td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-sm text-sub">{FILES.length === 0 ? "No files yet. Upload photos or print files above." : "No files match the filters."}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={cur} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="files" />
          {!admin && <p className="mt-3 text-xs text-sub">Locking and archiving are admin-only actions.</p>}
        </Panel>

        <Panel title="Storage usage" subtitle="§7.2" action={<HardDrive className="size-5 text-sub" />} bodyClassName="space-y-5">
          <div data-testid="storage-quota">
            <div className="flex items-baseline justify-between"><b className="text-xl font-extrabold">{fmtSize(used)}</b><span className="text-xs text-sub">of {fmtSize(QUOTA)} quota</span></div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className={cx("h-full rounded-full", used / QUOTA > 0.8 ? "bg-rose-500" : "bg-brand")} style={{ width: `${Math.max(1, Math.min(100, (used / QUOTA) * 100))}%` }} /></div>
            <p className="mt-1 text-xs text-sub">{((used / QUOTA) * 100).toFixed(used / QUOTA < 0.01 ? 4 : 1)}% used · {live.length} active files · {FILES.length - live.length} archived (retained)</p>
          </div>
          <Bars title="By category" data={byCat.map(([k, v]) => [k, v])} />
          <Bars title="By order" data={byOrder} />
          <Bars title="By customer" data={byCust} />
        </Panel>
      </div>

      <SlideOver open={!!preview} onClose={() => setPreview(null)} title="Preview" width={460}>
        {preview && (
          <div className="space-y-4 text-sm">
            <div className="grid h-56 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-slate-50 text-center text-sub">{previewSrc ? <img src={previewSrc} alt={preview.name} className="max-h-56 max-w-full object-contain" /> : <div><FileText className="mx-auto mb-2 size-10 text-slate-400" /><b className="text-ink">{preview.name}</b><div className="text-xs">Browser preview is available for stored JPG/PNG files; use Download for everything else.</div></div>}</div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2"><dt className="text-sub">Order</dt><dd>{preview.orderId} · {custOf(preview.orderId)}</dd><dt className="text-sub">Category</dt><dd>{preview.category}</dd><dt className="text-sub">Version</dt><dd>v{preview.version}</dd><dt className="text-sub">Size</dt><dd>{fmtSize(preview.size)}</dd><dt className="text-sub">State</dt><dd>{preview.state}</dd><dt className="text-sub">Uploaded</dt><dd>{preview.by}, {fmtDate(preview.at)}</dd></dl>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
