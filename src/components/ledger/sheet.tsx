import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { compareIso, formatDMY, formatPretty, parseFlexibleDate } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import {
  catalogMeta,
  destinationKey,
  filterMatches,
  formatShortage,
  normalizeDestination,
  normalizeVehicle,
  parseShortage,
  rankCatalog,
  resolveEntry,
} from "@/lib/ledger/text";
import type { Shipment, ShipmentDraft } from "@/lib/ledger/types";
import { SuggestInput } from "@/components/ledger/suggest-input";

const COLS = ["vehicle", "loading", "unloading", "destination", "shortage"] as const;
type Col = (typeof COLS)[number];
type Move = "down" | "right" | "left" | "stay";
export type SortKey = "created" | Col;

export function Sheet({
  rows,
  sort,
  onSort,
  highlightId,
  monthLabel,
  showAll,
  onShowAll,
  hasRecords,
  onPasteGrid,
  onDelete,
}: {
  rows: Shipment[];
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  highlightId: string | null;
  monthLabel: string;
  showAll: boolean;
  onShowAll: () => void;
  hasRecords: boolean;
  onPasteGrid: (text: string) => void;
  onDelete: (id: string) => void;
}) {
  const vehicles = useLedger((state) => state.vehicles);
  const destinations = useLedger((state) => state.destinations);
  const month = useLedger((state) => state.month);
  const year = useLedger((state) => state.year);
  const updateShipment = useLedger((state) => state.updateShipment);

  const [sel, setSel] = useState<{ id: string; col: Col } | null>(null);
  const [edit, setEdit] = useState<{ id: string; col: Col; draft: string; lock: boolean } | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const editState = useRef(edit);
  const pendingNav = useRef<{ id: string; col: Col } | null>(null);
  const suppressClick = useRef(false);
  const committing = useRef(false);
  const seeded = useRef(false);
  const editRef = useRef<HTMLInputElement>(null);
  editState.current = edit;

  useEffect(() => {
    if (sel && !rows.some((row) => row.id === sel.id)) setSel(null);
  }, [rows, sel]);

  useEffect(() => {
    if (!edit) return;
    const node = editRef.current;
    if (!node) return;
    node.focus();
    if (seeded.current) node.setSelectionRange(node.value.length, node.value.length);
    else node.select();
  }, [edit?.id, edit?.col]);

  useEffect(() => {
    if (!sel || edit) return;
    document.getElementById(`cell-${sel.id}-${sel.col}`)?.focus();
  }, [sel, edit]);

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`row-${highlightId}`)?.scrollIntoView({ block: "nearest" });
  }, [highlightId]);

  function beginEdit(id: string, col: Col, seed?: string) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    const draft = seed != null ? (col === "vehicle" ? seed.toUpperCase() : seed) : display(row, col);
    seeded.current = seed != null;
    const next = { id, col, draft, lock: false };
    editState.current = next;
    setSel({ id, col });
    setEdit(next);
    setCellError(null);
  }

  function cancelEdit() {
    pendingNav.current = null;
    editState.current = null;
    setEdit(null);
    setCellError(null);
  }

  function commitDraft(draft: string, lock: boolean, move: Move) {
    const current = editState.current;
    if (!current || committing.current) return;
    committing.current = true;
    const source = useLedger.getState().records.find((row) => row.id === current.id);
    if (!source) {
      editState.current = null;
      setEdit(null);
      committing.current = false;
      return;
    }
    const result = draftFrom(source, current.col, draft, lock, vehicles, destinations, month, year);
    if (!result.ok) {
      setCellError(result.error);
      pendingNav.current = null;
      committing.current = false;
      editRef.current?.focus();
      return;
    }
    if (!sameShipment(source, result.draft)) updateShipment(current.id, result.draft);
    editState.current = null;
    setEdit(null);
    setCellError(null);
    const nav = pendingNav.current;
    pendingNav.current = null;
    if (nav) suppressClick.current = true;
    const rowIndex = rows.findIndex((row) => row.id === current.id);
    const colIndex = COLS.indexOf(current.col);
    if (nav) setSel(nav);
    else if (move === "down" && rows[rowIndex + 1]) setSel({ id: rows[rowIndex + 1].id, col: current.col });
    else if (move === "right") {
      if (COLS[colIndex + 1]) setSel({ id: current.id, col: COLS[colIndex + 1] });
      else if (rows[rowIndex + 1]) setSel({ id: rows[rowIndex + 1].id, col: "vehicle" });
    } else if (move === "left") {
      if (COLS[colIndex - 1]) setSel({ id: current.id, col: COLS[colIndex - 1] });
      else if (rows[rowIndex - 1]) setSel({ id: rows[rowIndex - 1].id, col: "shortage" });
    } else setSel({ id: current.id, col: current.col });
    committing.current = false;
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [data-dialog], [data-quick-entry]")) return;
      if (!sel || editState.current) return;
      const rowIndex = rows.findIndex((row) => row.id === sel.id);
      const colIndex = COLS.indexOf(sel.col);
      if (rowIndex < 0) return;
      const go = (row: number, col: number) => {
        const nextRow = rows[row];
        const nextCol = COLS[col];
        if (!nextRow || !nextCol) return;
        event.preventDefault();
        setSel({ id: nextRow.id, col: nextCol });
      };
      if (event.key === "ArrowDown") go(rowIndex + 1, colIndex);
      else if (event.key === "ArrowUp") go(rowIndex - 1, colIndex);
      else if (event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey)) go(rowIndex, colIndex + 1 === COLS.length ? 0 : colIndex + 1);
      else if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) go(rowIndex, colIndex - 1);
      else if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        beginEdit(sel.id, sel.col);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        const row = rows.find((item) => item.id === sel.id);
        if (!row) return;
        event.preventDefault();
        void navigator.clipboard.writeText(copyText(row, sel.col));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        beginEdit(sel.id, sel.col, event.key);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-quick-entry], [data-dialog]")) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim()) return;
      const grid = text.includes("\n") || text.includes("\t");
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typing && !grid) return;
      if (grid) {
        event.preventDefault();
        onPasteGrid(text);
        return;
      }
      if (sel && !editState.current) {
        event.preventDefault();
        const state = useLedger.getState();
        const source = state.records.find((row) => row.id === sel.id);
        if (!source) return;
        const result = draftFrom(
          source,
          sel.col,
          text.trim(),
          false,
          state.vehicles,
          state.destinations,
          state.month,
          state.year,
        );
        if (!result.ok) {
          beginEdit(sel.id, sel.col, text.trim());
          setCellError(result.error);
          return;
        }
        if (!sameShipment(source, result.draft)) updateShipment(source.id, result.draft);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [sel, rows, onPasteGrid, updateShipment]);

  function onCellMouseDown(event: MouseEvent, id: string, col: Col) {
    if (!editState.current) return;
    if ((event.target as HTMLElement).closest("input, button")) return;
    pendingNav.current = { id, col };
  }

  const headers: { key: SortKey; label: string; tone?: "load" | "unload" }[] = [
    { key: "vehicle", label: "Vehicle number" },
    { key: "loading", label: "Loading date", tone: "load" },
    { key: "unloading", label: "Unloading date", tone: "unload" },
    { key: "destination", label: "Destination" },
    { key: "shortage", label: "Shortage" },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-sheet">
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-line px-3 py-1 text-xs text-muted">
        <span>
          {cellError
            ? cellError
            : edit
              ? `Editing ${edit.col}. A lone day uses ${monthLabel}.`
              : copied
                ? "Copied"
                : "Click a cell to select it. Type, or press Enter, to edit."}
        </span>
        <span className="hidden sm:inline">Ctrl+C copies · Ctrl+V pastes · paste a block to add rows</span>
      </div>
      <div className="min-w-0 overflow-auto" data-sheet>
        <div className="sheet-min" role="grid" aria-label="Shipments" aria-rowcount={rows.length + 1}>
          <div className="sheet-grid sticky top-0 z-10 border-b border-line bg-header text-xs font-medium text-muted" role="row">
            <div className="px-2 py-3" />
            {headers.map((header) => (
              <div key={header.key} className={header.tone === "load" ? "border-t-2 border-t-load" : header.tone === "unload" ? "border-t-2 border-t-unload" : ""}>
                <button
                  type="button"
                  className="flex h-11 w-full items-center gap-1 px-2 text-left"
                  onClick={() => onSort(header.key)}
                >
                  {header.label}
                  {sort.key === header.key ? (
                    sort.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
                  ) : null}
                </button>
              </div>
            ))}
            <div />
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted">
              {hasRecords ? (
                <p>
                  Nothing matches this view.{" "}
                  {!showAll ? (
                    <button type="button" className="font-medium text-accent" onClick={onShowAll}>
                      Show every month
                    </button>
                  ) : (
                    "Clear the search or destination filter."
                  )}
                </p>
              ) : (
                <p>
                  No shipments for {monthLabel}. Use the row above: type a vehicle, then only the day. 2 becomes{" "}
                  {formatDMY(`${year}-${String(month).padStart(2, "0")}-02`)}.
                </p>
              )}
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.id}
                id={`row-${row.id}`}
                role="row"
                className={`sheet-grid border-b border-line text-sm ${highlightId === row.id ? "bg-accent-soft" : "hover:bg-row"}`}
              >
                <div className="flex items-center px-2 font-mono text-xs text-faint tabular-nums">{index + 1}</div>
                {COLS.map((col) => {
                  const selected = sel?.id === row.id && sel.col === col;
                  const editing = edit?.id === row.id && edit.col === col;
                  return (
                    <div
                      key={col}
                      id={`cell-${row.id}-${col}`}
                      role="gridcell"
                      tabIndex={selected ? 0 : -1}
                      className={`flex min-h-12 items-center px-2 outline-none ${selected && !editing ? "ring-2 ring-inset ring-accent" : ""}`}
                      onMouseDown={(event) => onCellMouseDown(event, row.id, col)}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        if (editState.current) return;
                        if (selected) beginEdit(row.id, col);
                        else setSel({ id: row.id, col });
                      }}
                      onDoubleClick={() => beginEdit(row.id, col)}
                    >
                      {editing && edit ? (
                        <CellEditor
                          edit={edit}
                          editRef={editRef}
                          vehicles={vehicles}
                          destinations={destinations}
                          onChange={(draft) => {
                            const next = { ...edit, draft, lock: false };
                            editState.current = next;
                            setEdit(next);
                            setCellError(null);
                          }}
                          onPick={(label) => commitDraft(label, true, "down")}
                          onEnter={() => commitDraft(edit.draft, edit.lock, "down")}
                          onCtrl={() => commitDraft(edit.draft, true, "down")}
                          onTab={(shift) => commitDraft(edit.draft, edit.lock, shift ? "left" : "right")}
                          onEscape={cancelEdit}
                          onBlur={() => {
                            window.setTimeout(() => {
                              if (!editState.current || committing.current) return;
                              if (document.activeElement === editRef.current) return;
                              commitDraft(editState.current.draft, editState.current.lock, "stay");
                            }, 0);
                          }}
                        />
                      ) : (
                        <CellView row={row} col={col} />
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    aria-label={`Delete shipment ${row.vehicle}`}
                    className="inline-flex size-11 items-center justify-center text-faint hover:text-danger"
                    onClick={() => onDelete(row.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CellView({ row, col }: { row: Shipment; col: Col }) {
  if (col === "loading" || col === "unloading") {
    const iso = col === "loading" ? row.loading : row.unloading;
    return (
      <span className="min-w-0">
        <span className="block font-mono text-sm tabular-nums">{formatDMY(iso)}</span>
        <span className="block text-xs text-muted">{formatPretty(iso)}</span>
      </span>
    );
  }
  if (col === "shortage") {
    return (
      <span className="ml-auto font-mono tabular-nums text-ink">
        {row.shortage == null ? <span className="text-faint">—</span> : formatShortage(row.shortage)}
      </span>
    );
  }
  return <span className={`truncate ${col === "vehicle" ? "font-mono" : ""}`}>{display(row, col)}</span>;
}

function CellEditor({
  edit,
  editRef,
  vehicles,
  destinations,
  onChange,
  onPick,
  onEnter,
  onCtrl,
  onTab,
  onEscape,
  onBlur,
}: {
  edit: { id: string; col: Col; draft: string; lock: boolean };
  editRef: RefObject<HTMLInputElement | null>;
  vehicles: { name: string; uses: number; lastUsed: number }[];
  destinations: { name: string; uses: number; lastUsed: number }[];
  onChange: (draft: string) => void;
  onPick: (label: string) => void;
  onEnter: () => void;
  onCtrl: () => void;
  onTab: (shift: boolean) => void;
  onEscape: () => void;
  onBlur: () => void;
}) {
  if (edit.col === "vehicle" || edit.col === "destination") {
    const isVehicle = edit.col === "vehicle";
    const normalize = isVehicle ? normalizeVehicle : destinationKey;
    const rank = rankCatalog(isVehicle ? vehicles : destinations, edit.draft, normalize);
    const typed = isVehicle ? normalizeVehicle(edit.draft) : normalizeDestination(edit.draft);
    const exists = (isVehicle ? vehicles : destinations).some((item) => normalize(item.name) === normalize(typed));
    return (
      <SuggestInput
        ref={editRef}
        value={edit.draft}
        mono={isVehicle}
        variant="cell"
        ariaLabel={isVehicle ? "Edit vehicle number" : "Edit destination"}
        suggestions={rank.shown.map((item) => ({ key: item.name, label: item.name, meta: catalogMeta(item) }))}
        moreCount={Math.max(0, rank.total - rank.shown.length)}
        extraLabel={typed && !exists ? `Use ${typed} as typed` : null}
        transform={isVehicle ? (value) => value.toUpperCase() : undefined}
        onChange={onChange}
        onPick={onPick}
        onExtra={() => onPick(typed)}
        onEnter={onEnter}
        onCtrlEnter={onCtrl}
        onTab={onTab}
        onEscape={onEscape}
        onFieldBlur={onBlur}
      />
    );
  }

  return (
    <input
      ref={editRef}
      value={edit.draft}
      aria-label={`Edit ${edit.col}`}
      className="h-10 w-full bg-transparent px-1 font-mono text-sm outline-none"
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        } else if (event.key === "Tab") {
          event.preventDefault();
          onTab(event.shiftKey);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
        }
      }}
    />
  );
}

function display(row: Shipment, col: Col): string {
  if (col === "vehicle") return row.vehicle;
  if (col === "loading") return formatDMY(row.loading);
  if (col === "unloading") return formatDMY(row.unloading);
  if (col === "destination") return row.destination;
  return row.shortage == null ? "" : formatShortage(row.shortage);
}

function copyText(row: Shipment, col: Col): string {
  if (col === "shortage") return row.shortage == null ? "" : String(row.shortage);
  return display(row, col);
}

function sameShipment(row: Shipment, draft: ShipmentDraft): boolean {
  return (
    row.vehicle === draft.vehicle &&
    row.loading === draft.loading &&
    row.unloading === draft.unloading &&
    row.destination === draft.destination &&
    row.shortage === draft.shortage
  );
}

function draftFrom(
  row: Shipment,
  col: Col,
  draft: string,
  lock: boolean,
  vehicles: { name: string; uses: number; lastUsed: number }[],
  destinations: { name: string; uses: number; lastUsed: number }[],
  month: number,
  year: number,
): { ok: true; draft: ShipmentDraft } | { ok: false; error: string } {
  const next: ShipmentDraft = {
    vehicle: row.vehicle,
    loading: row.loading,
    unloading: row.unloading,
    destination: row.destination,
    shortage: row.shortage,
  };
  if (col === "vehicle") {
    const resolved = lock
      ? normalizeVehicle(draft)
        ? { ok: true as const, value: normalizeVehicle(draft) }
        : { ok: false as const, error: "Enter a vehicle number", ambiguous: false }
      : resolveEntry(draft, filterMatches(vehicles, draft, normalizeVehicle), normalizeVehicle, "vehicle");
    if (!resolved.ok) return { ok: false, error: resolved.error };
    next.vehicle = resolved.value;
  } else if (col === "destination") {
    const resolved = lock
      ? normalizeDestination(draft)
        ? { ok: true as const, value: normalizeDestination(draft) }
        : { ok: false as const, error: "Enter a destination", ambiguous: false }
      : resolveEntry(
          draft,
          filterMatches(destinations, draft, destinationKey),
          destinationKey,
          "destination",
          normalizeDestination,
        );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    next.destination = resolved.value;
  } else if (col === "loading" || col === "unloading") {
    const parsed = parseFlexibleDate(draft, { month, year });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    next[col] = parsed.iso;
  } else {
    const parsed = parseShortage(draft);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    next.shortage = parsed.value;
  }
  if (next.unloading < next.loading) {
    return {
      ok: false,
      error: `Unloading ${formatDMY(next.unloading)} is before loading ${formatDMY(next.loading)}`,
    };
  }
  return { ok: true, draft: next };
}

export function sortRows(rows: Shipment[], sort: { key: SortKey; dir: "asc" | "desc" }): Shipment[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let diff = 0;
    if (sort.key === "created") diff = a.createdAt - b.createdAt;
    else if (sort.key === "vehicle") diff = a.vehicle.localeCompare(b.vehicle);
    else if (sort.key === "destination") diff = a.destination.localeCompare(b.destination);
    else if (sort.key === "loading") diff = compareIso(a.loading, b.loading);
    else if (sort.key === "unloading") diff = compareIso(a.unloading, b.unloading);
    else {
      const av = a.shortage;
      const bv = b.shortage;
      if (av == null && bv == null) diff = 0;
      else if (av == null) diff = 1;
      else if (bv == null) diff = -1;
      else diff = av - bv;
    }
    return diff * dir || b.createdAt - a.createdAt;
  });
}
