import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAutomationTarget } from '../useAutomationTarget'
import type { AssistantModeStatus, Repo } from '@subpolar/shared/types'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  getAssistantModeStatus: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  getAssistantModeStatus: mocks.getAssistantModeStatus,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useAutomationTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('repoId === 0 (assistant)', () => {
    it('returns assistant automation target with correct properties', async () => {
      const mockStatus: AssistantModeStatus = {
        repoId: 0,
        directory: '/abs/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '', exists: false, created: false },
          opencodeJson: { path: '', exists: false, created: false },
        },
        automationsSkill: { path: '', exists: false, created: false },
      }

      mocks.getAssistantModeStatus.mockResolvedValue(mockStatus)

      const { result } = renderHook(() => useAutomationTarget(0), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.automationTarget).toBeDefined()
      })

      expect(result.current.automationTarget?.kind).toBe('assistant')
      expect(result.current.automationTarget?.fullPath).toBe('/abs/assistant')
      expect(result.current.automationTarget?.repoId).toBe(0)
      expect(result.current.automationTarget?.backHref).toBe('/assistant')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isError).toBe(false)
    })

    it('does not call getRepo for assistant', async () => {
      mocks.getAssistantModeStatus.mockResolvedValue({
        directory: '/abs/assistant',
        relativePath: 'repos/assistant',
        files: { agentsMd: { path: '', exists: false, created: false }, opencodeJson: { path: '', exists: false, created: false } },
        automationsSkill: { path: '', exists: false, created: false },
        repoId: 0,
      })

      renderHook(() => useAutomationTarget(0), { wrapper: createWrapper() })

      await vi.waitFor(() => {
        expect(mocks.getRepo).not.toHaveBeenCalled()
      })
    })
  })

  describe('repoId === 5 (real repo)', () => {
    it('returns repo automation target with correct properties', async () => {
      const mockRepo: Repo = {
        id: 5,
        repoUrl: 'https://x/my-repo',
        localPath: 'repos/my-repo',
        fullPath: '/abs/repos/my-repo',
        sourcePath: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: 0,
      }

      mocks.getRepo.mockResolvedValue(mockRepo)

      const { result } = renderHook(() => useAutomationTarget(5), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.automationTarget).toBeDefined()
      })

      expect(result.current.automationTarget?.kind).toBe('repo')
      expect(result.current.automationTarget?.repoId).toBe(5)
      expect(result.current.automationTarget?.fullPath).toBe('/abs/repos/my-repo')
      expect(result.current.automationTarget?.backHref).toBe('/repos/5')
    })

    it('does not call getAssistantModeStatus for repo', async () => {
      const mockRepo: Repo = {
        id: 5,
        repoUrl: 'https://x/my-repo',
        localPath: 'repos/my-repo',
        fullPath: '/abs/repos/my-repo',
        sourcePath: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: 0,
      }

      mocks.getRepo.mockResolvedValue(mockRepo)

      renderHook(() => useAutomationTarget(5), { wrapper: createWrapper() })

      await vi.waitFor(() => {
        expect(mocks.getAssistantModeStatus).not.toHaveBeenCalled()
      })
    })
  })

  describe('repoId === undefined', () => {
    it('returns undefined automation target', () => {
      const { result } = renderHook(() => useAutomationTarget(undefined), { wrapper: createWrapper() })

      expect(result.current.automationTarget).toBeUndefined()
      expect(result.current.isLoading).toBe(false)
    })
  })
})
