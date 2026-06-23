import type { Database } from '../db/schema'
import { callTool, describeToolForAgent, listToolsForAgent } from '../services/subpolar-tool-router'

export class ToolGateway {
  constructor(private readonly db: Database) {}

  list(agentId: string) {
    return listToolsForAgent(this.db, agentId)
  }

  describe(agentId: string, toolId: string) {
    return describeToolForAgent(this.db, agentId, toolId)
  }

  call(input: { agentId: string; toolId: string; toolInput: unknown; sessionId?: string }) {
    return callTool(this.db, input.agentId, input.toolId, input.toolInput, input.sessionId)
  }
}
