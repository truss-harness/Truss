import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MaterialIcon } from "./MaterialIcon.tsx";
import { formatHumanReadableModelName } from "./chat/chat-utils.ts";

export interface ModelSelectorOption {
  isDefault?: boolean;
  modelId: string;
  providerId: string;
  providerLabel: string;
  source: "default" | "endpoint" | "configured";
}

export interface SelectedModel {
  modelId: string;
  providerId: string;
}

export function ModelSelector({
  disabled = false,
  loading = false,
  onChange,
  options,
  selected,
}: {
  disabled?: boolean;
  loading?: boolean;
  onChange(selection: SelectedModel): void;
  options: ModelSelectorOption[];
  selected: SelectedModel | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = selected
    ? options.find(
        (option) =>
          option.providerId === selected.providerId && option.modelId === selected.modelId,
      )
    : null;
  const visibleSelection = selectedOption ?? fallbackSelectedOption(selected, options);
  const previewModelName = visibleSelection
    ? formatHumanReadableModelName(visibleSelection.modelId)
    : loading
      ? "Loading models..."
      : "Choose model";
  const providerLabel = visibleSelection?.providerLabel ?? "No configured provider";
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            `${option.modelId} ${option.providerLabel} ${option.providerId}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : options,
    [normalizedQuery, options],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveIndex((current) => {
      if (filteredOptions.length === 0) {
        return 0;
      }

      return Math.min(current, filteredOptions.length - 1);
    });
  }, [filteredOptions.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function close(): void {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function selectOption(option: ModelSelectorOption): void {
    onChange({
      modelId: option.modelId,
      providerId: option.providerId,
    });
    close();
  }

  function openDropdown(activeIndexOverride = selectedOptionIndex(filteredOptions, selected)): void {
    setActiveIndex(activeIndexOverride >= 0 ? activeIndexOverride : 0);
    setOpen(true);
  }

  function toggleDropdown(): void {
    if (open) {
      close();
    } else {
      openDropdown();
    }
  }

  function moveActiveIndex(direction: 1 | -1): void {
    if (filteredOptions.length === 0) {
      return;
    }

    setActiveIndex((current) => {
      const nextIndex = current + direction;

      if (nextIndex < 0) {
        return filteredOptions.length - 1;
      }

      if (nextIndex >= filteredOptions.length) {
        return 0;
      }

      return nextIndex;
    });
  }

  function moveFocusedOption(direction: 1 | -1): void {
    if (filteredOptions.length === 0) {
      return;
    }

    setActiveIndex((current) => {
      const nextIndex =
        current + direction < 0
          ? filteredOptions.length - 1
          : current + direction >= filteredOptions.length
            ? 0
            : current + direction;

      window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());

      return nextIndex;
    });
  }

  function selectActiveOption(): void {
    const option = filteredOptions[activeIndex];

    if (option) {
      selectOption(option);
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openDropdown();
      } else {
        moveActiveIndex(1);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openDropdown(filteredOptions.length - 1);
      } else {
        moveActiveIndex(-1);
      }
      return;
    }

    if (event.key === "Enter" && open) {
      event.preventDefault();
      selectActiveOption();
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectActiveOption();
      return;
    }

    if (event.key === "Escape") {
      close();
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocusedOption(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocusedOption(-1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <div
      className="relative z-[110] min-w-0"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          close();
        }
      }}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-label="Select model"
        className="group/model-selector flex h-10 w-full min-w-0 items-center gap-0 rounded-sm border border-outline-variant bg-surface-container-low px-3 text-left text-sm text-on-surface transition hover:bg-surface-container focus:border-outline focus:bg-surface focus:outline-none sm:w-[360px]"
        disabled={disabled}
        onClick={toggleDropdown}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <MaterialIcon
          className="mr-3 shrink-0 text-on-surface-variant"
          name="memory"
          size={19}
        />
        <span className="grid min-w-0 flex-1 gap-0">
          <span className="block truncate font-medium">{previewModelName}</span>
          <span
            className={[
              "block max-h-0 overflow-hidden truncate text-[11px] font-medium uppercase text-on-surface-variant opacity-0 transition-all duration-200",
              open
                ? "max-h-4 opacity-100"
                : "group-hover/model-selector:max-h-4 group-hover/model-selector:opacity-100 group-focus-visible/model-selector:max-h-4 group-focus-visible/model-selector:opacity-100",
            ].join(" ")}
          >
            {providerLabel}
          </span>
        </span>
        <MaterialIcon
          className={[
            "shrink-0 overflow-hidden text-on-surface-variant transition-all duration-200",
            open
              ? "ml-3 w-5 opacity-100"
              : "ml-0 w-0 translate-x-1 opacity-0 group-hover/model-selector:ml-3 group-hover/model-selector:w-5 group-hover/model-selector:translate-x-0 group-hover/model-selector:opacity-100 group-focus-visible/model-selector:ml-3 group-focus-visible/model-selector:w-5 group-focus-visible/model-selector:translate-x-0 group-focus-visible/model-selector:opacity-100",
          ].join(" ")}
          name={open ? "expand_less" : "expand_more"}
          size={20}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-[120] mt-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-2 shadow-panel sm:right-auto sm:w-[420px]">
          <label className="flex h-10 items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-low px-3 text-on-surface-variant focus-within:border-outline focus-within:bg-surface">
            <MaterialIcon name="search" size={18} />
            <input
              autoFocus
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:ring-0"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search models..."
              type="search"
              value={query}
            />
          </label>

          <div className="mt-2 max-h-72 overflow-y-auto" role="listbox">
            {filteredOptions.map((option, index) => {
              const selectedOptionActive =
                selected?.providerId === option.providerId &&
                selected.modelId === option.modelId;
              const highlighted = index === activeIndex;

              return (
                <button
                  aria-selected={selectedOptionActive}
                  className={[
                    "grid w-full gap-1 rounded-sm px-3 py-2 text-left text-sm transition",
                    selectedOptionActive
                      ? "bg-primary text-on-primary"
                      : highlighted
                        ? "bg-surface-container text-primary"
                        : "text-on-surface hover:bg-surface-container-low",
                  ].join(" ")}
                  key={`${option.providerId}:${option.modelId}`}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onKeyDown={handleOptionKeyDown}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  type="button"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      {option.modelId}
                    </span>
                    <span
                      className={[
                        "shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-medium",
                        selectedOptionActive
                          ? "border-on-primary/25 bg-on-primary/10 text-on-primary"
                          : highlighted
                            ? "border-outline bg-surface text-primary"
                          : "border-outline-variant bg-surface text-on-surface-variant",
                      ].join(" ")}
                    >
                      {option.providerLabel}
                    </span>
                  </span>
                  <span
                    className={
                      selectedOptionActive
                        ? "text-xs text-on-primary/70"
                        : highlighted
                          ? "text-xs text-primary/75"
                          : "text-xs text-on-surface-variant"
                    }
                  >
                    {option.isDefault ? "Default for this mode" : optionSourceLabel(option.source)}
                  </span>
                </button>
              );
            })}

            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-on-surface-variant">
                {loading ? "Loading models..." : "No matching models"}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function selectedOptionIndex(
  options: ModelSelectorOption[],
  selected: SelectedModel | null,
): number {
  if (!selected) {
    return 0;
  }

  return options.findIndex(
    (option) => option.providerId === selected.providerId && option.modelId === selected.modelId,
  );
}

function fallbackSelectedOption(
  selected: SelectedModel | null,
  options: ModelSelectorOption[],
): ModelSelectorOption | null {
  if (!selected) {
    return null;
  }

  const provider = options.find((option) => option.providerId === selected.providerId);

  return {
    modelId: selected.modelId,
    providerId: selected.providerId,
    providerLabel: provider?.providerLabel ?? selected.providerId,
    source: "configured",
  };
}

function optionSourceLabel(source: ModelSelectorOption["source"]): string {
  if (source === "endpoint") {
    return "From provider models endpoint";
  }

  if (source === "configured") {
    return "Configured model";
  }

  return "Default model";
}
