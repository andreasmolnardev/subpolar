import type { AgentSkillAccess, SkillFileInfo } from '@subpolar/shared'

export function buildAgentPromptPreview(input: {
  prompt?: string
  skillAccess?: AgentSkillAccess[]
  skills?: SkillFileInfo[]
}) {
  const skills = new Map((input.skills ?? []).map(skill => [skill.name, skill]))
  const skillBlocks = (input.skillAccess ?? []).flatMap(access => {
    if (access.discovery === 'search') return []
    const skill = skills.get(access.id)
    if (!skill) return [`### ${access.id}\nMissing skill file`]
    if (access.discovery === 'full') return [`### ${skill.name}\n${skill.description}\n\n${skill.body}`]
    if (access.discovery === 'description') return [`### ${skill.name}\n${skill.source === 'auto' ? 'Type: Auto-generated\n' : ''}${skill.description || 'No description'}`]
    return [`### ${skill.name}`]
  })
  return [
    '## Subpolar Instructions\nDefault Subpolar runtime instructions apply.',
    `## Agent Instructions\n${input.prompt?.trim() || 'No agent prompt yet.'}`,
    `## Skills\n${skillBlocks.length ? skillBlocks.join('\n\n') : 'No skills listed directly. Search-discovery skills may be available through skill search.'}`,
    '## User Prompt\n${user}',
  ].join('\n\n')
}
