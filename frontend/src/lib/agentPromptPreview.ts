import type { SkillFileInfo } from '@subpolar/shared'

export function buildAgentPromptPreview(input: {
  projectInstructions?: string
  prompt?: string
  skillAccess?: Array<{
    id: string
    discovery: 'full' | 'description' | 'name' | 'search'
  }>
  skills?: SkillFileInfo[]
}) {
  const skillsByName = new Map((input.skills ?? []).map(skill => [skill.name, skill]))
  const skillBlocks = (input.skillAccess ?? []).flatMap(access => {
    if (access.discovery === 'search') return []

    const skill = skillsByName.get(access.id)
    if (!skill) return [`### ${access.id}\nMissing skill metadata`]
    if (access.discovery === 'full') {
      const schema = skill.source === 'auto' && skill.inputSchema
        ? `\n\nTool call parameters:\n\`\`\`json\n${JSON.stringify(skill.inputSchema, null, 2)}\n\`\`\``
        : ''
      return [`### ${skill.name}\n${skill.description}${schema}\n\n${skill.body}`]
    }
    if (access.discovery === 'description') {
      return [`### ${skill.name}\n${skill.source === 'auto' ? 'Type: Auto-generated\n' : ''}${skill.description || 'No description'}`]
    }
    return [`### ${skill.name}`]
  })

  return [
    ...(input.projectInstructions?.trim() ? [`## Project Instructions\n${input.projectInstructions.trim()}`] : []),
    ...(input.prompt?.trim() ? [`## Agent Instructions\n${input.prompt.trim()}`] : []),
    `## Skills\n${skillBlocks.length ? skillBlocks.join('\n\n') : 'No skills listed directly. Search-discovery skills may be available through skill search.'}`,
    '## User Prompt\n${user}',
  ].join('\n\n')
}
