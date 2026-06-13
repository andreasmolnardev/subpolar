import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useAuth } from '@/hooks/useAuth'
import { useUrlParams } from '@/hooks/useUrlParams'
import { listRepos } from '@/api/repos'
import { settingsApi } from '@/api/settings'
import { getAssistantPath } from '@/lib/navigation'
import { FolderGit2, Home, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sidebar, SidebarCollapseToggle } from '@/components/ui/sidebar'

function SidebarSection({
  label,
  icon: Icon,
  collapsed,
  expanded,
  onToggle,
  children,
}: {
  label: string
  icon?: React.ElementType
  collapsed: boolean
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (collapsed) return null

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          {children}
        </div>
      )}
    </div>
  )
}

function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
  indent,
}: {
  icon?: React.ElementType
  label: string
  active?: boolean
  onClick?: () => void
  indent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors w-full text-left',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        indent && 'pl-8',
      )}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const [collapsed, toggle] = useSidebarCollapsed()
  const { isAuthenticated, isLoading, user } = useAuth()
  const isDesktop = useDesktop()

  const [agentsExpanded, setAgentsExpanded] = useState(true)
  const [projectsExpanded, setProjectsExpanded] = useState(true)

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const { data: configs } = useQuery({
    queryKey: ['opencode-configs'],
    queryFn: () => settingsApi.getOpenCodeConfigs(),
  })

  const defaultConfig = configs?.defaultConfig
  const rawContent = defaultConfig?.rawContent
  const parsedConfig = rawContent ? tryParseJson(rawContent) : null
  const agents = parsedConfig?.agents as Record<string, { description?: string; disable?: boolean }> | undefined
  const agentNames = agents ? Object.keys(agents).filter((name) => !agents[name]?.disable) : []

  if (isLoading || !isAuthenticated) {
    return null
  }

  if (!isDesktop) {
    return null
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <Sidebar collapsed={collapsed} className="pt-0">
      {/* Brand */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        {!collapsed && (
          <span className="text-sm font-semibold text-foreground tracking-tight">subpolar</span>
        )}
        <SidebarCollapseToggle collapsed={collapsed} onToggle={toggle} />
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-1 p-2 pt-3 flex-1 overflow-y-auto">
        {/* Home */}
        <SidebarNavItem
          icon={Home}
          label="Home"
          active={isActive('/')}
          onClick={() => navigate('/')}
        />

        {/* Agents & Skills */}
        <SidebarSection
          label="Agents & Skills"
          icon={Bot}
          collapsed={collapsed}
          expanded={agentsExpanded}
          onToggle={() => setAgentsExpanded(!agentsExpanded)}
        >
          <SidebarNavItem
            label="Assistant"
            active={isActive('/assistant')}
            onClick={() => navigate(getAssistantPath())}
            indent
          />
          {agentNames.map((name) => (
            <SidebarNavItem
              key={name}
              label={name}
              onClick={() => navigate(`/assistant?agent=${encodeURIComponent(name)}`)}
              indent
            />
          ))}
        </SidebarSection>

        {/* Projects */}
        <SidebarSection
          label="Projects"
          icon={FolderGit2}
          collapsed={collapsed}
          expanded={projectsExpanded}
          onToggle={() => setProjectsExpanded(!projectsExpanded)}
        >
          {repos?.map((repo) => (
            <SidebarNavItem
              key={repo.id}
              label={repo.localPath.split('/').pop() || repo.localPath}
              active={location.pathname === `/repos/${repo.id}`}
              onClick={() => navigate(`/repos/${repo.id}`)}
              indent
            />
          ))}
        </SidebarSection>
      </div>

      {/* Profile */}
      <div className="border-t border-border mt-auto">
        <button
          type="button"
          onClick={() => {
            updateParams((p) => {
              p.set('settings', 'open')
              p.set('settingsTab', 'account')
              p.delete('mobileTab')
            }, 'push')
          }}
          className={cn(
            'flex items-center gap-3 w-full p-3 hover:bg-accent/50 transition-colors',
            collapsed && 'justify-center',
          )}
        >
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0 overflow-hidden">
            {user?.image ? (
              <img src={user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              (user?.name?.[0] || user?.email?.[0] || '?').toUpperCase()
            )}
          </div>
          {!collapsed && (
            <div className="flex flex-col items-start min-w-0">
              <span className="text-sm font-medium text-foreground truncate w-full text-left">
                {user?.name || 'User'}
              </span>
              <span className="text-xs text-muted-foreground truncate w-full text-left">
                {user?.email || ''}
              </span>
            </div>
          )}
        </button>
      </div>
    </Sidebar>
  )
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
