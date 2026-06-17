import { describe, it, expect, beforeEach, vi } from 'vitest'
import type PocketBase from 'pocketbase'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'

const mockCollection = (name: string) => ({
  getOne: vi.fn().mockRejectedValue(new Error('Not found')),
  getFirstListItem: vi.fn().mockRejectedValue(new Error('Not found')),
  getFullList: vi.fn().mockResolvedValue([]),
  getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
})

const mockPb = {
  collection: vi.fn((name: string) => mockCollection(name)),
  health: { check: vi.fn().mockResolvedValue({ code: 200 }) },
} as unknown as PocketBase

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  updateLastAccessed: vi.fn(),
}))

vi.mock('../../src/services/repo', () => ({
  getCurrentBranch: vi.fn(),
}))

vi.mock('../../src/services/general-chat', () => ({
  getGeneralChatStatus: vi.fn(),
  ensureGeneralChat: vi.fn(),
  getGeneralChatDirectory: vi.fn(),
  buildAssistantOpenCodeConfig: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
    restart: vi.fn().mockResolvedValue(undefined),
  },
}))

import * as db from '../../src/db/queries'
import { createRepoRoutes } from '../../src/routes/repos'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import type { GitAuthService } from '../../src/services/git-auth'
import type { AutomationService } from '../../src/services/automations'
import type { GeneralChatStatus } from '@subpolar/shared/types'
import { getGeneralChatStatus, ensureGeneralChat } from '../../src/services/general-chat'

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({}),
} as unknown as GitAuthService

const mockautomationservice = {} as AutomationService

describe('Repo Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /:id/access', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockResolvedValue(null)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should return 200 and call updateLastAccessed when repo exists', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(db.updateLastAccessed).toHaveBeenCalledWith(mockPb, 1)
    })

    it('should return 500 when updateLastAccessed throws', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)
      vi.mocked(db.updateLastAccessed).mockImplementation(() => {
        throw new Error('Database error')
      })

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Database error')
    })
  })

  describe('GET /:id/general-chat', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockResolvedValue(null)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/general-chat', { method: 'GET' })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should call getGeneralChatStatus and return status', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      const mockStatus: GeneralChatStatus = {
        repoId: 1,
        directory: '/tmp/workspace/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/workspace/repos/assistant/AGENTS.md', exists: false, created: false },
          opencodeJson: { path: '/tmp/workspace/repos/assistant/opencode.json', exists: false, created: false },
        },
      }

      vi.mocked(getGeneralChatStatus).mockResolvedValue(mockStatus)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/general-chat', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as typeof mockStatus
      expect(body.repoId).toBe(1)
      expect(body.relativePath).toBe('repos/assistant')

      expect(ensureGeneralChat).not.toHaveBeenCalled()
    })
  })

  describe('POST /:id/general-chat', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockResolvedValue(null)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/general-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should validate body and call ensureGeneralChat', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      const mockStatus: GeneralChatStatus = {
        repoId: 1,
        directory: '/tmp/workspace/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/workspace/repos/assistant/AGENTS.md', exists: true, created: true },
          opencodeJson: { path: '/tmp/workspace/repos/assistant/opencode.json', exists: true, created: true },
        },
      }

      vi.mocked(ensureGeneralChat).mockResolvedValue(mockStatus)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/general-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteAgentsMd: true }),
      })

      expect(res.status).toBe(200)

      const body = await res.json() as typeof mockStatus
      expect(body).toEqual(mockStatus)

      expect(ensureGeneralChat).toHaveBeenCalledTimes(1)
      expect(ensureGeneralChat).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, localPath: 'repos/test-repo' }),
        expect.objectContaining({ db: mockPb, apiBaseUrl: 'http://localhost:5003/api/internal' }),
        expect.objectContaining({ overwriteAgentsMd: true }),
      )

      expect(opencodeServerManager.clearStartupError).not.toHaveBeenCalled()
      expect(opencodeServerManager.restart).not.toHaveBeenCalled()
    })

    it('should handle errors from ensureGeneralChat', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      vi.mocked(ensureGeneralChat).mockRejectedValue(new Error('Test error'))

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/general-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(500)
    })
  })

  describe('POST /:id/reset-permissions', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockResolvedValue(null)

      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient())
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('should return 400 without disposing when repo has no directory', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: undefined,
        localPath: 'assistant',
        fullPath: '',
        sourcePath: undefined,
        branch: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      const forward = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }))
      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(400)
      expect(forward).not.toHaveBeenCalled()
    })

    it('should dispose only the repo directory and return success', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockResolvedValue(mockRepo)

      const forward = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }))
      const app = createRepoRoutes(mockPb, mockGitAuthService, mockautomationservice, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(200)
      expect(forward).toHaveBeenCalledWith({
        method: 'POST',
        path: '/instance/dispose',
        directory: '/tmp/test-repo',
      })
    })
  })
})
