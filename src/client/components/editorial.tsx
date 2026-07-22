import { useMemo, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export interface FilterableSelectOption {
  description?: string;
  label: string;
  searchText?: string;
  value: string;
}

export function EditorialButton({
  children,
  tone = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost";
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary"
      : tone === "secondary"
        ? "border-outline-variant bg-transparent text-on-surface hover:border-outline hover:bg-surface-container"
        : "border-transparent bg-transparent text-on-surface-variant hover:text-on-surface";

  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center gap-2 rounded border px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
        props.className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function EditorialInput({
  label,
  optional,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  optional?: boolean;
}) {
  return (
    <label className="grid gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
        {label}
        {optional ? (
          <span className="text-xs font-medium text-on-surface-variant/65">(Optional)</span>
        ) : null}
      </span>
      <input
        {...props}
        className={[
          "w-full rounded border border-outline-variant bg-surface-container-low px-4 py-3.5 text-base text-on-surface shadow-[inset_0_1px_3px_rgba(27,28,25,0.02)] outline-none transition placeholder:text-on-surface-variant/40 focus:border-primary focus:bg-surface focus:ring-1 focus:ring-primary",
          props.className ?? "",
        ].join(" ")}
      />
    </label>
  );
}

export function EditorialSelect({
  children,
  label,
  optional,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  optional?: boolean;
}) {
  return (
    <label className="grid gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
        {label}
        {optional ? (
          <span className="text-xs font-medium text-on-surface-variant/65">(Optional)</span>
        ) : null}
      </span>
      <select
        {...props}
        className={[
          "w-full cursor-pointer rounded border border-outline-variant bg-surface-container-low px-4 py-3.5 text-base text-on-surface shadow-[inset_0_1px_3px_rgba(27,28,25,0.02)] outline-none transition focus:border-primary focus:bg-surface focus:ring-1 focus:ring-primary",
          props.className ?? "",
        ].join(" ")}
      >
        {children}
      </select>
    </label>
  );
}

export function FilterableSelect({
  emptyLabel = "No matching options",
  label,
  maxVisible = 100,
  onChange,
  optional,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Filter options",
  value,
}: {
  emptyLabel?: string;
  label?: string;
  maxVisible?: number;
  onChange(value: string): void;
  optional?: boolean;
  options: FilterableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : options,
    [normalizedQuery, options],
  );
  const visibleOptions =
    selectedOption && !filteredOptions.includes(selectedOption)
      ? [selectedOption, ...filteredOptions.slice(0, maxVisible - 1)]
      : filteredOptions.slice(0, maxVisible);

  function close(): void {
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      className={[
        "truss-filterable-select relative grid gap-3",
        open ? "truss-select-open z-[120]" : "z-0",
      ].join(" ")}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          close();
        }
      }}
      ref={rootRef}
    >
      {label ? (
        <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
          {label}
          {optional ? (
            <span className="text-xs font-medium text-on-surface-variant/65">(Optional)</span>
          ) : null}
        </span>
      ) : null}
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded border border-outline-variant bg-surface-container-low px-4 py-3.5 text-left text-base text-on-surface shadow-[inset_0_1px_3px_rgba(27,28,25,0.02)] outline-none transition focus:border-primary focus:bg-surface focus:ring-1 focus:ring-primary"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={selectedOption ? "truncate" : "truncate text-on-surface-variant/55"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="text-on-surface-variant">
          v
        </span>
      </button>

      {open ? (
        <div className="truss-animate-in absolute left-0 right-0 top-full z-[120] mt-2 rounded border border-outline-variant bg-surface-container-lowest p-2 shadow-panel">
          <input
            autoFocus
            className="mb-2 w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/40 focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
          />
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {visibleOptions.map((option) => (
              <button
                aria-selected={option.value === value}
                className={[
                  "grid w-full gap-1 rounded px-3 py-2 text-left text-sm transition",
                  option.value === value
                    ? "bg-primary text-on-primary"
                    : "text-on-surface hover:bg-surface-container",
                ].join(" ")}
                key={option.value || "empty-option"}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span
                    className={[
                      "truncate text-xs",
                      option.value === value
                        ? "text-on-primary/70"
                        : "text-on-surface-variant",
                    ].join(" ")}
                  >
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))}
            {visibleOptions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-on-surface-variant">{emptyLabel}</p>
            ) : null}
          </div>
          {filteredOptions.length > visibleOptions.length ? (
            <p className="border-t border-outline-variant px-3 pt-2 text-xs leading-5 text-on-surface-variant">
              Showing {visibleOptions.length} of {filteredOptions.length}. Keep typing to narrow
              the list.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdvancedDisclosure({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="truss-disclosure border-y border-outline-variant py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-on-surface marker:hidden">
        <span>{title}</span>
        <span className="truss-disclosure-icon text-lg leading-none text-on-surface-variant">
          +
        </span>
      </summary>
      <div className="truss-disclosure-panel mt-4 text-sm leading-6 text-on-surface-variant">
        {children}
      </div>
    </details>
  );
}

export function OnboardingShell({
  children,
  step,
}: {
  children: ReactNode;
  step: number;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-surface text-on-surface">
      <div className="truss-grid pointer-events-none fixed inset-0 z-0" />
      <header className="relative z-10 mx-auto flex w-full max-w-[1120px] flex-col items-start justify-between gap-6 px-6 py-8 md:flex-row md:items-center lg:px-8">
        <div className="text-[32px] font-semibold leading-tight text-primary">Truss</div>
        <div className="flex w-full items-center gap-6 md:w-auto">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">
            Step {String(step).padStart(2, "0")} of 05
          </span>
          <div className="grid h-px flex-1 grid-cols-5 gap-2 md:w-48 md:flex-none">
            {Array.from({ length: 5 }, (_, index) => (
              <span
                className={index < step ? "bg-primary" : "bg-surface-variant"}
                key={index}
              />
            ))}
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

export function OnboardingContent({
  children,
  marginalia,
}: {
  children: ReactNode;
  marginalia?: ReactNode;
}) {
  return (
    <section className="relative z-10 mx-auto flex w-full max-w-[680px] flex-col px-6 py-12 md:py-20 lg:px-8">
      <div className="relative">
        {marginalia}
        {children}
      </div>
    </section>
  );
}

export function OnboardingFooter({
  back,
  next,
}: {
  back?: ReactNode;
  next: ReactNode;
}) {
  return (
    <div className="mt-20 border-t border-outline-variant pt-6">
      <div className="flex flex-col-reverse items-stretch justify-between gap-4 md:flex-row md:items-center">
        <div>{back}</div>
        <div className="flex justify-end">{next}</div>
      </div>
    </div>
  );
}

export function Marginalia({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <aside className="hidden xl:block absolute -left-56 top-2 w-44 border-r border-outline-variant pr-6 text-right">
      <p className="mb-2 text-sm font-medium text-on-surface">{title}</p>
      <p className="text-xs font-medium leading-relaxed text-on-surface-variant">{children}</p>
    </aside>
  );
}
