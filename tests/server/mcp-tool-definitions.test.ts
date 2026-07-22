import { describe, expect, it } from "bun:test";
import { trussChatToolDefinitions } from "../../src/server/mcp/servers/truss-chat-tools/server.ts";
import { trussFilesystemToolDefinitions } from "../../src/server/mcp/servers/truss-filesystem-tools/server.ts";
import { trussOrchestrationToolDefinitions } from "../../src/server/mcp/servers/truss-orchestration-tools/server.ts";
import { commandRunnerToolDefinitions } from "../../src/server/tools/command-runner.ts";
import { askUserChoiceInputSchema } from "../../src/server/tools/user-choice.ts";
import { requestDirectoryAccessInputSchema } from "../../src/server/tools/file-access-request.ts";
import { trussWebToolDefinitions } from "../../src/server/tools/truss-web-tools.ts";

describe("first-party MCP tool definitions", () => {
  it("advertises explicit safety gates for destructive and host-mediated tools", () => {
    const deleteFileSchema = trussFilesystemToolDefinitions.delete_file.inputSchema;
    const deleteConfirm = schemaProperty(deleteFileSchema, "confirmDeletion");

    expect(deleteFileSchema.required).toContain("confirmDeletion");
    expect(deleteConfirm.description).toContain("explicit confirmation");
    expect(trussChatToolDefinitions.edit_mcp_config.description).toContain(
      "writes only after user approval",
    );
    expect(trussChatToolDefinitions.request_directory_access.description).toContain(
      "active file-access root with sufficient permission",
    );
    expect(trussChatToolDefinitions.request_directory_access.description).toContain(
      "Set readOnly: true",
    );
    expect(trussChatToolDefinitions.read_skill.description).toContain(
      "filesystem access to its global or workspace skill directory may be unavailable",
    );
    expect(commandRunnerToolDefinitions.run_command.description).toContain(
      "pre-execution guard",
    );
    expect(commandRunnerToolDefinitions.run_command.description).toContain(
      "post-execution output guard",
    );
    expect(commandRunnerToolDefinitions.request_command_whitelist.description).toContain(
      "browser-mediated user approval",
    );
  });

  it("bounds common web and filesystem parameters at the schema level", () => {
    const webSearchProperties = schemaProperties(trussWebToolDefinitions.web_search.parameters);
    const loadWebpageProperties = schemaProperties(trussWebToolDefinitions.load_webpage.parameters);
    const conversionProperties = schemaProperties(
      trussWebToolDefinitions.convert_webpage_html_to_markdown.parameters,
    );
    const sanitizerProperties = schemaProperties(
      trussWebToolDefinitions.sanitize_webpage_markdown.parameters,
    );
    const readTextProperties = schemaProperties(trussFilesystemToolDefinitions.read_text_file.inputSchema);
    const readSkillProperties = schemaProperties(trussChatToolDefinitions.read_skill.inputSchema);
    const regexSearchProperties = schemaProperties(
      trussFilesystemToolDefinitions.regex_search_files.inputSchema,
    );
    const runCommandProperties = schemaProperties(
      commandRunnerToolDefinitions.run_command.parameters,
    );
    const spawnTerminalProperties = schemaProperties(
      commandRunnerToolDefinitions.spawn_terminal.parameters,
    );
    const writeTerminalProperties = schemaProperties(
      commandRunnerToolDefinitions.write_to_terminal.parameters,
    );
    const whitelistProperties = schemaProperties(
      commandRunnerToolDefinitions.request_command_whitelist.parameters,
    );
    const webSearchQuery = requiredProperty(webSearchProperties, "query");
    const loadUrls = requiredProperty(loadWebpageProperties, "urls");
    const conversionHtml = requiredProperty(conversionProperties, "html");
    const sanitizerContent = requiredProperty(sanitizerProperties, "content");
    const readLineCount = requiredProperty(readTextProperties, "lineCount");
    const readPath = requiredProperty(readTextProperties, "path");
    const skillId = requiredProperty(readSkillProperties, "skillId");
    const regexContextLines = requiredProperty(regexSearchProperties, "context_lines");
    const regexPattern = requiredProperty(regexSearchProperties, "pattern");
    const runCommandCommand = requiredProperty(runCommandProperties, "command");
    const runCommandTimeout = requiredProperty(runCommandProperties, "timeoutSeconds");
    const runCommandStreaming = requiredProperty(runCommandProperties, "streaming");
    const spawnTimeout = requiredProperty(spawnTerminalProperties, "timeoutSeconds");
    const writeTimeout = requiredProperty(writeTerminalProperties, "timeoutSeconds");
    const whitelistPattern = requiredProperty(whitelistProperties, "pattern");
    const whitelistType = requiredProperty(whitelistProperties, "type");
    const whitelistReason = requiredProperty(whitelistProperties, "reason");

    expect(webSearchQuery.maxLength).toBe(500);
    expect(loadUrls.maxItems).toBe(5);
    expect(conversionHtml.maxLength).toBe(1_000_000);
    expect(sanitizerContent.maxLength).toBe(1_000_000);
    expect(readLineCount.type).toBe("integer");
    expect(readLineCount.maximum).toBe(10_000);
    expect(readPath.maxLength).toBe(4_000);
    expect(skillId.maxLength).toBe(1_000);
    expect(regexContextLines.maximum).toBe(20);
    expect(regexPattern.maxLength).toBe(2_000);
    expect(commandRunnerToolDefinitions.run_command.parameters.required).toContain("timeoutSeconds");
    expect(commandRunnerToolDefinitions.spawn_terminal.parameters.required).toContain("timeoutSeconds");
    expect(commandRunnerToolDefinitions.write_to_terminal.parameters.required).toContain("timeoutSeconds");
    expect(runCommandCommand.maxLength).toBe(8_000);
    expect(runCommandTimeout.maximum).toBe(3_600);
    expect(spawnTimeout.maximum).toBe(3_600);
    expect(writeTimeout.maximum).toBe(3_600);
    expect(
      requiredProperty(schemaProperties(runCommandStreaming), "every_lines").maximum,
    ).toBe(10_000);
    expect(whitelistPattern.maxLength).toBe(1_000);
    expect(whitelistType.enum).toEqual(["prefix", "glob", "regex"]);
    expect(whitelistReason.maxLength).toBe(1_200);
  });

  it("describes sub-agent boundaries and nullable allowlist inheritance", () => {
    const spawn = trussOrchestrationToolDefinitions.spawn_sub_agent;
    const spawnProperties = schemaProperties(spawn.inputSchema);
    const spawnTask = requiredProperty(spawnProperties, "task");
    const spawnMcpServers = requiredProperty(spawnProperties, "mcpServers");
    const spawnTools = requiredProperty(spawnProperties, "tools");

    expect(spawn.description).toContain("available only in agentic sessions");
    expect(spawn.description).toContain("background-safe MCP servers and tools");
    expect(spawn.description).toContain("does not require creating a timer");
    expect(spawn.description).toContain("timers are only for delayed or scheduled resumption");
    expect(spawnTask.maxLength).toBe(20_000);
    expect(JSON.stringify(spawnMcpServers.anyOf)).toContain('"type":"null"');
    expect(JSON.stringify(spawnTools.anyOf)).toContain('"type":"null"');
  });

  it("describes planning tools as session-scoped bookkeeping separate from delegation", () => {
    const planToolNames = [
      "plan_set_todos",
      "plan_set_subtasks",
      "plan_get",
      "plan_update_todo",
      "plan_update_subtask",
    ] as const;

    for (const name of planToolNames) {
      const description = trussOrchestrationToolDefinitions[name].description;

      expect(description).toContain("session-scoped, in-memory status board");
      expect(description).toContain("They do not execute, schedule, or delegate work");
      expect(description).toContain("not persisted as a source of truth");
      expect(description).toContain("Direct user requests");
      expect(description).toContain("not requests to simulate a checklist in text");
      expect(description).toContain("Marking `done` is bookkeeping");
      expect(description).toContain("Use when:");
      expect(description).toContain("Don't confuse with:");
      expect(description).toContain("Example:");
    }

    expect(trussOrchestrationToolDefinitions.plan_set_todos.description).toContain(
      "tracked top-level checklist",
    );
    expect(trussOrchestrationToolDefinitions.plan_set_subtasks.description).toContain(
      "nested status rows under a parent todo",
    );
    expect(trussOrchestrationToolDefinitions.plan_get.description).toContain(
      "throwaway plan state only",
    );
    expect(trussOrchestrationToolDefinitions.spawn_sub_agent.description).toContain(
      "perform an independent delegated task",
    );
    expect(trussOrchestrationToolDefinitions.spawn_sub_agent.description).toContain(
      "planning subtasks",
    );
    expect(trussOrchestrationToolDefinitions.spawn_sub_agent.description).toContain(
      "never start child work",
    );
  });

  it("publishes caps for browser-mediated user interaction schemas", () => {
    const choiceProperties = schemaProperties(askUserChoiceInputSchema());
    const choiceOptions = requiredProperty(choiceProperties, "options");
    const choiceQuestion = requiredProperty(choiceProperties, "question");
    const optionProperties = schemaProperties(choiceOptions.items as Record<string, unknown>);
    const optionLabel = requiredProperty(optionProperties, "label");
    const accessProperties = schemaProperties(requestDirectoryAccessInputSchema());
    const directoryPath = requiredProperty(accessProperties, "directoryPath");
    const readOnly = requiredProperty(accessProperties, "readOnly");
    const reason = requiredProperty(accessProperties, "reason");

    expect(choiceQuestion.maxLength).toBe(1_200);
    expect(choiceOptions.maxItems).toBe(8);
    expect(optionLabel.maxLength).toBe(180);
    expect(directoryPath.maxLength).toBe(4_000);
    expect(readOnly.type).toBe("boolean");
    expect(readOnly.description).toContain("Read-only grants block");
    expect(reason.maxLength).toBe(1_200);
  });
});

function schemaProperty(schema: Record<string, unknown>, key: string): Record<string, unknown> {
  return requiredProperty(schemaProperties(schema), key);
}

function schemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = schema.properties;

  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("Expected schema properties object.");
  }

  return properties as Record<string, Record<string, unknown>>;
}

function requiredProperty(
  properties: Record<string, Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const property = properties[key];

  if (!property) {
    throw new Error(`Expected schema property ${key}.`);
  }

  return property;
}
