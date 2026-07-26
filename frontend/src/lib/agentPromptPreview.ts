import type { SkillFileInfo } from '@subpolar/shared'

export function buildAgentPromptPreview(input: {
  prompt?: string
  skills?: SkillFileInfo[]
}) {
  const skillBlocks = (input.skills ?? []).map(skill => [
    `### ${skill.name}`,
    `- **Description:** ${skill.description || 'No description'}`,
    `- **Location:** ${skill.location}`,
  ].join('\n'))
  return [
    '## Subpolar Instructions\nDefault Subpolar runtime instructions apply.',
    `## Agent Instructions\n${input.prompt?.trim() || 'No agent prompt yet.'}`,
    `## Skills\n${skillBlocks.length ? skillBlocks.join('\n\n') : 'No skills listed directly. Search-discovery skills may be available through skill search.'}`,
    '## User Prompt\n${user}',
  ].join('\n\n')
}
