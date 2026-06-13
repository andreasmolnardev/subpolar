import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DesktopSidebar } from './DesktopSidebar'
import * as useDesktopModule from '@/hooks/useDesktop'
import * as useSidebarCollapsedModule from '@/hooks/useSidebarCollapsed'
import * as useAuthModule from '@/hooks/useAuth'

vi.mock('@/hooks/useDesktop')
vi.mock('@/hooks/useSidebarCollapsed')
vi.mock('@/hooks/useAuth')

vi.mock('@/api/repos', () => ({
  listRepos: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfigs: vi.fn().mockResolvedValue({ configs: [], defaultConfig: null }),
  },
}))

function createWrapper(initialEntries?: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DesktopSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when user is not authenticated', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when auth state is loading', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: true,
      logout: vi.fn(),
    } as any)

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when not desktop', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(false)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    const { container } = render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(container.firstChild).toBeNull()
  })

  it('renders brand name', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.getByText('subpolar')).toBeInTheDocument()
  })

  it('renders Home, Agents & Skills, Apps, and Projects sections', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Agents & Skills')).toBeInTheDocument()
    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('renders Settings and Logout at the bottom', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('shows Assistant sub-item under Agents & Skills', () => {
    vi.spyOn(useDesktopModule, 'useDesktop').mockReturnValue(true)
    vi.spyOn(useSidebarCollapsedModule, 'useSidebarCollapsed').mockReturnValue([false, vi.fn()])
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    } as any)

    render(<DesktopSidebar />, { wrapper: createWrapper(['/']) })

    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })
})
