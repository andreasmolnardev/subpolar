import { useMemo, useRef, useEffect } from 'react'
import { useMessages, useConfig, useAgents } from './useOpenCode'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import type { components } from '@/api/opencode-types'

type UserMessage = components['schemas']['UserMessage']

interface AgentInfo {
  name: string
  mode?: string
  hidden?: boolean
}

export function resolveDefaultSessionAgent(
  configDefaultAgent: string | undefined,
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string {
  const primaryAgents = agents?.filter(
    (agent) => (agent.mode === 'primary' || agent.mode === 'all') && !agent.hidden
  ) ?? []

  if (configDefaultAgent) {
    const normalizedConfig = configDefaultAgent.toLowerCase()
    const configInPrimary = primaryAgents.some(
      (agent) => agent.name.toLowerCase() === normalizedConfig
    )
    if (!agentsLoaded || configInPrimary) {
      return configDefaultAgent
    }
  }

  if (agentsLoaded && primaryAgents.length > 0) {
    return primaryAgents[0].name
  }

  return 'build'
}

interface SessionAgentResult {
  agent: string
  model: { providerID: string; modelID: string } | undefined
  variant: string | undefined
  fromMessage: boolean
}

export function useSessionAgent(
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string
) {
  const { data: messages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionID, directory)
  const { data: config } = useConfig(opcodeUrl, directory)
  const { data: agents, isSuccess: agentsLoaded } = useAgents(opcodeUrl, directory)
  const storedAgent = useSessionAgentStore((s) => s.agents[sessionID ?? ''] ?? null)
  const setAgent = useSessionAgentStore((s) => s.setAgent)
  const prevRef = useRef<SessionAgentResult>({ agent: 'build', model: undefined, variant: undefined, fromMessage: false })

  const defaultAgent = useMemo(
    () => resolveDefaultSessionAgent(config?.default_agent, agents, agentsLoaded),
    [config?.default_agent, agents, agentsLoaded]
  )

  const result = useMemo(() => {
    if (storedAgent && messages && messages.length > 0) {
      let model: { providerID: string; modelID: string } | undefined
      let variant: string | undefined

      for (let i = messages.length - 1; i >= 0; i--) {
        const msgWithParts = messages[i]
        if (msgWithParts.info.role === 'user') {
          const userInfo = msgWithParts.info as UserMessage
          model = userInfo.model
          variant = userInfo.variant
          break
        }
      }

      const prev = prevRef.current
      if (
        prev.agent === storedAgent &&
        prev.variant === variant &&
        prev.model?.providerID === model?.providerID &&
        prev.model?.modelID === model?.modelID
      ) {
        return { ...prev, fromMessage: false }
      }

      const next: SessionAgentResult = { agent: storedAgent, model, variant, fromMessage: false }
      prevRef.current = next
      return next
    }

    if (messagesLoading) {
      return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
    }

    if (!messages || messages.length === 0) {
      return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgWithParts = messages[i]
      if (msgWithParts.info.role === 'user') {
        const userInfo = msgWithParts.info as UserMessage
        if (userInfo.agent) {
          const prev = prevRef.current
          if (
            prev.agent === userInfo.agent &&
            prev.variant === userInfo.variant &&
            prev.model?.providerID === userInfo.model?.providerID &&
            prev.model?.modelID === userInfo.model?.modelID
          ) {
            return { ...prev, fromMessage: true }
          }

          const next: SessionAgentResult = {
            agent: userInfo.agent,
            model: userInfo.model,
            variant: userInfo.variant,
            fromMessage: true,
          }
          prevRef.current = next
          return next
        }
      }
    }

    return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
  }, [messages, messagesLoading, storedAgent, defaultAgent])

  useEffect(() => {
    if (result.agent && sessionID && result.fromMessage) {
      setAgent(sessionID, result.agent)
    }
  }, [result.agent, result.fromMessage, sessionID, setAgent])

  return { agent: result.agent, model: result.model, variant: result.variant }
}

export function getSessionAgentFromMessages(
  messages: Array<{ role: string; agent?: string }> | undefined
): string | undefined {
  if (!messages || messages.length === 0) {
    return undefined
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && 'agent' in msg && msg.agent) {
      return msg.agent
    }
  }

  return undefined
}
