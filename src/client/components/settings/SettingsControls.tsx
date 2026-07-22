import type { ReactNode } from "react";

import { MaterialIcon } from "../MaterialIcon.tsx";
import type { ToastState } from "./types.ts";

export function SettingsSection({
  children,
  description,
  icon,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: string;
  id: string;
  title: string;
}) {
  return (
    <section className="scroll-mt-6 border-t border-outline-variant pt-6" id={id}>
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
          <MaterialIcon name={icon} size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-primary">{title}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}


export function SettingsTextInput({
  helpText,
  label,
  mono = false,
  onChange,
  placeholder,
  value,
}: {
  helpText?: string;
  label: string;
  mono?: boolean;
  onChange(value: string): void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase text-on-surface-variant">
        {label}
      </span>
      <input
        className={[
          "h-10 w-full rounded-sm border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface outline-none transition focus:border-outline focus:bg-surface",
          mono ? "font-mono text-xs" : "",
        ].join(" ")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {helpText ? (
        <span className="text-xs leading-5 text-on-surface-variant">{helpText}</span>
      ) : null}
    </label>
  );
}


export function SettingsNumberInput({
  helpText,
  label,
  min = 0,
  onChange,
  suffix,
  value,
}: {
  helpText?: string;
  label: string;
  min?: number;
  onChange(value: number): void;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase text-on-surface-variant">
        {label}
      </span>
      <div className="flex min-w-0 items-center rounded-sm border border-outline-variant bg-surface-container-low transition focus-within:border-outline focus-within:bg-surface">
        <input
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-on-surface outline-none"
          min={min}
          onChange={(event) => onChange(normalizeIntegerInput(event.target.value, min))}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="shrink-0 border-l border-outline-variant px-3 text-xs font-medium text-on-surface-variant">
            {suffix}
          </span>
        ) : null}
      </div>
      {helpText ? (
        <span className="text-xs leading-5 text-on-surface-variant">{helpText}</span>
      ) : null}
    </label>
  );
}


export function SettingsSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className="relative inline-flex h-7 w-12 shrink-0 items-center">
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="absolute inset-0 rounded-full border border-outline-variant bg-surface-container-low transition peer-checked:border-primary peer-checked:bg-primary peer-disabled:opacity-45" />
      <span className="absolute left-1 h-5 w-5 rounded-full bg-on-surface-variant transition peer-checked:translate-x-5 peer-checked:bg-on-primary peer-disabled:opacity-45" />
    </label>
  );
}


export function SettingsAlert({ message, tone }: { message: string; tone: "error" | "info" }) {
  return (
    <p
      className={[
        "mt-4 rounded-sm border px-3 py-2 text-sm font-medium",
        tone === "error"
          ? "border-error/40 bg-error-container text-error"
          : "border-outline-variant bg-surface-container-low text-on-surface-variant",
      ].join(" ")}
    >
      {message}
    </p>
  );
}


export function normalizeIntegerInput(value: string, min: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.max(min, Math.floor(parsed));
}


export function PrimaryButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container hover:text-on-primary-container focus:border-outline focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <MaterialIcon name={icon} size={18} />
      {label}
    </button>
  );
}


export function SecondaryButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface-container-low px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <MaterialIcon name={icon} size={18} />
      {label}
    </button>
  );
}


export function ToastNotification({ toast }: { toast: ToastState | null }) {
  if (!toast) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="truss-toast fixed bottom-6 right-6 z-170 max-w-sm rounded-sm border border-outline-variant bg-surface px-4 py-3 text-sm font-medium text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.18)]"
      key={toast.id}
      role="status"
    >
      {toast.message}
    </div>
  );
}

