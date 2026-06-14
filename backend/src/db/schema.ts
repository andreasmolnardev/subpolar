import { getPocketBaseClient, closePocketBaseClient } from './pocketbase-client'
import type PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'
import { ASSISTANT_REPO_PATH } from '@subpolar/shared/utils'

export type Database = PocketBase

export async function initializeDatabase(): Promise<Database> {
  if (!ENV.POCKETBASE?.URL || ENV.POCKETBASE.URL === '') {
    throw new Error('POCKETBASE_URL is not configured. PocketBase is required.')
  }

  try {
    const pb = await getPocketBaseClient()

    const existing = await pb.collection('user_preferences').getFirstListItem('user_id = "default"').catch(() => null)
    if (!existing) {
      await pb.collection('user_preferences').create({
        user_id: 'default',
        preferences: '{}',
        updated_at: Date.now(),
      })
      logger.info('Created default user preferences')
    }

    const assistantRepo = await pb.collection('repos').getFirstListItem(`local_path = "${ASSISTANT_REPO_PATH}"`).catch(() => null)
    if (!assistantRepo) {
      const now = Date.now()
      await pb.collection('repos').create({
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
      logger.info('Created assistant repo')
    }

    logger.info('PocketBase database initialized successfully')
    return pb
  } catch (error) {
    logger.error('Failed to initialize PocketBase:', error)
    throw error
  }
}

export { getPocketBaseClient, closePocketBaseClient }
