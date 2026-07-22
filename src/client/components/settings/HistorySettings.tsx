import type { ReactNode } from "react";

import { MaterialIcon } from "../MaterialIcon.tsx";
import { SettingsSwitch } from "./SettingsControls.tsx";

export function HistoryToggleCard({
  checked,
  children,
  description,
  disabled = false,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  children?: ReactNode;
  description: string;
  disabled?: boolean;
  icon: string;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
              <MaterialIcon name={icon} size={18} />
            </span>
            <h3 className="text-base font-semibold text-on-surface">{label}</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">{description}</p>
        </div>
        <SettingsSwitch
          checked={checked}
          disabled={disabled}
          label={label}
          onChange={onChange}
        />
      </div>
      {children ? <div className="border-t border-outline-variant pt-4">{children}</div> : null}
    </article>
  );
}

