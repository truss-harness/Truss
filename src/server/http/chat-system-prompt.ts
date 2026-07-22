import type {
  AgentSessionSummary,
  AgentSessionType,
  ChatMessage,
  CommandTerminalSummary,
  OpenAiChatToolDefinition,
  SystemPromptMode,
} from "../../shared/protocol.ts";
import type { LlmToolDefinition } from "../llm/chat-completions.ts";
import {
  getDefaultSystemPromptTemplate,
  renderSystemPromptForChat,
  renderSystemPromptTemplate,
} from "../prompts/system-prompts.ts";
import type { ServerContext } from "./context.ts";

export function systemPromptModeForSessionType(type: AgentSessionType): SystemPromptMode {
  return type === "agentic" ? "agentic" : "conversation";
}

export function systemPromptTemplateForMode(
  context: ServerContext,
  mode: SystemPromptMode,
): string {
  return context.systemPrompts.getSystemPrompt(mode)?.template ?? getDefaultSystemPromptTemplate(mode);
}

export function renderChatSystemPrompt({
  context,
  session,
  systemPrompt,
  toolDefinitions,
}: {
  context: ServerContext;
  session?: AgentSessionSummary | null;
  systemPrompt: string;
  toolDefinitions: LlmToolDefinition[];
}): string {
  const rendered = renderSystemPromptForChat({
    richFeatures: context.richFeatures.getRichFeatureSettings(),
    setup: context.setup.getSetup(),
    template: systemPrompt,
  });
  const sections = [
    rendered,
    "",
    filesystemAccessPromptAppendix(context),
    "",
    skillsPromptAppendix(context),
  ];
  const terminalsAppendix = session ? runningTerminalsPromptAppendix(context, session) : null;

  if (terminalsAppendix) {
    sections.push("", terminalsAppendix);
  }

  const scopedRendered = sections.join("\n");

  if (toolDefinitions.length === 0) {
    return scopedRendered;
  }

  return [
    scopedRendered,
    "",
    "Tool behavior:",
    "- The structured tool definitions supplied with this request are the source of truth for available tools and parameter schemas. Do not infer additional tools from this prompt.",
    "- Use tools when they improve accuracy, recency, or access to external context.",
    ...planningToolBehaviorLines(toolDefinitions),
    "- Tool use is iterative. Alternate reasoning, tool calls, observations, and follow-up reasoning for as many tool turns as the task needs within Truss limits, then provide the final response when more tool calls would not improve the answer.",
    "- Truss can execute tool calls in parallel. Default to calling tools in parallel, except high-risk mutating calls, or when one result must inform the next action.",
    "- When a tool result says it was truncated, clipped, or skipped because of a limit, make a narrower follow-up call if the missing detail matters.",
    "- Use delegation tools for independent subtasks whose final answer can be folded back into the parent turn. A sub-agent does not require a timer; use timer tools only for delayed or scheduled resumption.",
    "- Use user-interaction tools only when the answer is needed to proceed. Use directory-access request tools only when filesystem access is blocked by the current context's grants. Use destructive tools only when the user explicitly asks.",
    "- Use mutating filesystem tools only when the user explicitly asks to modify workspace files. Treat active filesystem grants as process-local runtime grants, not as the full saved Security settings list.",
    "- Cite URLs from web results when external web information affects the answer.",
  ].join("\n");
}

export function renderSubAgentSystemPrompt({
  context,
  filesystemWorkspacePath,
  toolDefinitions,
}: {
  context: ServerContext;
  filesystemWorkspacePath: string | null;
  toolDefinitions: LlmToolDefinition[];
}): string {
  const rendered = renderSystemPromptTemplate({
    setup: context.setup.getSetup(),
    template: [
      "You are a Truss sub-agent completing one delegated task for a parent agent.",
      "Your transcript and final output are hidden from the user by default; the parent agent will inspect or summarize your result when needed.",
      "Work only on the delegated task. Omit parent-facing progress narration, broad background, unimportant caveats, and follow-up prompts.",
      "Type out the final response very concisely. Prefer a few plain sentences or a compact list of facts.",
      "Do not use markdown formatting unless the delegated task explicitly asks for exact markdown, code, or structured text.",
      "",
      "Current actual datetime (not the time of the first message in this conversation in a multi-turn session): {{datetime}}.",
      "{{#location}}The user's location is {{location}}.{{/location}}",
      "{{#preferred_response_language}}Respond in {{preferred_response_language}} unless the delegated task asks otherwise.{{/preferred_response_language}}",
    ].join("\n"),
  });
  const sections = [
    rendered,
    "",
    filesystemAccessPromptAppendix(context),
    "",
    skillsPromptAppendix(context),
    ...subAgentFilesystemScopeAppendix(filesystemWorkspacePath),
  ];

  if (toolDefinitions.length > 0) {
    sections.push(
      "",
      "Tool behavior:",
      "- The structured tool definitions supplied with this request are the source of truth for available tools and parameter schemas. Do not infer additional tools from this prompt.",
      "- Use tools only when they directly help complete the delegated task.",
      "- Tool use is iterative. Alternate reasoning, tool calls, observations, and follow-up reasoning until you have enough evidence to answer concisely.",
      "- Truss can execute safe independent tool calls in parallel. Keep dependent or high-risk mutating calls ordered.",
      "- If a tool result is truncated, clipped, or skipped and the missing detail matters, make a narrower follow-up call.",
    );
  }

  return sections.join("\n");
}

function planningToolBehaviorLines(toolDefinitions: LlmToolDefinition[]): string[] {
  if (!toolDefinitions.some((tool) => /(?:^|__)plan_(?:get|set|update)_/.test(tool.name))) {
    return [];
  }

  return [
    '- Planning state-change requests are tool-use requests. Direct phrases such as "mark ... as done", "set ... to in-progress", "add ... to the list", or "replace the plan" require a planning tool call before final text; do not simulate the updated checklist in prose.',
    "- Treat the current todos as required context for every user or system message: before acting on the message, prepend your working context with the current todo list and a brief explanation of how those todos shape the next step. If the current todos are not already visible from the conversation, call plan_get first.",
    "- Use the available planning tool whose name is or ends with plan_update_todo or plan_update_subtask for explicit status changes, plan_set_todos or plan_set_subtasks for add, replace, or reshape requests, and plan_get before updating when the referenced item or ID is not already clear from the current turn.",
    "- If more than one todo or subtask could match, ask one concise clarification question instead of inventing an ID or writing a text-only update. If a planning tool errors, report the error from the observation and offer a concrete fallback.",
    "- After a planning tool succeeds, confirm from the tool observation so the visible response matches the actual session plan state.",
  ];
}

function subAgentFilesystemScopeAppendix(filesystemWorkspacePath: string | null): string[] {
  if (!filesystemWorkspacePath) {
    return [];
  }

  return [
    "",
    "Sub-agent filesystem scope:",
    `- For this sub-agent, Truss Filesystem Tools are narrowed to this root: ${filesystemWorkspacePath}.`,
    "- Treat parent-session filesystem grants outside that root as unavailable unless the parent explicitly delegates a broader root.",
  ];
}

function filesystemAccessPromptAppendix(context: ServerContext): string {
  const workspacePath = context.options.conversationWorkspacePath;
  const whitelistedDirectories = filesystemAccessWhitelistedDirectories(context);
  const whitelistLines = filesystemAccessWhitelistLines(
    whitelistedDirectories,
    workspacePath ? "workspace" : "global",
  );

  if (workspacePath) {
    return [
      "Truss filesystem access:",
      `- You are limited to this Truss workspace directory: ${workspacePath}.`,
      ...whitelistLines,
      "- If the task needs another local directory, request directory access and wait for the user's approval.",
      "- Truss may deny access to certain files automatically, such as .env files.",
    ].join("\n");
  }

  return [
    "Truss filesystem access:",
    "- File access to ordinary local directories through Truss's first-party filesystem tools is disabled by default.",
    ...whitelistLines,
    "- If the task needs local file access, request directory access and wait for the user's approval.",
    "- Truss may deny access to certain files automatically, such as .env files.",
  ].join("\n");
}

function filesystemAccessWhitelistedDirectories(context: ServerContext): string[] {
  const workspacePath = context.options.conversationWorkspacePath;
  const grantDirectories = context.filesystemGrants
    .listGrantsForContext(workspacePath)
    .map((grant) => grant.directoryPath);

  return uniqueFilesystemPaths([
    ...(workspacePath ? [workspacePath] : []),
    ...grantDirectories,
  ]);
}

function filesystemAccessWhitelistLines(
  directoryPaths: string[],
  contextLabel: "global" | "workspace",
): string[] {
  if (directoryPaths.length === 0) {
    return [`- No directories are currently whitelisted for the ${contextLabel} context.`];
  }

  return [
    `- Whitelisted directories for the ${contextLabel} context:`,
    ...directoryPaths.map((directoryPath) => `  - ${directoryPath}`),
  ];
}

function runningTerminalsPromptAppendix(
  context: ServerContext,
  session: AgentSessionSummary,
): string | null {
  const terminals = context.commandTerminals
    .list(session.id)
    .filter((terminal): terminal is CommandTerminalSummary => terminal.status === "running");

  if (terminals.length === 0) {
    return null;
  }

  const lines = [
    "Active terminals:",
    "- The following terminals spawned by this session are currently running. This list reflects live server state, not conversation history, so trust it over any earlier status mentioned in prior messages.",
    ...terminals.map((terminal) => {
      const label = terminal.label || terminal.command || "Terminal";
      const preview = terminal.lastOutputPreview
        ? ` last output: ${truncateForPrompt(terminal.lastOutputPreview)}`
        : "";

      return `  - terminalId=${terminal.terminalId} label=${label} command=${terminal.command}${preview}`;
    }),
    "- Use write_to_terminal or kill_terminal with these terminalId values instead of spawning duplicates. write_to_terminal writes input verbatim with no automatic newline, so append \\n to submit a line.",
  ];

  return lines.join("\n");
}

function truncateForPrompt(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();

  return singleLine.length > 160 ? `${singleLine.slice(0, 160)}…` : singleLine;
}

function skillsPromptAppendix(context: ServerContext): string {
  const summaries = context.skills?.skills ?? [];
  const activeSkills = summaries.filter((skill) => skill.active);
  const prunedCount = summaries.length - activeSkills.length;

  const lines = [
    "Skills:",
    "- Skills are packaged task guidance folders with a SKILL.md file plus optional scripts, templates, and reference files.",
    "- Use skill names and descriptions to decide when specialized guidance is relevant. When a skill is relevant, read that skill's SKILL.md with Truss Chat Tools `read_skill` before relying on it, then read only the supporting files needed for the task.",
    "- Skill directories may also be exposed through Truss Filesystem Tools as read-only roots. Global skills are always available when present; workspace/provider skills are auto-discovered only in workspace mode.",
  ];

  if (activeSkills.length === 0) {
    lines.push("- No skills are currently active for this prompt context.");
    return lines.join("\n");
  }

  lines.push("- Active skills:");

  for (const skill of activeSkills) {
    const description = skill.description ? ` - ${skill.description}` : "";
    lines.push(
      `  - ${skill.name} (${skill.scope}/${skill.source}) id=${skill.id}: ${skill.path}${description}`,
    );
  }

  if (prunedCount > 0) {
    lines.push(`- ${prunedCount} discovered skill(s) were omitted from this prompt context by the skill budget.`);
  }

  return lines.join("\n");
}

function uniqueFilesystemPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    const key = process.platform === "win32" ? path.toLowerCase() : path;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(path);
  }

  return unique;
}

export function exportSystemMessageForSession({
  context,
  sessionType,
}: {
  context: ServerContext;
  sessionType: AgentSessionType;
}): ChatMessage {
  const mode = systemPromptModeForSessionType(sessionType);
  const template = systemPromptTemplateForMode(context, mode);

  return {
    role: "system",
    content: renderChatSystemPrompt({
      context,
      systemPrompt: template,
      toolDefinitions: exportToolDefinitionsForSessionType(context, sessionType),
    }),
  };
}

export function exportToolDefinitionsForSession({
  context,
  sessionType,
}: {
  context: ServerContext;
  sessionType: AgentSessionType;
}): OpenAiChatToolDefinition[] {
  return exportToolDefinitionsForSessionType(context, sessionType).map(toOpenAiChatToolDefinition);
}

function exportToolDefinitionsForSessionType(
  context: ServerContext,
  sessionType: AgentSessionType,
): LlmToolDefinition[] {
  const definitions = context.mcp.getToolDefinitions();

  return sessionType === "agentic"
    ? definitions
    : definitions.filter((tool) => tool.name !== "spawn_sub_agent");
}

function toOpenAiChatToolDefinition(tool: LlmToolDefinition): OpenAiChatToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
