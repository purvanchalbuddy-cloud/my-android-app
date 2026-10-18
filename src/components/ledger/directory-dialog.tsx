import { useMemo, useState } from "react";
import { useLedger } from "@/lib/ledger/store";
import { catalogMeta, type CatalogItem } from "@/lib/ledger/text";
import { Dialog } from "@/components/ledger/dialog";
import { Button } from "@/components/ledger/ui";

export function DirectoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vehicles = useLedger((state) => state.vehicles);
  const destinations = useLedger((state) => state.destinations);

  return (
    <Dialog
      open={open}
      wide
      title="Saved names"
      description="Suggestions are kept even if you delete a shipment. Renaming updates the sheet."
      onClose={onClose}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <CatalogEditor
          title="Vehicles"
          items={vehicles}
          placeholder="UP65AG2021"
          mono
          onAdd={(name) => useLedger.getState().addVehicle(name)}
          onRename={(from, to) => useLedger.getState().renameVehicle(from, to)}
          onRemove={(name) => useLedger.getState().removeVehicle(name)}
        />
        <CatalogEditor
          title="Destinations"
          items={destinations}
          placeholder="Kanpur"
          onAdd={(name) => useLedger.getState().addDestination(name)}
          onRename={(from, to) => useLedger.getState().renameDestination(from, to)}
          onRemove={(name) => useLedger.getState().removeDestination(name)}
        />
      </div>
    </Dialog>
  );
}

function CatalogEditor({
  title,
  items,
  placeholder,
  mono = false,
  onAdd,
  onRename,
  onRemove,
}: {
  title: string;
  items: CatalogItem[];
  placeholder: string;
  mono?: boolean;
  onAdd: (name: string) => string | null;
  onRename: (from: string, to: string) => number;
  onRemove: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [rename, setRename] = useState<{ name: string; value: string } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...items]
      .filter((item) => !q || item.name.toLowerCase().includes(q))
      .sort((a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed || a.name.localeCompare(b.name));
  }, [items, query]);

  return (
    <section>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const error = onAdd(draft);
          setMessage(error);
          if (!error) setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(mono ? event.target.value.toUpperCase() : event.target.value)}
          placeholder={placeholder}
          aria-label={`Add ${title.toLowerCase()}`}
          className={`h-11 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-accent ${mono ? "font-mono uppercase" : ""}`}
        />
        <Button variant="soft" type="submit">
          Add
        </Button>
      </form>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter"
        aria-label={`Filter ${title.toLowerCase()}`}
        className="mt-2 h-11 w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-accent"
      />
      {message ? <p className="mt-2 text-sm text-danger">{message}</p> : null}
      <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
        {shown.length === 0 ? <li className="text-sm text-muted">Nothing saved yet.</li> : null}
        {shown.map((item) => (
          <li key={item.name} className="rounded-md border border-line px-3 py-2">
            {rename?.name === item.name ? (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const changed = onRename(item.name, rename.value);
                  setMessage(changed ? `Updated ${changed} saved ${changed === 1 ? "row" : "rows"}.` : "Name saved.");
                  setRename(null);
                }}
              >
                <input
                  value={rename.value}
                  onChange={(event) =>
                    setRename({ name: item.name, value: mono ? event.target.value.toUpperCase() : event.target.value })
                  }
                  aria-label={`Rename ${item.name}`}
                  className={`h-11 min-w-0 flex-1 rounded-md border border-line px-3 text-sm outline-none ${mono ? "font-mono" : ""}`}
                />
                <Button variant="primary" type="submit">
                  Save
                </Button>
                <Button type="button" onClick={() => setRename(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate text-sm ${mono ? "font-mono" : ""}`}>{item.name}</p>
                  <p className="text-xs text-muted">{catalogMeta(item)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button className="h-9 px-2" onClick={() => setRename({ name: item.name, value: item.name })}>
                    Rename
                  </Button>
                  {pendingRemove === item.name ? (
                    <Button
                      variant="danger"
                      className="h-9 px-2"
                      onClick={() => {
                        onRemove(item.name);
                        setPendingRemove(null);
                      }}
                    >
                      Confirm
                    </Button>
                  ) : (
                    <Button className="h-9 px-2" onClick={() => setPendingRemove(item.name)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
