import type { AgentSkillAccess, SkillFileInfo } from '@subpolar/shared'

export interface AgentPromptBuilderInput {
  baseInstructions?: string
  agentPrompt?: string
  projectInstructions?: string
  skillAccess?: AgentSkillAccess[]
  skills?: SkillFileInfo[]
  includeUserPlaceholder?: boolean
  skillSearchAvailable?: boolean
}

export interface AgentPromptBuilderOutput {
  prompt: string
  warnings: string[]
}

function formatFullSkill(skill: SkillFileInfo): string {
  const schema = skill.source === 'auto' && skill.inputSchema
    ? `\n\nTool call parameters:\n\`\`\`json\n${JSON.stringify(skill.inputSchema, null, 2)}\n\`\`\``
    : ''
  return `### ${skill.name}\n${skill.description}${schema}\n\n${skill.body}`
}

export function buildAgentPrompt(input: AgentPromptBuilderInput): AgentPromptBuilderOutput {
  const warnings: string[] = []
  const sections: string[] = []

  if (input.baseInstructions?.trim()) sections.push(`## Subpolar Instructions\n${input.baseInstructions.trim()}`)
  if (input.agentPrompt?.trim()) sections.push(`## Agent Instructions\n${input.agentPrompt.trim()}`)
  if (input.projectInstructions?.trim()) sections.push(`## Project Instructions\n${input.projectInstructions.trim()}`)

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
    if (access.discovery === 'full') return [formatFullSkill(skill)]
    if (access.discovery === 'description') return [`### ${skill.name}\n${skill.source === 'auto' ? 'Type: Auto-generated\n' : ''}${skill.description || 'No description'}`]
    return [`### ${skill.name}`]
  })
  sections.push(`## Skills\n${skillLines.length > 0 ? skillLines.join('\n\n') : 'No skills listed directly. Search-discovery skills may be available through skill search.'}`)
  if (input.includeUserPlaceholder) sections.push('## User Prompt\n${user}')

  return { prompt: sections.join('\n\n'), warnings }
}
