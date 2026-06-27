export type ForwardRequest = {
  method: string
  path: string
  directory?: string
  headers?: Record<string, string>
  body?: string | ArrayBuffer | Blob | FormData | URLSearchParams | null
  signal?: AbortSignal
}

export type JsonRequestOptions = {
  directory?: string
  query?: Record<string, string | number | boolean | null | undefined>
  signal?: AbortSignal
}

export interface PiInternalClient {
  forward(req: ForwardRequest): Promise<Response>
  forwardRaw(request: Request): Promise<Response>
  getJson<T>(path: string, opts?: JsonRequestOptions): Promise<T>
  postJson<T>(path: string, body: unknown, opts?: JsonRequestOptions): Promise<T>
  setProviderAuth(providerId?: string, auth?: unknown): Promise<boolean>
  deleteProviderAuth(providerId: string): Promise<boolean>
  startMcpAuth(body?: unknown, opts?: JsonRequestOptions): Promise<Response>
  authenticateMcp(body?: unknown, opts?: JsonRequestOptions): Promise<Response>
}
