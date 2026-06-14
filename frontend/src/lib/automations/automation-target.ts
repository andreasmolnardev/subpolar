import type { Repo } from '@/api/types'
import { ASSISTANT_REPO_ID } from '@subpolar/shared/utils'
import { getRepoDisplayName } from '@/lib/utils'

export interface AutomationTarget {
  repoId: number
  kind: 'workspace' | 'repo'
  name: string
  subtitle: string
  fullPath: string
  backHref: string
}

export function isWorkspaceRepoId(repoId: number | undefined): boolean {
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
