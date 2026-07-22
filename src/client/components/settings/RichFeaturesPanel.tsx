import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PlantUmlRenderFormat, RichFeatureSettingsSummary } from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import {
  PrimaryButton,
  SecondaryButton,
  SettingsAlert,
  SettingsSwitch,
  SettingsTextInput,
} from "./SettingsControls.tsx";

export function RichFeaturesPanel({
  draft,
  error,
  onChange,
  onSave,
  saving,
  saved,
}: {
  draft: RichFeatureSettingsSummary;
  error: string | null;
  onChange(patch: Partial<RichFeatureSettingsSummary>): void;
  onSave(): void;
  saving: boolean;
  saved: RichFeatureSettingsSummary;
}) {
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4">
        <RichFeatureCard
          checked={draft.smartTablesEnabled}
          description="Turns ordinary markdown tables into interactive data grids with CSV export, sorting, visible-column controls, and row paging. When disabled, tables still render as regular styled HTML tables."
          icon="table"
          label="Smart tables"
          onChange={(smartTablesEnabled) => onChange({ smartTablesEnabled })}
        />

        <RichFeatureCard
          checked={draft.timelinesEnabled}
          description="Renders fenced Timeline blocks as compact vertical histories or ordered steps, including repair instructions, assembly flows, recipes, approvals, and release plans. When disabled, Timeline syntax stays plain markdown text."
          icon="timeline"
          label="Timelines"
          onChange={(timelinesEnabled) => onChange({ timelinesEnabled })}
        />

        <RichFeatureCard
          checked={draft.smartEventsEnabled}
          description="Renders Truss calendar syntax as an event chip with a details modal. When disabled, event syntax stays plain markdown text."
          icon="event"
          label="Smart events"
          onChange={(smartEventsEnabled) => onChange({ smartEventsEnabled })}
        >
          <div className="grid gap-3">
            <RichFeatureCheckbox
              checked={draft.smartEventsGoogleCalendarEnabled}
              description="Adds a pre-filled Google Calendar action to event modals."
              label="Google Calendar button"
              onChange={(smartEventsGoogleCalendarEnabled) =>
                onChange({ smartEventsGoogleCalendarEnabled })
              }
            />
            <RichFeatureCheckbox
              checked={draft.smartEventsOutlookCalendarEnabled}
              description="Adds a pre-filled Outlook calendar action to event modals."
              label="Outlook Calendar button"
              onChange={(smartEventsOutlookCalendarEnabled) =>
                onChange({ smartEventsOutlookCalendarEnabled })
              }
            />
            <RichFeatureCheckbox
              checked={draft.smartEventsIcsEnabled}
              description="Adds an ICS download action generated from the event details."
              label="Downloadable ICS files"
              onChange={(smartEventsIcsEnabled) => onChange({ smartEventsIcsEnabled })}
            />
          </div>
        </RichFeatureCard>

        <RichFeatureCard
          checked={draft.plantUmlEnabled}
          description="Renders fenced PlantUML diagrams through a PlantUML server instead of showing them only as code."
          icon="account_tree"
          label="PlantUML"
          onChange={(plantUmlEnabled) => onChange({ plantUmlEnabled })}
        >
          <div className="grid gap-4">
            <SettingsTextInput
              helpText="The renderer appends /svg or /png plus an encoded diagram to this server URL."
              label="PlantUML server"
              mono
              onChange={(plantUmlServerUrl) => onChange({ plantUmlServerUrl })}
              value={draft.plantUmlServerUrl}
            />
            <PlantUmlFormatControl
              format={draft.plantUmlFormat}
              onChange={(plantUmlFormat) => onChange({ plantUmlFormat })}
            />
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase text-on-surface-variant">
                Custom PlantUML prompt instructions
              </span>
              <textarea
                className="min-h-40 w-full resize-y rounded-sm border border-outline-variant bg-surface-container-low px-3 py-3 font-mono text-xs leading-5 text-on-surface outline-none transition focus:border-outline focus:bg-surface"
                onChange={(event) => onChange({ plantUmlPrompt: event.target.value })}
                placeholder="Add the PlantUML instructions you want Truss to append to model prompts."
                spellCheck={false}
                value={draft.plantUmlPrompt}
              />
              <span className="text-xs leading-5 text-on-surface-variant">
                Leave this blank to enable rendering without changing model instructions.
              </span>
            </label>
          </div>
        </RichFeatureCard>

        <RichFeatureCard
          checked={draft.katexEnabled}
          description="Renders LaTeX math expressions in chat answers with KaTeX MathML output."
          icon="functions"
          label="KaTeX rendering"
          onChange={(katexEnabled) => onChange({ katexEnabled })}
        />

        <RichFeatureCard
          checked={draft.cardsEnabled}
          description="Renders Truss Card blocks for artifact-style answers with a labeled container and hover actions to copy or download the card contents. Do not embed tables or vertical timelines inside Cards."
          icon="article"
          label="Cards"
          onChange={(cardsEnabled) => onChange({ cardsEnabled })}
        />

        <RichFeatureCard
          checked={draft.followUpsEnabled}
          description="Renders Truss follow-up prompt blocks above the composer instead of inside the assistant message. When disabled, model prompts tell the assistant not to end replies with follow-up prompts."
          icon="playlist_add"
          label="Follow-up prompts"
          onChange={(followUpsEnabled) => onChange({ followUpsEnabled })}
        />

        <RichFeatureCard
          checked={draft.calloutsEnabled}
          description="Renders GitHub-style note, tip, important, warning, and caution blocks as styled callouts in chat answers."
          icon="info"
          label="Callouts"
          onChange={(calloutsEnabled) => onChange({ calloutsEnabled })}
        />
      </div>

      {error ? <SettingsAlert tone="error" message={error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton
          disabled={saving || !hasChanges}
          icon="undo"
          label="Discard changes"
          onClick={() => onChange(saved)}
        />
        <PrimaryButton
          disabled={saving || !hasChanges}
          icon="save"
          label={saving ? "Saving" : "Save rich features"}
          onClick={onSave}
        />
      </div>
    </div>
  );
}


function RichFeatureCard({
  checked,
  children,
  description,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  children?: ReactNode;
  description: string;
  icon: string;
  label: string;
  onChange(value: boolean): void;
}) {
  const [renderBody, setRenderBody] = useState(checked);
  const hasChildren = children !== undefined && children !== null;

  useEffect(() => {
    if (checked) {
      setRenderBody(true);
      return undefined;
    }

    const timeout = window.setTimeout(() => setRenderBody(false), 220);

    return () => window.clearTimeout(timeout);
  }, [checked]);

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
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            {description}
          </p>
        </div>
        <SettingsSwitch checked={checked} label={label} onChange={onChange} />
      </div>
      {hasChildren && renderBody ? (
        <div
          aria-hidden={!checked}
          className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
            checked ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={`grid gap-3 border-t border-outline-variant transition-[padding,transform] duration-200 ease-out ${
                checked ? "translate-y-0 pt-4" : "pointer-events-none -translate-y-1 pt-0"
              }`}
            >
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}


function RichFeatureCheckbox({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="grid gap-1">
        <span className="text-sm font-semibold text-on-surface">{label}</span>
        <span className="text-xs leading-5 text-on-surface-variant">{description}</span>
      </span>
    </label>
  );
}


function PlantUmlFormatControl({
  format,
  onChange,
}: {
  format: PlantUmlRenderFormat;
  onChange(format: PlantUmlRenderFormat): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold uppercase text-on-surface-variant">
        Render format
      </span>
      <div className="inline-flex w-fit rounded-sm border border-outline-variant bg-surface-container-low p-1">
        {(["svg", "png"] as const).map((option) => (
          <button
            aria-pressed={format === option}
            className={[
              "h-8 rounded-sm px-3 text-xs font-semibold uppercase transition focus:border-outline focus:outline-none",
              format === option
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container hover:text-primary",
            ].join(" ")}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

