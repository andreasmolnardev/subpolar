export const GENERAL_CHAT_PROJECT_ID = 0
export const GENERAL_CHAT_PROJECT_NAME = 'General Chat'
export const GENERAL_CHAT_PROJECT_PATH = 'general-chat'

function trimTrailingChar(value: string, char: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === char) end--
  return value.slice(0, end)
}

export function sanitizeRepoDirectoryName(input: string): string {
  const collapsed = input.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '')
  const sanitized = trimTrailingChar(collapsed, '-')

  return sanitized || 'repo'
}

export function getRepoDirectoryNameError(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return 'Directory name is required'
  }

  if (trimmed === '.' || trimmed.includes('..')) {
    return 'Directory name cannot contain dot-dot path segments'
  }

  if (/^(?:[a-zA-Z]:)?[\\/]/.test(trimmed)) {
    return 'Directory name must be relative'
  }

  if (/[\\/]/.test(trimmed)) {
    return 'Directory name cannot contain path separators'
  }

  if (sanitizeRepoDirectoryName(trimmed) !== trimmed) {
    return 'Directory name can only contain letters, numbers, dots, underscores, and hyphens'
  }

  return null
}

export function normalizeRepoDirectoryName(input: string): string {
  const error = getRepoDirectoryNameError(input)

  if (error) {
    throw new Error(error)
  }

  return input.trim()
}
