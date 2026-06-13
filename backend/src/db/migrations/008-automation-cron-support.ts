import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

const migration: Migration = {
  version: 8,
  name: 'automation-cron-support',

  up(db) {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_jobs'").get()

    if (!tableExists) {
      db.run(`
        CREATE TABLE automation_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          interval_minutes INTEGER,
          automation_mode TEXT NOT NULL DEFAULT 'interval',
          cron_expression TEXT,
          timezone TEXT,
          agent_slug TEXT,
          prompt TEXT NOT NULL,
          model TEXT,
          skill_metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_run_at INTEGER,
          next_run_at INTEGER
        )
      `)
      db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_repo ON automation_jobs(repo_id)')
      db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_next_run ON automation_jobs(enabled, next_run_at)')
    }

    const runsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_runs'").get()
    if (!runsTableExists) {
      db.run(`
        CREATE TABLE automation_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
          repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
          trigger_source TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          created_at INTEGER NOT NULL,
          session_id TEXT,
          session_title TEXT,
          log_text TEXT,
          response_text TEXT,
          error_text TEXT
        )
      `)
      db.run('CREATE INDEX IF NOT EXISTS idx_automation_runs_job ON automation_runs(job_id, started_at DESC)')
      db.run('CREATE INDEX IF NOT EXISTS idx_automation_runs_repo ON automation_runs(repo_id, started_at DESC)')
    }

    const tableInfo = db.prepare('PRAGMA table_info(automation_jobs)').all() as ColumnInfo[]
    const existingColumns = new Set(tableInfo.map((column) => column.name))
    const intervalMinutesColumn = tableInfo.find((column) => column.name === 'interval_minutes')
    const automationModeColumn = tableInfo.find((column) => column.name === 'automation_mode')
    const hasCronColumns = existingColumns.has('automation_mode') && existingColumns.has('cron_expression') && existingColumns.has('timezone')
    const automationModeDefault = automationModeColumn?.dflt_value?.replaceAll("'", '')

    if (intervalMinutesColumn?.notnull === 0 && hasCronColumns && automationModeDefault === 'interval') {
      return
    }

    db.run(`
      CREATE TABLE automation_jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        interval_minutes INTEGER,
        automation_mode TEXT NOT NULL DEFAULT 'interval',
        cron_expression TEXT,
        timezone TEXT,
        agent_slug TEXT,
        prompt TEXT NOT NULL,
        model TEXT,
        skill_metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER
      )
    `)

    db.run(`
      INSERT INTO automation_jobs_new (
        id, repo_id, name, description, enabled, interval_minutes, automation_mode, cron_expression, timezone,
        agent_slug, prompt, model, skill_metadata, created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id,
        repo_id,
        name,
        description,
        enabled,
        interval_minutes,
        ${existingColumns.has('automation_mode') ? "COALESCE(automation_mode, 'interval')" : "'interval'"},
        ${existingColumns.has('cron_expression') ? 'cron_expression' : 'NULL'},
        ${existingColumns.has('timezone') ? 'timezone' : 'NULL'},
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      FROM automation_jobs
    `)

    db.run('DROP TABLE automation_jobs')
    db.run('ALTER TABLE automation_jobs_new RENAME TO automation_jobs')
    db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_repo ON automation_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_next_run ON automation_jobs(enabled, next_run_at)')
  },

  down(db) {
    db.run(`
      CREATE TABLE automation_jobs_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        interval_minutes INTEGER NOT NULL,
        agent_slug TEXT,
        prompt TEXT NOT NULL,
        model TEXT,
        skill_metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER
      )
    `)

    db.run(`
      INSERT INTO automation_jobs_old (
        id, repo_id, name, description, enabled, interval_minutes, agent_slug, prompt, model, skill_metadata,
        created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id,
        repo_id,
        name,
        description,
        enabled,
        COALESCE(interval_minutes, 60),
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      FROM automation_jobs
    `)

    db.run('DROP TABLE automation_jobs')
    db.run('ALTER TABLE automation_jobs_old RENAME TO automation_jobs')
    db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_repo ON automation_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_automation_jobs_next_run ON automation_jobs(enabled, next_run_at)')
  },
}

export default migration
