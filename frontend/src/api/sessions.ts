import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface StoredSession {
  id: string
  projectId: number | null
  directory: string | null
  title: string | null
  createdAt: number
  updatedAt: number
}

export async function listStoredSessions(): Promise<StoredSession[]> {
  const res = await fetchWrapper<{ sessions: StoredSession[] }>(`${API_BASE_URL}/api/sessions`)
  return res.sessions
}
