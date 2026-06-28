import type { PolicySeed, ToolSeed } from '../db/subpolar-tools'

const emptyOutput = { type: 'object', properties: {} }
const webSearchOutput = objectSchema({
  query: { type: 'string' },
  results: {
    type: 'array',
    items: objectSchema({
      title: { type: 'string' },
      url: { type: 'string' },
      snippet: { type: 'string' },
    }, ['title', 'url', 'snippet']),
  },
}, ['query', 'results'])
const webScrapeOutput = objectSchema({
  url: { type: 'string' },
  title: { type: 'string' },
  content: { type: 'string' },
  truncated: { type: 'boolean' },
}, ['url', 'title', 'content', 'truncated'])
const calendarEventsOutput = objectSchema({
  calendars: {
    type: 'array',
    items: objectSchema({ id: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' } }),
  },
  events: {
    type: 'array',
    items: objectSchema({ title: { type: 'string' }, calendar: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' } }),
  },
}, ['calendars', 'events'])

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required }
}

export const SUBPOLAR_TOOL_SEEDS: ToolSeed[] = [
  { tool_id: 'tools.list', namespace: 'tools', description: 'List available Subpolar tools', adapter: 'internal', target: 'tool-router', operation: 'list', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'calendar.get', namespace: 'calendar', description: 'Read events from a configured CalDAV calendar', adapter: 'internal', target: 'caldav', operation: 'get_events', input_schema: objectSchema({ range: { type: 'string' }, calendarId: { type: 'string' }, integrationId: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }), output_schema: calendarEventsOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'caldav', examples: [{ range: 'today' }, { range: 'next week' }, { start: '2026-07-06T00:00:00+02:00', end: '2026-07-13T00:00:00+02:00' }] } },
  { tool_id: 'calendar.create', namespace: 'calendar', description: 'Create an event in a configured CalDAV calendar', adapter: 'internal', target: 'caldav', operation: 'create_event', input_schema: objectSchema({ calendarId: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, description: { type: 'string' } }, ['title', 'start']), output_schema: emptyOutput, risk: 'write', requires_approval: true, enabled: true, metadata: { integrationType: 'caldav', examples: [{ title: 'Meeting', start: '2026-06-20T15:00:00+02:00', end: '2026-06-20T16:00:00+02:00' }] } },
  { tool_id: 'mail.search', namespace: 'mail', description: 'Search mail through a configured IMAP account', adapter: 'internal', target: 'imap_smtp', operation: 'search', input_schema: objectSchema({ query: { type: 'string' }, mailbox: { type: 'string' }, limit: { type: 'number' } }, ['query']), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'imap_smtp' } },
  { tool_id: 'mail.send', namespace: 'mail', description: 'Send mail through a configured SMTP account', adapter: 'internal', target: 'imap_smtp', operation: 'send', input_schema: objectSchema({ to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' } }, ['to', 'subject', 'body']), output_schema: emptyOutput, risk: 'external', requires_approval: true, enabled: true, metadata: { integrationType: 'imap_smtp' } },
  { tool_id: 'web.search', namespace: 'web', description: 'Search the public web for research sources', adapter: 'internal', target: 'web', operation: 'search', input_schema: objectSchema({ query: { type: 'string' }, limit: { type: 'number' } }, ['query']), output_schema: webSearchOutput, risk: 'external', requires_approval: false, enabled: true, metadata: { examples: [{ query: 'Odysseus deep research agent implementation', limit: 5 }] } },
  { tool_id: 'web.scrape', namespace: 'web', description: 'Fetch and extract readable text from a public web page', adapter: 'internal', target: 'web', operation: 'scrape', input_schema: objectSchema({ url: { type: 'string' }, maxLength: { type: 'number' } }, ['url']), output_schema: webScrapeOutput, risk: 'external', requires_approval: false, enabled: true, metadata: { examples: [{ url: 'https://example.com', maxLength: 12000 }] } },
  { tool_id: 'mcp.github.listIssues', namespace: 'mcp', description: 'List GitHub issues through a configured MCP server', adapter: 'mcp', target: 'github', operation: 'listIssues', input_schema: objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } }, ['owner', 'repo']), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: { integrationType: 'mcp' } },
  { tool_id: 'mcp.github.createIssue', namespace: 'mcp', description: 'Create a GitHub issue through a configured MCP server', adapter: 'mcp', target: 'github', operation: 'createIssue', input_schema: objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, ['owner', 'repo', 'title']), output_schema: emptyOutput, risk: 'external', requires_approval: true, enabled: true, metadata: { integrationType: 'mcp' } },
  { tool_id: 'pi.read', namespace: 'pi', description: 'Authorize Pi read tool execution', adapter: 'internal', target: 'pi', operation: 'read', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'pi.grep', namespace: 'pi', description: 'Authorize Pi grep tool execution', adapter: 'internal', target: 'pi', operation: 'grep', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'pi.find', namespace: 'pi', description: 'Authorize Pi find tool execution', adapter: 'internal', target: 'pi', operation: 'find', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'pi.ls', namespace: 'pi', description: 'Authorize Pi ls tool execution', adapter: 'internal', target: 'pi', operation: 'ls', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'read', requires_approval: false, enabled: true, metadata: {} },
  { tool_id: 'pi.write', namespace: 'pi', description: 'Authorize Pi write tool execution', adapter: 'internal', target: 'pi', operation: 'write', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'write', requires_approval: true, enabled: true, metadata: {} },
  { tool_id: 'pi.edit', namespace: 'pi', description: 'Authorize Pi edit tool execution', adapter: 'internal', target: 'pi', operation: 'edit', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'write', requires_approval: true, enabled: true, metadata: {} },
  { tool_id: 'pi.bash', namespace: 'pi', description: 'Authorize Pi bash tool execution', adapter: 'internal', target: 'pi', operation: 'bash', input_schema: objectSchema({}), output_schema: emptyOutput, risk: 'external', requires_approval: true, enabled: true, metadata: {} },
]

export const SUBPOLAR_POLICY_SEEDS: PolicySeed[] = [
  { agent_id: 'auto', tool_id: 'tools.list', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'tools.list', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'calendar.get', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'calendar.create', effect: 'approval', constraints: {} },
  { agent_id: 'productivity', tool_id: 'mail.search', effect: 'allow', constraints: {} },
  { agent_id: 'productivity', tool_id: 'mail.send', effect: 'approval', constraints: {} },
  { agent_id: 'research', tool_id: 'tools.list', effect: 'allow', constraints: {} },
  { agent_id: 'research', tool_id: 'web.search', effect: 'allow', constraints: {} },
  { agent_id: 'research', tool_id: 'web.scrape', effect: 'allow', constraints: {} },
  { agent_id: 'research', tool_id: 'mcp.github.listIssues', effect: 'allow', constraints: {} },
  { agent_id: 'code-build-master', tool_id: 'mcp.github.listIssues', effect: 'allow', constraints: {} },
  { agent_id: 'code-build-master', tool_id: 'mcp.github.createIssue', effect: 'approval', constraints: {} },
]
