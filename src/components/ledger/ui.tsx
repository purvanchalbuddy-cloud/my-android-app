import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "soft";

export function Button({
  variant = "ghost",
  icon = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    ghost: "border border-line bg-sheet text-ink hover:bg-row",
    danger: "bg-danger text-accent-ink hover:opacity-90",
    soft: "border border-transparent bg-accent-soft text-accent hover:opacity-80",
  };
  const pad = icon ? "w-11 px-0" : "px-3";
  return (
    <button
      type={type}
      className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${pad} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function FieldLabel({ children, dot }: { children: ReactNode; dot?: "load" | "unload" }) {
  return (
    <span className="flex h-5 items-center gap-2 text-xs font-medium text-muted">
      {dot ? <span className={`size-2 rounded-full ${dot === "load" ? "bg-load" : "bg-unload"}`} /> : null}
      {children}
    </span>
  );
}
