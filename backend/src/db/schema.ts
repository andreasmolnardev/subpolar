import { Database as SQLiteDatabase } from 'bun:sqlite'
import { PocketBaseDatabase, getPocketBaseClient } from './pocketbase-client'
import { logger } from '../utils/logger'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { migrate } from './migration-runner'
import { allMigrations } from './migrations'
import { ensureOpenCodeModelStateTable } from './model-state'
import { ensureAssistantRepo } from './queries'
import { ENV } from '@subpolar/shared/config/env'

// Database type can be either SQLite Database or PocketBaseDatabase
export type Database = SQLiteDatabase | PocketBaseDatabase

/**
 * Initialize the database - either PocketBase or SQLite
 * This function is async to support PocketBase authentication
 */
export async function initializeDatabase(dbPath?: string): Promise<Database> {
  // Check if PocketBase is configured
  const usePocketBase = ENV.POCKETBASE?.URL && ENV.POCKETBASE.URL !== ''
  
  if (usePocketBase) {
    logger.info('Using PocketBase as database backend')
    try {
      const pbClient = await getPocketBaseClient()
      const db = new PocketBaseDatabase(pbClient)
      
      // Initialize default data
      const defaultPreferences = await db.collection('user_preferences').getFirst('user_id = "default"')
      if (!defaultPreferences) {
        await db.collection('user_preferences').create({
          user_id: 'default',
          preferences: '{}',
          updated_at: Date.now()
        })
        logger.info('Created default user preferences')
      }
      
      // Ensure assistant repo exists
      await ensureAssistantRepoPocketBase(db)
      
      // Note: PocketBase uses its own migration system via collections
      // SQLite-specific migrations (migrate(), ensureOpenCodeModelStateTable) are skipped
      logger.info('PocketBase database initialized successfully')
      logger.warn('PocketBase: Collections must be created manually via Admin UI or API')
      return db
    } catch (error) {
      logger.error('Failed to initialize PocketBase:', error)
      throw error
    }
  }

  // Fall back to SQLite
  logger.info('Using SQLite as database backend')
  const path = dbPath || './data/opencode.db'
  mkdirSync(dirname(path), { recursive: true })
  const db = new SQLiteDatabase(path)

  migrate(db, allMigrations)
  ensureOpenCodeModelStateTable(db)

  db.prepare('INSERT OR IGNORE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run('default', '{}', Date.now())
  ensureAssistantRepo(db)

  logger.info('SQLite database initialized successfully')

  return db
}

/**
 * PocketBase-specific version of ensureAssistantRepo
 */
async function ensureAssistantRepoPocketBase(db: PocketBaseDatabase): Promise<void> {
  // This needs to be implemented with PocketBase queries
  // For now, we'll use a simplified version
  const ASSISTANT_REPO_ID = -1
  const ASSISTANT_REPO_PATH = '.assistant'
  
  const existing = await db.collection('repos').getFirst(`id = ${ASSISTANT_REPO_ID}`)
  const now = Date.now()
  
  if (existing) {
    await db.collection('repos').update(String(existing.id), {
      id: ASSISTANT_REPO_ID,
      repo_url: null,
      local_path: ASSISTANT_REPO_PATH,
      source_path: null,
      branch: null,
      default_branch: 'main',
      clone_status: 'ready',
      cloned_at: now,
      last_accessed_at: now,
      is_worktree: false,
      is_local: false,
    })
  } else {
    await db.collection('repos').create({
      id: ASSISTANT_REPO_ID,
      repo_url: null,
      local_path: ASSISTANT_REPO_PATH,
      source_path: null,
      branch: null,
      default_branch: 'main',
      clone_status: 'ready',
      cloned_at: now,
      last_accessed_at: now,
      is_worktree: false,
      is_local: false,
    })
  }
}

// Re-export PocketBase client for use in migrations
export { PocketBaseDatabase, getPocketBaseClient, closePocketBaseClient } from './pocketbase-client'
