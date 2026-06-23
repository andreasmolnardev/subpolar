import type { paths } from './opencode-types'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

type SessionListResponse = paths['/session']['get']['responses']['200']['content']['application/json']
type SessionResponse = paths['/session/{sessionID}']['get']['responses']['200']['content']['application/json']
type SessionListParams = NonNullable<paths['/session']['get']['parameters']['query']> & {
  roots?: boolean
}
type CreateSessionRequest = NonNullable<paths['/session']['post']['requestBody']>['content']['application/json']
type MessageListResponse = paths['/session/{sessionID}/message']['get']['responses']['200']['content']['application/json']
type SendPromptRequest = NonNullable<paths['/session/{sessionID}/message']['post']['requestBody']>['content']['application/json']
type SendPromptAsyncRequest = NonNullable<paths['/session/{sessionID}/prompt_async']['post']['requestBody']>['content']['application/json']
type ConfigResponse = paths['/config']['get']['responses']['200']['content']['application/json']
type CommandListResponse = paths['/command']['get']['responses']['200']['content']['application/json']
type CommandRequest = NonNullable<paths['/session/{sessionID}/command']['post']['requestBody']>['content']['application/json']
type SendCommandResponse = paths['/session/{sessionID}/command']['post']['responses']['200']['content']['application/json']
type ShellRequest = NonNullable<paths['/session/{sessionID}/shell']['post']['requestBody']>['content']['application/json']
type AgentListResponse = paths['/agent']['get']['responses']['200']['content']['application/json']
type PermissionListResponse = paths['/permission']['get']['responses']['200']['content']['application/json']
type QuestionListResponse = paths['/question']['get']['responses']['200']['content']['application/json']
type SendPromptResponse = paths['/session/{sessionID}/message']['post']['responses']['200']['content']['application/json']
type LspStatusResponse = paths['/lsp']['get']['responses']['200']['content']['application/json']
type LspStatus = LspStatusResponse[number]

type LegacySession = SessionListResponse[number]

type SessionPageParams = { limit?: number; order?: 'asc' | 'desc'; search?: string; cursor?: string }
type SessionPage = { items: LegacySession[]; nextCursor?: string }

export type { SendPromptResponse, SendCommandResponse, LspStatus }

export class OpenCodeClient {
  private baseURL: string
  private directory?: string

  constructor(baseURL: string, directory?: string) {
    this.baseURL = baseURL
    this.directory = directory
  }

  setDirectory(directory: string) {
    this.directory = directory
  }

  private getParams(params?: Record<string, string | number | boolean | undefined>) {
    if (!this.directory) return params
    return { ...params, directory: this.directory }
  }

  private get nativeBaseURL() {
    return this.baseURL.replace(/\/api\/opencode$/, '/api')
  }

  private toLegacySession(session: { id: string; title?: string | null; directory?: string | null; createdAt?: number; updatedAt?: number; projectId?: number | null }) {
    const created = session.createdAt ?? Date.now()
    const updated = session.updatedAt ?? created
    return {
      id: session.id,
      projectID: session.projectId ? String(session.projectId) : 'default',
      directory: session.directory ?? this.directory ?? '',
      title: session.title || 'Untitled Session',
      version: 'pi',
      time: { created, updated },
    } as LegacySession
  }

  async listSessions(params?: SessionListParams) {
    const response = await fetchWrapper<{ sessions: Array<{ id: string; title?: string | null; directory?: string | null; createdAt?: number; updatedAt?: number; projectId?: number | null }> }>(`${this.nativeBaseURL}/sessions`, { params: this.getParams(params) })
    return response.sessions.map(session => this.toLegacySession(session)) as SessionListResponse
  }

  async listSessionsPage(params?: SessionPageParams): Promise<SessionPage> {
    const isCursorRequest = params?.cursor !== undefined
    const queryParams = isCursorRequest
      ? this.getParams({ cursor: params.cursor })
      : this.getParams({
          ...(params?.limit !== undefined && { limit: params.limit }),
          ...(params?.order !== undefined && { order: params.order }),
          ...(params?.search !== undefined && { search: params.search }),
        })
    const response = await fetchWrapper<{ sessions: Array<{ id: string; title?: string | null; directory?: string | null; createdAt?: number; updatedAt?: number; projectId?: number | null }> }>(`${this.nativeBaseURL}/sessions`, { params: queryParams })
    return {
      items: response.sessions.map((item) => this.toLegacySession(item)),
    }
  }

  async getSession(sessionID: string) {
    const session = await fetchWrapper<{ id: string; title?: string | null; directory?: string | null; createdAt?: number; updatedAt?: number; projectId?: number | null }>(`${this.nativeBaseURL}/sessions/${sessionID}`, { params: this.getParams() })
    return this.toLegacySession(session) as SessionResponse
  }

  async createSession(data: CreateSessionRequest) {
    const response = await fetchWrapper<{ session: { id: string; runtime: string; runtimeSessionId: string | null } }>(`${this.nativeBaseURL}/sessions`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, directory: this.directory, runtime: 'pi' }),
    })
    return this.toLegacySession({ id: response.session.id, title: 'Untitled Session', directory: this.directory }) as SessionResponse
  }

  async deleteSession(sessionID: string) {
    return fetchWrapperVoid(`${this.nativeBaseURL}/sessions/${sessionID}`, {
      method: 'DELETE',
      params: this.getParams(),
    })
  }

  async deleteWorkspace(workspaceID: string) {
    return fetchWrapperVoid(`${this.baseURL}/experimental/workspace/${workspaceID}`, {
      method: 'DELETE',
      params: this.getParams(),
    })
  }

  async updateSession(sessionID: string, data: { title?: string }) {
    return fetchWrapper(`${this.nativeBaseURL}/sessions/${sessionID}`, {
      method: 'PATCH',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async forkSession(sessionID: string, messageID?: string) {
    return fetchWrapper<SessionResponse>(`${this.baseURL}/session/${sessionID}/fork`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageID }),
    })
  }

  async abortSession(sessionID: string) {
    return fetchWrapper(`${this.nativeBaseURL}/runs/${sessionID}/cancel`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async listMessages(sessionID: string) {
    const response = await fetchWrapper<{ messages: Array<{ id: string; role: string; content: string; createdAt: number }> }>(`${this.nativeBaseURL}/sessions/${sessionID}/messages`, { params: this.getParams() })
    return response.messages.map(message => ({
      info: {
        id: message.id,
        sessionID,
        role: message.role,
        time: { created: message.createdAt },
      },
      parts: message.content ? [{ id: message.id, type: 'text', text: message.content }] : [],
    })) as MessageListResponse
  }

  async sendPrompt(sessionID: string, data: SendPromptRequest): Promise<SendPromptResponse> {
    const prompt = typeof data === 'object' && data && 'parts' in data && Array.isArray(data.parts)
      ? data.parts.map((part) => 'text' in part && typeof part.text === 'string' ? part.text : '').join('\n')
      : typeof data === 'object' && data && 'text' in data
      ? String(data.text ?? '')
      : ''
    await fetchWrapper(`${this.nativeBaseURL}/sessions/${sessionID}/messages`, { method: 'POST', params: this.getParams(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: prompt }), timeout: 0 })
    await fetchWrapper(`${this.nativeBaseURL}/sessions/${sessionID}/runs`, { method: 'POST', params: this.getParams(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runtime: 'pi', agentId: typeof data === 'object' && data && 'agent' in data ? data.agent : 'default' }), timeout: 0 })
    return { parts: [] } as unknown as SendPromptResponse
  }

  async sendPromptAsync(sessionID: string, data: SendPromptAsyncRequest): Promise<void> {
    return fetchWrapperVoid(
      `${this.baseURL}/session/${sessionID}/prompt_async`,
      {
        method: 'POST',
        params: this.getParams(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        timeout: 0,
      }
    )
  }

  async summarizeSession(sessionID: string, providerID: string, modelID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/summarize`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerID, modelID }),
    })
  }

  async getConfig() {
    return fetchWrapper<ConfigResponse>(`${this.nativeBaseURL}/config`, {
      params: this.getParams(),
    })
  }

  async getLSPStatus() {
    return fetchWrapper<LspStatusResponse>(`${this.nativeBaseURL}/lsp`, {
      params: this.getParams(),
    })
  }

  async updateConfig(config: Partial<ConfigResponse>) {
    return fetchWrapper<ConfigResponse>(`${this.nativeBaseURL}/config`, {
      method: 'PATCH',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  async getProviders() {
    return fetchWrapper(`${this.nativeBaseURL}/provider`, {
      params: this.getParams(),
    })
  }

  async getConfigProviders() {
    return fetchWrapper(`${this.nativeBaseURL}/config/providers`, {
      params: this.getParams(),
    })
  }

  async listCommands() {
    return fetchWrapper<CommandListResponse>(`${this.nativeBaseURL}/command`, {
      params: this.getParams(),
    })
  }

  async sendCommand(sessionID: string, data: CommandRequest): Promise<SendCommandResponse> {
    return fetchWrapper<SendCommandResponse>(`${this.baseURL}/session/${sessionID}/command`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeout: 0,
    })
  }

  async sendShell(sessionID: string, data: ShellRequest) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/shell`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async respondToPermission(sessionID: string, permissionID: string, response: 'once' | 'always' | 'reject') {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/permissions/${permissionID}`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    })
  }

  async listPendingPermissions() {
    return fetchWrapper<PermissionListResponse>(`${this.nativeBaseURL}/permission`, {
      params: this.getParams(),
    })
  }

  async replyToQuestion(requestID: string, answers: string[][]) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reply`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
  }

  async rejectQuestion(requestID: string) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reject`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async listPendingQuestions() {
    return fetchWrapper<QuestionListResponse>(`${this.nativeBaseURL}/question`, {
      params: this.getParams(),
    })
  }

  async listAgents() {
    return fetchWrapper<AgentListResponse>(`${this.nativeBaseURL}/agent`, {
      params: this.getParams(),
    })
  }

  async revertMessage(sessionID: string, data: { messageID: string, partID?: string }) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/revert`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async unrevertSession(sessionID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/unrevert`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async getSessionStatuses() {
    return fetchWrapper<Record<string, { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }>>(`${this.nativeBaseURL}/sessions/status`, {
      params: this.getParams(),
    })
  }

  getEventSourceURL() {
    const base = this.baseURL.startsWith('http')
      ? this.baseURL
      : `${window.location.origin}${this.baseURL}`
    const url = new URL(`${base}/sse`)
    if (this.directory) {
      url.searchParams.set('directory', this.directory)
    }
    return url.toString()
  }
}

export const createOpenCodeClient = (baseURL: string, directory?: string) => {
  return new OpenCodeClient(baseURL, directory)
}
