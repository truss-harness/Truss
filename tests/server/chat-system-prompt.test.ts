import { describe, expect, it } from "bun:test";
import type {
  FirstRunSetupSummary,
  RichFeatureSettingsSummary,
} from "../../src/shared/protocol.ts";
import {
  renderChatSystemPrompt,
  renderSubAgentSystemPrompt,
} from "../../src/server/http/chat-system-prompt.ts";
import type { ServerContext } from "../../src/server/http/context.ts";

describe("renderChatSystemPrompt", () => {
  it("adds the workspace filesystem boundary in workspace mode", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace", [
        "C:\\repo\\workspace\\sibling",
        "D:\\shared",
      ]),
      systemPrompt: "Base prompt.",
      toolDefinitions: [],
    });

    expect(prompt).toContain(
      "You are limited to this Truss workspace directory: C:\\repo\\workspace.",
    );
    expect(prompt).toContain("Whitelisted directories for the workspace context:");
    expect(prompt).toContain("  - C:\\repo\\workspace");
    expect(prompt).toContain("  - C:\\repo\\workspace\\sibling");
    expect(prompt).toContain("  - D:\\shared");
    expect(prompt).toContain("If the task needs another local directory");
    expect(prompt).toContain("request directory access and wait for the user's approval");
  });

  it("adds the disabled filesystem note in global mode", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext(null),
      systemPrompt: "Base prompt.",
      toolDefinitions: [],
    });

    expect(prompt).toContain(
      "File access to ordinary local directories through Truss's first-party filesystem tools is disabled by default.",
    );
    expect(prompt).toContain("No directories are currently whitelisted for the global context.");
    expect(prompt).toContain("If the task needs local file access");
    expect(prompt).toContain("request directory access and wait for the user's approval");
  });

  it("lists global filesystem grants in global mode", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext(null, ["C:\\workspace", "D:\\shared"]),
      systemPrompt: "Base prompt.",
      toolDefinitions: [],
    });

    expect(prompt).toContain("Whitelisted directories for the global context:");
    expect(prompt).toContain("  - C:\\workspace");
    expect(prompt).toContain("  - D:\\shared");
  });

  it("instructs tool-capable chats from behavior rules without duplicating tool names", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace"),
      systemPrompt: "Base prompt.",
      toolDefinitions: [
        {
          description: "Demo tool",
          name: "demo_tool",
          parameters: {},
        },
      ],
    });

    expect(prompt).toContain("Tool behavior:");
    expect(prompt).toContain("structured tool definitions supplied with this request");
    expect(prompt).toContain("Truss can execute tool calls in parallel");
    expect(prompt).toContain("Default to calling tools in parallel");
    expect(prompt).toContain("except high-risk mutating calls");
    expect(prompt).toContain("truncated, clipped, or skipped because of a limit");
    expect(prompt).not.toContain("Available tools:");
    expect(prompt).not.toContain("demo_tool");
    expect(prompt).not.toContain("spawn_sub_agent");
  });

  it("introduces skills as read-only context through Chat Tools", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace", [], {
        skills: [
          {
            active: true,
            description: "Use when creating API docs.",
            id: "skill:api-docs",
            name: "api-docs",
            path: "C:\\Users\\ASUS\\.codex\\skills\\api-docs\\SKILL.md",
            scope: "global",
            source: "codex",
            tokenEstimate: 100,
          },
        ],
      }),
      systemPrompt: "Base prompt.",
      toolDefinitions: [],
    });

    expect(prompt).toContain("Skills:");
    expect(prompt).toContain("read that skill's SKILL.md with Truss Chat Tools `read_skill`");
    expect(prompt).toContain("read-only roots");
    expect(prompt).toContain("Global skills are always available");
    expect(prompt).toContain("workspace/provider skills are auto-discovered only in workspace mode");
    expect(prompt).toContain("api-docs (global/codex) id=skill:api-docs");
    expect(prompt).toContain("Use when creating API docs.");
  });

  it("instructs tool-capable chats to use iterative tool turns when needed", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace"),
      systemPrompt: "Base prompt.",
      toolDefinitions: [
        {
          description: "Demo tool",
          name: "demo_tool",
          parameters: {},
        },
      ],
    });

    expect(prompt).toContain("Tool use is iterative.");
    expect(prompt).toContain("for as many tool turns as the task needs");
    expect(prompt).toContain("provide the final response when more tool calls");
    expect(prompt).not.toContain("may provide");
  });

  it("treats direct planning state changes as planning tool triggers", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace"),
      systemPrompt: "Base prompt.",
      toolDefinitions: [
        {
          description: "Patch one top-level todo.",
          name: "plan_update_todo",
          parameters: {},
        },
        {
          description: "Patch one nested subtask.",
          name: "plan_update_subtask",
          parameters: {},
        },
        {
          description: "Return the current plan.",
          name: "plan_get",
          parameters: {},
        },
      ],
    });

    expect(prompt).toContain("Planning state-change requests are tool-use requests");
    expect(prompt).toContain("mark ... as done");
    expect(prompt).toContain("prepend your working context with the current todo list");
    expect(prompt).toContain("call plan_get first");
    expect(prompt).toContain("plan_update_todo or plan_update_subtask");
    expect(prompt).toContain("ask one concise clarification question");
    expect(prompt).toContain("confirm from the tool observation");
  });

  it("does not repeat sub-agent tool names in the prompt", () => {
    const prompt = renderChatSystemPrompt({
      context: testContext("C:\\repo\\workspace"),
      systemPrompt: "Base prompt.",
      toolDefinitions: [
        {
          description: "Spawn a child agent session.",
          name: "spawn_sub_agent",
          parameters: {},
        },
      ],
    });

    expect(prompt).toContain(
      "Use delegation tools for independent subtasks whose final answer can be folded back into the parent turn",
    );
    expect(prompt).toContain("A sub-agent does not require a timer");
    expect(prompt).not.toContain("spawn_sub_agent");
    expect(prompt).not.toContain("child session");
  });

  it("renders a concise plain sub-agent system prompt", () => {
    const prompt = renderSubAgentSystemPrompt({
      context: testContext("C:\\repo\\workspace", [], {
        richFeatures: {
          ...disabledRichFeatures,
          followUpsEnabled: true,
          smartTablesEnabled: true,
        },
        setup: {
          ...emptySetup,
          location: "Alphen aan den Rijn, The Netherlands",
          preferredLanguage: "Dutch",
        },
      }),
      filesystemWorkspacePath: "C:\\repo\\workspace\\child",
      toolDefinitions: [
        {
          description: "Demo tool",
          name: "demo_tool",
          parameters: {},
        },
      ],
    });

    expect(prompt).toContain("You are a Truss sub-agent completing one delegated task");
    expect(prompt).toContain("hidden from the user by default");
    expect(prompt).toContain("Type out the final response very concisely");
    expect(prompt).toContain("Do not use markdown formatting");
    expect(prompt).toContain("The user's location is Alphen aan den Rijn, The Netherlands.");
    expect(prompt).toContain("Respond in Dutch unless the delegated task asks otherwise.");
    expect(prompt).toContain("narrowed to this root: C:\\repo\\workspace\\child");
    expect(prompt).toContain("Use tools only when they directly help complete the delegated task.");
    expect(prompt).not.toContain("Smart tables are enabled");
    expect(prompt).not.toContain("Use delegation tools");
    expect(prompt).not.toContain("demo_tool");
  });
});

function testContext(
  conversationWorkspacePath: string | null,
  filesystemGrantDirectories: string[] = [],
  options: {
    richFeatures?: RichFeatureSettingsSummary;
    setup?: FirstRunSetupSummary;
    skills?: Array<{
      active: boolean;
      description?: string;
      id: string;
      name: string;
      path: string;
      scope: "global" | "workspace";
      source: string;
      tokenEstimate: number;
    }>;
  } = {},
): ServerContext {
  return {
    filesystemGrants: {
      listGrantsForContext: (workspacePath: string | null) =>
        filesystemGrantDirectories.map((directoryPath, index) => ({
          directoryPath,
          expiresAt: "2026-06-28T00:00:00.000Z",
          grantedAt: "2026-06-27T00:00:00.000Z",
          grantSource: "user-dialog",
          id: index + 1,
          readOnly: false,
          workspacePath,
        })),
    },
    options: {
      conversationWorkspacePath,
    },
    skills: {
      activeSkills: options.skills?.filter((skill) => skill.active).length ?? 0,
      directories: [],
      discoveredSkills: options.skills?.length ?? 0,
      skills: options.skills ?? [],
    },
    richFeatures: {
      getRichFeatureSettings: () => options.richFeatures ?? disabledRichFeatures,
    },
    setup: {
      getSetup: () => options.setup ?? emptySetup,
    },
  } as unknown as ServerContext;
}

const emptySetup: FirstRunSetupSummary = {
  completed: true,
  location: null,
  modelCatalogUrl: null,
  nickname: null,
  preferredLanguage: null,
  showWorkspaceSessionsInGlobalView: false,
};

const disabledRichFeatures: RichFeatureSettingsSummary = {
  agenticToolTurnLimit: 300,
  agenticToolTurnLimitEnabled: true,
  calloutsEnabled: false,
  cardsEnabled: false,
  followUpsEnabled: false,
  katexEnabled: false,
  plantUmlEnabled: false,
  plantUmlFormat: "svg",
  plantUmlPrompt: "",
  plantUmlServerUrl: "",
  smartEventsEnabled: false,
  smartEventsGoogleCalendarEnabled: false,
  smartEventsIcsEnabled: false,
  smartEventsOutlookCalendarEnabled: false,
  smartTablesEnabled: false,
  timelinesEnabled: false,
};
