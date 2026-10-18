import {
  formatDMY,
  isoToUtcDate,
  MONTH_LONG,
  parseFlexibleDate,
  utcDateToIso,
} from "@/lib/ledger/dates";
import type { CatalogItem } from "@/lib/ledger/text";
import {
  canonicalDestination,
  ensureCatalog,
  normalizeDestination,
  normalizeVehicle,
  parseShortage,
} from "@/lib/ledger/text";
import type { Shipment, ShipmentDraft } from "@/lib/ledger/types";

type Field = "vehicle" | "loading" | "unloading" | "destination" | "shortage";

const HEADER_FIELDS: Record<string, Field> = {
  vehicle: "vehicle",
  vehiclenumber: "vehicle",
  vehicleno: "vehicle",
  truck: "vehicle",
  trucknumber: "vehicle",
  loading: "loading",
  loadingdate: "loading",
  vehicleloadingdate: "loading",
  loaded: "loading",
  loaddate: "loading",
  unloading: "unloading",
  unloadingdate: "unloading",
  vehicleunloadingdate: "unloading",
  unloaded: "unloading",
  unloaddate: "unloading",
  destination: "destination",
  dest: "destination",
  shortage: "shortage",
  short: "shortage",
  shortageqty: "shortage",
  shortagequantity: "shortage",
};

export type ImportIssue = { row: number; reason: string };

export type ImportResult = {
  rows: ShipmentDraft[];
  issues: ImportIssue[];
};

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return "";
  return String(value).trim();
}

function dateFromCell(
  value: unknown,
  month: number,
  year: number,
): { ok: true; iso: string } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: false, error: "Missing date" };
  if (value instanceof Date) {
    const iso = utcDateToIso(value);
    return iso ? { ok: true, iso } : { ok: false, error: "Invalid date" };
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31) {
    const parsed = parseFlexibleDate(String(value), { month, year });
    return parsed.ok ? { ok: true, iso: parsed.iso } : parsed;
  }
  if (typeof value === "number" || typeof value === "string") {
    const parsed = parseFlexibleDate(String(value), { month, year });
    return parsed.ok ? { ok: true, iso: parsed.iso } : { ok: false, error: parsed.error };
  }
  return { ok: false, error: "Invalid date" };
}

export function parseTable(
  matrix: unknown[][],
  month: number,
  year: number,
  destinations: CatalogItem[],
): ImportResult {
  const issues: ImportIssue[] = [];
  const rows: ShipmentDraft[] = [];
  if (matrix.length === 0) return { rows, issues: [{ row: 1, reason: "The file is empty" }] };

  const first = matrix[0].map((cell) => (cell == null ? "" : String(cell)));
  const mapped = first.map((cell) => HEADER_FIELDS[headerKey(cell)] ?? null);
  const recognized = mapped.filter(Boolean).length;
  const hasHeader = recognized >= 2;
  const indexes: Record<Field, number> = hasHeader
    ? {
        vehicle: mapped.indexOf("vehicle"),
        loading: mapped.indexOf("loading"),
        unloading: mapped.indexOf("unloading"),
        destination: mapped.indexOf("destination"),
        shortage: mapped.indexOf("shortage"),
      }
    : { vehicle: 0, loading: 1, unloading: 2, destination: 3, shortage: 4 };

  if (hasHeader && (indexes.vehicle < 0 || indexes.loading < 0 || indexes.unloading < 0 || indexes.destination < 0)) {
    return {
      rows,
      issues: [
        {
          row: 1,
          reason: "Need columns for vehicle, loading date, unloading date, and destination",
        },
      ],
    };
  }

  const body = hasHeader ? matrix.slice(1) : matrix;
  let knownDestinations = destinations.slice();
  body.forEach((line, offset) => {
    const rowNumber = offset + (hasHeader ? 2 : 1);
    const blank = line.every((cell) => cell == null || String(cell).trim() === "");
    if (blank) return;
    const vehicle = normalizeVehicle(cellText(line[indexes.vehicle]));
    if (!vehicle) {
      issues.push({ row: rowNumber, reason: "Missing vehicle number" });
      return;
    }
    const loading = dateFromCell(line[indexes.loading], month, year);
    if (!loading.ok) {
      issues.push({ row: rowNumber, reason: `Loading date: ${loading.error}` });
      return;
    }
    const unloading = dateFromCell(line[indexes.unloading], month, year);
    if (!unloading.ok) {
      issues.push({ row: rowNumber, reason: `Unloading date: ${unloading.error}` });
      return;
    }
    if (unloading.iso < loading.iso) {
      issues.push({
        row: rowNumber,
        reason: `Unloading ${formatDMY(unloading.iso)} is before loading ${formatDMY(loading.iso)}`,
      });
      return;
    }
    const destination = canonicalDestination(knownDestinations, cellText(line[indexes.destination]));
    if (!destination) {
      issues.push({ row: rowNumber, reason: "Missing destination" });
      return;
    }
    knownDestinations = ensureCatalog(knownDestinations, destination);
    const shortageRaw =
      indexes.shortage >= 0 && line[indexes.shortage] != null ? String(line[indexes.shortage]) : "";
    const shortage = parseShortage(shortageRaw);
    if (!shortage.ok) {
      issues.push({ row: rowNumber, reason: shortage.error });
      return;
    }
    rows.push({
      vehicle,
      loading: loading.iso,
      unloading: unloading.iso,
      destination,
      shortage: shortage.value,
    });
  });

  if (rows.length + issues.length === 0) {
    issues.push({ row: 1, reason: "No shipment rows found" });
  }
  return { rows, issues };
}

export function parseClipboard(
  text: string,
  month: number,
  year: number,
  destinations: CatalogItem[],
): ImportResult {
  const matrix = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
  return parseTable(matrix, month, year, destinations);
}

export async function readExcelFile(
  file: File,
  month: number,
  year: number,
  destinations: CatalogItem[],
): Promise<ImportResult> {
  const { readSheet } = await import("read-excel-file/browser");
  const matrix = await readSheet(file);
  return parseTable(matrix as unknown[][], month, year, destinations);
}

export function buildExcelRows(records: Shipment[]) {
  const head = {
    fontWeight: "bold" as const,
    backgroundColor: "#1e4d5c",
    textColor: "#f3f7f8",
    alignVertical: "center" as const,
  };
  const ordered = [...records].sort((a, b) => a.loading.localeCompare(b.loading) || a.createdAt - b.createdAt);
  return [
    [
      { value: "Vehicle Number", ...head },
      { value: "Vehicle Loading Date", ...head },
      { value: "Vehicle Unloading Date", ...head },
      { value: "Destination", ...head },
      { value: "Shortage", ...head, align: "right" as const },
    ],
    ...ordered.map((row) => [
      { value: row.vehicle, type: String },
      { value: isoToUtcDate(row.loading), type: Date, format: "dd/mm/yyyy" },
      { value: isoToUtcDate(row.unloading), type: Date, format: "dd/mm/yyyy" },
      { value: row.destination, type: String },
      row.shortage == null
        ? null
        : { value: row.shortage, type: Number, format: "#,##0.###", align: "right" as const },
    ]),
  ];
}

export async function downloadExcel(records: Shipment[]): Promise<void> {
  const writeXlsxFile = (await import("write-excel-file/browser")).default;
  const stamp = new Date();
  const name = `Load-Ledger-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}.xlsx`;
  await writeXlsxFile(buildExcelRows(records), {
    sheet: "Shipments",
    dateFormat: "dd/mm/yyyy",
    stickyRowsCount: 1,
    columns: [{ width: 20 }, { width: 24 }, { width: 26 }, { width: 24 }, { width: 14 }],
  }).toFile(name);
}

export type BackupFile = {
  version: 1;
  exportedAt: string;
  app: "Load Ledger";
  records: Shipment[];
  vehicles: CatalogItem[];
  destinations: CatalogItem[];
  month: number;
  year: number;
};

function isIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCatalog(value: unknown): value is CatalogItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as CatalogItem).name === "string" &&
        typeof (item as CatalogItem).uses === "number" &&
        typeof (item as CatalogItem).lastUsed === "number",
    )
  );
}

export function serializeBackup(data: Omit<BackupFile, "version" | "exportedAt" | "app">): string {
  const payload: BackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "Load Ledger",
    ...data,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadBackup(data: Omit<BackupFile, "version" | "exportedAt" | "app">): void {
  const blob = new Blob([serializeBackup(data)], { type: "application/json" });
  const stamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Load-Ledger-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function parseBackup(text: string): { ok: true; data: BackupFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON" };
  }
  if (!json || typeof json !== "object") return { ok: false, error: "Backup file is empty" };
  const raw = json as Partial<BackupFile>;
  if (!Array.isArray(raw.records)) return { ok: false, error: "Backup is missing shipments" };
  if (raw.records.length > 20000) return { ok: false, error: "Backup is too large" };
  const records: Shipment[] = [];
  for (let index = 0; index < raw.records.length; index += 1) {
    const row = raw.records[index] as Partial<Shipment>;
    if (!row || typeof row.vehicle !== "string" || !normalizeVehicle(row.vehicle)) {
      return { ok: false, error: `Row ${index + 1} has no vehicle number` };
    }
    if (!isIso(row.loading) || !isIso(row.unloading)) {
      return { ok: false, error: `Row ${index + 1} has an invalid date` };
    }
    if (typeof row.destination !== "string" || !normalizeDestination(row.destination)) {
      return { ok: false, error: `Row ${index + 1} has no destination` };
    }
    const shortage = row.shortage == null ? null : row.shortage;
    if (shortage != null && (typeof shortage !== "number" || shortage < 0)) {
      return { ok: false, error: `Row ${index + 1} has an invalid shortage` };
    }
    records.push({
      id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
      vehicle: normalizeVehicle(row.vehicle),
      loading: row.loading,
      unloading: row.unloading,
      destination: normalizeDestination(row.destination),
      shortage,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    });
  }
  const month = typeof raw.month === "number" && raw.month >= 1 && raw.month <= 12 ? raw.month : 1;
  const year = typeof raw.year === "number" && raw.year >= 1980 && raw.year <= 2100 ? raw.year : 2026;
  return {
    ok: true,
    data: {
      version: 1,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      app: "Load Ledger",
      records,
      vehicles: isCatalog(raw.vehicles) ? raw.vehicles : [],
      destinations: isCatalog(raw.destinations) ? raw.destinations : [],
      month,
      year,
    },
  };
}

export function periodLabel(month: number, year: number): string {
  return `${MONTH_LONG[month - 1]} ${year}`;
}
