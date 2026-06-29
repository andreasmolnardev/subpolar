import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsApi, type AgentToolPolicy, type SubpolarTool } from '@/api/settings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'

const toolAccessSchema = z.object({
  type: z.enum(['builtin', 'skill', 'cli', 'subpolar']),
  id: z.string().min(1),
  permission: z.enum(['allow', 'ask', 'deny']),
  command: z.string().optional(),
})

const agentFormSchema = z.object({
  name: z.string().min(1, 'Agent name is required').regex(/^[a-z0-9-]+$/, 'Must be lowercase letters, numbers, and hyphens only'),
  description: z.string().optional(),
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['subagent', 'primary', 'all']),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  disable: z.boolean(),
  icon: z.string().optional(),
  skills: z.array(z.string()).optional(),
  allowedCommands: z.array(z.string()).optional(),
  toolAccess: z.array(toolAccessSchema).optional(),
})

type AgentFormValues = z.infer<typeof agentFormSchema>
type ToolAccess = z.infer<typeof toolAccessSchema>

interface Agent {
  prompt?: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  temperature?: number
  topP?: number
  top_p?: number
  model?: string
  tools?: Record<string, boolean>
  permission?: {
    edit?: 'ask' | 'allow' | 'deny'
    bash?: 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
    webfetch?: 'ask' | 'allow' | 'deny'
  }
  icon?: string
  skills?: string[]
  allowedCommands?: string[]
  toolAccess?: Array<z.infer<typeof toolAccessSchema>>
  disable?: boolean
  [key: string]: unknown
}

const BUILTIN_TOOL_LABELS: Record<string, string> = {
  edit: 'Edit Files',
  webfetch: 'Web Fetch',
  'other-bash': 'Other Bash Commands',
}

function permissionFrom(value: unknown, fallback: 'allow' | 'ask' | 'deny' = 'deny'): 'allow' | 'ask' | 'deny' {
  return value === 'allow' || value === 'ask' || value === 'deny' ? value : fallback
}

function policyPermission(effect: AgentToolPolicy['effect']): 'allow' | 'ask' | 'deny' {
  if (effect === 'approval') return 'ask'
  return effect
}

function buildToolAccess(agent?: Agent, policies: AgentToolPolicy[] = []): ToolAccess[] {
  const configured = agent?.toolAccess?.length ? agent.toolAccess.filter(tool => tool.type !== 'subpolar') : undefined
  const bashPermission = agent?.permission?.bash
  const piBashPolicy = policies.find(policy => policy.tool_id === 'pi.bash')
  const fallback = [
    { type: 'builtin' as const, id: 'edit', permission: permissionFrom(agent?.permission?.edit, 'allow') },
    { type: 'builtin' as const, id: 'webfetch', permission: permissionFrom(agent?.permission?.webfetch, 'allow') },
    { type: 'builtin' as const, id: 'other-bash', permission: piBashPolicy ? policyPermission(piBashPolicy.effect) : typeof bashPermission === 'string' ? permissionFrom(bashPermission, 'ask') : 'deny' },
    ...(agent?.skills || []).map((skill): ToolAccess => ({ type: 'skill', id: skill, permission: 'allow' })),
    ...(agent?.allowedCommands || []).map((command): ToolAccess => ({ type: 'cli', id: command, command, permission: 'allow' })),
  ]
  const base = configured ?? fallback
  const subpolar = policies.filter(policy => !policy.tool_id.startsWith('pi.')).map((policy): ToolAccess => ({
    type: 'subpolar',
    id: policy.tool_id,
    permission: policyPermission(policy.effect),
  }))
  return [
    ...base,
    ...subpolar,
  ]
}

interface AgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, agent: Agent) => void | Promise<void>
  editingAgent?: { name: string; agent: Agent } | null
  availableSkills?: string[]
}

export function AgentDialog({ open, onOpenChange, onSubmit, editingAgent, availableSkills = [] }: AgentDialogProps) {
  const [selectedToolIndex, setSelectedToolIndex] = useState(0)

  const { data: subpolarToolsResponse } = useQuery({
    queryKey: ['subpolar-tools'],
    queryFn: () => settingsApi.listSubpolarTools(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: policyResponse } = useQuery({
    queryKey: ['agent-tool-policies', editingAgent?.name],
    queryFn: () => settingsApi.listAgentToolPolicies(editingAgent!.name),
    enabled: open && !!editingAgent?.name,
  })

  const subpolarTools = useMemo(() => subpolarToolsResponse?.tools ?? [], [subpolarToolsResponse?.tools])
  const policies = useMemo(() => policyResponse?.policies ?? [], [policyResponse?.policies])

  const getDefaultValues = useCallback((agent?: { name: string; agent: Agent } | null): AgentFormValues => {
    return {
      name: agent?.name || '',
      description: agent?.agent.description || '',
      prompt: agent?.agent.prompt || '',
      mode: agent?.agent.mode || 'subagent',
      temperature: agent?.agent.temperature ?? 0.7,
      topP: agent?.agent.topP ?? agent?.agent.top_p ?? 1,
      disable: agent?.agent.disable ?? false,
      icon: agent?.agent.icon || '',
      skills: agent?.agent.skills || [],
      allowedCommands: agent?.agent.allowedCommands || [],
      toolAccess: buildToolAccess(agent?.agent, policies),
    }
  }, [policies])

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    mode: 'onChange',
    defaultValues: getDefaultValues(editingAgent)
  })

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingAgent))
      setSelectedToolIndex(0)
    }
  }, [open, editingAgent, form, getDefaultValues])

  const toolAccess = form.watch('toolAccess') || []
  const selectedTool = toolAccess[selectedToolIndex]

  const addToolAccess = () => {
    const defaultTool = subpolarTools[0]?.tool_id ?? 'calendar.get'
    const next = [...toolAccess, { type: 'subpolar' as const, id: defaultTool, permission: 'allow' as const }]
    form.setValue('toolAccess', next, { shouldDirty: true, shouldValidate: true })
    setSelectedToolIndex(next.length - 1)
  }

  const removeToolAccess = (index: number) => {
    const next = toolAccess.filter((_, itemIndex) => itemIndex !== index)
    form.setValue('toolAccess', next, { shouldDirty: true, shouldValidate: true })
    setSelectedToolIndex(Math.max(0, Math.min(index, next.length - 1)))
  }

  const updateSelectedTool = (patch: Partial<ToolAccess>) => {
    const next = toolAccess.map((tool, index) => index === selectedToolIndex ? { ...tool, ...patch } : tool)
    form.setValue('toolAccess', next, { shouldDirty: true, shouldValidate: true })
  }

  const handleSubmit = async (values: AgentFormValues) => {
    const agent: Agent = {
      prompt: values.prompt,
      description: values.description || undefined,
      mode: values.mode,
      temperature: values.temperature,
      topP: values.topP,
      disable: values.disable,
      tools: {},
      permission: {}
    }

    if (values.icon) {
      agent.icon = values.icon
    }

    if (values.skills && values.skills.length > 0) {
      agent.skills = values.skills
    }

    if (values.allowedCommands && values.allowedCommands.length > 0) {
      agent.allowedCommands = values.allowedCommands
    }

    if (values.toolAccess && values.toolAccess.length > 0) {
      agent.toolAccess = values.toolAccess
      const builtinTools = Object.fromEntries(values.toolAccess.filter(tool => tool.type === 'builtin').map(tool => [tool.id, tool]))
      const editPermission = builtinTools.edit?.permission || 'deny'
      const webfetchPermission = builtinTools.webfetch?.permission || 'deny'
      const otherBashPermission = builtinTools['other-bash']?.permission || 'deny'
      agent.tools = {
        edit: editPermission !== 'deny',
        bash: otherBashPermission !== 'deny' || values.toolAccess.some(tool => tool.type === 'cli'),
        webfetch: webfetchPermission !== 'deny',
      }
      agent.permission = {
        edit: editPermission,
        webfetch: webfetchPermission,
        bash: otherBashPermission,
      }
      agent.skills = Array.from(new Set(values.toolAccess.filter(tool => tool.type === 'skill').map(tool => tool.id)))
      agent.allowedCommands = Array.from(new Set(values.toolAccess.filter(tool => tool.type === 'cli').map(tool => tool.command || tool.id)))
      const cliTools = values.toolAccess.filter(tool => tool.type === 'cli')
      if (cliTools.length > 0 || otherBashPermission !== 'deny') {
        agent.permission = {
          ...agent.permission,
          bash: Object.fromEntries([
            ...cliTools.map(tool => [`${tool.command || tool.id} *`, tool.permission]),
            ['*', otherBashPermission],
          ]),
        }
      }
    }

    await onSubmit(values.name, agent)
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <Form {...form}>
            <div className="space-y-4">
              <div className="grid grid-cols-[minmax(3.25rem,auto)_1fr] gap-3 items-start">
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Icon</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="🤖"
                          maxLength={4}
                          className="w-14 min-w-14 text-center text-lg px-2"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agent Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="my-agent"
                          disabled={!!editingAgent}
                          className={editingAgent ? 'bg-muted' : ''}
                        />
                      </FormControl>
                      <FormDescription>
                        Use lowercase letters, numbers, and hyphens only
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Brief description of what the agent does"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prompt</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="The system prompt that defines the agent's behavior and role"
                        rows={6}
                        className="font-mono md:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="mode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mode</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select mode" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="subagent">Subagent</SelectItem>
                          <SelectItem value="primary">Primary</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Temperature</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="2"
                          step="0.1"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="topP"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top P</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Agent Tools</div>
                    <p className="text-xs text-muted-foreground">Configure skills, direct CLI utilities, and Subpolar backend-routed tool calls.</p>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {toolAccess.map((tool, index) => (
                    <button
                      key={`${tool.type}-${tool.id}-${index}`}
                      type="button"
                      onClick={() => setSelectedToolIndex(index)}
                      className={`min-w-36 rounded-md border p-3 text-left text-sm transition-colors ${selectedToolIndex === index ? 'border-primary bg-primary/10' : 'bg-card hover:bg-muted'}`}
                    >
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{tool.type}</div>
                      <div className="truncate font-medium">{tool.id}</div>
                      <div className="text-xs text-muted-foreground">{tool.permission}</div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addToolAccess}
                    className="min-w-24 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted flex items-center justify-center"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {selectedTool ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tool Type</label>
                      <Select value={selectedTool.type} onValueChange={(value) => updateSelectedTool({ type: value as 'builtin' | 'skill' | 'cli' | 'subpolar' })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="builtin">Built-in Tool</SelectItem>
                          <SelectItem value="skill">Skill</SelectItem>
                          <SelectItem value="cli">CLI Utility</SelectItem>
                          <SelectItem value="subpolar">Subpolar Tool</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{selectedTool.type === 'builtin' ? 'Tool' : selectedTool.type === 'skill' ? 'Skill' : selectedTool.type === 'cli' ? 'Command' : 'Tool ID'}</label>
                      {selectedTool.type === 'builtin' ? (
                        <Select value={selectedTool.id} onValueChange={(value) => updateSelectedTool({ id: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(BUILTIN_TOOL_LABELS).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : selectedTool.type === 'skill' && availableSkills.length > 0 ? (
                        <Select value={selectedTool.id} onValueChange={(value) => updateSelectedTool({ id: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {availableSkills.map(skill => <SelectItem key={skill} value={skill}>{skill}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : selectedTool.type === 'subpolar' && subpolarTools.length > 0 ? (
                        <Select value={selectedTool.id} onValueChange={(value) => updateSelectedTool({ id: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {subpolarTools.map((tool: SubpolarTool) => <SelectItem key={tool.tool_id} value={tool.tool_id}>{tool.tool_id}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={selectedTool.id} placeholder={selectedTool.type === 'subpolar' ? 'calendar.get' : 'rg'} onChange={(event) => updateSelectedTool({ id: event.target.value, command: selectedTool.type === 'cli' ? event.target.value : selectedTool.command })} />
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeToolAccess(selectedToolIndex)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Permission</label>
                      <Select value={selectedTool.permission} onValueChange={(value) => updateSelectedTool({ permission: value as 'allow' | 'ask' | 'deny' })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="ask">Ask</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-sm font-medium">CLI Pattern</label>
                      <Input value={selectedTool.command || ''} placeholder="rg *" disabled={selectedTool.type === 'subpolar'} onChange={(event) => updateSelectedTool({ command: event.target.value })} />
                      <p className="text-xs text-muted-foreground">For CLI utilities this documents required bash permissions. Subpolar tools use the dot-based tool ID above.</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Add a tool to configure agent access.</div>
                )}
              </div>

              <FormField
                control={form.control}
                name="disable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Disable agent</FormLabel>
                      <FormDescription>
                        Prevent this agent from being used
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={form.formState.isSubmitting}
            className="flex-1 sm:flex-none"
          >
            {editingAgent ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
