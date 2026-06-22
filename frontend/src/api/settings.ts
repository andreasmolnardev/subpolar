import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfig,
  OpenCodeConfigResponse,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest,
  OpenCodeImportStatus,
  SyncOpenCodeImportResponse,
  SkillFileInfo,
  CreateSkillRequest,
  UpdateSkillRequest,
  SkillScope,
  IntegrationConfig,
  IntegrationSettings,
} from './types/settings'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'

const DEFAULT_USER_ID = 'default'

export const settingsApi = {
  getSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = DEFAULT_USER_ID
  ): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'PATCH',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  resetSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'DELETE',
      params: { userId },
    })
  },

  listIntegrations: async (): Promise<{ integrations: IntegrationSettings }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/integrations`)
  },

  createIntegration: async (integration: IntegrationConfig): Promise<IntegrationConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/integrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(integration),
    })
  },

  updateIntegration: async (integration: IntegrationConfig): Promise<IntegrationConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/integrations/${encodeURIComponent(integration.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(integration),
    })
  },

  deleteIntegration: async (id: string): Promise<{ success: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  getUpcomingCalendarEvents: async (): Promise<{
    calendars: Array<{ id: string; name: string; url: string }>
    events: Array<{ title: string; calendar: string; start: string; end: string | null; location?: string }>
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/calendar/upcoming`)
  },

  getOpenCodeConfigs: async (userId = DEFAULT_USER_ID): Promise<OpenCodeConfigResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs`, {
      params: { userId },
    })
  },

  createOpenCodeConfig: async (
    request: CreateOpenCodeConfigRequest,
    userId = DEFAULT_USER_ID
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs`, {
      method: 'POST',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  updateOpenCodeConfig: async (
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId = DEFAULT_USER_ID
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      {
        method: 'PUT',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    )
  },

  deleteOpenCodeConfig: async (
    configName: string,
    userId = DEFAULT_USER_ID
  ): Promise<boolean> => {
    await fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      {
        method: 'DELETE',
        params: { userId },
      }
    )
    return true
  },

  setDefaultOpenCodeConfig: async (
    configName: string,
    userId = DEFAULT_USER_ID
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}/set-default`,
      {
        method: 'POST',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    )
  },

  getDefaultOpenCodeConfig: async (userId = DEFAULT_USER_ID): Promise<OpenCodeConfig | null> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs/default`, {
        params: { userId },
      })
    } catch {
      return null
    }
  },

  restartOpenCodeServer: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  reloadOpenCodeConfig: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof FetchError && error.statusCode === 404) {
        return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw error
    }
  },

  rollbackOpenCodeConfig: async (): Promise<{ success: boolean; message: string; configName?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  getOpenCodeImportStatus: async (): Promise<OpenCodeImportStatus> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import/status`)
  },

  syncOpenCodeImport: async (overwriteState = false): Promise<SyncOpenCodeImportResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overwriteState }),
    })
  },

  getOpenCodeVersions: async (): Promise<{
    versions: Array<{
      version: string
      tag: string
      name: string
      publishedAt: string
    }>
    currentVersion: string | null
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-versions`)
  },

  installOpenCodeVersion: async (version: string): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-install-version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
  },

  upgradeOpenCode: async (): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    upgraded: boolean
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  testSSHConnection: async (host: string, sshPrivateKey: string, passphrase?: string): Promise<{ success: boolean; message: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/test-ssh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, sshPrivateKey, passphrase }),
    })
  },

  discoverCalDavCalendars: async (serverUrl: string, username: string, password: string): Promise<{ calendars: Array<{ name: string; url: string; description?: string }> }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/discover-caldav-calendars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, username, password }),
    })
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`)
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md/default`)
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  },

  listSubpolarTools: async (): Promise<{ tools: SubpolarTool[] }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/subpolar-tools`)
  },

  listAgentToolPolicies: async (agentId: string): Promise<{ policies: AgentToolPolicy[] }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents/${encodeURIComponent(agentId)}/tool-policies`)
  },

  replaceAgentToolPolicies: async (agentId: string, policies: Array<{ toolId: string; effect: AgentToolPolicyEffect }>): Promise<{ policies: AgentToolPolicy[] }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents/${encodeURIComponent(agentId)}/tool-policies`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policies }),
    })
  },

  getVersionInfo: async (): Promise<VersionInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/health/version`)
  },

  listManagedSkills: async (repoId?: number, directory?: string): Promise<SkillFileInfo[]> => {
    const searchParams = new URLSearchParams()
    if (repoId) searchParams.set('repoId', String(repoId))
    if (directory) searchParams.set('directory', directory)
    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills${query}`)
  },

  getSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<SkillFileInfo> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`)
  },

  createSkill: async (data: CreateSkillRequest): Promise<SkillFileInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  updateSkill: async (name: string, scope: SkillScope, data: UpdateSkillRequest, repoId?: number): Promise<SkillFileInfo> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<{ success: boolean }> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, {
      method: 'DELETE',
    })
  },
}

export interface VersionInfo {
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseName: string | null
}

export type AgentToolPolicyEffect = 'allow' | 'deny' | 'approval'

export interface SubpolarTool {
  tool_id: string
  namespace: string
  description: string
  risk: 'read' | 'write' | 'delete' | 'external'
  requires_approval: boolean
}

export interface AgentToolPolicy {
  id?: string
  agent_id: string
  tool_id: string
  effect: AgentToolPolicyEffect
}

export interface OpenCodeServerAuthStatus {
  isSet: boolean
  source: 'db' | 'env' | 'none'
}

export async function getOpenCodeServerAuth(): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`)
}

export async function updateOpenCodeServerAuth(password: string | null): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export interface ManagerTokenResponse {
  token: string
}

export async function getManagerToken(): Promise<ManagerTokenResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token`)
}

export async function rotateManagerToken(): Promise<ManagerTokenResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token/rotate`, {
    method: 'POST',
  })
}
