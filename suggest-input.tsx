import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type Suggestion = { key: string; label: string; meta?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  moreCount?: number;
  extraLabel?: string | null;
  onPick: (label: string) => void;
  onExtra?: () => void;
  onEnter: () => void;
  onCtrlEnter?: () => void;
  onEscape?: () => void;
  onTab?: (shift: boolean) => void;
  onFieldBlur?: () => void;
  placeholder?: string;
  ariaLabel: string;
  mono?: boolean;
  autoFocus?: boolean;
  variant?: "field" | "cell";
  transform?: (value: string) => string;
  testId?: string;
};

export const SuggestInput = forwardRef<HTMLInputElement, Props>(function SuggestInput(
  {
    value,
    onChange,
    suggestions,
    moreCount = 0,
    extraLabel,
    onPick,
    onExtra,
    onEnter,
    onCtrlEnter,
    onEscape,
    onTab,
    onFieldBlur,
    placeholder,
    ariaLabel,
    mono = false,
    autoFocus,
    variant = "field",
    transform,
    testId,
  },
  ref,
) {
  const listId = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const optionCount = suggestions.length + (extraLabel ? 1 : 0);

  useEffect(() => {
    setHighlight(-1);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = localRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(rect.width, 260);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 200 && rect.top > spaceBelow) {
        setBox({ bottom: window.innerHeight - rect.top + 4, left, width });
      } else {
        setBox({ top: rect.bottom + 4, left, width });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, suggestions.length, extraLabel, value]);

  useEffect(() => {
    if (highlight < 0) return;
    document.getElementById(`${listId}-opt-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, listId]);

  function setNode(node: HTMLInputElement | null) {
    localRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      onCtrlEnter?.();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (optionCount === 0) return;
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => {
        if (event.key === "ArrowDown") return current + 1 >= optionCount ? 0 : current + 1;
        return current - 1 < 0 ? optionCount - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Tab" && onTab) {
      event.preventDefault();
      onTab(event.shiftKey);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (highlight >= 0 && highlight < suggestions.length) onPick(suggestions[highlight].label);
      else if (extraLabel && highlight === suggestions.length) onExtra?.();
      else onEnter();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setHighlight(-1);
      onEscape?.();
    }
  }

  const list =
    open && optionCount > 0 && box
      ? createPortal(
          <div
            id={listId}
            role="listbox"
            style={box}
            className="fixed z-40 max-h-72 overflow-auto rounded-md border border-line bg-sheet shadow-pop"
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
                id={`${listId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={highlight === index}
                className={`flex min-h-11 w-full flex-col items-start justify-center px-3 py-1.5 text-left ${highlight === index ? "bg-accent-soft" : "hover:bg-row"}`}
                onClick={() => onPick(suggestion.label)}
              >
                <span className={`text-sm text-ink ${mono ? "font-mono" : ""}`}>{suggestion.label}</span>
                {suggestion.meta ? <span className="text-xs text-muted">{suggestion.meta}</span> : null}
              </button>
            ))}
            {extraLabel ? (
              <button
                id={`${listId}-opt-${suggestions.length}`}
                type="button"
                role="option"
                aria-selected={highlight === suggestions.length}
                className={`flex min-h-11 w-full items-center px-3 text-left text-sm text-accent ${highlight === suggestions.length ? "bg-accent-soft" : "hover:bg-row"}`}
                onClick={() => onExtra?.()}
              >
                {extraLabel}
              </button>
            ) : null}
            {moreCount > 0 ? (
              <p className="border-t border-line px-3 py-2 text-xs text-faint">
                {moreCount} more. Keep typing to narrow the list.
              </p>
            ) : (
              <p className="border-t border-line px-3 py-2 text-xs text-faint">Arrows choose · Enter accepts</p>
            )}
          </div>,
          document.body,
        )
      : null;

  const fieldClass =
    variant === "cell"
      ? "h-10 w-full border-0 bg-transparent px-0 text-sm text-ink outline-none"
      : "h-11 w-full rounded-md border border-line bg-sheet px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25";

  return (
    <>
      <input
        ref={setNode}
        value={value}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && optionCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        data-testid={testId}
        className={`${fieldClass} ${mono ? "font-mono uppercase" : ""}`}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
          onFieldBlur?.();
        }}
        onChange={(event) => onChange(transform ? transform(event.target.value) : event.target.value)}
        onKeyDown={onKeyDown}
      />
      {list}
    </>
  );
});
