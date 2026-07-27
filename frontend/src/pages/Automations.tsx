import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { AutomationDefinition, CreateAutomationDefinitionRequest } from '@subpolar/shared/schemas'
import { CalendarClock, ChevronLeft, CirclePlay, Plus, Trash2, Webhook, Zap } from 'lucide-react'
import {
  createProjectAutomationDefinition,
  deleteProjectAutomationDefinition,
  getProjectAutomationDefinition,
  listProjectAutomationDefinitionRuns,
  listProjectAutomationDefinitions,
  runProjectAutomationDefinition,
  updateProjectAutomationDefinition,
} from '@/api/automations'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { showToast } from '@/lib/toast'

function newDefinition(): CreateAutomationDefinitionRequest {
  return {
    name: 'Untitled automation', description: '', icon: 'zap', enabled: true,
    triggers: [],
    steps: [{ type: 'agent', position: 0, config: { prompt: 'Describe the task this automation should perform.', outputName: 'result' } }],
  }
}

function editable(definition: AutomationDefinition): CreateAutomationDefinitionRequest {
  return { name: definition.name, description: definition.description, icon: definition.icon, enabled: definition.enabled, triggers: definition.triggers, steps: definition.steps, updatedAt: definition.updatedAt }
}

export function Automations() {
  const { id: projectId, automationId } = useParams<{ id: string; automationId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: ['project-automations', projectId], queryFn: () => listProjectAutomationDefinitions(projectId!), enabled: Boolean(projectId) })
  const selected = useQuery({ queryKey: ['project-automation', projectId, automationId], queryFn: () => getProjectAutomationDefinition(projectId!, automationId!), enabled: Boolean(projectId && automationId) })
  const runs = useQuery({ queryKey: ['project-automation-runs', projectId, automationId], queryFn: () => listProjectAutomationDefinitionRuns(projectId!, automationId!), enabled: Boolean(projectId && automationId) })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project-automations', projectId] })
  const create = useMutation({ mutationFn: () => createProjectAutomationDefinition(projectId!, newDefinition()), onSuccess: ({ automation }) => { invalidate(); navigate(`/projects/${projectId}/automations/${automation.id}`) }, onError: (error) => showToast.error(error instanceof Error ? error.message : 'Could not create automation') })
  const save = useMutation({ mutationFn: (data: CreateAutomationDefinitionRequest) => updateProjectAutomationDefinition(projectId!, automationId!, data), onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ['project-automation', projectId, automationId] }); showToast.success('Automation saved') }, onError: (error) => showToast.error(error instanceof Error ? error.message : 'Could not save automation') })
  const remove = useMutation({ mutationFn: () => deleteProjectAutomationDefinition(projectId!, automationId!), onSuccess: () => { invalidate(); navigate(`/projects/${projectId}/automations`) } })
  const run = useMutation({ mutationFn: () => runProjectAutomationDefinition(projectId!, automationId!), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['project-automation-runs', projectId, automationId] }); showToast.success('Automation run started') }, onError: (error) => showToast.error(error instanceof Error ? error.message : 'Could not start automation') })

  if (!projectId) return null
  const automation = selected.data?.automation
  return <div className="min-h-dvh bg-background p-4 sm:p-8">
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card p-3 lg:min-h-[calc(100dvh-4rem)]">
        <div className="mb-3 flex items-center justify-between px-2"><div className="flex items-center gap-2 font-semibold"><Zap className="h-4 w-4" /> Automations</div><Button aria-label="New automation" size="icon" variant="ghost" onClick={() => create.mutate()}><Plus className="h-4 w-4" /></Button></div>
        <div className="space-y-1">
          {list.data?.automations.map((item) => <button key={item.id} type="button" onClick={() => navigate(`/projects/${projectId}/automations/${item.id}`)} className={`w-full rounded-lg px-3 py-2 text-left ${item.id === automationId ? 'bg-accent' : 'hover:bg-muted'}`}><div className="flex items-center gap-2 text-sm font-medium"><Zap className="h-3.5 w-3.5" />{item.name}</div><p className="mt-1 truncate text-xs text-muted-foreground">{item.description || (item.enabled ? 'Enabled' : 'Disabled')}</p></button>)}
        </div>
        {!list.isLoading && !list.data?.automations.length && <p className="px-3 py-8 text-sm text-muted-foreground">No automations in this project.</p>}
      </aside>
      {!automation ? <Card className="border-dashed"><CardContent className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><CalendarClock className="h-8 w-8 text-muted-foreground" /><div><h1 className="font-semibold">No automation selected</h1><p className="mt-1 text-sm text-muted-foreground">Create one to add triggers and ordered steps.</p></div><Button onClick={() => create.mutate()}><Plus className="mr-2 h-4 w-4" />New automation</Button></CardContent></Card> : <AutomationEditor automation={automation} runs={runs.data?.runs ?? []} saving={save.isPending} running={run.isPending} onSave={(data) => save.mutate(data)} onRun={() => run.mutate()} onDelete={() => remove.mutate()} onBack={() => navigate(`/projects/${projectId}/automations`)} />}
    </div>
  </div>
}

function AutomationEditor({ automation, runs, saving, running, onSave, onRun, onDelete, onBack }: { automation: AutomationDefinition; runs: Array<{ id: string; status: string; startedAt: number; errorText: string | null }>; saving: boolean; running: boolean; onSave: (data: CreateAutomationDefinitionRequest) => void; onRun: () => void; onDelete: () => void; onBack: () => void }) {
  const data = editable(automation)
  const update = (patch: Partial<CreateAutomationDefinitionRequest>) => onSave({ ...data, ...patch })
  return <main className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ChevronLeft className="h-4 w-4" /></Button><div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold">{automation.name}</h1><p className="text-sm text-muted-foreground">{automation.enabled ? 'Enabled' : 'Disabled'}</p></div><Button variant="outline" onClick={() => update({ enabled: !automation.enabled })}>{automation.enabled ? 'Disable' : 'Enable'}</Button><Button onClick={onRun} disabled={running}><CirclePlay className="mr-2 h-4 w-4" />Run</Button><Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete automation"><Trash2 className="h-4 w-4" /></Button></header>
    <Card><CardContent className="grid gap-3 p-5"><label className="text-sm font-medium">Name<Input defaultValue={automation.name} onBlur={(event) => event.target.value.trim() && update({ name: event.target.value.trim() })} /></label><label className="text-sm font-medium">Description<Textarea defaultValue={automation.description} onBlur={(event) => update({ description: event.target.value })} /></label></CardContent></Card>
    <Card><CardContent className="space-y-3 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Triggers</h2><Button size="sm" variant="outline" onClick={() => update({ triggers: [...automation.triggers, { type: 'schedule', enabled: true, position: automation.triggers.length, config: { preset: 'daily', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', cronExpression: '0 9 * * *' }, conditions: [] }] })}><Plus className="mr-1 h-3.5 w-3.5" />Add trigger</Button></div>{automation.triggers.map((trigger) => <div key={trigger.id} className="rounded-lg border p-3 text-sm"><div className="flex items-center gap-2 font-medium"><Webhook className="h-4 w-4" />{trigger.type}</div><p className="mt-1 text-muted-foreground">{trigger.type === 'webhook' ? 'Secure endpoint token generated on creation.' : `${trigger.config.timezone} · ${trigger.type === 'cron' ? trigger.config.expression : trigger.config.cronExpression}`}</p></div>)}{!automation.triggers.length && <p className="text-sm text-muted-foreground">No triggers. Manual runs remain available.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Automation steps</h2><Button size="sm" variant="outline" onClick={() => update({ steps: [...automation.steps, { type: 'notification', position: automation.steps.length, config: { destination: 'in-app', message: '{{result}}' } }] })}><Plus className="mr-1 h-3.5 w-3.5" />Add step</Button></div>{automation.steps.map((step, index) => <div key={step.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{index + 1}. {step.type.replaceAll('_', ' ')}</p>{step.type === 'agent' && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{step.config.prompt}</p>}{step.type === 'notification' && <p className="mt-1 text-sm text-muted-foreground">{step.config.destination}</p>}</div>)}</CardContent></Card>
    <Card><CardContent className="space-y-2 p-5"><h2 className="font-semibold">Past runs</h2>{runs.length ? runs.map((item) => <div key={item.id} className="flex justify-between border-t py-2 text-sm"><span>{item.status}</span><span className="text-muted-foreground">{new Date(item.startedAt).toLocaleString()}</span></div>) : <p className="text-sm text-muted-foreground">No runs yet.</p>}</CardContent></Card>
    <div className="flex justify-end"><Button onClick={() => onSave(data)} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></div>
  </main>
}
