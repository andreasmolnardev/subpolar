import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getProviders, providerCredentialsApi } from '@/api/providers'
import type { Provider } from '@/api/providers'
import { useSettings } from '@/hooks/useSettings'
import type { DefaultModels } from '@/api/types/settings'

const NO_MODEL_VALUE = '__none__'

const DEFAULT_MODEL_FIELDS = [
  { key: 'routing', label: 'Routing model', description: 'Chooses agents, tools, or model routes for a prompt.' },
  { key: 'compaction', label: 'Compaction model', description: 'Condenses long conversations when context is tight.' },
  { key: 'sessionNaming', label: 'Session naming model', description: 'Generates concise chat titles.' },
  { key: 'summary', label: 'Summary model', description: 'Produces session and handoff summaries.' },
  { key: 'toolSummary', label: 'Tool result summary model', description: 'Compresses noisy tool output into readable context.' },
] as const

type DefaultModelKey = typeof DEFAULT_MODEL_FIELDS[number]['key']

function getModelCapabilities(model: Provider['models'][string]): string[] {
  const capabilities: string[] = []
  if (model.reasoning) capabilities.push('reasoning')
  if (model.tool_call) capabilities.push('tools')
  if (model.attachment) capabilities.push('attachments')
  if (model.limit?.context) capabilities.push(`${model.limit.context.toLocaleString()} ctx`)
  if (model.limit?.output) capabilities.push(`${model.limit.output.toLocaleString()} out`)
  return capabilities
}

function ModelSelect({ value, providers, placeholder, onChange }: {
  value?: string
  providers: Provider[]
  placeholder: string
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Select open={open} onOpenChange={setOpen} value={value ?? NO_MODEL_VALUE} onValueChange={(nextValue) => onChange(nextValue === NO_MODEL_VALUE ? undefined : nextValue)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {open && (
        <SelectContent className="max-h-80">
          <SelectItem value={NO_MODEL_VALUE}>{placeholder}</SelectItem>
          {providers.map((provider) => (
            <SelectGroup key={provider.id}>
              <SelectLabel>{provider.name || provider.id}</SelectLabel>
              {Object.entries(provider.models || {}).map(([modelId, model]) => {
                const capabilities = getModelCapabilities(model)
                return (
                  <SelectItem key={`${provider.id}/${modelId}`} value={`${provider.id}/${modelId}`}>
                    <span className="flex flex-col">
                      <span>{model.name || modelId}</span>
                      <span className="text-xs text-muted-foreground">
                        {capabilities.length > 0 ? capabilities.join(' · ') : modelId}
                      </span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      )}
    </Select>
  )
}

export function DefaultModelsSettings() {
  const { preferences, updateSettings, isUpdating } = useSettings()
  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: () => getProviders(),
    staleTime: 300000,
  })
  const { data: credentialsList } = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: () => providerCredentialsApi.list(),
  })
  const defaultModels = useMemo(() => preferences?.defaultModels ?? {}, [preferences?.defaultModels])
  const providers = useMemo(() => providersData?.providers ?? [], [providersData?.providers])
  const conversationProviders = useMemo(() => (
    providers.filter((provider) => provider.isConnected || credentialsList?.includes(provider.id))
  ), [providers, credentialsList])

  const handleConversationModelChange = useCallback((model: string | undefined) => {
    updateSettings({ defaultModel: model })
  }, [updateSettings])

  const handleInternalModelChange = useCallback((key: DefaultModelKey, model: string | undefined) => {
    const nextModels: DefaultModels = { ...defaultModels, [key]: model }
    if (!model) delete nextModels[key]
    updateSettings({ defaultModels: nextModels })
  }, [defaultModels, updateSettings])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Default conversation model</Label>
        <p className="text-sm text-muted-foreground">Used by new chats when composer model selector is left on default.</p>
        <ModelSelect value={preferences?.defaultModel} providers={conversationProviders} placeholder="Use runtime default" onChange={handleConversationModelChange} />
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-foreground mb-2">Internal Task Models</h3>
          <p className="text-sm text-muted-foreground">Defaults for background agent work.</p>
        </div>
        <div className="grid gap-3">
          {DEFAULT_MODEL_FIELDS.map((field) => (
            <Card key={field.key} className="bg-card border-border">
              <CardHeader className="p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-center">
                  <div>
                    <CardTitle className="text-sm">{field.label}</CardTitle>
                    <CardDescription className="text-xs mt-1">{field.description}</CardDescription>
                  </div>
                  <ModelSelect value={defaultModels[field.key]} providers={providers} placeholder="Use conversation default" onChange={(model) => handleInternalModelChange(field.key, model)} />
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {isUpdating && <p className="text-xs text-muted-foreground">Saving model defaults...</p>}
    </div>
  )
}
