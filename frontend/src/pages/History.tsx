import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listProjects } from '@/api/projects'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { SessionList } from '@/components/session/SessionList'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Search } from 'lucide-react'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { useCreateSession } from '@/hooks/useOpenCode'

export function History() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  const { data: repos, isLoading: reposLoading } = useQuery({
    queryKey: ['repos'],
    queryFn: listProjects,
  })

  const directories = useMemo(() => {
    return repos?.map(r => r.fullPath).filter(Boolean) ?? []
  }, [repos])

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const primaryDirectory = directories[0]

  const handleSelectSession = useCallback((sessionId: string) => {
    // Find which repo this session belongs to
    // For now, navigate to the first repo's session detail
    if (directories.length > 0) {
      navigate(`/repos/0/sessions/${sessionId}`)
    }
  }, [navigate, directories])

  const createSession = useCreateSession(opcodeUrl, primaryDirectory, (newSession) => {
    navigate(`/repos/0/sessions/${newSession.id}`)
  })

  const handleCreateSession = async () => {
    await createSession.mutateAsync({ agent: undefined })
  }

  if (reposLoading) {
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
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          
          {directories.length > 0 ? (
            <SessionList
              opcodeUrl={opcodeUrl}
              directories={directories}
              createDirectory={primaryDirectory}
              onSelectSession={handleSelectSession}
            />
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No repositories available. Add a repository to see session history.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
