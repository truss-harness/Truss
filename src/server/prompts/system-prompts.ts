import type {
  FirstRunSetupSummary,
  RichFeatureSettingsSummary,
  SystemPromptMode,
  SystemPromptPlaceholderSummary,
} from "../../shared/protocol.ts";
import type { SystemPromptSettingDefaults } from "../storage/system-prompts.ts";

export const systemPromptModes: SystemPromptMode[] = ["conversation", "agentic"];

export const systemPromptLabels: Record<SystemPromptMode, string> = {
  agentic: "Agentic mode",
  conversation: "Conversation mode",
};

export const systemPromptPlaceholders: SystemPromptPlaceholderSummary[] = [
  {
    key: "datetime",
    label: "Datetime",
    optional: false,
  },
  {
    key: "location",
    label: "Location",
    optional: true,
  },
  {
    key: "nickname",
    label: "Nickname",
    optional: true,
  },
  {
    key: "preferred_response_language",
    label: "Preferred response language",
    optional: true,
  },
];

const defaultPromptTemplates: Record<SystemPromptMode, string> = {
  conversation: [
    "You are Truss, a concise technical assistant. Answer directly and ask for clarification only when needed.",
    "",
    "Current actual datetime (not the time of the first message in this conversation in a multi-turn session): {{datetime}}.",
    "{{#nickname}}The user prefers to be called {{nickname}}.{{/nickname}}",
    "{{#location}}The user's location is {{location}}.{{/location}}",
    "{{#preferred_response_language}}Respond in {{preferred_response_language}} unless the user asks otherwise.{{/preferred_response_language}}",
  ].join("\n"),
  agentic: [
    "You are Truss in agentic mode. Plan briefly, use available tools carefully, and keep the user informed about meaningful progress.",
    "",
    "Current actual datetime (not the time of the first message in this conversation in a multi-turn session): {{datetime}}. ",
    "{{#nickname}}The user prefers to be called {{nickname}}.{{/nickname}}",
    "{{#location}}The user's location is {{location}}.{{/location}}",
    "{{#preferred_response_language}}Respond in {{preferred_response_language}} unless the user asks otherwise.{{/preferred_response_language}}",
  ].join("\n"),
};

export function getSystemPromptDefaults(): SystemPromptSettingDefaults[] {
  return systemPromptModes.map((mode) => ({
    mode,
    template: defaultPromptTemplates[mode],
  }));
}

export function getDefaultSystemPromptTemplate(mode: SystemPromptMode): string {
  return defaultPromptTemplates[mode];
}

export function isSystemPromptMode(value: string): value is SystemPromptMode {
  return systemPromptModes.includes(value as SystemPromptMode);
}

export function renderSystemPromptTemplate({
  now = new Date(),
  setup,
  template,
}: {
  now?: Date;
  setup: FirstRunSetupSummary;
  template: string;
}): string {
  const values = promptTemplateValues(setup, now);
  let output = template;

  for (let index = 0; index < 20; index += 1) {
    const next = renderTemplateSections(output, values);

    if (next === output) {
      break;
    }

    output = next;
  }

  output = output.replace(
    /\{\{\s*([a-zA-Z0-9_. -]+)\s*\}\}/g,
    (_match, key: string) => values[normalizeTemplateKey(key)] ?? "",
  );

  return normalizeRenderedPrompt(output);
}

export function renderSystemPromptForChat({
  now = new Date(),
  richFeatures,
  setup,
  template,
}: {
  now?: Date;
  richFeatures: RichFeatureSettingsSummary;
  setup: FirstRunSetupSummary;
  template: string;
}): string {
  return appendPromptAppendix(
    ensureActualDatetimeInstruction(renderSystemPromptTemplate({ now, setup, template }), now),
    richFeaturePromptAppendix(richFeatures),
  );
}

function ensureActualDatetimeInstruction(prompt: string, now: Date): string {
  const renderedDatetime = now.toISOString();
  const instruction =
    `Current actual datetime: ${renderedDatetime}. ` +
    "This is the actual datetime at prompt render time, not the time of the first message in this conversation.";

  if (prompt.includes("actual datetime at prompt render time")) {
    return prompt;
  }

  const datetimeLiteral = escapeRegExp(renderedDatetime);
  const datetimeLinePattern = new RegExp(
    `^Current (?:actual )?datetime:\\s*${datetimeLiteral}\\.$`,
    "m",
  );

  if (datetimeLinePattern.test(prompt)) {
    return normalizeRenderedPrompt(prompt.replace(datetimeLinePattern, instruction));
  }

  return appendPromptAppendix(prompt, instruction);
}

function richFeaturePromptAppendix(settings: RichFeatureSettingsSummary): string {
  const sections: string[] = [];

  sections.push(
    richFeatureInstruction(
      "truss_markdown_instruction",
      [
        "Standard markdown rendering is enabled.",
        "A line containing only --- or *** renders as a thin horizontal separator. Avoid using it directly before or after a card or timeline block."
      ].join("\n"),
    ),
  );

  if (settings.cardsEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_cards_instruction",
        [
          "Card rendering is enabled.",
          "When the user asks for an artifact-style output such as a rephrased passage, reusable copy, draft text, a standalone summary, or another paste-ready deliverable, put the deliverable in a Card block.",
          "Do not embed markdown tables, codeblocks or vertical timelines inside Card blocks. Use normal markdown tables or Truss Timeline blocks outside the Card instead.",
          'Use this fenced syntax: :::card title="Optional header" footer="Optional footer" on its own line, then the card body on following lines, then ::: on its own closing line.',
          "Use the header and footer only when they make the artifact easier to identify, it is not mandatory.",
          [
            "Example:",
            ':::card title="Draft reply" footer="Ready to paste"',
            "Thanks for the update. I reviewed the notes and will send the revised version by Friday.",
            ":::",
          ].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.followUpsEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_followups_instruction",
        [
          "Follow-up prompt rendering is enabled.",
          "When it is genuinely useful to offer the user next-step prompts after a complete answer, put them in a follow-up block at the very end of the message.",
          "Use at most three follow-up prompts.",
          "Each prompt must be a short, concrete user action on its own line.",
          "Use this fenced syntax: :::followups, then one to three prompt lines, then ::: each in its own line",
          "Do not use generic endings such as 'Would you like anything else?' or duplicate questions already answered in the message.",
          [
            "Example:",
            ":::followups",
            "Turn this into a checklist",
            "Draft the email version",
            "Compare the two options",
            ":::",
          ].join("\n"),
        ].join("\n"),
      ),
    );
  } else {
    sections.push(
      richFeatureInstruction(
        "truss_no_followups_instruction",
        [
          "Do not end assistant messages with follow-up questions, suggested next prompts, or lines like 'Would you like me to...'.",
          "Ask a clarifying question only when it is necessary to answer the user's request; otherwise finish with the answer itself.",
          "Example ending: The corrected command is ready to run.",
        ].join("\n"),
      ),
    );
  }

  if (settings.smartTablesEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_smart_tables_instruction",
        [
          "Smart tables are enabled.",
          "When tabular data is useful, write normal GitHub-style markdown tables with clear headers.",
          "Truss renders those tables with sorting, column visibility controls, row controls, and CSV download.",
          [
            "Example:",
            "| Status | Owner | Due |",
            "| --- | --- | --- |",
            "| Draft | Nina | Friday |",
          ].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.timelinesEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_timelines_instruction",
        [
          "Timeline rendering is enabled.",
          "Use a Truss Timeline block for event histories, status progressions, approvals, incidents, release plans, repair or assembly instructions, recipes, or other ordered milestones and steps where a vertical timeline is clearer than prose.",
          'Use this fenced syntax: :::timeline title="Optional heading" on its own line, then one entry per line as - date="Today" title="Pending Approval" icon="inbox" description="This request requires your approval.", then ::: on its own closing line.',
          "The date and title attributes are required. For procedural content, the date value can be a step label such as Step 1, Prep, Assemble, or Bake. The description and icon attributes are optional.",
          "Keep entries concise and use Material Symbols icon names such as inbox, mail, location_on, task_alt, schedule, or flag when an icon helps scanning.",
          [
            "Example:",
            ':::timeline title="Release plan"',
            '- date="Today" title="Draft approved" icon="task_alt" description="The first pass is ready."',
            '- date="Friday" title="Ship update" icon="flag" description="Publish the final version."',
            ":::",
          ].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.smartEventsEnabled) {
    const actions = [
      settings.smartEventsGoogleCalendarEnabled ? "Google Calendar links" : "",
      settings.smartEventsOutlookCalendarEnabled ? "Outlook Calendar links" : "",
      settings.smartEventsIcsEnabled ? "downloadable ICS files" : "",
    ].filter(Boolean);

    sections.push(
      richFeatureInstruction(
        "truss_smart_events_instruction",
        [
          "Smart events are enabled.",
          "Use Truss event syntax for concrete calendar items:",
          ':calendar[Event title]{date="YYYY-MM-DD" time="HH:mm" end="HH:mm" location="Location" description="Short details"}',
          "The title and date are required. Use 24-hour local times for time and end.",
          actions.length > 0
            ? `The event modal can offer ${actions.join(", ")}.`
            : "No external calendar actions are currently enabled.",
          [
            "Example:",
            ':calendar[Planning review]{date="2026-07-08" time="14:00" end="14:30" location="Conference room" description="Review launch tasks"}',
          ].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.calloutsEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_callouts_instruction",
        [
          "Callout rendering is enabled.",
          "Use GitHub-style markdown callouts only when a response needs a distinct note, tip, important point, warning, or caution.",
          "Put the callout marker on its own quoted line, such as > [!NOTE], followed by quoted content lines.",
          "Supported callout kinds are NOTE, TIP, IMPORTANT, WARNING, and CAUTION.",
          ["Example:", "> [!WARNING]", "> This deletes local build output."].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.plantUmlEnabled && settings.plantUmlPrompt.trim()) {
    sections.push(
      richFeatureInstruction(
        "truss_plantuml_instruction",
        [
          "PlantUML rendering is enabled. Apply these user-provided PlantUML instructions exactly:",
          settings.plantUmlPrompt.trim(),
          [
            "Example:",
            "```plantuml",
            "@startuml",
            "Alice -> Bob: Request",
            "Bob --> Alice: Response",
            "@enduml",
            "```",
          ].join("\n"),
        ].join("\n"),
      ),
    );
  }

  if (settings.katexEnabled) {
    sections.push(
      richFeatureInstruction(
        "truss_katex_instruction",
        [
          "KaTeX math rendering is enabled.",
          "Use $...$ for inline math and $$...$$ for display math when mathematical notation makes the answer clearer.",
          ["Example:", "Inline: $E = mc^2$", "Display:", "$$a^2 + b^2 = c^2$$"].join("\n"),
        ].join("\n"),
      ),
    );
  }

  return sections.join("\n\n");
}

function richFeatureInstruction(tagName: string, content: string): string {
  return `<${tagName}>\n${content.trim()}\n</${tagName}>`;
}

function appendPromptAppendix(prompt: string, appendix: string): string {
  if (!appendix.trim()) {
    return prompt;
  }

  return normalizeRenderedPrompt(`${prompt}\n\n${appendix}`);
}

function promptTemplateValues(
  setup: FirstRunSetupSummary,
  now: Date,
): Record<string, string> {
  const preferredLanguage = setup.preferredLanguage ?? "";

  return {
    datetime: now.toISOString(),
    location: setup.location ?? "",
    nickname: setup.nickname ?? "",
    "preferred response language": preferredLanguage,
    preferred_language: preferredLanguage,
    preferred_response_language: preferredLanguage,
    preferredLanguage,
    preferredResponseLanguage: preferredLanguage,
  };
}

function renderTemplateSections(template: string, values: Record<string, string>): string {
  return template
    .replace(
      /\{\{\s*#\s*([a-zA-Z0-9_. -]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g,
      (_match, key: string, content: string) => {
        const value = values[normalizeTemplateKey(key)];
        return value ? renderSystemPromptFragment(content, values) : "";
      },
    )
    .replace(
      /\{\{\s*\^\s*([a-zA-Z0-9_. -]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g,
      (_match, key: string, content: string) => {
        const value = values[normalizeTemplateKey(key)];
        return value ? "" : renderSystemPromptFragment(content, values);
      },
    );
}

function renderSystemPromptFragment(fragment: string, values: Record<string, string>): string {
  return fragment.replace(
    /\{\{\s*([a-zA-Z0-9_. -]+)\s*\}\}/g,
    (_match, key: string) => values[normalizeTemplateKey(key)] ?? "",
  );
}

function normalizeTemplateKey(key: string): string {
  return key.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRenderedPrompt(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
