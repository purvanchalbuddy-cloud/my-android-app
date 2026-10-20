import { formatStamp } from "./dates.ts";

export type CatalogItem = {
  name: string;
  uses: number;
  lastUsed: number;
};

export function normalizeVehicle(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export function normalizeDestination(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function sameDestination(a: string, b: string): boolean {
  return normalizeDestination(a).toLowerCase() === normalizeDestination(b).toLowerCase();
}

export function parseShortage(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  let s = raw.trim().replace(/\s/g, "");
  if (!s || s === "—" || s === "-") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, error: "Shortage cannot be negative" };
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(s)) {
    const [whole, frac] = s.split(",");
    s = `${whole}.${frac}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: "Enter a number, or leave shortage blank" };
  const n = Number(s);
  if (!Number.isFinite(n) || n > 1_000_000_000) return { ok: false, error: "Shortage is too large" };
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

export function formatShortage(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);
}

export type Ranked = { shown: CatalogItem[]; total: number };

export function filterMatches(
  items: CatalogItem[],
  query: string,
  normalize: (value: string) => string,
): CatalogItem[] {
  const q = normalize(query);
  if (!q) return [];
  return items.filter((item) => normalize(item.name).includes(q));
}

export function rankCatalog(
  items: CatalogItem[],
  query: string,
  normalize: (value: string) => string,
  limit = 8,
): Ranked {
  const q = normalize(query);
  const pool = q ? items.filter((item) => normalize(item.name).includes(q)) : [...items];
  const sorted = [...pool].sort((a, b) => {
    if (q) {
      const an = normalize(a.name);
      const bn = normalize(b.name);
      const ae = an === q ? 1 : 0;
      const be = bn === q ? 1 : 0;
      if (ae !== be) return be - ae;
      const as = an.startsWith(q) ? 1 : 0;
      const bs = bn.startsWith(q) ? 1 : 0;
      if (as !== bs) return bs - as;
    }
    if (a.uses !== b.uses) return b.uses - a.uses;
    if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
    return a.name.localeCompare(b.name);
  });
  return { shown: sorted.slice(0, limit), total: pool.length };
}

export function resolveEntry(
  raw: string,
  matches: CatalogItem[],
  normalize: (value: string) => string,
  noun: string,
  storeAs: (value: string) => string = normalize,
): { ok: true; value: string } | { ok: false; error: string; ambiguous: boolean } {
  const stored = storeAs(raw);
  if (!stored) return { ok: false, error: `Enter a ${noun}`, ambiguous: false };
  const key = normalize(raw);
  const exact = matches.find((item) => normalize(item.name) === key);
  if (exact) return { ok: true, value: exact.name };
  if (matches.length === 1) return { ok: true, value: matches[0].name };
  if (matches.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      error: `${matches.length} ${noun}s match. Choose one, or keep “${stored}” as typed.`,
    };
  }
  return { ok: true, value: stored };
}

export function destinationKey(value: string): string {
  return normalizeDestination(value).toLowerCase();
}

export function catalogMeta(item: CatalogItem): string {
  if (item.uses <= 0) return "Saved for suggestions";
  const times = item.uses === 1 ? "1 trip" : `${item.uses} trips`;
  return item.lastUsed ? `${times} · last ${formatStamp(item.lastUsed)}` : times;
}

export function touchCatalog(list: CatalogItem[], name: string, now = Date.now()): CatalogItem[] {
  const index = list.findIndex((item) => item.name === name);
  if (index < 0) return [...list, { name, uses: 1, lastUsed: now }];
  const next = list.slice();
  next[index] = { ...next[index], uses: next[index].uses + 1, lastUsed: now };
  return next;
}

export function canonicalDestination(list: CatalogItem[], raw: string): string {
  const name = normalizeDestination(raw);
  if (!name) return "";
  return list.find((item) => sameDestination(item.name, name))?.name ?? name;
}

export function ensureCatalog(list: CatalogItem[], name: string, now = Date.now()): CatalogItem[] {
  if (list.some((item) => item.name === name)) return list;
  return [...list, { name, uses: 0, lastUsed: now }];
}
