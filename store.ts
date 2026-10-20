import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CatalogItem } from "@/lib/ledger/text";
import { canonicalDestination, ensureCatalog, normalizeDestination, normalizeVehicle, sameDestination, touchCatalog } from "@/lib/ledger/text";
import type { Shipment, ShipmentDraft } from "@/lib/ledger/types";

export type Snapshot = {
  records: Shipment[];
  vehicles: CatalogItem[];
  destinations: CatalogItem[];
};

type Persisted = Snapshot & {
  month: number;
  year: number;
  periodSet: boolean;
};

type LedgerState = Persisted & {
  history: Snapshot[];
  future: Snapshot[];
  addShipment: (draft: ShipmentDraft) => Shipment;
  updateShipment: (id: string, draft: ShipmentDraft) => void;
  deleteShipment: (id: string) => void;
  importShipments: (rows: ShipmentDraft[]) => number;
  replaceAll: (data: Persisted) => void;
  eraseAll: () => void;
  undo: () => void;
  redo: () => void;
  setPeriod: (month: number, year: number) => void;
  addVehicle: (name: string) => string | null;
  renameVehicle: (from: string, to: string) => number;
  removeVehicle: (name: string) => void;
  addDestination: (name: string) => string | null;
  renameDestination: (from: string, to: string) => number;
  removeDestination: (name: string) => void;
};

const HISTORY_LIMIT = 50;

function snapshot(state: Snapshot): Snapshot {
  return {
    records: state.records,
    vehicles: state.vehicles,
    destinations: state.destinations,
  };
}

function withHistory(state: LedgerState, patch: Partial<LedgerState>): Partial<LedgerState> {
  return {
    history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
    ...patch,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

export const useSaveStatus = create<{ error: string | null }>(() => ({ error: null }));

const memoryStorage = {
  getItem: (name: string) => localStorage.getItem(name),
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
      if (useSaveStatus.getState().error) useSaveStatus.setState({ error: null });
    } catch {
      useSaveStatus.setState({
        error: "This browser could not store more data. Export a backup, then remove older rows.",
      });
    }
  },
  removeItem: (name: string) => localStorage.removeItem(name),
};

export const useLedger = create<LedgerState>()(
  persist(
    (set, get) => ({
      records: [],
      vehicles: [],
      destinations: [],
      month: 1,
      year: 2026,
      periodSet: false,
      history: [],
      future: [],
      setPeriod: (month, year) => set({ month, year, periodSet: true }),
      addShipment: (draft) => {
        const now = Date.now();
        const shipment: Shipment = { ...draft, id: newId(), createdAt: now, updatedAt: now };
        set((state) =>
          withHistory(state, {
            records: [shipment, ...state.records],
            vehicles: touchCatalog(state.vehicles, draft.vehicle, now),
            destinations: touchCatalog(state.destinations, draft.destination, now),
          }),
        );
        return shipment;
      },
      updateShipment: (id, draft) => {
        const now = Date.now();
        set((state) => {
          const previous = state.records.find((row) => row.id === id);
          const vehicles =
            previous?.vehicle === draft.vehicle
              ? ensureCatalog(state.vehicles, draft.vehicle, now)
              : touchCatalog(state.vehicles, draft.vehicle, now);
          const destinations =
            previous?.destination === draft.destination
              ? ensureCatalog(state.destinations, draft.destination, now)
              : touchCatalog(state.destinations, draft.destination, now);
          return withHistory(state, {
            records: state.records.map((row) =>
              row.id === id ? { ...row, ...draft, updatedAt: now } : row,
            ),
            vehicles,
            destinations,
          });
        });
      },
      deleteShipment: (id) => {
        set((state) =>
          withHistory(state, {
            records: state.records.filter((row) => row.id !== id),
          }),
        );
      },
      importShipments: (rows) => {
        if (rows.length === 0) return 0;
        const now = Date.now();
        const shipments: Shipment[] = rows.map((row, index) => ({
          ...row,
          id: newId(),
          createdAt: now + (rows.length - index),
          updatedAt: now,
        }));
        set((state) => {
          let vehicles = state.vehicles;
          let destinations = state.destinations;
          for (const row of rows) {
            vehicles = touchCatalog(vehicles, row.vehicle, now);
            destinations = touchCatalog(destinations, row.destination, now);
          }
          return withHistory(state, {
            records: [...shipments, ...state.records],
            vehicles,
            destinations,
          });
        });
        return shipments.length;
      },
      replaceAll: (data) => {
        set((state) =>
          withHistory(state, {
            records: data.records,
            vehicles: data.vehicles,
            destinations: data.destinations,
            month: data.month,
            year: data.year,
            periodSet: true,
          }),
        );
      },
      eraseAll: () => {
        set((state) =>
          withHistory(state, {
            records: [],
            vehicles: [],
            destinations: [],
          }),
        );
      },
      undo: () => {
        const state = get();
        const prev = state.history[state.history.length - 1];
        if (!prev) return;
        set({
          ...prev,
          history: state.history.slice(0, -1),
          future: [...state.future, snapshot(state)].slice(-HISTORY_LIMIT),
        });
      },
      redo: () => {
        const state = get();
        const next = state.future[state.future.length - 1];
        if (!next) return;
        set({
          ...next,
          future: state.future.slice(0, -1),
          history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
        });
      },
      addVehicle: (name) => {
        const vehicle = normalizeVehicle(name);
        if (!vehicle) return "Enter a vehicle number";
        if (get().vehicles.some((item) => item.name === vehicle)) return "That vehicle is already saved";
        const now = Date.now();
        set((state) =>
          withHistory(state, { vehicles: ensureCatalog(state.vehicles, vehicle, now) }),
        );
        return null;
      },
      renameVehicle: (from, to) => {
        const vehicle = normalizeVehicle(to);
        if (!vehicle || vehicle === from) return 0;
        const state = get();
        const changed = state.records.filter((row) => row.vehicle === from).length;
        const now = Date.now();
        const kept = state.vehicles.filter((item) => item.name !== from && item.name !== vehicle);
        const previous = state.vehicles.find((item) => item.name === from);
        const target = state.vehicles.find((item) => item.name === vehicle);
        kept.push({
          name: vehicle,
          uses: (previous?.uses ?? 0) + (target?.uses ?? 0),
          lastUsed: Math.max(previous?.lastUsed ?? 0, target?.lastUsed ?? 0, now),
        });
        set(
          withHistory(state, {
            vehicles: kept,
            records: state.records.map((row) =>
              row.vehicle === from ? { ...row, vehicle, updatedAt: now } : row,
            ),
          }),
        );
        return changed;
      },
      removeVehicle: (name) => {
        set((state) =>
          withHistory(state, { vehicles: state.vehicles.filter((item) => item.name !== name) }),
        );
      },
      addDestination: (name) => {
        const destination = canonicalDestination(get().destinations, name);
        if (!destination) return "Enter a destination";
        if (get().destinations.some((item) => sameDestination(item.name, destination))) {
          return "That destination is already saved";
        }
        const now = Date.now();
        set((state) =>
          withHistory(state, {
            destinations: ensureCatalog(state.destinations, destination, now),
          }),
        );
        return null;
      },
      renameDestination: (from, to) => {
        const destination = normalizeDestination(to);
        if (!destination || sameDestination(destination, from)) return 0;
        const state = get();
        const existing = state.destinations.find(
          (item) => sameDestination(item.name, destination) && item.name !== from,
        );
        const canonical = existing?.name ?? destination;
        const changed = state.records.filter((row) => row.destination === from).length;
        const now = Date.now();
        const kept = state.destinations.filter(
          (item) => item.name !== from && item.name !== canonical,
        );
        const previous = state.destinations.find((item) => item.name === from);
        kept.push({
          name: canonical,
          uses: (previous?.uses ?? 0) + (existing?.uses ?? 0),
          lastUsed: Math.max(previous?.lastUsed ?? 0, existing?.lastUsed ?? 0, now),
        });
        set(
          withHistory(state, {
            destinations: kept,
            records: state.records.map((row) =>
              row.destination === from ? { ...row, destination: canonical, updatedAt: now } : row,
            ),
          }),
        );
        return changed;
      },
      removeDestination: (name) => {
        set((state) =>
          withHistory(state, {
            destinations: state.destinations.filter((item) => item.name !== name),
          }),
        );
      },
    }),
    {
      name: "load-ledger",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => memoryStorage),
      partialize: (state) => ({
        records: state.records,
        vehicles: state.vehicles,
        destinations: state.destinations,
        month: state.month,
        year: state.year,
        periodSet: state.periodSet,
      }),
      merge: (persisted, current) => {
        const data = persisted as Partial<Persisted> | undefined;
        if (!data || !Array.isArray(data.records)) return current;
        return {
          ...current,
          records: data.records,
          vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
          destinations: Array.isArray(data.destinations) ? data.destinations : [],
          month: typeof data.month === "number" ? data.month : current.month,
          year: typeof data.year === "number" ? data.year : current.year,
          periodSet: Boolean(data.periodSet),
          history: [],
          future: [],
        };
      },
    },
  ),
);

export function prepareLedgerPeriod(): void {
  const state = useLedger.getState();
  if (state.periodSet) return;
  const now = new Date();
  useLedger.setState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    periodSet: true,
  });
}
