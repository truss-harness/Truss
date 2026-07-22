import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS llm_provider_settings (
        provider_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        base_url TEXT,
        default_model TEXT,
        models_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS llm_model_profiles (
        profile_id TEXT PRIMARY KEY CHECK (profile_id IN ('fast-helper', 'conversation', 'agentic')),
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        temperature REAL CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
        top_p REAL CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1)),
        top_k INTEGER CHECK (top_k IS NULL OR top_k >= 0),
        context_size INTEGER CHECK (context_size IS NULL OR context_size > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES llm_provider_settings(provider_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('conversation', 'agentic', 'sub-agent')),
        parent_session_id TEXT,
        title TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        temperature REAL CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
        top_p REAL CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1)),
        top_k INTEGER CHECK (top_k IS NULL OR top_k >= 0),
        context_size INTEGER CHECK (context_size IS NULL OR context_size > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (type = 'sub-agent' AND parent_session_id IS NOT NULL)
          OR (type <> 'sub-agent' AND parent_session_id IS NULL)
        ),
        CHECK (parent_session_id IS NULL OR parent_session_id <> id),
        FOREIGN KEY (parent_session_id) REFERENCES agent_sessions(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        FOREIGN KEY (provider_id) REFERENCES llm_provider_settings(provider_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent_session_id
        ON agent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_type
        ON agent_sessions(type);
    `,
  },
  {
    version: 3,
    sql: `
      DROP INDEX IF EXISTS idx_agent_sessions_type;

      CREATE INDEX IF NOT EXISTS idx_llm_model_profiles_provider_id
        ON llm_model_profiles(provider_id);

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider_id
        ON agent_sessions(provider_id);

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_created_at
        ON agent_sessions(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_type_created_at
        ON agent_sessions(type, created_at DESC);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS first_run_setup (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        completed INTEGER NOT NULL CHECK (completed IN (0, 1)) DEFAULT 0,
        nickname TEXT,
        preferred_language TEXT,
        location TEXT,
        model_catalog_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        thinking_content TEXT,
        thinking_duration_ms INTEGER CHECK (thinking_duration_ms IS NULL OR thinking_duration_ms >= 0),
        thinking_word_count INTEGER CHECK (thinking_word_count IS NULL OR thinking_word_count >= 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
        ON chat_messages(session_id, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated_at
        ON agent_sessions(updated_at DESC);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS system_prompt_settings (
        mode TEXT PRIMARY KEY CHECK (mode IN ('conversation', 'agentic')),
        template TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_history_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        include_thinking_history INTEGER NOT NULL CHECK (include_thinking_history IN (0, 1)) DEFAULT 0,
        include_tool_history INTEGER NOT NULL CHECK (include_tool_history IN (0, 1)) DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS rich_feature_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        smart_tables_enabled INTEGER NOT NULL CHECK (smart_tables_enabled IN (0, 1)) DEFAULT 0,
        smart_events_enabled INTEGER NOT NULL CHECK (smart_events_enabled IN (0, 1)) DEFAULT 0,
        smart_events_google_calendar_enabled INTEGER NOT NULL CHECK (smart_events_google_calendar_enabled IN (0, 1)) DEFAULT 0,
        smart_events_outlook_calendar_enabled INTEGER NOT NULL CHECK (smart_events_outlook_calendar_enabled IN (0, 1)) DEFAULT 0,
        smart_events_ics_enabled INTEGER NOT NULL CHECK (smart_events_ics_enabled IN (0, 1)) DEFAULT 0,
        plantuml_enabled INTEGER NOT NULL CHECK (plantuml_enabled IN (0, 1)) DEFAULT 0,
        plantuml_server_url TEXT NOT NULL DEFAULT 'https://www.plantuml.com/plantuml',
        plantuml_format TEXT NOT NULL CHECK (plantuml_format IN ('svg', 'png')) DEFAULT 'svg',
        plantuml_prompt TEXT NOT NULL DEFAULT '',
        katex_enabled INTEGER NOT NULL CHECK (katex_enabled IN (0, 1)) DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE rich_feature_settings
        ADD COLUMN callouts_enabled INTEGER NOT NULL DEFAULT 1 CHECK (callouts_enabled IN (0, 1));
    `,
  },
  {
    version: 10,
    sql: `
      UPDATE rich_feature_settings
      SET plantuml_prompt =
        'When writing PlantUML for Truss, return a fenced plantuml code block containing valid multiline PlantUML source. Include @startuml and @enduml, and do not flatten the source into a single line.'
        || char(10) || char(10) ||
        'Use this palette consistently: #242421 for main text and line work, #8C8370 for neutral borders and secondary elements, #D96C4A for accents and errors, and #F9F7F2 for background and light fills.'
        || char(10) || char(10) ||
        'Place these directives near the top of each diagram after @startuml, replacing the title and header placeholders with useful text:'
        || char(10) ||
        'autonumber'
        || char(10) ||
        'skinparam style strictuml'
        || char(10) ||
        'skinparam DefaultFontName Calibri'
        || char(10) ||
        'skinparam RoundCorner 3'
        || char(10) ||
        'title **<Diagram Title>**'
        || char(10) ||
        'header "<Header Text>"'
        || char(10) || char(10) ||
        'For sequence diagrams, use ++ and -- inline on arrows to open and close activation bars:'
        || char(10) ||
        'client -> alb ++: Send request'
        || char(10) ||
        'alb -> envoy ++: Re-route'
        || char(10) ||
        'envoy --> alb --: Response'
        || char(10) || char(10) ||
        'Use dividers in the form ... <description> ... for time or state separators, for example: ... A client application is already registered ...'
        || char(10) || char(10) ||
        'Use these arrow styles: normal forward calls use ->, returns or async responses use -->, and error responses use -[#red]->.'
      WHERE trim(plantuml_prompt) = '';
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE conversation_history_settings
        ADD COLUMN limit_reasoning_budget INTEGER NOT NULL DEFAULT 0 CHECK (limit_reasoning_budget IN (0, 1));

      ALTER TABLE conversation_history_settings
        ADD COLUMN max_reasoning_time_seconds INTEGER NOT NULL DEFAULT 300 CHECK (max_reasoning_time_seconds >= 0);

      ALTER TABLE conversation_history_settings
        ADD COLUMN max_reasoning_words INTEGER NOT NULL DEFAULT 10000 CHECK (max_reasoning_words >= 0);
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE rich_feature_settings
        ADD COLUMN cards_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cards_enabled IN (0, 1));
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE rich_feature_settings
        ADD COLUMN follow_ups_enabled INTEGER NOT NULL DEFAULT 1 CHECK (follow_ups_enabled IN (0, 1));
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE chat_messages
        ADD COLUMN tool_calls_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 15,
    sql: `
      ALTER TABLE rich_feature_settings
        ADD COLUMN timelines_enabled INTEGER NOT NULL DEFAULT 0 CHECK (timelines_enabled IN (0, 1));
    `,
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sanitizer_provider_id TEXT,
        sanitizer_model_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE agent_sessions
        ADD COLUMN workspace_path TEXT;

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace_path_updated_at
        ON agent_sessions(workspace_path, updated_at DESC);
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE IF NOT EXISTS filesystem_directory_grants (
        id INTEGER PRIMARY KEY,
        workspace_path TEXT,
        directory_path TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        grant_source TEXT NOT NULL CHECK (grant_source IN ('user-dialog', 'cli-arg'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_filesystem_directory_grants_workspace_directory
        ON filesystem_directory_grants(workspace_path, directory_path);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_filesystem_directory_grants_global_directory
        ON filesystem_directory_grants(directory_path)
        WHERE workspace_path IS NULL;
    `,
  },
  {
    version: 19,
    sql: `
      ALTER TABLE rich_feature_settings
        ADD COLUMN agentic_tool_turn_limit_enabled INTEGER NOT NULL DEFAULT 1 CHECK (agentic_tool_turn_limit_enabled IN (0, 1));

      ALTER TABLE rich_feature_settings
        ADD COLUMN agentic_tool_turn_limit INTEGER NOT NULL DEFAULT 300 CHECK (agentic_tool_turn_limit >= 0);
    `,
  },
  {
    version: 20,
    sql: `
      ALTER TABLE filesystem_directory_grants
        ADD COLUMN expires_at TEXT;

      UPDATE filesystem_directory_grants
      SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', granted_at, '+24 hours')
      WHERE expires_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_filesystem_directory_grants_expires_at
        ON filesystem_directory_grants(expires_at);
    `,
  },
  {
    version: 21,
    sql: `
      ALTER TABLE chat_messages
        ADD COLUMN thinking_encrypted_content TEXT;
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE filesystem_directory_grants
        ADD COLUMN read_only BOOLEAN NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1));
    `,
  },
  {
    version: 23,
    sql: `
      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_guard_provider_id TEXT;

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_guard_model_id TEXT;

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_pre_guard_enabled INTEGER NOT NULL DEFAULT 1 CHECK (command_runner_pre_guard_enabled IN (0, 1));

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_post_guard_enabled INTEGER NOT NULL DEFAULT 1 CHECK (command_runner_post_guard_enabled IN (0, 1));

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_safe_action TEXT NOT NULL DEFAULT 'auto-allow' CHECK (command_runner_safe_action IN ('auto-allow', 'ask', 'auto-deny'));

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_risky_action TEXT NOT NULL DEFAULT 'ask' CHECK (command_runner_risky_action IN ('auto-allow', 'ask', 'auto-deny'));

      ALTER TABLE mcp_settings
        ADD COLUMN command_runner_dangerous_action TEXT NOT NULL DEFAULT 'ask' CHECK (command_runner_dangerous_action IN ('auto-allow', 'ask', 'auto-deny'));

      CREATE TABLE IF NOT EXISTS command_runner_whitelist_entries (
        id INTEGER PRIMARY KEY,
        pattern TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('prefix', 'glob', 'regex')),
        expires_at TEXT,
        added_by TEXT NOT NULL CHECK (added_by IN ('user', 'llm-request')),
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_command_runner_whitelist_entries_expires_at
        ON command_runner_whitelist_entries(expires_at);
    `,
  },
  {
    version: 24,
    sql: `
      ALTER TABLE first_run_setup
        ADD COLUMN show_workspace_sessions_in_global_view INTEGER NOT NULL DEFAULT 0 CHECK (show_workspace_sessions_in_global_view IN (0, 1));
    `,
  },
  {
    version: 25,
    sql: `
      UPDATE mcp_settings
      SET command_runner_dangerous_action = 'ask'
      WHERE command_runner_dangerous_action = 'auto-deny';

      CREATE TABLE IF NOT EXISTS command_runner_whitelist_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seeded_defaults INTEGER NOT NULL DEFAULT 0 CHECK (seeded_defaults IN (0, 1))
      );
    `,
  },
  {
    version: 26,
    sql: `
      ALTER TABLE mcp_settings
        ADD COLUMN playwright_mcp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (playwright_mcp_enabled IN (0, 1));

      ALTER TABLE mcp_settings
        ADD COLUMN playwright_mcp_headless INTEGER NOT NULL DEFAULT 1 CHECK (playwright_mcp_headless IN (0, 1));

      ALTER TABLE mcp_settings
        ADD COLUMN playwright_mcp_tools TEXT NOT NULL DEFAULT '*';

      ALTER TABLE mcp_settings
        ADD COLUMN playwright_mcp_shared_browser INTEGER NOT NULL DEFAULT 1 CHECK (playwright_mcp_shared_browser IN (0, 1));
    `,
  },
  {
    version: 27,
    sql: `
      ALTER TABLE chat_messages
        ADD COLUMN status TEXT CHECK (status IS NULL OR status = 'error');
    `,
  },
  {
    version: 28,
    sql: `
      ALTER TABLE chat_messages
        ADD COLUMN metrics_json TEXT;
    `,
  },
  {
    version: 29,
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        timezone TEXT,
        working_directory TEXT,
        workspace_path TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        temperature REAL CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
        top_p REAL CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1)),
        top_k INTEGER CHECK (top_k IS NULL OR top_k >= 0),
        context_size INTEGER CHECK (context_size IS NULL OR context_size > 0),
        allow_overlap INTEGER NOT NULL DEFAULT 0 CHECK (allow_overlap IN (0, 1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_by TEXT NOT NULL CHECK (created_by IN ('user', 'llm')),
        created_by_session_id TEXT,
        root_session_id TEXT,
        last_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES llm_provider_settings(provider_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (root_session_id) REFERENCES agent_sessions(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_workspace_path
        ON scheduled_tasks(workspace_path);

      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled
        ON scheduled_tasks(enabled);

      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'skipped')),
        trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
        allow_overlap INTEGER NOT NULL DEFAULT 0 CHECK (allow_overlap IN (0, 1)),
        summary TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task_started_at
        ON scheduled_task_runs(task_id, started_at DESC);

      -- Only tasks that do not allow overlap are protected by this uniqueness
      -- guard; the allow_overlap flag is copied from the task at run-start
      -- time so this partial index can reference it without a join.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_task_runs_running_unique
        ON scheduled_task_runs(task_id)
        WHERE status = 'running' AND allow_overlap = 0;

      CREATE TABLE IF NOT EXISTS scheduled_task_global_access_grants (
        workspace_path TEXT PRIMARY KEY,
        granted_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 30,
    sql: `
      CREATE TABLE IF NOT EXISTS spawned_processes (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        workspace_path TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_spawned_processes_port
        ON spawned_processes(port);
    `,
  },
];

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.query("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  const migrate = db.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
    }
  });

  migrate();
}
