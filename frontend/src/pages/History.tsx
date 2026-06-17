import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getProject, listProjects } from '@/api/projects'
import { SessionList } from '@/components/session/SessionList'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { useCreateSession } from '@/hooks/useOpenCode'
import { GENERAL_CHAT_PROJECT_ID } from '@subpolar/shared/utils'

export function History() {
  const navigate = useNavigate()

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  })

  const { data: generalChat, isLoading: generalChatLoading } = useQuery({
    queryKey: ['project', GENERAL_CHAT_PROJECT_ID],
    queryFn: () => getProject(GENERAL_CHAT_PROJECT_ID),
  })

  const historyProjects = useMemo(() => {
    return [generalChat, ...(projects ?? [])].filter((project): project is NonNullable<typeof project> => Boolean(project?.fullPath))
  }, [generalChat, projects])

  const directories = useMemo(() => {
    return historyProjects.map(project => project.fullPath)
  }, [historyProjects])

  const projectIdsByDirectory = useMemo(() => {
    return new Map(historyProjects.map(project => [project.fullPath, project.id]))
  }, [historyProjects])

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const primaryDirectory = generalChat?.fullPath ?? directories[0]

  const handleSelectSession = useCallback((sessionId: string, directory?: string) => {
    const projectId = directory ? projectIdsByDirectory.get(directory) : GENERAL_CHAT_PROJECT_ID
    navigate(`/projects/${projectId ?? GENERAL_CHAT_PROJECT_ID}/sessions/${sessionId}`)
  }, [navigate, projectIdsByDirectory])

  const createSession = useCreateSession(opcodeUrl, primaryDirectory, (newSession) => {
    navigate(`/projects/${GENERAL_CHAT_PROJECT_ID}/sessions/${newSession.id}`)
  })

  const handleCreateSession = async () => {
    await createSession.mutateAsync({ agent: undefined })
  }

  if (projectsLoading || generalChatLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header>
        <Header.Title>Session History</Header.Title>
        <Header.Actions>
          <Button
            onClick={handleCreateSession}
            disabled={!opcodeUrl || !primaryDirectory || createSession.isPending}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
          >
            <Plus className="w-4 h-4 mr-2" />
            <span>New Session</span>
          </Button>
        </Header.Actions>
      </Header>
      
      <div className="flex-1 p-4">
        <div className="max-w-6xl mx-auto">
          {directories.length > 0 ? (
            <SessionList
              opcodeUrl={opcodeUrl}
              directories={directories}
              createDirectory={primaryDirectory}
              onSelectSession={handleSelectSession}
            />
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No projects available. Add a project to see session history.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
