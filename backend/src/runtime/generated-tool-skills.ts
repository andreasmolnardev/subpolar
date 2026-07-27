export type RuntimeSkill = {
  name: string
  description: string
  filePath: string
  baseDir: string
  source?: 'auto-generated'
  toolId?: string
  inputSchema?: Record<string, unknown>
}

type ListedTool = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
}

export function createGeneratedToolSkills(tools: ListedTool[]): RuntimeSkill[] {
  return tools.map((tool) => ({
    name: `tool-${tool.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    description: `Auto-generated skill for ${tool.id}: ${tool.description}`,
    filePath: `subpolar-tool://${tool.id}`,
    baseDir: '',
    source: 'auto-generated',
    toolId: tool.id,
    inputSchema: tool.inputSchema,
  }))
}
