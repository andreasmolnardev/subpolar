type SearchInput = {
  query?: unknown
  limit?: unknown
  type?: unknown
  livecrawl?: unknown
  contextMaxCharacters?: unknown
}

type ScrapeInput = {
  url?: unknown
  maxLength?: unknown
}

type SearchResult = {
  title: string
  url: string
  snippet: string
}

type SearchOutput = {
  query: string
  results: SearchResult[]
  context: string
  provider: 'exa'
}

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
}

function normalizeText(value: string): string {
  return decodeHtml(value.replace(/\s+/g, ' ')).trim()
}

function stripTags(value: string): string {
  return normalizeText(value.replace(/<[^>]+>/g, ' '))
}

function asPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function exaUrl(): string {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) return EXA_MCP_URL
  const url = new URL(EXA_MCP_URL)
  url.searchParams.set('exaApiKey', apiKey)
  return url.toString()
}

function parseMcpPayload(payload: string): string | undefined {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const data = JSON.parse(trimmed) as { result?: { content?: Array<{ type?: unknown; text?: unknown }> } }
    const content = data.result?.content?.find(item => typeof item.text === 'string')
    return typeof content?.text === 'string' ? content.text : undefined
  } catch {
    return undefined
  }
}

function parseMcpResponse(body: string): string | undefined {
  const trimmed = body.trim()
  if (trimmed) {
    const direct = parseMcpPayload(trimmed)
    if (direct) return direct
  }
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = parseMcpPayload(line.slice(6))
    if (data) return data
  }
  return undefined
}

function extractMarkdownSearchResults(text: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const linkPattern = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(text)) && results.length < limit) {
    const title = normalizeText(match[1] ?? '')
    const url = normalizeText(match[2] ?? '')
    if (!title || !url || seen.has(url)) continue
    seen.add(url)
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 500)
    const snippet = normalizeText(after.split('\n').find(line => stripTags(line).length > 0) ?? '')
    results.push({ title, url, snippet })
  }
  return results
}

function requireUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error('url is required'), { code: 'VALIDATION_FAILED' })
  }
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('Only http and https URLs can be scraped'), { code: 'VALIDATION_FAILED' })
  }
  return url
}

function htmlToText(html: string): string {
  return stripTags(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'))
}

export async function webSearch(input: SearchInput): Promise<SearchOutput> {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw Object.assign(new Error('query is required'), { code: 'VALIDATION_FAILED' })
  const limit = asPositiveInteger(input.limit, 8, 1, 20)
  const contextMaxCharacters = asPositiveInteger(input.contextMaxCharacters, 10000, 1000, 50000)
  const searchType = input.type === 'fast' || input.type === 'deep' ? input.type : 'auto'
  const livecrawl = input.livecrawl === 'preferred' ? 'preferred' : 'fallback'
  const response = await fetch(exaUrl(), {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'user-agent': 'Subpolar research agent',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          type: searchType,
          numResults: limit,
          livecrawl,
          contextMaxCharacters,
        },
      },
    }),
  })
  if (!response.ok) throw Object.assign(new Error(`Search failed with HTTP ${response.status}`), { code: 'WEB_SEARCH_FAILED' })
  const body = await response.text()
  const context = parseMcpResponse(body) ?? ''
  return { query, results: extractMarkdownSearchResults(context, limit), context, provider: 'exa' }
}

export async function webScrape(input: ScrapeInput): Promise<{ url: string; title: string; content: string; truncated: boolean }> {
  const url = requireUrl(input.url)
  const maxLength = Math.min(Math.max(Number(input.maxLength) || 12000, 1000), 50000)
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,text/plain,application/xhtml+xml',
      'user-agent': 'Subpolar research agent',
    },
  })
  if (!response.ok) throw Object.assign(new Error(`Scrape failed with HTTP ${response.status}`), { code: 'WEB_SCRAPE_FAILED' })
  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()
  const title = contentType.includes('html')
    ? stripTags(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    : ''
  const content = contentType.includes('html') ? htmlToText(body) : normalizeText(body)
  return {
    url: url.toString(),
    title,
    content: content.slice(0, maxLength),
    truncated: content.length > maxLength,
  }
}
