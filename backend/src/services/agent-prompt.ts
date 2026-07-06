import type { AgentSkillAccess, SkillFileInfo } from '@subpolar/shared'

export interface AgentPromptBuilderInput {
  baseInstructions?: string
  agentPrompt?: string
  projectInstructions?: string
  tools?: Array<{ type?: string; id: string; permission?: string; command?: string }>
  skillAccess?: AgentSkillAccess[]
  skills?: SkillFileInfo[]
  includeUserPlaceholder?: boolean
  skillSearchAvailable?: boolean
}

export interface AgentPromptBuilderOutput {
  prompt: string
  warnings: string[]
}

export function buildAgentPrompt(input: AgentPromptBuilderInput): AgentPromptBuilderOutput {
  const warnings: string[] = []
  const sections: string[] = []

  if (input.baseInstructions?.trim()) sections.push(`## Subpolar Instructions\n${input.baseInstructions.trim()}`)
  if (input.agentPrompt?.trim()) sections.push(`## Agent Instructions\n${input.agentPrompt.trim()}`)
  sections.push(`## Project Instructions\n${input.projectInstructions?.trim() || 'Project instructions unavailable until project context selected'}`)

  const tools = input.tools ?? []
  sections.push(`## Tools\n${tools.length > 0 ? tools.map(tool => `- ${tool.id}: ${tool.permission ?? 'deny'}${tool.command ? ` (${tool.command})` : ''}`).join('\n') : 'No explicit tool access configured'}`)

  const skillByName = new Map((input.skills ?? []).map(skill => [skill.name, skill]))
  const skillLines = (input.skillAccess ?? []).flatMap(access => {
    if (access.discovery === 'search') {
      if (!input.skillSearchAvailable) warnings.push(`Skill ${access.id} uses search discovery, but skill search is not available`)
      return []
    }
    const skill = skillByName.get(access.id)
    if (!skill) {
      warnings.push(`Skill ${access.id} not found`)
      return [`### ${access.id}\nMissing skill metadata`]
    }
    if (access.discovery === 'full') return [`### ${skill.name}\n${skill.description}\n\n${skill.body}`]
    if (access.discovery === 'description') return [`### ${skill.name}\n${skill.description || 'No description'}`]
    return [`### ${skill.name}`]
  })
  sections.push(`## Skills\n${skillLines.length > 0 ? skillLines.join('\n\n') : 'No skills listed directly. Search-discovery skills may be available through skill search.'}`)
  if (input.includeUserPlaceholder) sections.push('## User Prompt\n${user}')

  return { prompt: sections.join('\n\n'), warnings }
}
