import { EventHub } from "../event-hub.ts";
import { SampleAgent } from "../agent/sample-agent.ts";
import { handleOrchestrationTimerFired } from "./routes-chat.ts";
import { ScheduledTaskScheduler } from "../agent/scheduled-task-scheduler.ts";
import { PendingToolStore } from "../tools/pending-tool-store.ts";
import { ChatUserChoiceStore } from "../tools/chat-user-choice-store.ts";
import {
  CommandExecutionRegistry,
  CommandTerminalRegistry,
} from "../tools/command-runner.ts";
import { createMcpRuntime, type McpRuntime } from "../mcp/runtime.ts";
import {
  getLlmProviderSettingsDefaults,
  summarizeLlmProviders,
} from "../llm/registry.ts";
import {
  getLlmModelProfileDefaults,
  summarizeModelProfiles,
} from "../llm/model-profiles.ts";
import { discoverSkills } from "../skills/discovery.ts";
import { createSkillContext } from "../skills/context.ts";
import { SecretEnvStore } from "../config/env.ts";
import { openAppDatabase, type AppDatabase } from "../storage/database.ts";
import { AgentSessionsRepository } from "../storage/agent-sessions.ts";
import { ChatMessagesRepository } from "../storage/chat-messages.ts";
import { CommandRunnerWhitelistRepository } from "../storage/command-runner-whitelist.ts";
import { HistorySettingsRepository } from "../storage/history-settings.ts";
import { McpSettingsRepository } from "../storage/mcp-settings.ts";
import { ModelProfilesRepository } from "../storage/model-profiles.ts";
import { RichFeatureSettingsRepository } from "../storage/rich-feature-settings.ts";
import { FilesystemDirectoryGrantsRepository } from "../storage/filesystem-directory-grants.ts";
import {
  ScheduledTaskAccessGrantsRepository,
  ScheduledTaskRunsRepository,
  ScheduledTasksRepository,
} from "../storage/scheduled-tasks.ts";
import { SettingsRepository } from "../storage/settings.ts";
import { SetupRepository } from "../storage/setup.ts";
import { SystemPromptsRepository } from "../storage/system-prompts.ts";
import { SpawnedProcessesRepository } from "../storage/spawned-processes.ts";
import type { SpawnLifecycle } from "./spawn-lifecycle.ts";
import type { TrussHome } from "../setup/truss-home.ts";
import { getSystemPromptDefaults } from "../prompts/system-prompts.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";
import {
  browserBrokerCredentialEnv,
  browserBrokerTokenEnv,
  browserBrokerUrlEnv,
  type BrowserBrokerCredentials,
} from "../browser/broker-protocol.ts";
import {
  readStoredFileAccessSettings,
  writeStoredFileAccessSettings,
} from "../security/file-access.ts";
import type {
  LlmModelProfileSummary,
  LlmProviderSummary,
  McpDiscoverySummary,
  SkillDiscoverySummary,
} from "../../shared/protocol.ts";

export interface ServerOptions {
  browserBroker?: BrowserBrokerCredentials;
  port?: number;
  projectRoot: string;
  publicDir: string;
  conversationWorkspacePath: string | null;
  trussHome: TrussHome;
  workspacePath: string;
  serviceMode?: boolean;
}

export interface ServerContext {
  agent: SampleAgent;
  agentSessions: AgentSessionsRepository;
  chatMessages: ChatMessagesRepository;
  chatUserChoices: ChatUserChoiceStore;
  commandExecutions: CommandExecutionRegistry;
  commandTerminals: CommandTerminalRegistry;
  commandWhitelist: CommandRunnerWhitelistRepository;
  database: AppDatabase;
  filesystemGrants: FilesystemDirectoryGrantsRepository;
  getLlmProviders(): LlmProviderSummary[];
  getModelProfiles(): LlmModelProfileSummary[];
  historySettings: HistorySettingsRepository;
  hub: EventHub;
  mcp: McpRuntime;
  mcpSettings: McpSettingsRepository;
  modelProfiles: ModelProfilesRepository;
  options: ServerOptions;
  richFeatures: RichFeatureSettingsRepository;
  reloadMcpRuntime(): Promise<McpDiscoverySummary>;
  scheduledTasks: ScheduledTasksRepository;
  scheduledTaskRuns: ScheduledTaskRunsRepository;
  scheduledTaskGrants: ScheduledTaskAccessGrantsRepository;
  scheduledTaskScheduler: ScheduledTaskScheduler;
  scheduledTaskRunControllers: Map<string, { controller: AbortController; taskId: string }>;
  reloadScheduledTasks(): void;
  secretEnv: SecretEnvStore;
  spawnedProcesses: SpawnedProcessesRepository;
  spawnLifecycle: SpawnLifecycle | null;
  settings: SettingsRepository;
  setup: SetupRepository;
  skills: SkillDiscoverySummary;
  startedAt: string;
  subAgentTasks: Map<string, Promise<void>>;
  systemPrompts: SystemPromptsRepository;
}

export async function createServerContext(options: ServerOptions): Promise<ServerContext> {
  const hub = new EventHub();
  const tools = new PendingToolStore(hub);
  const chatUserChoices = new ChatUserChoiceStore();
  const commandExecutions = new CommandExecutionRegistry();
  const commandTerminals = new CommandTerminalRegistry((sessionId, terminal) => {
    hub.publish({
      id: createId("evt"),
      type: "command_terminal.updated",
      createdAt: now(),
      sessionId,
      terminal,
    });
  });
  const database = openAppDatabase(options.trussHome.dbPath);
  const settings = new SettingsRepository(database.db);
  const spawnedProcesses = new SpawnedProcessesRepository(database.db);
  const modelProfiles = new ModelProfilesRepository(database.db);
  const agentSessions = new AgentSessionsRepository(database.db, {
    workspacePath: options.conversationWorkspacePath,
  });
  const chatMessages = new ChatMessagesRepository(database.db, {
    workspacePath: options.conversationWorkspacePath,
  });
  const commandWhitelist = new CommandRunnerWhitelistRepository(database.db);
  const historySettings = new HistorySettingsRepository(database.db);
  const mcpSettings = new McpSettingsRepository(database.db);
  const richFeatures = new RichFeatureSettingsRepository(database.db);
  const filesystemGrants = new FilesystemDirectoryGrantsRepository(database.db);
  const setup = new SetupRepository(database.db);
  const systemPrompts = new SystemPromptsRepository(database.db);
  const scheduledTasks = new ScheduledTasksRepository(database.db, {
    workspacePath: options.conversationWorkspacePath,
  });
  const scheduledTaskRuns = new ScheduledTaskRunsRepository(database.db);
  const scheduledTaskGrants = new ScheduledTaskAccessGrantsRepository(database.db);
  const secretEnv = new SecretEnvStore({
    envPath: options.trussHome.envPath,
    envKeysPath: options.trussHome.envKeysPath,
  });

  secretEnv.load();
  settings.ensureLlmProviders(getLlmProviderSettingsDefaults());
  modelProfiles.ensureModelProfiles(getLlmModelProfileDefaults());
  historySettings.ensureHistorySettings();
  mcpSettings.ensureMcpSettings();
  commandWhitelist.ensureDefaultEntries();
  richFeatures.ensureRichFeatureSettings();
  setup.ensureSetup();
  systemPrompts.ensureSystemPrompts(getSystemPromptDefaults());
  await migrateLegacyFileAccessDirectories({
    filesystemGrants,
    trussHome: options.trussHome,
  });

  const publishMcpSummary = (mcp: McpDiscoverySummary) => {
    hub.publish({
      id: createId("evt"),
      type: "mcp.capabilities",
      createdAt: now(),
      mcp,
      servers: mcp.servers.filter((server) => server.connected),
    });
  };

  const createCurrentMcpRuntime = () => {
    const env = secretEnv.mergedWithProcessEnv();

    delete env[browserBrokerUrlEnv];
    delete env[browserBrokerTokenEnv];
    return createMcpRuntime({
      env,
      managedBrowserEnv: options.browserBroker
        ? browserBrokerCredentialEnv(options.browserBroker)
        : undefined,
      onSummaryChange: publishMcpSummary,
      onOrchestrationTimerFired: (event) => handleOrchestrationTimerFired(context, event),
      projectRoot: options.projectRoot,
      trussHome: options.trussHome,
      conversationWorkspacePath: options.conversationWorkspacePath,
      workspacePath: options.workspacePath,
      filesystemGrants,
      mcpSettings,
    });
  };

  const [mcp, discoveredSkills] = await Promise.all([
    createCurrentMcpRuntime(),
    discoverSkills({ workspacePath: options.conversationWorkspacePath }),
  ]);
  const skillContext = createSkillContext(discoveredSkills);

  let context: ServerContext;

  context = {
    agent: new SampleAgent({
      hub,
      tools,
      workspacePath: options.workspacePath,
    }),
    agentSessions,
    chatMessages,
    chatUserChoices,
    commandExecutions,
    commandTerminals,
    commandWhitelist,
    database,
    filesystemGrants,
    getLlmProviders: () =>
      summarizeLlmProviders({
        env: secretEnv.mergedWithProcessEnv(),
        secretEnv,
        settings: settings.listLlmProviderSettingsMap(),
      }),
    getModelProfiles: () => summarizeModelProfiles(modelProfiles.listModelProfiles()),
    historySettings,
    hub,
    mcp,
    mcpSettings,
    modelProfiles,
    options,
    richFeatures,
    reloadMcpRuntime: async () => {
      secretEnv.load();
      const nextMcp = await replaceMcpRuntime(context.mcp, createCurrentMcpRuntime);
      context.mcp = nextMcp;
      return nextMcp.summary;
    },
    scheduledTasks,
    scheduledTaskRuns,
    scheduledTaskGrants,
    scheduledTaskScheduler: null as unknown as ScheduledTaskScheduler,
    scheduledTaskRunControllers: new Map(),
    reloadScheduledTasks: () => context.scheduledTaskScheduler.sync(),
    secretEnv,
    spawnedProcesses,
    spawnLifecycle: null,
    settings,
    setup,
    skills: skillContext.summary,
    startedAt: new Date().toISOString(),
    subAgentTasks: new Map(),
    systemPrompts,
  };

  context.scheduledTaskScheduler = new ScheduledTaskScheduler(context);
  context.scheduledTaskScheduler.sync();

  return context;
}

export async function replaceMcpRuntime<T extends { close(): Promise<void> }>(
  previousMcp: T,
  createNextMcp: () => Promise<T>,
): Promise<T> {
  const nextMcp = await createNextMcp();

  try {
    await previousMcp.close();
  } catch (caught) {
    console.warn("Failed to close previous MCP runtime:", caught);
  }

  return nextMcp;
}

async function migrateLegacyFileAccessDirectories({
  filesystemGrants,
  trussHome,
}: {
  filesystemGrants: FilesystemDirectoryGrantsRepository;
  trussHome: TrussHome;
}): Promise<void> {
  const legacy = await readStoredFileAccessSettings(trussHome);

  if (legacy.directories.length === 0) {
    return;
  }

  for (const directoryPath of legacy.directories) {
    try {
      await filesystemGrants.upsertGrant({
        directoryPath,
        grantSource: "user-dialog",
        readOnly: false,
        workspacePath: null,
      });
    } catch (caught) {
      console.warn("Skipped legacy file-access directory grant:", caught);
    }
  }

  await writeStoredFileAccessSettings(trussHome, {
    directories: [],
    ignorePatterns: legacy.ignorePatterns,
  });
}
