import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createProject } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { showToast } from '@/lib/toast'

const projectFormSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  directory: z.string().optional(),
  openCodeConfigName: z.string().optional(),
})

type ProjectFormValues = z.infer<typeof projectFormSchema>

const NO_OPEN_CODE_CONFIG = '__none__'

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectDialog({ open, onOpenChange }: ProjectDialogProps) {
  const queryClient = useQueryClient()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: '',
      directory: '',
      openCodeConfigName: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      createProject({
        name: values.name,
        directory: values.directory || undefined,
        openCodeConfigName: values.openCodeConfigName || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      showToast.success('Project created')
      form.reset()
      onOpenChange(false)
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to create project')
    },
  })

  const handleSubmit = (values: ProjectFormValues) => {
    mutation.mutate(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen mobileSwipeToClose className="sm:max-w-[500px] gap-0 bg-[#141414] border-[#2a2a2a]">
        <DialogHeader className="px-4 sm:px-6 pt-2 sm:pt-6 pb-2 sm:pb-3 h-fit">
          <DialogTitle className="text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            Create Project
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 px-4 sm:px-6 pb-4 sm:pb-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="My project"
                      disabled={mutation.isPending}
                      className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="directory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Directory (optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="/path/to/project"
                      disabled={mutation.isPending}
                      className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-zinc-500 min-h-[44px] text-base"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openCodeConfigName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>OpenCode Config (optional)</FormLabel>
                  <Select
                    value={field.value || NO_OPEN_CODE_CONFIG}
                    onValueChange={(value) => field.onChange(value === NO_OPEN_CODE_CONFIG ? undefined : value)}
                    disabled={mutation.isPending}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-[#1a1a1a] border-[#2a2a2a] text-white min-h-[44px] text-base">
                        <SelectValue placeholder="Select a config" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value={NO_OPEN_CODE_CONFIG}>None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={mutation.isPending}
              className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white text-base font-medium"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </Button>
            {mutation.isError && (
              <p className="text-sm text-red-400">
                {mutation.error.message}
              </p>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
