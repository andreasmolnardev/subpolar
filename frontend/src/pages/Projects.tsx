import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ProjectList } from '@/components/project/ProjectList'
import { ProjectDialog } from '@/components/project/ProjectDialog'
import { createProject } from '@/api/projects'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { PendingActionsGroup } from '@/components/notifications/PendingActionsGroup'
import { useSidebarAction } from '@/hooks/useSidebarAction'
import { showToast } from '@/lib/toast'

export function Projects() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const queryClient = useQueryClient()

  useSidebarAction('new-repo', () => {
    setCreateDialogOpen(true)
  })

  const handleCreateProject = async (data: Parameters<typeof createProject>[0]) => {
    try {
      await createProject(data)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setCreateDialogOpen(false)
      showToast.success('Project created')
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to create project')
      throw error
    }
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Header.Title logo>Subpolar</Header.Title>
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Project
          </Button>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 pt-2 px-2 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-0">
        <ProjectList />
      </div>
      <ProjectDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onSubmit={handleCreateProject} />
    </div>
  )
}
