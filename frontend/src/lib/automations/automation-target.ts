import type { Repo } from '@/api/types'
import type { AssistantModeStatus } from '@subpolar/shared/types'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME } from '@subpolar/shared/utils'
import { getRepoDisplayName } from '@/lib/utils'
import { getAssistantPath } from '@/lib/navigation'

export interface AutomationTarget {
  repoId: number
  kind: 'assistant' | 'repo'
  name: string
  subtitle: string
  fullPath: string
  backHref: string
}

export function isAssistantRepoId(repoId: number | undefined): boolean {
  return repoId === ASSISTANT_REPO_ID
}

export function automationTargetFromRepo(repo: Repo): AutomationTarget {
  return {
    repoId: repo.id,
    kind: 'repo',
    name: getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath),
    subtitle: repo.localPath,
    fullPath: repo.fullPath,
    backHref: `/repos/${repo.id}`,
  }
}

export function automationTargetFromAssistant(status: AssistantModeStatus): AutomationTarget {
  return {
    repoId: ASSISTANT_REPO_ID,
    kind: 'assistant',
    name: ASSISTANT_REPO_NAME,
    subtitle: 'Built-in assistant',
    fullPath: status.directory,
    backHref: getAssistantPath(),
  }
}
