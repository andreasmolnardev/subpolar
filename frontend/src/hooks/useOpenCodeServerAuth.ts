import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServerAuth, updateServerAuth } from '@/api/settings'
import type { ServerAuthStatus as ServerAuthStatusType } from '@/api/settings'

export function useServerAuth() {
  const queryClient = useQueryClient()
  
  const query = useQuery({
    queryKey: ['settings', 'subpolar-server-auth'],
    queryFn: getServerAuth,
  })

  const setPassword = useMutation({
    mutationFn: (password: string) => updateServerAuth(password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'subpolar-server-auth'] })
    },
  })

  const clearPassword = useMutation({
    mutationFn: () => updateServerAuth(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'subpolar-server-auth'] })
    },
  })

  return {
    status: query.data as ServerAuthStatusType | undefined,
    isLoading: query.isLoading,
    setPassword,
    clearPassword,
  }
}
