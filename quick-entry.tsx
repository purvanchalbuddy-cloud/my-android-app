import { useEffect, useRef, useState } from "react";
import { formatDMY, formatPretty, MONTH_LONG, parseFlexibleDate } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import {
  catalogMeta,
  destinationKey,
  filterMatches,
  normalizeDestination,
  normalizeVehicle,
  parseShortage,
  rankCatalog,
  resolveEntry,
} from "@/lib/ledger/text";
import type { Shipment } from "@/lib/ledger/types";
import { SuggestInput } from "@/components/ledger/suggest-input";
import { Button, FieldLabel } from "@/components/ledger/ui";

export function QuickEntry({ onSaved }: { onSaved: (shipment: Shipment) => void }) {
  const month = useLedger((state) => state.month);
  const year = useLedger((state) => state.year);
  const vehicles = useLedger((state) => state.vehicles);
  const destinations = useLedger((state) => state.destinations);
  const addShipment = useLedger((state) => state.addShipment);

  const [vehicle, setVehicle] = useState("");
  const [vehicleLock, setVehicleLock] = useState(false);
  const [loading, setLoading] = useState("");
  const [unloading, setUnloading] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationLock, setDestinationLock] = useState(false);
  const [shortage, setShortage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const vehicleRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef<HTMLInputElement>(null);
  const unloadingRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const shortageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) vehicleRef.current?.focus();
  }, []);

  const period = `${MONTH_LONG[month - 1]} ${year}`;
  const vehicleRank = rankCatalog(vehicles, vehicle, normalizeVehicle);
  const vehicleNorm = normalizeVehicle(vehicle);
  const destinationRank = rankCatalog(destinations, destination, destinationKey);
  const destinationNorm = normalizeDestination(destination);

  function acceptVehicle(force: boolean): string | null {
    if (force || vehicleLock) {
      if (!vehicleNorm) {
        setError("Enter a vehicle number");
        return null;
      }
      setVehicle(vehicleNorm);
      setVehicleLock(true);
      return vehicleNorm;
    }
    const resolved = resolveEntry(
      vehicle,
      filterMatches(vehicles, vehicle, normalizeVehicle),
      normalizeVehicle,
      "vehicle",
    );
    if (!resolved.ok) {
      setError(resolved.error);
      return null;
    }
    setVehicle(resolved.value);
    setVehicleLock(true);
    return resolved.value;
  }

  function acceptDestination(force: boolean): string | null {
    if (force || destinationLock) {
      if (!destinationNorm) {
        setError("Enter a destination");
        return null;
      }
      setDestination(destinationNorm);
      setDestinationLock(true);
      return destinationNorm;
    }
    const resolved = resolveEntry(
      destination,
      filterMatches(destinations, destination, destinationKey),
      destinationKey,
      "destination",
      normalizeDestination,
    );
    if (!resolved.ok) {
      setError(resolved.error);
      return null;
    }
    setDestination(resolved.value);
    setDestinationLock(true);
    return resolved.value;
  }

  function save(force = false) {
    const vehicleName = acceptVehicle(force);
    if (!vehicleName) {
      vehicleRef.current?.focus();
      return;
    }
    const loaded = parseFlexibleDate(loading, { month, year });
    if (!loaded.ok) {
      setError(`Loading date: ${loaded.error}`);
      loadingRef.current?.focus();
      return;
    }
    const unloadSource = unloading.trim() === "=" ? loading : unloading;
    const unloaded = parseFlexibleDate(unloadSource, { month, year });
    if (!unloaded.ok) {
      setError(`Unloading date: ${unloaded.error}`);
      unloadingRef.current?.focus();
      return;
    }
    if (unloaded.iso < loaded.iso) {
      setError(`Unloading ${formatDMY(unloaded.iso)} is before loading ${formatDMY(loaded.iso)}`);
      unloadingRef.current?.focus();
      return;
    }
    const destinationName = acceptDestination(force);
    if (!destinationName) {
      destinationRef.current?.focus();
      return;
    }
    const short = parseShortage(shortage);
    if (!short.ok) {
      setError(short.error);
      shortageRef.current?.focus();
      return;
    }
    const shipment = addShipment({
      vehicle: vehicleName,
      loading: loaded.iso,
      unloading: unloaded.iso,
      destination: destinationName,
      shortage: short.value,
    });
    setVehicle("");
    setVehicleLock(false);
    setLoading("");
    setUnloading("");
    setDestination("");
    setDestinationLock(false);
    setShortage("");
    setError(null);
    onSaved(shipment);
    vehicleRef.current?.focus();
  }

  function advanceDate(
    raw: string,
    allowSame: boolean,
    next: HTMLInputElement | null,
    label: string,
  ): boolean {
    if (allowSame && raw.trim() === "=") {
      const loaded = parseFlexibleDate(loading, { month, year });
      if (!loaded.ok) {
        setError("Enter the loading date first");
        return false;
      }
      setUnloading(formatDMY(loaded.iso));
      setError(null);
      next?.focus();
      return true;
    }
    const parsed = parseFlexibleDate(raw, { month, year });
    if (!parsed.ok) {
      setError(`${label}: ${parsed.error}`);
      return false;
    }
    if (label === "Loading date") setLoading(formatDMY(parsed.iso));
    else setUnloading(formatDMY(parsed.iso));
    setError(null);
    next?.focus();
    return true;
  }

  const loadingHint = hintFor(loading, month, year, false);
  const unloadingHint = hintFor(unloading, month, year, true);

  return (
    <form
      data-quick-entry
      className="rounded-xl border border-line bg-sheet p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          save(true);
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z" &&
          !event.shiftKey &&
          !vehicle &&
          !loading &&
          !unloading &&
          !destination &&
          !shortage
        ) {
          event.preventDefault();
          useLedger.getState().undo();
        }
      }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">New shipment</h2>
        <p className="text-xs text-muted">Day numbers use {period}. Full dates stay as typed.</p>
      </div>
      <div className="entry-grid">
        <label className="grid gap-1">
          <FieldLabel>Vehicle number</FieldLabel>
          <SuggestInput
            ref={vehicleRef}
            value={vehicle}
            mono
            ariaLabel="Vehicle number"
            placeholder="UP65AG2021"
            testId="quick-vehicle"
            suggestions={vehicleRank.shown.map((item) => ({
              key: item.name,
              label: item.name,
              meta: catalogMeta(item),
            }))}
            moreCount={Math.max(0, vehicleRank.total - vehicleRank.shown.length)}
            extraLabel={vehicleNorm && !vehicles.some((item) => item.name === vehicleNorm) ? `Use ${vehicleNorm} as typed` : null}
            transform={(value) => value.toUpperCase()}
            onChange={(value) => {
              setVehicle(value);
              setVehicleLock(false);
              setError(null);
            }}
            onPick={(label) => {
              setVehicle(label);
              setVehicleLock(true);
              setError(null);
              loadingRef.current?.focus();
            }}
            onExtra={() => {
              if (!vehicleNorm) return;
              setVehicle(vehicleNorm);
              setVehicleLock(true);
              setError(null);
              loadingRef.current?.focus();
            }}
            onEnter={() => {
              if (acceptVehicle(false)) loadingRef.current?.focus();
            }}
            onCtrlEnter={() => save(true)}
          />
          <span className="h-4 text-xs text-faint">Suggestions stay on this device</span>
        </label>
        <label className="grid gap-1">
          <FieldLabel dot="load">Loading date</FieldLabel>
          <input
            ref={loadingRef}
            value={loading}
            aria-label="Loading date"
            placeholder="2"
            data-testid="quick-loading"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-md border border-line bg-sheet px-3 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setLoading(event.target.value);
              setError(null);
            }}
            onBlur={() => {
              const parsed = parseFlexibleDate(loading, { month, year });
              if (parsed.ok) setLoading(formatDMY(parsed.iso));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                advanceDate(loading, false, unloadingRef.current, "Loading date");
              }
            }}
          />
          <span className={`h-4 truncate font-mono text-xs ${loadingHint.bad ? "text-danger" : "text-muted"}`}>
            {loadingHint.text}
          </span>
        </label>
        <label className="grid gap-1">
          <FieldLabel dot="unload">Unloading date</FieldLabel>
          <input
            ref={unloadingRef}
            value={unloading}
            aria-label="Unloading date"
            placeholder="4 or ="
            data-testid="quick-unloading"
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-md border border-line bg-sheet px-3 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setUnloading(event.target.value);
              setError(null);
            }}
            onBlur={() => {
              if (unloading.trim() === "=") return;
              const parsed = parseFlexibleDate(unloading, { month, year });
              if (parsed.ok) setUnloading(formatDMY(parsed.iso));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                advanceDate(unloading, true, destinationRef.current, "Unloading date");
              }
            }}
          />
          <span className={`h-4 truncate font-mono text-xs ${unloadingHint.bad ? "text-danger" : "text-muted"}`}>
            {unloadingHint.text}
          </span>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Destination</FieldLabel>
          <SuggestInput
            ref={destinationRef}
            value={destination}
            ariaLabel="Destination"
            placeholder="Kanpur"
            testId="quick-destination"
            suggestions={destinationRank.shown.map((item) => ({
              key: item.name,
              label: item.name,
              meta: catalogMeta(item),
            }))}
            moreCount={Math.max(0, destinationRank.total - destinationRank.shown.length)}
            extraLabel={
              destinationNorm && !destinations.some((item) => destinationKey(item.name) === destinationKey(destinationNorm))
                ? `Use ${destinationNorm} as typed`
                : null
            }
            onChange={(value) => {
              setDestination(value);
              setDestinationLock(false);
              setError(null);
            }}
            onPick={(label) => {
              setDestination(label);
              setDestinationLock(true);
              setError(null);
              shortageRef.current?.focus();
            }}
            onExtra={() => {
              if (!destinationNorm) return;
              setDestination(destinationNorm);
              setDestinationLock(true);
              setError(null);
              shortageRef.current?.focus();
            }}
            onEnter={() => {
              if (acceptDestination(false)) shortageRef.current?.focus();
            }}
            onCtrlEnter={() => save(true)}
          />
          <span className="h-4 text-xs text-faint">Previous destinations appear here</span>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Shortage</FieldLabel>
          <input
            ref={shortageRef}
            value={shortage}
            aria-label="Shortage"
            placeholder="0"
            data-testid="quick-shortage"
            inputMode="decimal"
            autoComplete="off"
            className="h-11 rounded-md border border-line bg-sheet px-3 font-mono text-sm text-ink tabular-nums outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setShortage(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save(false);
              }
            }}
          />
          <span className="h-4 text-xs text-faint">Blank if none</span>
        </label>
        <div className="grid gap-1">
          <span className="hidden h-5 md:block" />
          <Button variant="primary" type="submit" data-testid="quick-save" className="md:min-w-36">
            Add shipment
          </Button>
        </div>
      </div>
      <p className="mt-2 min-h-5 text-sm text-danger" role="alert">
        {error ?? ""}
      </p>
    </form>
  );
}

function hintFor(raw: string, month: number, year: number, allowSame: boolean): { text: string; bad: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: `Day in ${MONTH_LONG[month - 1]} ${year}`, bad: false };
  if (allowSame && trimmed === "=") return { text: "Same as loading", bad: false };
  const parsed = parseFlexibleDate(trimmed, { month, year });
  if (!parsed.ok) return { text: parsed.error, bad: true };
  const text = `${formatDMY(parsed.iso)} · ${formatPretty(parsed.iso)}`;
  return { text: parsed.source === "full" ? `${text} · full date` : text, bad: false };
}
