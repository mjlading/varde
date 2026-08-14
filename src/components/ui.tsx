import type { ReactNode } from "react";

/* -------------------------------- Button ---------------------------------- */

type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant} ${className}`}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Toggle --------------------------------- */

export function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-on={on}
      className="toggle"
      onClick={() => onChange(!on)}
    />
  );
}

export function ToggleRow({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="row-item">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 550, fontSize: 15 }}>{label}</div>
        {sub && (
          <div className="text-3" style={{ fontSize: 12.5, marginTop: 3 }}>
            {sub}
          </div>
        )}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/* ------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Field ---------------------------------- */

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  autoFocus,
  mono,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  autoFocus?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      {label && <label className="field-label">{label}</label>}
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        style={mono ? { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 13.5 } : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
