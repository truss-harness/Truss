import { ensureTrussHome, type TrussHome } from "../../../setup/truss-home.ts";
import { openAppDatabase, type AppDatabase } from "../../../storage/database.ts";
import { AgentSessionsRepository } from "../../../storage/agent-sessions.ts";
import { ChatMessagesRepository } from "../../../storage/chat-messages.ts";
import {
  ScheduledTaskAccessGrantsRepository,
  ScheduledTaskRunsRepository,
  ScheduledTasksRepository,
} from "../../../storage/scheduled-tasks.ts";

export interface TrussChatToolsRuntime {
  agentSessions: AgentSessionsRepository;
  chatMessages: ChatMessagesRepository;
  close(): void;
  scheduledTasks: ScheduledTasksRepository;
  scheduledTaskRuns: ScheduledTaskRunsRepository;
  scheduledTaskGrants: ScheduledTaskAccessGrantsRepository;
  trussHome: TrussHome;
  workspacePath: string | null;
}

export async function createTrussChatToolsMcpRuntime(
  trussHomeDir?: string,
  workspacePath?: string,
): Promise<TrussChatToolsRuntime> {
  const trussHome = await ensureTrussHome(trussHomeDir, {
    log: (message) => console.error(message),
  });
  const database = openAppDatabase(trussHome.dbPath);
  const scopedWorkspacePath = normalizeWorkspacePath(workspacePath);

  return {
    agentSessions: new AgentSessionsRepository(database.db, {
      workspacePath: scopedWorkspacePath,
    }),
    chatMessages: new ChatMessagesRepository(database.db, {
      workspacePath: scopedWorkspacePath,
    }),
    close: () => closeDatabase(database),
    scheduledTasks: new ScheduledTasksRepository(database.db, {
      workspacePath: scopedWorkspacePath,
    }),
    scheduledTaskRuns: new ScheduledTaskRunsRepository(database.db),
    scheduledTaskGrants: new ScheduledTaskAccessGrantsRepository(database.db),
    trussHome,
    workspacePath: scopedWorkspacePath,
  };
}

function closeDatabase(database: AppDatabase): void {
  try {
    database.db.close();
  } catch {
    // Process shutdown should not be blocked by a failed close.
  }
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
