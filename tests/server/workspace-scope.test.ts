import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { ensureGlobalMcpConfig } from "../../src/server/mcp/global-config.ts";
import { ensureTrussHome } from "../../src/server/setup/truss-home.ts";
import { AgentSessionsRepository } from "../../src/server/storage/agent-sessions.ts";
import { ChatMessagesRepository } from "../../src/server/storage/chat-messages.ts";
import { openAppDatabase, type AppDatabase } from "../../src/server/storage/database.ts";
import { FilesystemDirectoryGrantsRepository } from "../../src/server/storage/filesystem-directory-grants.ts";
import { SettingsRepository } from "../../src/server/storage/settings.ts";
import { getLlmProviderSettingsDefaults } from "../../src/server/llm/registry.ts";

describe("workspace-scoped conversation storage", () => {
  it("stores workspace-scoped conversations in one database and filters by scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-workspace-scope-"));
    let database: AppDatabase | null = null;

    try {
      const dbPath = join(root, "truss.db");
      const workspaceA = resolve(root, "workspace-a");
      const workspaceB = resolve(root, "workspace-b");

      database = openAppDatabase(dbPath);
      new SettingsRepository(database.db).ensureLlmProviders(getLlmProviderSettingsDefaults());

      const allSessions = new AgentSessionsRepository(database.db);
      const allMessages = new ChatMessagesRepository(database.db);
      const workspaceASessions = new AgentSessionsRepository(database.db, {
        workspacePath: workspaceA,
      });
      const workspaceAMessages = new ChatMessagesRepository(database.db, {
        workspacePath: workspaceA,
      });
      const workspaceBSessions = new AgentSessionsRepository(database.db, {
        workspacePath: workspaceB,
      });
      const workspaceBMessages = new ChatMessagesRepository(database.db, {
        workspacePath: workspaceB,
      });

      const sessionA = workspaceASessions.createAgentSession({
        id: "session_workspace_a",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Workspace A",
        type: "conversation",
      });
      const sessionB = workspaceBSessions.createAgentSession({
        id: "session_workspace_b",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Workspace B",
        type: "conversation",
      });
      const unscopedSession = allSessions.createAgentSession({
        id: "session_all_workspaces",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "All workspaces",
        type: "conversation",
      });

      allMessages.createChatMessage({
        content: "message only in workspace A",
        id: "msg_workspace_a",
        role: "user",
        sessionId: sessionA.id,
      });
      allMessages.createChatMessage({
        content: "message only in workspace B",
        id: "msg_workspace_b",
        role: "user",
        sessionId: sessionB.id,
      });

      expect(sessionA.workspacePath).toBe(workspaceA);
      expect(sessionB.workspacePath).toBe(workspaceB);
      expect(unscopedSession.workspacePath).toBeNull();

      expect(workspaceASessions.listAgentSessions().map((session) => session.id)).toEqual([
        sessionA.id,
      ]);
      expect(workspaceBSessions.listAgentSessions().map((session) => session.id)).toEqual([
        sessionB.id,
      ]);
      expect(allSessions.listAgentSessions().map((session) => session.id).sort()).toEqual(
        [sessionA.id, sessionB.id, unscopedSession.id].sort(),
      );
      expect(
        allSessions
          .listAgentSessions({ includeWorkspaceSessions: false })
          .map((session) => session.id),
      ).toEqual([unscopedSession.id]);

      expect(workspaceASessions.getAgentSession(sessionB.id)).toBeNull();
      expect(
        workspaceAMessages.searchSessionMessages({
          includeSubAgents: true,
          query: "workspace B",
        }),
      ).toEqual([]);
      expect(
        allMessages.searchSessionMessages({
          includeSubAgents: true,
          query: "workspace B",
        }),
      ).toHaveLength(1);
    } finally {
      if (database) {
        database.db.close();
      }

      await rm(root, { force: true, recursive: true });
    }
  });

  it("summarizes workspaces and deletes workspace sessions with cascades", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-workspace-summary-"));
    let database: AppDatabase | null = null;

    try {
      const dbPath = join(root, "truss.db");
      const workspaceA = resolve(root, "workspace-a");
      const workspaceB = resolve(root, "workspace-b");

      database = openAppDatabase(dbPath);
      new SettingsRepository(database.db).ensureLlmProviders(getLlmProviderSettingsDefaults());

      const allSessions = new AgentSessionsRepository(database.db);
      const allMessages = new ChatMessagesRepository(database.db);

      const sessionA1 = allSessions.createAgentSession({
        id: "session_workspace_a_one",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Workspace A one",
        type: "conversation",
        workspacePath: workspaceA,
      });
      const sessionA2 = allSessions.createAgentSession({
        id: "session_workspace_a_two",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Workspace A two",
        type: "agentic",
        workspacePath: workspaceA,
      });
      const sessionB = allSessions.createAgentSession({
        id: "session_workspace_b_one",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Workspace B one",
        type: "conversation",
        workspacePath: workspaceB,
      });
      const subAgent = allSessions.createAgentSession({
        id: "session_workspace_a_sub",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: sessionA1.id,
        providerId: "ollama",
        title: "Workspace A sub-agent",
        type: "sub-agent",
      });

      allSessions.createAgentSession({
        id: "session_global",
        modelId: "llama3.1",
        parameters: nullParameters(),
        parentSessionId: null,
        providerId: "ollama",
        title: "Global",
        type: "conversation",
      });

      allMessages.createChatMessage({
        content: "top-level workspace A message",
        id: "msg_workspace_a",
        role: "user",
        sessionId: sessionA1.id,
      });
      allMessages.createChatMessage({
        content: "sub-agent workspace A message",
        id: "msg_workspace_a_sub",
        role: "assistant",
        sessionId: subAgent.id,
      });

      setSessionTimes(
        database,
        sessionA1.id,
        "2025-03-01T10:00:00.000Z",
        "2026-06-01T10:00:00.000Z",
      );
      setSessionTimes(
        database,
        sessionA2.id,
        "2026-06-05T10:00:00.000Z",
        "2026-06-10T10:00:00.000Z",
      );
      setSessionTimes(
        database,
        sessionB.id,
        "2026-01-01T10:00:00.000Z",
        "2026-06-15T10:00:00.000Z",
      );
      setSessionTimes(
        database,
        subAgent.id,
        "2026-06-20T10:00:00.000Z",
        "2026-06-20T10:00:00.000Z",
      );

      const workspaces = allSessions.listWorkspaces();

      expect(workspaces.map((workspace) => workspace.workspacePath)).toEqual([
        workspaceB,
        workspaceA,
      ]);
      expect(workspaces.find((workspace) => workspace.workspacePath === workspaceA)).toMatchObject({
        displayName: "workspace-a",
        firstCreatedAt: "2025-03-01T10:00:00.000Z",
        lastActiveAt: "2026-06-10T10:00:00.000Z",
        lastCreatedAt: "2026-06-05T10:00:00.000Z",
        sessionCount: 2,
      });

      expect(allSessions.deleteWorkspaceSessions(workspaceA)).toBe(2);
      expect(allSessions.getAgentSession(sessionA1.id)).toBeNull();
      expect(allSessions.getAgentSession(sessionA2.id)).toBeNull();
      expect(allSessions.getAgentSession(subAgent.id)).toBeNull();
      expect(allSessions.getAgentSession(sessionB.id)?.workspacePath).toBe(workspaceB);
      expect(countChatMessages(database)).toBe(0);
      expect(allSessions.listWorkspaces().map((workspace) => workspace.workspacePath)).toEqual([
        workspaceB,
      ]);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("writes the scoped workspace path into managed Truss Chat Tools config only when scoped", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-workspace-mcp-"));
    const previousGlobalSkillDirs = process.env.TRUSS_GLOBAL_SKILL_DIRS;
    process.env.TRUSS_GLOBAL_SKILL_DIRS = "";

    try {
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });
      const workspace = resolve(root, "workspace");

      await mkdir(workspace);

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: workspace,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const scopedConfig = JSON.parse(await Bun.file(trussHome.mcpConfigPath).text()) as {
        mcpServers: Record<string, { args?: string[]; cwd?: string; disabled?: boolean }>;
      };
      const scopedChatTools = scopedConfig.mcpServers["truss-chat-tools"];
      const scopedFilesystemTools = scopedConfig.mcpServers["truss-filesystem-tools"];

      expect(scopedChatTools).toBeDefined();
      expect(scopedFilesystemTools).toBeDefined();

      if (!scopedChatTools || !scopedFilesystemTools) {
        throw new Error("Managed scoped Truss MCP entries were not written.");
      }

      const workspaceFlagIndex = scopedChatTools.args?.indexOf("--workspace-path") ?? -1;
      const filesystemWorkspaceFlagIndex =
        scopedFilesystemTools.args?.indexOf("--workspace-path") ?? -1;

      expect(workspaceFlagIndex).toBeGreaterThanOrEqual(0);
      expect(scopedChatTools.args?.[workspaceFlagIndex + 1]).toBe(workspace);
      expect(filesystemWorkspaceFlagIndex).toBeGreaterThanOrEqual(0);
      expect(scopedFilesystemTools.args?.[filesystemWorkspaceFlagIndex + 1]).toBe(workspace);
      expect(scopedFilesystemTools.disabled).toBeUndefined();
      expect(scopedChatTools.cwd).toBe(workspace);
      expect(scopedFilesystemTools.cwd).toBe(workspace);

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: null,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const allConfig = JSON.parse(await Bun.file(trussHome.mcpConfigPath).text()) as {
        mcpServers: Record<string, { args?: string[]; disabled?: boolean }>;
      };
      const allChatTools = allConfig.mcpServers["truss-chat-tools"];
      const allFilesystemTools = allConfig.mcpServers["truss-filesystem-tools"];

      expect(allChatTools?.args?.includes("--workspace-path")).toBe(false);
      expect(allFilesystemTools?.args?.includes("--workspace-path")).toBe(false);
      expect(allFilesystemTools?.disabled).toBe(true);
    } finally {
      restoreEnv("TRUSS_GLOBAL_SKILL_DIRS", previousGlobalSkillDirs);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses only context-matching grants when refreshing managed filesystem config", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-config-grants-"));
    let database: AppDatabase | null = null;

    try {
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });
      const workspace = resolve(root, "workspace");
      const globalGrant = resolve(root, "global-grant");

      await mkdir(workspace);
      await mkdir(globalGrant);

      database = openAppDatabase(trussHome.dbPath);
      const grants = new FilesystemDirectoryGrantsRepository(database.db);

      await grants.upsertGrant({
        directoryPath: globalGrant,
        grantSource: "user-dialog",
        workspacePath: null,
      });

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: null,
        filesystemGrants: grants,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const globalConfig = JSON.parse(await Bun.file(trussHome.mcpConfigPath).text()) as {
        mcpServers: Record<string, { args?: string[]; disabled?: boolean }>;
      };
      const globalFilesystemTools = globalConfig.mcpServers["truss-filesystem-tools"];

      expect(globalFilesystemTools?.disabled).toBeUndefined();
      expect(globalFilesystemTools?.args?.includes("--workspace-path")).toBe(false);
      expect(globalFilesystemTools?.args?.includes(globalGrant)).toBe(false);

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: workspace,
        filesystemGrants: grants,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const scopedConfig = JSON.parse(await Bun.file(trussHome.mcpConfigPath).text()) as {
        mcpServers: Record<string, { args?: string[]; disabled?: boolean }>;
      };
      const scopedFilesystemTools = scopedConfig.mcpServers["truss-filesystem-tools"];
      const workspaceFlagIndex = scopedFilesystemTools?.args?.indexOf("--workspace-path") ?? -1;

      expect(scopedFilesystemTools?.disabled).toBeUndefined();
      expect(workspaceFlagIndex).toBeGreaterThanOrEqual(0);
      expect(scopedFilesystemTools?.args?.[workspaceFlagIndex + 1]).toBe(workspace);
      expect(scopedFilesystemTools?.args?.includes(globalGrant)).toBe(false);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});

function nullParameters() {
  return {
    contextSize: null,
    temperature: null,
    topK: null,
    topP: null,
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function setSessionTimes(
  database: AppDatabase,
  sessionId: string,
  createdAt: string,
  updatedAt: string,
): void {
  database.db
    .query("UPDATE agent_sessions SET created_at = ?, updated_at = ? WHERE id = ?")
    .run(createdAt, updatedAt, sessionId);
}

function countChatMessages(database: AppDatabase): number {
  const row = database.db.query("SELECT COUNT(*) AS count FROM chat_messages").get() as {
    count: number;
  };

  return row.count;
}
