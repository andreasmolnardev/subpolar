type SearchInput = {
  query?: unknown
  limit?: unknown
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

function extractDuckDuckGoUrl(value: string): string {
  try {
    const parsed = new URL(decodeHtml(value))
    const redirected = parsed.searchParams.get('uddg')
    return redirected ? decodeURIComponent(redirected) : parsed.toString()
  } catch {
    return decodeHtml(value)
  }
}

function parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []
  const resultPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = resultPattern.exec(html)) && results.length < limit) {
    const url = extractDuckDuckGoUrl(match[1] ?? '')
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue
    results.push({
      title: stripTags(match[2] ?? ''),
      url,
      snippet: stripTags(match[3] ?? ''),
    })
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

export async function webSearch(input: SearchInput): Promise<{ query: string; results: SearchResult[] }> {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw Object.assign(new Error('query is required'), { code: 'VALIDATION_FAILED' })
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10)
  const url = new URL('https://duckduckgo.com/html/')
  url.searchParams.set('q', query)
  const response = await fetch(url, {
    headers: {
      accept: 'text/html',
      'user-agent': 'Subpolar research agent',
    },
  })
  if (!response.ok) throw Object.assign(new Error(`Search failed with HTTP ${response.status}`), { code: 'WEB_SEARCH_FAILED' })
  const html = await response.text()
  return { query, results: parseDuckDuckGoResults(html, limit) }
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
