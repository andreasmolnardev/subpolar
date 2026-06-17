import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { GeneralChatStatus, GeneralChatInitRequest } from '@subpolar/shared/types'

export interface Project {
  id: number
  name: string
  directory: string
  fullPath: string
  openCodeConfigName?: string
  status: 'ready' | 'error'
  createdAt: number
  updatedAt: number
  lastAccessedAt?: number
  isGeneralChat?: boolean
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetchWrapper<{ projects: Project[] }>(`${API_BASE_URL}/api/projects`)
  return res.projects
}

export async function getProject(id: number): Promise<Project> {
  const res = await fetchWrapper<{ project: Project }>(`${API_BASE_URL}/api/projects/${id}`)
  return res.project
}

export async function createProject(data: {
  name: string
  directory?: string
  openCodeConfigName?: string
}): Promise<Project> {
  return fetchWrapper(`${API_BASE_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateProject(
  id: number,
  data: { name?: string; directory?: string; openCodeConfigName?: string },
): Promise<Project> {
  return fetchWrapper(`${API_BASE_URL}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteProject(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/projects/${id}`, {
    method: 'DELETE',
  })
}

export async function touchProjectActivity(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/projects/${id}/access`, {
    method: 'POST',
  })
}

export async function switchProjectConfig(id: number, configName: string): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/projects/${id}/config/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configName }),
  })
}

export async function getGeneralChatStatus(projectId: number): Promise<GeneralChatStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/projects/${projectId}/general-chat`, {
    method: 'GET',
  })
}

export async function initializeGeneralChat(
  projectId: number,
  options?: GeneralChatInitRequest,
): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/projects/${projectId}/general-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  })
}
