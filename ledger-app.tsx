import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookMarked, ChevronLeft, ChevronRight, Download, FolderArchive, Search, Undo2, Upload } from "lucide-react";
import { MONTH_LONG, pad2, shiftMonth, formatDMY, formatPretty } from "@/lib/ledger/dates";
import { downloadBackup, downloadExcel, parseBackup, parseClipboard, periodLabel, readExcelFile, type BackupFile, type ImportResult } from "@/lib/ledger/files";
import { prepareLedgerPeriod, useLedger, useSaveStatus } from "@/lib/ledger/store";
import { formatShortage } from "@/lib/ledger/text";
import type { Shipment } from "@/lib/ledger/types";
import { DirectoryDialog } from "@/components/ledger/directory-dialog";
import { Dialog } from "@/components/ledger/dialog";
import { QuickEntry } from "@/components/ledger/quick-entry";
import { Sheet, sortRows, type SortKey } from "@/components/ledger/sheet";
import { Button } from "@/components/ledger/ui";

export function LedgerApp() {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const finish = () => {
      prepareLedgerPeriod();
      setReady(true);
    };
    const unsub = useLedger.persist.onFinishHydration(finish);
    void useLedger.persist.rehydrate();
    return unsub;
  }, []);
  if (!ready) return <Opening />;
  return <Desk />;
}

function Opening() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <div className="border-b border-line bg-sheet px-4 py-5 md:px-6">
        <p className="text-xs font-medium tracking-widest text-muted">VEHICLE LOG</p>
        <h1 className="font-display text-3xl leading-tight">Load Ledger</h1>
        <p className="mt-1 text-sm text-muted">Opening your sheet…</p>
      </div>
    </main>
  );
}

function Desk() {
  const records = useLedger((state) => state.records);
  const vehicles = useLedger((state) => state.vehicles);
  const destinations = useLedger((state) => state.destinations);
  const month = useLedger((state) => state.month);
  const year = useLedger((state) => state.year);
  const history = useLedger((state) => state.history);
  const future = useLedger((state) => state.future);
  const setPeriod = useLedger((state) => state.setPeriod);
  const undo = useLedger((state) => state.undo);
  const redo = useLedger((state) => state.redo);
  const importShipments = useLedger((state) => state.importShipments);
  const deleteShipment = useLedger((state) => state.deleteShipment);
  const replaceAll = useLedger((state) => state.replaceAll);
  const eraseAll = useLedger((state) => state.eraseAll);
  const saveError = useSaveStatus((state) => state.error);

  const [search, setSearch] = useState("");
  const [monthOnly, setMonthOnly] = useState(true);
  const [destination, setDestination] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [yearText, setYearText] = useState(String(year));
  const [pendingBackup, setPendingBackup] = useState<BackupFile | null>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  useEffect(() => setYearText(String(year)), [year]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const label = periodLabel(month, year);
  const searching = search.trim().length > 0;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = records;
    if (!query && monthOnly) {
      const prefix = `${year}-${pad2(month)}`;
      list = list.filter((row) => row.loading.startsWith(prefix));
    }
    if (query) {
      list = list.filter((row) =>
        [
          row.vehicle,
          row.destination,
          formatDMY(row.loading),
          formatPretty(row.loading),
          formatDMY(row.unloading),
          formatPretty(row.unloading),
          row.shortage == null ? "" : String(row.shortage),
          formatShortage(row.shortage),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }
    if (destination !== "all") list = list.filter((row) => row.destination === destination);
    return sortRows(list, sort);
  }, [records, search, monthOnly, month, year, destination, sort]);

  const destinationOptions = useMemo(() => {
    return [...new Set(records.map((row) => row.destination))].sort((a, b) => a.localeCompare(b));
  }, [records]);

  const shortageValues = filtered.filter((row) => row.shortage != null);
  const shortageSum = shortageValues.reduce((sum, row) => sum + (row.shortage ?? 0), 0);
  const vehicleCount = new Set(filtered.map((row) => row.vehicle)).size;
  const deleting = records.find((row) => row.id === deleteId) ?? null;

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key !== key) {
        const dir = key === "vehicle" || key === "destination" ? "asc" : "desc";
        return { key, dir };
      }
      return { key, dir: current.dir === "asc" ? "desc" : "asc" };
    });
  }

  function commitYear() {
    const next = Number(yearText);
    if (!Number.isInteger(next) || next < 1980 || next > 2100) {
      setYearText(String(year));
      return;
    }
    setPeriod(month, next);
  }

  function onSaved(shipment: Shipment) {
    setHighlightId(shipment.id);
    const [savedYear, savedMonth] = shipment.loading.split("-").map(Number);
    if (monthOnly && (savedYear !== year || savedMonth !== month)) {
      setMonthOnly(false);
      setNotice(`Saved. ${formatDMY(shipment.loading)} is outside ${label}, so every month is showing.`);
    } else {
      setNotice(`Saved ${shipment.vehicle} · loaded ${formatDMY(shipment.loading)}.`);
    }
    window.setTimeout(() => setHighlightId((current) => (current === shipment.id ? null : current)), 1600);
  }

  const onPasteGrid = useCallback(
    (text: string) => {
      const state = useLedger.getState();
      const result = parseClipboard(text, state.month, state.year, state.destinations);
      if (result.rows.length > 0) state.importShipments(result.rows);
      setReport(result);
    },
    [],
  );

  async function onExcelFile(file: File) {
    setBusy(true);
    try {
      const state = useLedger.getState();
      const result = await readExcelFile(file, state.month, state.year, state.destinations);
      if (result.rows.length > 0) importShipments(result.rows);
      setReport(result);
    } catch {
      setReport({ rows: [], issues: [{ row: 0, reason: "Could not read that Excel file. Use .xlsx." }] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-paper text-ink lg:h-dvh lg:overflow-hidden">
      <header className="border-b border-line bg-sheet px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted">VEHICLE LOG</p>
            <h1 className="font-display text-3xl leading-tight">Load Ledger</h1>
          </div>
          <a
            href="/load-ledger-source.zip"
            download="load-ledger-complete-source.zip"
            className="inline-flex h-12 items-center justify-center rounded-md bg-accent px-5 text-base font-semibold text-accent-ink"
          >
            Download complete source zip
          </a>
          <p className={`text-sm ${saveError ? "text-danger" : "text-muted"}`}>
            <span className={`mr-2 inline-block size-2 rounded-full ${saveError ? "bg-danger" : "bg-ok"}`} />
            {saveError ?? "Saved on this device"}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3 md:px-6 lg:min-h-0 lg:flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-line bg-sheet">
            <Button
              icon
              aria-label="Previous month"
              onClick={() => {
                const next = shiftMonth(month, year, -1);
                setPeriod(next.month, next.year);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              aria-label="Month"
              value={month}
              onChange={(event) => setPeriod(Number(event.target.value), year)}
              className="h-11 bg-transparent px-1 text-sm font-medium"
            >
              {MONTH_LONG.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <Button
              icon
              aria-label="Next month"
              onClick={() => {
                const next = shiftMonth(month, year, 1);
                setPeriod(next.month, next.year);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="inline-flex items-center rounded-md border border-line bg-sheet">
            <Button
              icon
              aria-label="Previous year"
              onClick={() => setPeriod(month, year - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <input
              aria-label="Year"
              inputMode="numeric"
              value={yearText}
              onChange={(event) => setYearText(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              onBlur={commitYear}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitYear();
                  event.currentTarget.blur();
                }
              }}
              className="h-11 w-16 bg-transparent text-center text-sm font-medium tabular-nums outline-none"
            />
            <Button icon aria-label="Next year" onClick={() => setPeriod(month, year + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button onClick={() => {
            const now = new Date();
            setPeriod(now.getMonth() + 1, now.getFullYear());
          }}>
            This month
          </Button>
          <p className="text-sm text-muted">
            Day <span className="font-mono text-ink">2</span> becomes{" "}
            <span className="font-mono text-ink">{formatDMY(`${year}-${pad2(month)}-02`)}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search vehicles, dates, destinations"
              aria-label="Search shipments"
              className="h-11 w-full rounded-md border border-line bg-sheet pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <select
            aria-label="Filter by destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="h-11 max-w-full rounded-md border border-line bg-sheet px-3 text-sm"
          >
            <option value="all">All destinations</option>
            {destinationOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button variant={monthOnly && !searching ? "soft" : "ghost"} onClick={() => setMonthOnly(true)} disabled={searching}>
            {label}
          </Button>
          <Button variant={!monthOnly || searching ? "soft" : "ghost"} onClick={() => setMonthOnly(false)}>
            All months
          </Button>
          <Button icon aria-label="Undo" disabled={history.length === 0} onClick={undo}>
            <Undo2 className="size-4" />
          </Button>
          <Button aria-label="Redo" disabled={future.length === 0} onClick={redo}>
            Redo
          </Button>
          <Button onClick={() => setDirectoryOpen(true)}>
            <BookMarked className="size-4" />
            <span className="hidden sm:inline">Names</span>
          </Button>
          <Button onClick={() => setBackupOpen(true)}>
            <FolderArchive className="size-4" />
            <span className="hidden sm:inline">Backup</span>
          </Button>
          <Button onClick={() => excelRef.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          <Button variant="primary" onClick={() => void downloadExcel(records)} disabled={records.length === 0}>
            <Download className="size-4" />
            Export
          </Button>
        </div>

        {searching ? (
          <p className="text-sm text-muted">Search looks through every month. {filtered.length} match.</p>
        ) : null}
        {notice ? (
          <p className="text-sm text-ok">
            {notice}{" "}
            <button type="button" className="text-muted" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <QuickEntry onSaved={onSaved} />

        <div className="lg:min-h-0 lg:flex-1">
          <Sheet
            rows={filtered}
            sort={sort}
            onSort={toggleSort}
            highlightId={highlightId}
            monthLabel={label}
            showAll={!monthOnly || searching}
            onShowAll={() => setMonthOnly(false)}
            hasRecords={records.length > 0}
            onPasteGrid={onPasteGrid}
            onDelete={setDeleteId}
          />
        </div>
      </div>

      <footer className="safe-bottom flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sheet px-4 py-2 text-xs text-muted md:px-6">
        <p className="tabular-nums">
          {filtered.length} {filtered.length === 1 ? "shipment" : "shipments"} · {vehicleCount}{" "}
          {vehicleCount === 1 ? "vehicle" : "vehicles"} · shortage{" "}
          {shortageValues.length === 0 ? "—" : formatShortage(shortageSum)}
        </p>
        <p className="hidden md:block">Enter moves to the next field and saves on shortage. Ctrl+Z undoes.</p>
      </footer>

      <input
        ref={excelRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onExcelFile(file);
        }}
      />
      <input
        ref={backupRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) => {
            const parsed = parseBackup(text);
            if (!parsed.ok) {
              setReport({ rows: [], issues: [{ row: 0, reason: parsed.error }] });
              return;
            }
            setBackupOpen(false);
            setPendingBackup(parsed.data);
          });
        }}
      />

      <DirectoryDialog open={directoryOpen} onClose={() => setDirectoryOpen(false)} />

      <Dialog open={backupOpen} title="Backup and restore" description="A backup is a JSON file of every shipment and suggestion." onClose={() => setBackupOpen(false)}>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() =>
              downloadBackup({ records, vehicles, destinations, month, year })
            }
          >
            Download backup
          </Button>
          <Button onClick={() => backupRef.current?.click()}>Restore from backup</Button>
          <Button
            onClick={() => {
              setBackupOpen(false);
              setEraseText("");
              setEraseOpen(true);
            }}
          >
            Erase all data
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={pendingBackup != null}
        title="Replace the sheet?"
        description={
          pendingBackup
            ? `This replaces ${records.length} shipments with ${pendingBackup.records.length} from the backup. You can undo it until you leave the page.`
            : ""
        }
        onClose={() => setPendingBackup(null)}
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPendingBackup(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!pendingBackup) return;
              replaceAll({ ...pendingBackup, periodSet: true });
              setPendingBackup(null);
              setNotice("Backup restored.");
            }}
          >
            Replace data
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={eraseOpen}
        title="Erase all data?"
        description="Shipments and suggestions on this device will be removed. Type DELETE to confirm. Undo still works until you leave the page."
        onClose={() => setEraseOpen(false)}
      >
        <input
          value={eraseText}
          onChange={(event) => setEraseText(event.target.value)}
          aria-label="Type DELETE to confirm"
          placeholder="DELETE"
          className="h-11 w-full rounded-md border border-line px-3 font-mono text-sm outline-none"
        />
        <div className="mt-3 flex gap-2">
          <Button onClick={() => setEraseOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={eraseText !== "DELETE"}
            onClick={() => {
              eraseAll();
              setEraseOpen(false);
              setNotice("All data erased.");
            }}
          >
            Erase
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={deleting != null}
        title="Delete this shipment?"
        description={
          deleting
            ? `${deleting.vehicle} · loaded ${formatDMY(deleting.loading)} · ${deleting.destination}. The vehicle stays in suggestions.`
            : ""
        }
        onClose={() => setDeleteId(null)}
      >
        <div className="flex gap-2">
          <Button autoFocus onClick={() => setDeleteId(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteId) deleteShipment(deleteId);
              setDeleteId(null);
            }}
          >
            Delete shipment
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={report != null}
        title={report && report.rows.length > 0 ? `Added ${report.rows.length}` : "Nothing added"}
        description={
          report && report.issues.length > 0
            ? `${report.issues.length} ${report.issues.length === 1 ? "row was" : "rows were"} skipped.`
            : "Every row was added. The same vehicle can appear more than once."
        }
        onClose={() => setReport(null)}
      >
        {report && report.issues.length > 0 ? (
          <ul className="max-h-60 space-y-1 overflow-auto text-sm text-muted">
            {report.issues.slice(0, 12).map((issue, index) => (
              <li key={`${issue.row}-${index}`}>
                {issue.row > 0 ? `Row ${issue.row}: ` : ""}
                {issue.reason}
              </li>
            ))}
            {report.issues.length > 12 ? <li>And {report.issues.length - 12} more.</li> : null}
          </ul>
        ) : null}
        <div className="mt-3">
          <Button variant="primary" onClick={() => setReport(null)}>
            Close
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
