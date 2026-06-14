import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useWorkspaceMode } from '@/hooks/useWorkspaceMode'
import { isWorkspaceRepoId, automationTargetFromRepo } from '@/lib/automations/automation-target'
import type { AutomationTarget } from '@/lib/automations/automation-target'

export function useAutomationTarget(repoId: number | undefined): {
  automationTarget: AutomationTarget | undefined
  isLoading: boolean
  isError: boolean
} {
  const workspaceQuery = useWorkspaceMode(repoId)

  const repoQuery = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined && repoId > 0,
  })

  if (isWorkspaceRepoId(repoId)) {
    return {
      automationTarget: workspaceQuery.status && repoQuery.data ? automationTargetFromRepo(repoQuery.data) : undefined,
      isLoading: repoQuery.isLoading,
      isError: repoQuery.isError,
    }
  }

  return {
    automationTarget: repoQuery.data ? automationTargetFromRepo(repoQuery.data) : undefined,
    isLoading: repoQuery.isLoading,
    isError: repoQuery.isError,
  }
}
