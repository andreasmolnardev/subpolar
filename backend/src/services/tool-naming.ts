export function normalizeToolName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Tool name must include letters or numbers')
  return normalized
}

export function qualifiedToolId(toolName: string, subtool: string): string {
  return `${normalizeToolName(toolName)}.${encodeURIComponent(subtool)}`
}
