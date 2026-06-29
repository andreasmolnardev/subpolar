import type { ForwardRequest, JsonRequestOptions, PiInternalClient } from './internal-client-types'

export class PiNativeClient implements PiInternalClient {
  async forward(req: ForwardRequest): Promise<Response> {
    void req
    return new Response(JSON.stringify({ error: 'OpenCode runtime has been replaced by Pi' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async forwardRaw(request: Request): Promise<Response> {
    void request
    return new Response(JSON.stringify({ error: 'OpenCode runtime has been replaced by Pi' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async getJson<T>(path: string, opts?: JsonRequestOptions): Promise<T> {
    void path
    void opts
    throw new Error('OpenCode runtime has been replaced by Pi')
  }

  async postJson<T>(path: string, body: unknown, opts?: JsonRequestOptions): Promise<T> {
    void path
    void body
    void opts
    throw new Error('OpenCode runtime has been replaced by Pi')
  }

  async setProviderAuth(): Promise<boolean> {
    return false
  }

  async deleteProviderAuth(): Promise<boolean> {
    return false
  }

  async startMcpAuth(): Promise<Response> {
    return this.forward({ method: 'POST', path: '/mcp/auth' })
  }

  async authenticateMcp(): Promise<Response> {
    return this.forward({ method: 'POST', path: '/mcp/auth/authenticate' })
  }
}
