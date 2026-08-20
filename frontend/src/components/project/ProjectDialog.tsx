import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { getDefaultProjectDirectory, listProjectDirectories } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { MultiSelect } from '@/components/ui/multi-select'
import { Folder, Loader2 } from 'lucide-react'

const projectFormSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  mode: z.enum(['existing', 'workspace']),
  directory: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
}).superRefine((values, context) => {
  if (!values.directory?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['directory'], message: 'Directory is required' })
  }
})

export type ProjectFormValues = z.infer<typeof projectFormSchema>

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ProjectFormValues) => void | Promise<void>
  availableAgents?: Array<{ name: string; description?: string }>
  userId?: string
  isSubmitting?: boolean
}

export function ProjectDialog({ open, onOpenChange, onSubmit, availableAgents = [], userId, isSubmitting = false }: ProjectDialogProps) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserPath, setBrowserPath] = useState<string | undefined>()
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: '',
      mode: 'workspace',
      directory: '',
      agentNames: [],
    },
  })

  const name = form.watch('name')
  const mode = form.watch('mode')

  const { data: defaultDirectory } = useQuery({
    queryKey: ['project-default-directory', name, userId],
    queryFn: () => getDefaultProjectDirectory(name || 'project', userId),
    enabled: open,
  })

  const { data: directoryListing, isLoading: directoriesLoading } = useQuery({
    queryKey: ['project-directories', browserPath, userId],
    queryFn: () => listProjectDirectories(browserPath, userId),
    enabled: open && browserOpen,
  })

  useEffect(() => {
    if (!open) return
    const current = form.getValues('directory')
    if (mode === 'workspace' && !current && defaultDirectory) {
      form.setValue('directory', defaultDirectory, { shouldDirty: false })
    }
  }, [defaultDirectory, form, mode, open])

  useEffect(() => {
    if (open) return
    form.reset({ name: '', mode: 'workspace', directory: '', agentNames: [] })
    setBrowserOpen(false)
    setBrowserPath(undefined)
  }, [form, open])

  const agentOptions = useMemo(
    () => availableAgents.map((agent) => ({ value: agent.name, label: agent.name, description: agent.description })),
    [availableAgents],
  )

  const handleSubmit = async (values: ProjectFormValues) => {
    await onSubmit(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileFullscreen
        mobileSwipeToClose
        className="sm:top-1/2 sm:bottom-auto sm:translate-y-[-50%] sm:min-h-[600px] sm:max-w-[560px]"
      >
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>Choose an existing folder or create a new Docker-friendly workspace.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
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
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project location</FormLabel>
                  <FormControl>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        { value: 'workspace' as const, title: 'New workspace', description: 'Create an isolated project folder.' },
                        { value: 'existing' as const, title: 'Existing directory', description: 'Use a folder that already exists.' },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className={`cursor-pointer rounded-md border p-3 transition-colors ${field.value === option.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'}`}
                        >
                          <input
                            type="radio"
                            name={field.name}
                            value={option.value}
                            checked={field.value === option.value}
                            onChange={() => {
                              field.onChange(option.value)
                              form.setValue('directory', option.value === 'workspace' ? defaultDirectory ?? '' : '')
                              setBrowserOpen(false)
                              setBrowserPath(undefined)
                            }}
                            className="sr-only"
                            disabled={isSubmitting}
                          />
                          <span className="block text-sm font-medium">{option.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
                        </label>
                      ))}
                    </div>
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
                  <FormLabel>{mode === 'workspace' ? 'Workspace directory' : 'Existing directory'}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        placeholder={mode === 'workspace' ? '/workspace/users/user/workspaces/project' : '/path/to/existing/project'}
                        disabled={isSubmitting}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setBrowserPath(field.value)
                          setBrowserOpen((value) => !value)
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Browse directories"
                      >
                        <Folder className="h-4 w-4" />
                      </button>
                    </div>
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {mode === 'workspace' ? 'Created recursively when submitted.' : 'This directory must already exist.'}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {browserOpen && (
              <div className="rounded-md border bg-popover p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setBrowserPath(directoryListing?.currentPath.split('/').slice(0, -1).join('/') || '/')}>
                    Up
                  </Button>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{directoryListing?.currentPath || browserPath}</span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {directoriesLoading ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">Loading directories...</div>
                  ) : (
                    directoryListing?.directories.map((directory) => (
                      <button
                        key={directory.path}
                        type="button"
                        onClick={() => {
                          form.setValue('directory', directory.path, { shouldDirty: true })
                          setBrowserPath(directory.path)
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <Folder className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{directory.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <FormField
              control={form.control}
              name="agentNames"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Agents</FormLabel>
                  <p className="text-sm text-muted-foreground">If none are selected, this project inherits all global agents.</p>
                  <FormControl>
                    <MultiSelect
                      value={field.value ?? []}
                      onChange={field.onChange}
                      options={agentOptions}
                      placeholder="Select project agents..."
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
