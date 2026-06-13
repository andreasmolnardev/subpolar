import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 7,
  name: 'automations',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS automation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        interval_minutes INTEGER,
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

    db.run(`
      CREATE TABLE IF NOT EXISTS automation_runs (
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
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS automation_runs')
    db.run('DROP TABLE IF EXISTS automation_jobs')
  },
}

export default migration
