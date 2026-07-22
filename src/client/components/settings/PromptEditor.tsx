import type {
  FirstRunSetupSummary,
  SystemPromptMode,
  SystemPromptPlaceholderSummary,
  SystemPromptTemplateSummary,
} from "../../../shared/protocol.ts";
import { PrimaryButton, SecondaryButton, SettingsAlert } from "./SettingsControls.tsx";
import type { PromptDraft } from "./types.ts";

export function PromptEditor({
  draft,
  onChange,
  onRestoreDefault,
  onSave,
  placeholders,
  prompt,
  setup,
}: {
  draft: PromptDraft | undefined;
  onChange(template: string): void;
  onRestoreDefault(): void;
  onSave(): void;
  placeholders: SystemPromptPlaceholderSummary[];
  prompt: SystemPromptTemplateSummary;
  setup: FirstRunSetupSummary | null;
}) {
  if (!draft) {
    return null;
  }

  const renderedPreview = setup
    ? renderPromptPreview(draft.template, setup)
    : prompt.renderedPreview;

  return (
    <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
      <div>
        <h3 className="text-lg font-semibold text-on-surface">{prompt.label}</h3>
        <p className="mt-1 text-xs font-medium uppercase text-on-surface-variant">
          {prompt.mode}
        </p>
      </div>
      <div className="grid gap-2 rounded-sm border border-outline-variant bg-surface px-3 py-3 text-sm leading-6 text-on-surface-variant">
        <p>
          Use variables like <code>{"{{datetime}}"}</code> for values. Optional
          sections like <code>{"{{#nickname}}...{{/nickname}}"}</code> render only
          when that customization is set. Inverted sections like{" "}
          <code>{"{{^location}}...{{/location}}"}</code> render only when the value
          is empty.
        </p>
      </div>
      <textarea
        className="min-h-[18rem] w-full resize-y rounded-sm border border-outline-variant bg-surface-container-low px-3 py-3 font-mono text-xs leading-5 text-on-surface outline-none transition focus:border-outline focus:bg-surface"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={draft.template}
      />
      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase text-on-surface-variant">Preview</p>
        <pre className="max-h-56 overflow-auto rounded-sm border border-outline-variant bg-surface px-3 py-3 whitespace-pre-wrap text-xs leading-5 text-on-surface-variant">
          {renderedPreview}
        </pre>
      </div>
      <div className="flex flex-wrap gap-2">
        {placeholders.map((placeholder) => (
          <button
            className="rounded-sm border border-outline-variant bg-surface px-2 py-1 font-mono text-xs text-on-surface-variant transition hover:border-outline hover:text-primary focus:border-outline focus:text-primary focus:outline-none"
            key={`${prompt.mode}:${placeholder.key}`}
            onClick={() => onChange(`${draft.template}\n{{${placeholder.key}}}`)}
            type="button"
          >
            {"{{"}{placeholder.key}{"}}"}
          </button>
        ))}
      </div>
      {draft.error ? <SettingsAlert tone="error" message={draft.error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton
          icon="restart_alt"
          label="Restore default"
          onClick={onRestoreDefault}
        />
        <PrimaryButton
          disabled={draft.saving}
          icon="save"
          label={draft.saving ? "Saving" : "Save prompt"}
          onClick={onSave}
        />
      </div>
    </article>
  );
}


export function promptLabel(mode: SystemPromptMode): string {
  return mode === "agentic" ? "Agentic mode" : "Conversation mode";
}


function renderPromptPreview(template: string, setup: FirstRunSetupSummary): string {
  const values: Record<string, string> = {
    datetime: new Date().toISOString(),
    location: setup.location ?? "",
    nickname: setup.nickname ?? "",
    "preferred response language": setup.preferredLanguage ?? "",
    preferred_language: setup.preferredLanguage ?? "",
    preferred_response_language: setup.preferredLanguage ?? "",
    preferredLanguage: setup.preferredLanguage ?? "",
    preferredResponseLanguage: setup.preferredLanguage ?? "",
  };
  let output = template;

  for (let index = 0; index < 20; index += 1) {
    const next = output
      .replace(
        /\{\{\s*#\s*([a-zA-Z0-9_. -]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g,
        (_match, key: string, content: string) =>
          values[key.trim()] ? renderPromptFragment(content, values) : "",
      )
      .replace(
        /\{\{\s*\^\s*([a-zA-Z0-9_. -]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g,
        (_match, key: string, content: string) =>
          values[key.trim()] ? "" : renderPromptFragment(content, values),
      );

    if (next === output) {
      break;
    }

    output = next;
  }

  return renderPromptFragment(output, values)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


function renderPromptFragment(fragment: string, values: Record<string, string>): string {
  return fragment.replace(
    /\{\{\s*([a-zA-Z0-9_. -]+)\s*\}\}/g,
    (_match, key: string) => values[key.trim()] ?? "",
  );
}

