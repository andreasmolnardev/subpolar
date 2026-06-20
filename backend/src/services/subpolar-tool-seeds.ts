import type { PolicySeed, ToolSeed } from '../db/subpolar-tools'

const emptyOutput = { type: 'object', properties: {} }

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required }
}

export const SUBPOLAR_TOOL_SEEDS: ToolSeed[] = [
  { tool_id: 'tools.list', namespace: 'tools', description: 'List available Subpolar tools', adapter: 'internal', target: 'tool-router', operation: 'list', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'calendar.get', namespace: 'calendar', description: 'Read events from a configured CalDAV calendar', adapter: 'internal', target: 'caldav', operation: 'get_events', input_schema: objectSchema({ range: { type: 'string' }, calendarId: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, ['range']), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'caldav', examples: [{ range: 'today' }] } },
  { tool_id: 'calendar.create', namespace: 'calendar', description: 'Create an event in a configured CalDAV calendar', adapter: 'internal', target: 'caldav', operation: 'create_event', input_schema: objectSchema({ calendarId: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, description: { type: 'string' } }, ['title', 'start']), output_schema: emptyOutput, risk: 'write', requires_approval: true, enabled: true, metadata: { integrationType: 'caldav', examples: [{ title: 'Meeting', start: '2026-06-20T15:00:00+02:00', end: '2026-06-20T16:00:00+02:00' }] } },
  { tool_id: 'mail.search', namespace: 'mail', description: 'Search mail through a configured IMAP account', adapter: 'internal', target: 'imap_smtp', operation: 'search', input_schema: objectSchema({ query: { type: 'string' }, mailbox: { type: 'string' }, limit: { type: 'number' } }, ['query']), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'imap_smtp' } },
  { tool_id: 'mail.send', namespace: 'mail', description: 'Send mail through a configured SMTP account', adapter: 'internal', target: 'imap_smtp', operation: 'send', input_schema: objectSchema({ to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' } }, ['to', 'subject', 'body']), output_schema: emptyOutput, risk: 'external', requires_approval: true, enabled: true, metadata: { integrationType: 'imap_smtp' } },
  { tool_id: 'mcp.github.listIssues', namespace: 'mcp', description: 'List GitHub issues through a configured MCP server', adapter: 'mcp', target: 'github', operation: 'listIssues', input_schema: objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } }, ['owner', 'repo']), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'mcp' } },
  { tool_id: 'mcp.github.createIssue', namespace: 'mcp', description: 'Create a GitHub issue through a configured MCP server', adapter: 'mcp', target: 'github', operation: 'createIssue', input_schema: objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, ['owner', 'repo', 'title']), output_schema: emptyOutput, risk: 'external', requires_approval: true, enabled: true, metadata: { integrationType: 'mcp' } },
]

export const SUBPOLAR_POLICY_SEEDS: PolicySeed[] = [
  { agent_id: 'auto', tool_id: 'tools.list', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'tools.list', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'calendar.get', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'calendar.create', effect: 'approval', constraints: {} },
  { agent_id: 'productivity', tool_id: 'mail.search', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'mail.send', effect: 'approval', constraints: {} },
  { agent_id: 'research', tool_id: 'mcp.github.listIssues', effect: 'allow', constraints: {} },
  { agent_id: 'code-build-master', tool_id: 'mcp.github.listIssues', effect: 'allow', constraints: {} },
  { agent_id: 'code-build-master', tool_id: 'mcp.github.createIssue', effect: 'approval', constraints: {} },
]
