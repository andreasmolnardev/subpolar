import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWorkspaceStatus,
  initializeWorkspace,
} from '@/api/repos'
import { ASSISTANT_REPO_ID } from '@subpolar/shared/utils'
import type { WorkspaceStatus, WorkspaceInitRequest } from '@subpolar/shared/types'

export function useWorkspaceMode(repoId?: number) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<WorkspaceStatus>({
    queryKey: ['workspace-mode'],
    queryFn: () => getWorkspaceStatus(ASSISTANT_REPO_ID),
    enabled: repoId === ASSISTANT_REPO_ID,
  })

  const initializeMutation = useMutation({
    mutationFn: (options?: WorkspaceInitRequest) =>
      initializeWorkspace(ASSISTANT_REPO_ID, options),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['workspace-mode'],
      })
    },
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    initialize: initializeMutation.mutateAsync,
    isInitializing: initializeMutation.isPending,
  }
}
