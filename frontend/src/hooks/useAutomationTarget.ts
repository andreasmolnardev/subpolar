import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useAssistantMode } from '@/hooks/useAssistantMode'
import { isAssistantRepoId, automationTargetFromAssistant, automationTargetFromRepo } from '@/lib/automations/automation-target'
import type { AutomationTarget } from '@/lib/automations/automation-target'

export function useAutomationTarget(repoId: number | undefined): {
  automationTarget: AutomationTarget | undefined
  isLoading: boolean
  isError: boolean
} {
  const assistantQuery = useAssistantMode(repoId)

  const repoQuery = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined && repoId > 0,
  })

  if (isAssistantRepoId(repoId)) {
    return {
      automationTarget: assistantQuery.status ? automationTargetFromAssistant(assistantQuery.status) : undefined,
      isLoading: assistantQuery.isLoading,
      isError: assistantQuery.isError,
    }
  }

  return {
    automationTarget: repoQuery.data ? automationTargetFromRepo(repoQuery.data) : undefined,
    isLoading: repoQuery.isLoading,
    isError: repoQuery.isError,
  }
}
