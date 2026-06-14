import type { LucideIcon } from 'lucide-react'
import { Plug, Sparkles, ShieldOff, CalendarClock, GitCommitHorizontal, Code2, Settings, LogOut, Plus, Folder, Clock, SquarePlus, History } from 'lucide-react'

export interface MoreDrawerItem {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
}

export interface NavPrimaryCta {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  onSelect?: 'new-session' | 'new-repo' | 'new-automation' | 'history'
  variant?: 'primary' | 'secondary'
}

export interface NavModel {
  primary: NavPrimaryCta[]
  items: MoreDrawerItem[]
}

function getBaseItems(): MoreDrawerItem[] {
  return [
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'logout', label: 'Logout', icon: LogOut },
  ]
}

export function buildNavModel(pathname: string): NavModel {
  const baseItems = getBaseItems()

  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'automations', label: 'automations', icon: CalendarClock, to: `/repos/${id}/automations` },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      { key: 'history', label: 'History', icon: History, to: '/history' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
      ],
      items,
    }
  }

  const sessionDetailMatch = /^\/repos\/(\d+)\/sessions\/[^/]+$/.exec(pathname)
  if (sessionDetailMatch) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'lsp', label: 'LSP', icon: Code2, dialog: 'lsp' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'automations', label: 'automations', icon: CalendarClock, to: `/repos/${sessionDetailMatch[1]}/automations` },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      { key: 'history', label: 'History', icon: History, to: '/history' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
      ],
      items,
    }
  }

  if (pathname === '/history') {
    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
      ],
      items: baseItems,
    }
  }

  if (pathname === '/automations' || /^\/repos\/\d+\/automations$/.test(pathname)) {
    return {
      primary: [
        { key: 'new-automation', label: 'New automation', icon: Clock, onSelect: 'new-automation', variant: 'primary' },
      ],
      items: [
        { key: 'history', label: 'History', icon: History, to: '/history' },
        ...baseItems,
      ],
    }
  }

  if (pathname === '/') {
    return {
      primary: [
        { key: 'new-repo', label: 'New Repo', icon: Plus, onSelect: 'new-repo', variant: 'primary' },
      ],
      items: [
        { key: 'all-automations', label: 'All automations', icon: CalendarClock, to: '/automations' },
        { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
        { key: 'history', label: 'History', icon: History, to: '/history' },
        ...baseItems,
      ],
    }
  }

  return {
    primary: [],
    items: baseItems,
  }
}

export function buildMoreItems(pathname: string): MoreDrawerItem[] {
  return buildNavModel(pathname).items
}
