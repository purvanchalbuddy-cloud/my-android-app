import assert from "node:assert/strict";
import test from "node:test";
import { formatDMY, formatPretty, parseFlexibleDate, shiftMonth } from "./dates.ts";
import { filterMatches, normalizeVehicle, parseShortage, resolveEntry } from "./text.ts";
import type { CatalogItem } from "./text.ts";

const aug = { month: 8, year: 2026 };

test("day-only dates use the selected month and year", () => {
  assert.deepEqual(parseFlexibleDate("2", aug), { ok: true, iso: "2026-08-02", source: "day" });
  assert.deepEqual(parseFlexibleDate("15", aug), { ok: true, iso: "2026-08-15", source: "day" });
  assert.deepEqual(parseFlexibleDate("28", aug), { ok: true, iso: "2026-08-28", source: "day" });
  assert.equal(formatDMY("2026-08-02"), "02/08/2026");
  assert.equal(formatPretty("2026-08-02"), "2 Aug 2026");
});

test("invalid days and full dates", () => {
  const april = parseFlexibleDate("31", { month: 4, year: 2026 });
  assert.equal(april.ok, false);
  const leap = parseFlexibleDate("29", { month: 2, year: 2024 });
  assert.equal(leap.ok && leap.iso, "2024-02-29");
  const nonLeap = parseFlexibleDate("29", { month: 2, year: 2026 });
  assert.equal(nonLeap.ok, false);
  assert.deepEqual(parseFlexibleDate("02/08/2026", aug).ok && parseFlexibleDate("02/08/2026", aug), {
    ok: true,
    iso: "2026-08-02",
    source: "full",
  });
  assert.equal(parseFlexibleDate("15/09/2026", aug).ok && parseFlexibleDate("15/09/2026", aug).iso, "2026-09-15");
  assert.equal(parseFlexibleDate("2026-08-02", aug).ok && parseFlexibleDate("2026-08-02", aug).iso, "2026-08-02");
  assert.equal(parseFlexibleDate("2 Aug 2026", aug).ok && parseFlexibleDate("2 Aug 2026", aug).iso, "2026-08-02");
  assert.equal(parseFlexibleDate("2 August", aug).ok && parseFlexibleDate("2 August", aug).iso, "2026-08-02");
  assert.equal(parseFlexibleDate("15/08/26", aug).ok && parseFlexibleDate("15/08/26", aug).iso, "2026-08-15");
});

test("month stepping wraps the year", () => {
  assert.deepEqual(shiftMonth(12, 2026, 1), { month: 1, year: 2027 });
  assert.deepEqual(shiftMonth(1, 2026, -1), { month: 12, year: 2025 });
});

test("shortage parsing", () => {
  assert.deepEqual(parseShortage(""), { ok: true, value: null });
  assert.deepEqual(parseShortage("1.5"), { ok: true, value: 1.5 });
  assert.deepEqual(parseShortage("1,250"), { ok: true, value: 1250 });
  assert.deepEqual(parseShortage("12,5"), { ok: true, value: 12.5 });
  assert.equal(parseShortage("-1").ok, false);
});

test("vehicle suggestions do not guess among several matches", () => {
  const items: CatalogItem[] = [
    { name: "UP65AG2021", uses: 4, lastUsed: 2 },
    { name: "UP65AG2022", uses: 9, lastUsed: 3 },
    { name: "MH12AB0001", uses: 1, lastUsed: 1 },
  ];
  const matches = filterMatches(items, "UP65AG", normalizeVehicle);
  const ambiguous = resolveEntry("UP65AG", matches, normalizeVehicle, "vehicle");
  assert.equal(ambiguous.ok, false);
  const unique = resolveEntry("UP65AG202", filterMatches(items, "UP65AG202", normalizeVehicle), normalizeVehicle, "vehicle");
  assert.equal(unique.ok, false);
  const one = resolveEntry("MH12", filterMatches(items, "MH12", normalizeVehicle), normalizeVehicle, "vehicle");
  assert.deepEqual(one, { ok: true, value: "MH12AB0001" });
  const exact = resolveEntry("UP65AG2021", matches, normalizeVehicle, "vehicle");
  assert.deepEqual(exact, { ok: true, value: "UP65AG2021" });
  assert.equal(normalizeVehicle("up 65-ag 2021"), "UP65AG2021");
});
