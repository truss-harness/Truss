import type { RichFeatureSettingsSummary } from "../shared/protocol.ts";
import {
  defaultPlantUmlPrompt,
  defaultPlantUmlServerUrl,
} from "../shared/rich-feature-defaults.ts";

export const defaultRichFeatureSettings: RichFeatureSettingsSummary = {
  agenticToolTurnLimit: 300,
  agenticToolTurnLimitEnabled: true,
  cardsEnabled: true,
  calloutsEnabled: true,
  followUpsEnabled: true,
  katexEnabled: false,
  plantUmlEnabled: false,
  plantUmlFormat: "svg",
  plantUmlPrompt: defaultPlantUmlPrompt,
  plantUmlServerUrl: defaultPlantUmlServerUrl,
  smartEventsEnabled: false,
  smartEventsGoogleCalendarEnabled: false,
  smartEventsIcsEnabled: false,
  smartEventsOutlookCalendarEnabled: false,
  smartTablesEnabled: false,
  timelinesEnabled: false,
};
