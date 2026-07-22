import { describe, expect, it } from "bun:test";
import type {
  FirstRunSetupSummary,
  RichFeatureSettingsSummary,
} from "../../src/shared/protocol.ts";
import {
  getDefaultSystemPromptTemplate,
  renderSystemPromptForChat,
} from "../../src/server/prompts/system-prompts.ts";

const setup: FirstRunSetupSummary = {
  completed: true,
  location: null,
  modelCatalogUrl: null,
  nickname: null,
  preferredLanguage: null,
  showWorkspaceSessionsInGlobalView: false,
};

const richFeatures: RichFeatureSettingsSummary = {
  agenticToolTurnLimit: 300,
  agenticToolTurnLimitEnabled: true,
  cardsEnabled: false,
  calloutsEnabled: false,
  followUpsEnabled: false,
  katexEnabled: false,
  plantUmlEnabled: false,
  plantUmlFormat: "svg",
  plantUmlPrompt: "",
  plantUmlServerUrl: "https://www.plantuml.com/plantuml",
  smartEventsEnabled: false,
  smartEventsGoogleCalendarEnabled: false,
  smartEventsIcsEnabled: false,
  smartEventsOutlookCalendarEnabled: false,
  smartTablesEnabled: false,
  timelinesEnabled: false,
};

describe("renderSystemPromptForChat", () => {
  it("injects the actual datetime when a custom template omits the datetime placeholder", () => {
    const prompt = renderSystemPromptForChat({
      now: new Date("2026-06-26T10:11:12.000Z"),
      richFeatures,
      setup,
      template: "Custom prompt.",
    });

    expect(prompt).toContain("Current actual datetime: 2026-06-26T10:11:12.000Z.");
    expect(prompt).toContain(
      "This is the actual datetime at prompt render time, not the time of the first message in this conversation.",
    );
  });

  it("replaces the legacy datetime line with the actual datetime wording", () => {
    const prompt = renderSystemPromptForChat({
      now: new Date("2026-06-26T10:11:12.000Z"),
      richFeatures,
      setup,
      template: "Custom prompt.\n\nCurrent datetime: {{datetime}}.",
    });

    expect(prompt).not.toContain("Current datetime:");
    expect(prompt.match(/Current actual datetime:/g)?.length).toBe(1);
    expect(prompt).toContain("Current actual datetime: 2026-06-26T10:11:12.000Z.");
  });

  it("keeps default prompts on the actual datetime wording", () => {
    const prompt = renderSystemPromptForChat({
      now: new Date("2026-06-26T10:11:12.000Z"),
      richFeatures,
      setup,
      template: getDefaultSystemPromptTemplate("conversation"),
    });

    expect(prompt.match(/Current actual datetime:/g)?.length).toBe(1);
    expect(prompt).toContain("not the time of the first message");
  });
});
