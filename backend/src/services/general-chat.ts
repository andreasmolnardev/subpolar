import path from 'path'
import { createHash } from 'node:crypto'
import type { AgentDefinition, Project, GeneralChatStatus, OpenCodeConfigInput } from '@subpolar/shared/types'
import type { AgentFileInfo } from '@subpolar/shared/schemas/repo'
import {
  readFileContent,
  writeFileContent,
  fileExists,
  ensureDirectoryExists,
  deletePath,
} from './file-operations'
import { PiConfigSchema } from '@subpolar/shared/schemas'
import { GENERAL_CHAT_PROJECT_ID, GENERAL_CHAT_PROJECT_PATH } from '@subpolar/shared/utils'
import { getWorkspacePath, ENV } from '@subpolar/shared/config/env'
import type { Database } from '../db/schema'
import { ensureGeneralChatProject } from '../db/projects'
import { getOrCreateInternalToken } from './internal-token'
import { deleteSystemAgents, listAgents } from '../db/subpolar-agents'


const GENERAL_CHAT_DIR = GENERAL_CHAT_PROJECT_PATH
const GENERAL_CHAT_RELATIVE_PATH = 'general-chat'
const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'
const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'
const ASSISTANT_OPENCODE_DIR = '.opencode'
const ASSISTANT_INTERNAL_TOKEN_FILENAME = 'internal-token'
const ASSISTANT_SKILLS_DIR = 'skills'
const ASSISTANT_SKILL_FILENAME = 'SKILL.md'
const ASSISTANT_AGENTS_DIR = 'agents'

const AGENT_AUTO = 'auto'
const AGENT_CODE_BUILD_SANDBOX = 'code-build-sandbox'
const AGENT_CODE_BUILD_MASTER = 'code-build-master'
const AGENT_CODE_PLAN = 'code-plan'
const AGENT_CODE_ANALYZE = 'code-analyze'
const AGENT_RESEARCH = 'research'
const AGENT_PRODUCTIVITY = 'productivity'

const AGENT_NAMES = [
  AGENT_AUTO,
  AGENT_CODE_BUILD_SANDBOX,
  AGENT_CODE_BUILD_MASTER,
  AGENT_CODE_PLAN,
  AGENT_CODE_ANALYZE,
  AGENT_RESEARCH,
  AGENT_PRODUCTIVITY,
] as const

const SKILL_AUTOMATIONS_DIR = 'automation-management'
const SKILL_NOTIFICATIONS_DIR = 'notifications'
const SKILL_SETTINGS_DIR = 'manager-settings'
const SKILL_REPOS_DIR = 'repo-management'
const SKILL_CODE_REVIEW_DIR = 'code-review'
const SKILL_CODE_ANALYSIS_DIR = 'code-analysis'
const SKILL_RESEARCH_WEB_DIR = 'research-web'
const SKILL_SUBPOLAR_CONTEXT_DIR = 'subpolar-context'
const SKILL_OPENCODE_CONTEXT_DIR = 'opencode-context'
const SKILL_CALENDAR_CLI_DIR = 'calendar-cli'
const SKILL_MAIL_CLI_DIR = 'mail-cli'
const SKILL_TODO_CLI_DIR = 'todo-cli'
const SKILL_NOTES_CLI_DIR = 'notes-cli'
const SKILL_SUBPOLAR_TOOLS_DIR = 'subpolar-tools'

const SKILL_DIRS = [
  SKILL_AUTOMATIONS_DIR,
  SKILL_NOTIFICATIONS_DIR,
  SKILL_SETTINGS_DIR,
  SKILL_REPOS_DIR,
  SKILL_CODE_REVIEW_DIR,
  SKILL_CODE_ANALYSIS_DIR,
  SKILL_RESEARCH_WEB_DIR,
  SKILL_SUBPOLAR_CONTEXT_DIR,
  SKILL_OPENCODE_CONTEXT_DIR,
  SKILL_CALENDAR_CLI_DIR,
  SKILL_MAIL_CLI_DIR,
  SKILL_TODO_CLI_DIR,
  SKILL_NOTES_CLI_DIR,
  SKILL_SUBPOLAR_TOOLS_DIR,
] as const

export function getGeneralChatDirectory(): string {
  const workspacePath = getWorkspacePath()
  const generalChatDir = path.join(workspacePath, GENERAL_CHAT_DIR)
  const resolvedWorkspaceRoot = path.resolve(workspacePath)
  const resolvedGeneralChatDir = path.resolve(generalChatDir)

  if (!resolvedGeneralChatDir.startsWith(resolvedWorkspaceRoot)) {
    throw new Error('General chat directory must be within workspace root')
  }

  return resolvedGeneralChatDir
}

export function buildGeneralChatProject(): Project {
  return {
    id: GENERAL_CHAT_PROJECT_ID,
    name: 'General Chat',
    directory: GENERAL_CHAT_DIR,
    fullPath: getGeneralChatDirectory(),
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGeneralChat: true,
  }
}

function getInternalTokenPath(generalChatDir: string): string {
  return path.join(generalChatDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_INTERNAL_TOKEN_FILENAME)
}

function getAgentPath(generalChatDir: string, agentName: string): string {
  return path.join(generalChatDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR, `${agentName}.md`)
}

function getSkillPath(generalChatDir: string, skillDir: string): string {
  return path.join(generalChatDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, skillDir, ASSISTANT_SKILL_FILENAME)
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function hasSameContentHash(existingContent: string | undefined, generatedContent: string): boolean {
  return existingContent !== undefined && hashContent(existingContent) === hashContent(generatedContent)
}

function buildAgentMd(
  description: string,
  mode: 'primary' | 'subagent',
  permission: Record<string, string | Record<string, string>>,
  prompt: string,
): string {
  const permissionYaml = Object.entries(permission)
    .map(([key, value]) => {
      if (typeof value === 'object') {
        const subLines = Object.entries(value)
          .map(([k, v]) => `      "${k}": "${v}"`)
          .join('\n')
        return `    ${key}:\n${subLines}`
      }
      return `    ${key}: ${value}`
    })
    .join('\n')

  return `---
description: ${description}
mode: ${mode}
permission:
${permissionYaml}
---

${prompt}
`
}

function buildFullPermission(): Record<string, string> {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    skill: 'allow',
    todowrite: 'allow',
    question: 'allow',
    external_directory: 'ask',
  }
}

function buildReadOnlyPermission(): Record<string, string> {
  return {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    edit: 'deny',
    bash: 'deny',
    webfetch: 'allow',
    websearch: 'deny',
    skill: 'allow',
    todowrite: 'allow',
    question: 'allow',
    external_directory: 'ask',
  }
}

function buildSandboxPermission(): Record<string, string | Record<string, string>> {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: {
      '*': 'allow',
      'rm -rf /*': 'deny',
      'sudo *': 'deny',
    },
    webfetch: 'allow',
    websearch: 'deny',
    skill: 'allow',
    todowrite: 'allow',
    question: 'allow',
    external_directory: 'allow',
  }
}

function buildResearchPermission(): Record<string, string> {
  return {
    read: 'allow',
    edit: 'deny',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'deny',
    webfetch: 'allow',
    websearch: 'allow',
    skill: 'allow',
    todowrite: 'allow',
    question: 'allow',
    external_directory: 'ask',
  }
}

function buildProductivityPermission(): Record<string, string | Record<string, string>> {
  return {
    read: 'allow',
    edit: 'deny',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    skill: 'allow',
    todowrite: 'allow',
    question: 'allow',
    external_directory: 'ask',
  }
}

// --- Agent Prompts ---

function buildAutoAgentPrompt(): string {
  return [
    'You are the Auto agent for subpolar. Your job is to analyze the user\'s query and route it to the correct specialized agent.',
    '',
    '## Available Agents',
    '',
    '- **code-build-master**: Full build agent with access to subpolar internals (repos, automations, notifications, settings) and code review. Use this for building features, fixing bugs, or any work that needs full project access.',
    '- **code-build-sandbox**: Build agent that works in a temporary sandbox directory. Use this for experimental code, testing ideas, or when the user wants to try something without affecting the main project.',
    '- **code-plan**: Read-only planning agent. Use this for architecture discussions, design proposals, or planning features without making changes.',
    '- **code-analyze**: Read-only analysis agent with code analysis skills. Use this for debugging, finding bugs, detecting repetitive patterns, or deep code review.',
    '- **research**: Deep web research agent with websearch, webfetch, web.search, and web.scrape tools. Use this for source-backed research, documentation lookups, and current information.',
    '- **productivity**: Productivity agent for calendar, mail, todo, and notes work through subpolar-tools. Use this for personal organization tasks.',
    '',
    '## Routing Rules',
    '',
    '- If the user wants to BUILD or MODIFY code, route to a build agent.',
    '- If the user wants to PLAN or DESIGN, route to code-plan.',
    '- If the user wants to ANALYZE code, find bugs, or review, route to code-analyze.',
    '- If the user is experimenting or wants a safe environment, route to code-build-sandbox.',
    '- If the user needs web research or documentation lookups, route to research.',
    '- If the user asks about calendar, mail, todo, notes, reminders, scheduling, or personal productivity, route to productivity.',
    '- If unsure, ask the user which agent they need.',
    '',
    '## Model Routing Contract',
    '',
    'If you are invoked only as an intermediate model router, choose exactly one model from the supplied model list and respond with only valid JSON in this shape:',
    '',
    '{"use":"MODEL"}',
    '',
    'Use the exact model identifier from the supplied list. Consider the model names, limits, modalities, reasoning support, tool support, status, and cost metadata when provided.',
    '',
    'When routing to an agent, explain briefly why you chose that agent and hand off to it.',
  ].join('\n')
}

function buildCodeBuildSandboxAgentPrompt(): string {
  return [
    'You are the Code Build (Sandbox) agent for subpolar.',
    '',
    '## Sandbox Rules',
    '',
    'You MUST work in a temporary sandbox directory. Create one at the start of your session:',
    '',
    '1. Create a temp directory using `mkdir -p /tmp/subpolar-sandbox-<session-id>`',
    '2. Copy or symlink only the files needed for the task',
    '3. Work exclusively inside this sandbox directory',
    '4. Present the results to the user without modifying the main project',
    '',
    '## What You Can Do',
    '',
    '- Write and test experimental code',
    '- Prototype features and ideas',
    '- Run builds and tests in isolation',
    '- Create proof-of-concept implementations',
    '',
    '## Constraints',
    '',
    '- NEVER modify files outside the sandbox directory',
    '- NEVER run destructive system commands',
    '- Clean up temp directories when done if the user asks',
    '- Ask before moving sandbox code into the main project',
  ].join('\n')
}

function buildCodeBuildMasterAgentPrompt(): string {
  return [
    'You are the Code Build (Master) agent for subpolar. You have full access to the subpolar project, OpenCode configuration, and all workspace skills.',
    '',
    '## Available Skills',
    '',
    'Load these skills when relevant:',
    '- **subpolar-context**: How subpolar is structured, run, tested, and safely changed.',
    '- **opencode-context**: How OpenCode configuration, agents, permissions, and skills work.',
    '- **repo-management**: List repos and look up repo IDs. Load before automation-management if you need a repo ID.',
    '- **automation-management**: Create, list, update, delete, run, and cancel automation jobs and runs.',
    '- **notifications**: Send push notifications to the user\'s registered devices.',
    '- **manager-settings**: Read and safely modify user preferences (theme, mode, etc.).',
    '- **code-review**: Review code for quality, bugs, security, and best practices.',
    '',
    '## Self-Editing Rules',
    '',
    'This workspace is the shared general chat workspace. Durable agent instructions belong in `.opencode/agents/`.',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them.',
    'Ask before destructive operations or changes outside this workspace.',
  ].join('\n')
}

function buildCodePlanAgentPrompt(): string {
  return [
    'You are the Code Plan agent for subpolar. You are read-only and focused on planning and design.',
    '',
    '## What You Do',
    '',
    '- Draft architecture proposals and design documents',
    '- Plan feature implementations with step-by-step breakdowns',
    '- Discuss trade-offs, tech stack decisions, and design patterns',
    '- Review requirements and create technical specifications',
    '- Estimate effort and identify risks',
    '',
    '## Constraints',
    '',
    '- You CANNOT edit files or run shell commands',
    '- You CAN read files to understand the codebase',
    '- Present plans as clear, actionable documents the user can hand to a build agent',
    '- When appropriate, reference specific files and line numbers',
  ].join('\n')
}

function buildCodeAnalyzeAgentPrompt(): string {
  return [
    'You are the Code Analyze agent for subpolar. You are read-only and focused on deep code analysis.',
    '',
    '## Available Skills',
    '',
    'Load this skill when relevant:',
    '- **code-analysis**: Techniques for analyzing code, finding bugs, detecting repetitive behavior, and identifying code quality issues.',
    '',
    '## What You Do',
    '',
    '- Analyze code for bugs, logic errors, and edge cases',
    '- Detect repetitive patterns, code duplication, and violations of DRY',
    '- Identify security vulnerabilities and performance bottlenecks',
    '- Review code structure and suggest improvements',
    '- Trace execution paths and data flow',
    '- Draft plans for refactoring or fixing issues',
    '',
    '## Constraints',
    '',
    '- You CANNOT edit files or run shell commands',
    '- You CAN read files and search the codebase',
    '- Present findings clearly with file paths and line references',
    '- Suggest concrete fixes that a build agent can implement',
  ].join('\n')
}

function buildResearchAgentPrompt(): string {
  return [
    'You are the Research agent for subpolar. Your job is to run source-backed web research and produce clear, cited findings.',
    '',
    '## Tools Available',
    '',
    '- **websearch**: Built-in web search. Use this whenever possible for broad discovery, current information, and quick source triangulation before falling back to backend-routed search.',
    '- **webfetch**: Built-in page reader. Use this for specific URLs, official docs, articles, and API references.',
    '- **subpolar-tools web.search**: Backend-routed search tool. Use this when you need auditable, policy-controlled search results through Subpolar.',
    '- **subpolar-tools web.scrape**: Backend-routed scrape tool. Use this to extract readable text from a public URL for deeper source reading.',
    '',
    '## Deep Research Workflow',
    '',
    '1. Clarify the research question, time sensitivity, and success criteria.',
    '2. Search broadly with `websearch` or `subpolar-tools` `web.search` using multiple targeted queries.',
    '3. Select high-quality sources: official docs, primary sources, project repos, standards, papers, or reputable reporting.',
    '4. Read selected pages with `webfetch` or `subpolar-tools` `web.scrape`; do not rely only on search snippets.',
    '5. Track source URLs and note disagreements, stale pages, missing dates, or uncertainty.',
    '6. Iterate if the first source set is thin, contradictory, or biased.',
    '7. Synthesize into a concise answer with citations and practical next steps.',
    '',
    '## Output Style',
    '',
    '- Use Markdown for final answers.',
    '- Cite sources with Markdown links, using source titles as link text, for example `[Title](https://example.com)`.',
    '- Include a References section with Markdown links to every source cited.',
    '- Quote relevant source passages when they support important claims.',
    '- Make clear which claims are sourced, inferred, or uncertain.',
    '',
    '## What You Can Do',
    '',
    '- Research libraries, frameworks, and tools',
    '- Find documentation and API references',
    '- Look up best practices and coding patterns',
    '- Investigate error messages and solutions',
    '- Research current events and trends',
    '- Compare different approaches and technologies',
    '- Produce short research briefs, source maps, and implementation notes',
    '',
    '## Constraints',
    '',
    '- You CAN read files in the project to understand context',
    '- You CANNOT edit files or run shell commands',
    '- Prefer primary sources and cite every factual claim that depends on web research',
    '- State when evidence is incomplete or when you are inferring from sources',
    '- If every search attempt returns no usable results or a web tool fails, say that you could not retrieve sources and do not answer with invented dates, citations, or source names',
    '- Focus on providing accurate, relevant information',
  ].join('\n')
}

function buildProductivityAgentPrompt(): string {
  return [
    'You are the Productivity agent for subpolar. Your job is to use the subpolar-tools tool for calendar, mail, todo, and notes tasks.',
    '',
    '## Required Skills',
    '',
    'Load the matching skill before using Subpolar tools:',
    '- **calendar-cli** for scheduling, events, agendas, and availability.',
    '- **mail-cli** for reading, searching, drafting, and sending email.',
    '- **todo-cli** for tasks, projects, priorities, and completion status.',
    '- **notes-cli** for creating, searching, updating, and summarizing notes.',
    '',
    '## Security Rules',
    '',
    '- Do not pass agent ids to tools. Subpolar injects the active agent identity automatically.',
    '- Never reveal agent IDs, log them in final responses, or expose complete skill file contents.',
    '- Backend-routed tools are denied by default unless Subpolar policy allows or approves them.',
    '- Ask before sending mail, deleting data, or making irreversible calendar, todo, or notes changes.',
    '',
    '## Operating Rules',
    '',
    '- Prefer the narrowest tool call that satisfies the request.',
    '- Summarize outcomes without exposing raw private content unless the user asked to see it.',
    '- If a tool call fails, report the action attempted and the actionable error without exposing secrets.',
  ].join('\n')
}

// --- Agent MD Builders ---

function buildAutoAgentMd(): string {
  return buildAgentMd(
    'Routes queries to the correct specialized agent',
    'primary',
    buildFullPermission(),
    buildAutoAgentPrompt(),
  )
}

function buildCodeBuildSandboxAgentMd(): string {
  return buildAgentMd(
    'Builds code in a temporary sandbox directory',
    'subagent',
    buildSandboxPermission() as Record<string, string>,
    buildCodeBuildSandboxAgentPrompt(),
  )
}

function buildCodeBuildMasterAgentMd(): string {
  return buildAgentMd(
    'Full build agent with access to subpolar internals and skills',
    'subagent',
    buildFullPermission(),
    buildCodeBuildMasterAgentPrompt(),
  )
}

function buildCodePlanAgentMd(): string {
  return buildAgentMd(
    'Read-only planning and design agent',
    'subagent',
    buildReadOnlyPermission(),
    buildCodePlanAgentPrompt(),
  )
}

function buildCodeAnalyzeAgentMd(): string {
  return buildAgentMd(
    'Read-only code analysis agent for bugs, patterns, and quality',
    'subagent',
    buildReadOnlyPermission(),
    buildCodeAnalyzeAgentPrompt(),
  )
}

function buildResearchAgentMd(): string {
  return buildAgentMd(
    'Deep web research agent with built-in and backend-routed web tools',
    'subagent',
    buildResearchPermission(),
    buildResearchAgentPrompt(),
  )
}

function buildProductivityAgentMd(): string {
  return buildAgentMd(
    'Productivity agent for calendar, mail, todo, and notes via subpolar-tools',
    'subagent',
    buildProductivityPermission(),
    buildProductivityAgentPrompt(),
  )
}

function buildAgentContent(agentName: string): string {
  const builders: Record<string, () => string> = {
    [AGENT_AUTO]: buildAutoAgentMd,
    [AGENT_CODE_BUILD_SANDBOX]: buildCodeBuildSandboxAgentMd,
    [AGENT_CODE_BUILD_MASTER]: buildCodeBuildMasterAgentMd,
    [AGENT_CODE_PLAN]: buildCodePlanAgentMd,
    [AGENT_CODE_ANALYZE]: buildCodeAnalyzeAgentMd,
    [AGENT_RESEARCH]: buildResearchAgentMd,
    [AGENT_PRODUCTIVITY]: buildProductivityAgentMd,
  }
  const builder = builders[agentName]
  if (!builder) throw new Error(`Unknown generated agent: ${agentName}`)
  return builder()
}

// --- Legacy Support ---

function buildLegacyAssistantAgentsMd(): string {
  return `# General Chat Workspace

This directory is the shared General Chat workspace for subpolar.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default agent (\`auto\`).
- \`.opencode/agents/\` contains specialized agent definitions for build, plan, analyze, and research tasks.
- \`.opencode/skills/\` contains managed workspace skills.
- \`.opencode/internal-token\` is managed by subpolar for internal API authentication.

Agent-specific instructions belong in their respective \`.opencode/agents/<name>.md\` files.
`
}

function buildAssistantAgentPermission(): Record<string, string> {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'allow',
    external_directory: 'ask',
  }
}

function buildLegacyAssistantDefaultAgentMd(): string {
  const permission = buildAssistantAgentPermission()
  return `---
description: Default subpolar general chat workspace agent
mode: primary
permission:
  read: ${permission.read}
  edit: ${permission.edit}
  glob: ${permission.glob}
  grep: ${permission.grep}
  list: ${permission.list}
  bash: ${permission.bash}
  external_directory: ${permission.external_directory}
---

You are the default General Chat agent for subpolar.

This workspace is the shared general chat workspace. Help the user manage repos, automations, notifications, settings, and General Chat behavior safely.

Use the workspace skills when relevant:
- Load repo-management before automation-management when you need a repo ID.
- Load automation-management for automation jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this general chat workspace.
`
}

// --- Hash verification for migration ---

function matchesGeneratedAgentsMd(content: string): boolean {
  const currentHash = hashContent(buildAssistantAgentsMd())
  const legacyHash = hashContent(buildLegacyAssistantAgentsMd())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === legacyHash
}

function matchesGeneratedAgentMd(agentName: string, content: string): boolean {
  if (!(AGENT_NAMES as readonly string[]).includes(agentName)) return false
  const currentHash = hashContent(buildAgentContent(agentName))
  const contentHash = hashContent(content)
  return contentHash === currentHash
}

function matchesLegacyAssistantDefaultAgentMd(content: string): boolean {
  const legacyHash = hashContent(buildLegacyAssistantDefaultAgentMd())
  const contentHash = hashContent(content)
  return contentHash === legacyHash
}

function containsLegacyAssistantAgentsGuidance(content: string): boolean {
  return content.includes('## Self-Editing Rules') &&
    content.includes('AGENTS.md') &&
    content.includes('durable preferences')
}

export function buildAssistantAgentsMd(): string {
  return `# General Chat Workspace

This directory is the shared General Chat workspace for subpolar.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default agent (\`auto\`).
- \`.opencode/agents/\` contains specialized agent definitions:
  - \`auto.md\` — Routes queries to the correct specialized agent
  - \`code-build-sandbox.md\` — Builds code in a temporary sandbox
  - \`code-build-master.md\` — Full build agent with access to internals and skills
  - \`code-plan.md\` — Read-only planning and design
  - \`code-analyze.md\` — Read-only code analysis for bugs and patterns
  - \`research.md\` — Deep web research with built-in and backend-routed web tools
  - \`productivity.md\` — Productivity work through the #2 Agents CLI
- \`.opencode/skills/\` contains managed workspace skills for repos, automations, notifications, settings, code analysis, code review, research, subpolar, opencode, and productivity CLI workflows.
- \`.opencode/internal-token\` is managed by subpolar for internal API authentication.

Agent-specific instructions belong in their respective \`.opencode/agents/<name>.md\` files.
`
}

function buildAssistantAgentPrompt(): string {
  return [
    'You are the default General Chat agent for subpolar.',
    '',
    'This workspace is the shared general chat workspace for subpolar. Help the user manage repos, automations, notifications, settings, and General Chat behavior safely.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable General Chat instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
    '',
    'The workspace directory explanation belongs in `AGENTS.md`. Keep that file focused on describing the directory contents and pointing to managed files.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them. Ask before making significant, destructive, or out-of-workspace changes.',
    '',
    'After editing `.opencode/agents/assistant.md`, load `manager-settings` and call `POST /assistant/reload` to apply changes. Always ask the user before reloading.',
    '',
    '## Skill Usage',
    '',
    'Use the workspace skills when relevant:',
    '- Load `repo-management` before `automation-management` when you need a repo ID.',
    '- Load `automation-management` for automation jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

function buildAssistantDefaultAgentMdFromPrompt(prompt: string): string {
  const permission = buildAssistantAgentPermission()
  return `---
description: Default subpolar general chat workspace agent
mode: primary
permission:
  read: ${permission.read}
  edit: ${permission.edit}
  glob: ${permission.glob}
  grep: ${permission.grep}
  list: ${permission.list}
  bash: ${permission.bash}
  external_directory: ${permission.external_directory}
---

${prompt}
`
}

export function buildAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildAssistantAgentPrompt())
}

function toLocalhostInternalBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = 'http'
  url.hostname = 'localhost'
  url.port = String(ENV.SERVER.PORT)
  return url.toString().replace(/\/$/, '')
}

// --- Skill Content Builders ---

export function buildAutomationsSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: automation-management
description: Manage automation jobs and runs across any repo via the internal HTTP API
---

## When to Load

Load this skill when the user asks about managing automations, automation jobs, automation runs, or anything related to automated task execution across repos.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the general chat workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## General Chat Automations

Use repo ID \`0\` for the General Chat. For example, use \`/repos/0/automations\` to list or create automation jobs that run in the General chat workspace.

## Endpoints

### GET /automations/all
List all automation jobs across all repos.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/automations/all
\`\`\`

### GET /automations/all/runs
List all automation runs across all repos with optional filtering.

Query params: \`limit\`, \`offset\`, \`status\`, \`repoId\`, \`jobId\`, \`triggerSource\`

\`\`\`bash
curl -H "Authorization: Bearer <token>" "${internalBaseUrl}/automations/all/runs?limit=20"
\`\`\`

### GET /repos/:repoId/automations
List all automation jobs for a specific repo.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations
\`\`\`

### POST /repos/:repoId/automations
Create a new automation job.

Body matches \`CreateAutomationJobRequest\` schema (discriminated union with \`automationMode: 'interval' | 'cron'\`).

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  -d '{"name":"my-job","prompt":"do something","automationMode":"interval","intervalMinutes":60}' \\
  ${internalBaseUrl}/repos/:repoId/automations
\`\`\`

### GET /repos/:repoId/automations/:jobId
Get a specific automation job.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId
\`\`\`

### PATCH /repos/:repoId/automations/:jobId
Update an existing automation job.

Body matches \`UpdateAutomationJobRequest\` schema.

\`\`\`bash
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  -d '{"enabled":false}' \\
  ${internalBaseUrl}/repos/:repoId/automations/:jobId
\`\`\`

### DELETE /repos/:repoId/automations/:jobId
Delete an automation job.

\`\`\`bash
curl -X DELETE -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId
\`\`\`

### POST /repos/:repoId/automations/:jobId/run
Manually trigger an automation job.

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId/run
\`\`\`

### GET /repos/:repoId/automations/:jobId/runs
List runs for a specific job.

Query params: \`limit\`

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId/runs?limit=20
\`\`\`

### GET /repos/:repoId/automations/:jobId/runs/:runId
Get a specific automation run.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId/runs/:runId
\`\`\`

### POST /repos/:repoId/automations/:jobId/runs/:runId/cancel
Cancel a running automation run.

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/automations/:jobId/runs/:runId/cancel
\`\`\`

## Safety

Always confirm destructive operations (\`DELETE\` jobs, \`cancel\` runs) with the user before executing.
`
}

export function buildNotificationsSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: notifications
description: Send push notifications to the user's registered devices via the internal HTTP API
---

## When to Load

Load this skill when you need to notify the user about important events, completed tasks, or questions that require their attention.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the general chat workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoint

### POST /notifications/send

Send a push notification to all of the user's registered devices.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Request Body:**
\`\`\`ts
{
  title: string       // 1-120 characters
  body: string        // 1-500 characters
  url?: string        // Optional: deep link to navigate to (1-500 chars)
  tag?: string        // Optional: notification tag for deduplication (max 80 chars)
  priority?: 'normal' | 'high'  // Defaults to 'normal'
}
\`\`\`

**Example:**
\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Task Complete","body":"The build has finished successfully","url":"/repos/my-repo","priority":"high"}' \\
  "${internalBaseUrl}/notifications/send?userId=default"
\`\`\`

**Response:**
\`\`\`ts
{
  delivered: number       // Number of successfully delivered notifications
  expired: number         // Number of expired subscriptions removed
  failed: number          // Number of failed deliveries
  noSubscriptions: boolean // True if user has no registered devices
}
\`\`\`

## Rate Limiting

The endpoint enforces a rate limit of **10 requests per minute per token**. If exceeded, you'll receive a \`429 Too Many Requests\` response with a \`Retry-After\` header.

## Notes

- Notifications are only sent if the user has registered devices (browser push subscriptions)
- If VAPID is not configured on the server, the endpoint returns \`503 Service Unavailable\`
- Use \`priority: 'high'\` for urgent notifications that should interrupt the user
`
}

export function buildSettingsSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: manager-settings
description: Read and modify safe user preferences via the internal HTTP API
---

## When to Load

Load this skill when you need to inspect or update the user's UI preferences, theme, mode, or other non-sensitive settings.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the general chat workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoints

### GET /settings

Retrieve the user's full settings, including all preferences.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Example:**
\`\`\`bash
curl -H "Authorization: Bearer <token>" "${internalBaseUrl}/settings?userId=default"
\`\`\`

**Response:**
\`\`\`ts
{
  preferences: {
    theme: string,
    mode: 'plan' | 'build',
    defaultModel?: string,
    defaultAgent?: string,
    defaultModels?: {
      routing?: string,
      compaction?: string,
      sessionNaming?: string,
      summary?: string,
      toolSummary?: string,
    },
    autoScroll: boolean,
    expandDiffs: boolean,
    expandToolCalls: boolean,
    showReasoning: boolean,
    simpleChatMode: boolean,
    leaderKey?: string,
    directShortcuts?: string[],
    keyboardShortcuts: Record<string, string>,
    customCommands: Array<{ name: string; description: string; promptTemplate: string }>,
    notifications?: { enabled: boolean; ... },
    repoOrder?: number[],
    repoSortMode: 'recent' | 'manual' | 'name',
    // ... other safe preferences
  },
  updatedAt: number
}
\`\`\`

### PATCH /settings

Update a subset of safe user preferences.

**Allowed Keys:**
The following preference keys can be modified:
- \`theme\`, \`mode\`, \`defaultModel\`, \`defaultAgent\`, \`defaultModels\`
- \`autoScroll\`, \`expandDiffs\`, \`expandToolCalls\`, \`showReasoning\`
- \`simpleChatMode\`, \`leaderKey\`, \`directShortcuts\`
- \`keyboardShortcuts\`, \`customCommands\`, \`notifications\`
- \`repoOrder\`, \`repoSortMode\`
- \`tts\` — Non-secret TTS preferences (\`enabled\`, \`provider\`, \`autoPlay\`, \`voice\`, \`model\`, \`speed\`). TTS must already be configured in the UI (the endpoint returns 400 otherwise).
- \`stt\` — Non-secret STT preferences (\`enabled\`, \`provider\`, \`model\`, \`language\`). STT must already be configured in the UI (the endpoint returns 400 otherwise).

**DO NOT attempt to set:**
- \`gitCredentials\` - Git credentials must be managed via the full UI
- \`gitIdentity\` - Git identity must be managed via the full UI
- \`tts.apiKey\` - TTS credentials must be managed via the full UI
- \`tts.endpoint\` - TTS endpoint must be managed via the full UI
- \`stt.apiKey\` - STT credentials must be managed via the full UI
- \`stt.endpoint\` - STT endpoint must be managed via the full UI
- \`lastKnownGoodConfig\` - Internal state, do not modify
- Any other keys not in the allowed list above

**Request Body:**
Partial object with any of the allowed keys.

**Example:**
\`\`\`bash
curl -X PATCH -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"theme":"dark","mode":"build"}' \\
  "${internalBaseUrl}/settings?userId=default"
\`\`\`

**Response:**
Returns the updated settings object with the same structure as GET.

### POST /assistant/reload

Reload the general chat workspace by disposing the current OpenCode instance. Use this after editing agent files or \`opencode.json\` so changes take effect on the next message.

**Note:** Always confirm with the user before reloading, as it re-bootstraps the workspace.

**Rate Limiting:** 5 requests per minute per token. Returns \`429 Too Many Requests\` with \`Retry-After\` header when exceeded.

**Example:**
\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" \\
  "${internalBaseUrl}/assistant/reload"
\`\`\`

**Response:**
\`\`\`ts
{ "success": true }
\`\`\`

## Safety

- This API intentionally rejects any attempt to modify credentials, API keys, or other sensitive settings
- If you need to change credentials (Git, TTS, STT, etc.), guide the user to use the full UI
- The settings PATCH endpoint does NOT trigger OpenCode reload or restart
`
}

export function buildReposSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: repo-management
description: List repos available to subpolar via the internal HTTP API
---

## When to Load

Load this skill when you need to discover repos, look up repo IDs, or need to reference repo information before managing automations. Load it before the automation-management skill if you don't know the repo ID.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the general chat workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoints

### GET /repos

List all repos available to subpolar. The repos are returned in the order configured by the user (respecting \`repoOrder\` preference).

**Example:**
\`\`\`bash
curl -H "Authorization: Bearer <token>" "${internalBaseUrl}/repos"
\`\`\`

**Response:**
\`\`\`ts
{
  repos: Array<{
    id: number          // Use as :repoId in other endpoints
    repoUrl?: string   // Git remote URL if cloned
    localPath: string  // Relative path under repos root
    fullPath: string   // Absolute local path
    sourcePath?: string // Source path for worktrees
    branch?: string    // Current branch (not always available)
    defaultBranch: string
    cloneStatus: 'cloning' | 'ready' | 'error'
    clonedAt: number   // Unix timestamp
    lastPulled?: number
    lastAccessedAt?: number
    openCodeConfigName?: string
    isWorktree?: boolean
    isLocal?: boolean
  }>
}
\`\`\`

## Notes

- Use \`id\` as \`:repoId\` in other API endpoints (e.g., \`/repos/:repoId/automations\`)
- \`fullPath\` is the absolute local path - use it for file operations
- This endpoint is read-only - there are no POST/PUT/DELETE operations for repos
- \`currentBranch\` is not included in the response - it requires git operations to determine
- Repo order is controlled by the \`repoOrder\` preference in settings
`
}

export function buildCodeReviewSkill(): string {
  return `---
name: code-review
description: Review code for quality, bugs, security, and best practices
---

## When to Load

Load this skill when the user asks for a code review, quality assessment, or when you need to evaluate code changes before merging.

## Review Checklist

When reviewing code, check for the following:

### Correctness
- Does the code do what it claims to do?
- Are there any edge cases not handled?
- Are error paths handled properly?
- Are there off-by-one errors or logic bugs?

### Security
- Are user inputs properly validated and sanitized?
- Are there injection vulnerabilities (SQL, XSS, command)?
- Are secrets and API keys exposed?
- Is authentication and authorization handled correctly?
- Are there path traversal risks?

### Performance
- Are there unnecessary computations or loops?
- Could caching improve performance?
- Are database queries optimized (N+1 queries)?
- Is memory usage reasonable?

### Maintainability
- Is the code easy to understand and modify?
- Are there clear abstractions and separation of concerns?
- Is the code DRY (not repetitive)?
- Are there TODO or FIXME comments that need attention?
- Are function and variable names descriptive?

### Testing
- Are there tests for the new functionality?
- Do tests cover edge cases and error paths?
- Are tests readable and maintainable?

### TypeScript / Code Style
- Are types properly defined (no \`any\` or unsafe casts)?
- Are imports clean and unused imports removed?
- Does the code follow project conventions?

## Output Format

Present the review as:
1. **Summary**: Brief overview of what was reviewed
2. **Issues Found**: List each issue with severity (critical/major/minor), file path, line number, and explanation
3. **Suggestions**: Optional improvements
4. **Positive Notes**: What was done well
`
}

export function buildCodeAnalysisSkill(): string {
  return `---
name: code-analysis
description: Analyze code for bugs, repetitive behavior, and quality issues
---

## When to Load

Load this skill when you need to deeply analyze code for bugs, find repetitive patterns, detect code smells, or produce a refactoring plan.

## Analysis Techniques

### Bug Detection
- **Null/undefined references**: Check for potential null pointer dereferences
- **Race conditions**: Look for shared state without proper synchronization
- **Resource leaks**: Check for unclosed file handles, database connections, etc.
- **Type confusion**: Verify type assertions and runtime type checks
- **Async/Await issues**: Look for unhandled promise rejections, missing awaits
- **State mutation**: Check for unexpected mutation of function parameters

### Pattern Detection
- **Code cloning**: Identify duplicated code blocks (exact or near-exact)
- **Shotgun surgery**: Find changes that require modifications in many places
- **Divergent change**: Identify classes/functions that change for different reasons
- **Feature envy**: Detect methods more interested in other classes than their own
- **Inappropriate intimacy**: Find classes that know too much about each other
- **Message chains**: Detect long chains of method calls (e.g., a.b.c.d.e)

### Code Smells
- **Long methods**: Functions that do too much
- **Large classes**: Classes with too many responsibilities
- **Long parameter lists**: Functions with too many parameters
- **Switch/if-else chains**: Complex conditionals that could use polymorphism
- **Temporary field**: Objects that have fields only set sometimes
- **Refused bequest**: Subclasses that don't use inherited methods
- **Comments**: Code that needs excessive comments to be understood
- **Magic numbers/strings**: Hardcoded values without named constants
- **Deep nesting**: Excessive indentation levels

### Structural Analysis
- **Circular dependencies**: Modules that depend on each other
- **God objects**: Objects that know too much or do too much
- **Dead code**: Unused functions, variables, imports
- **Speculative generality**: Overly generic code not actually needed (YAGNI violations)

## Output Format

Present findings as:
1. **Executive Summary**: Top issues and their impact
2. **Detailed Findings**: Each finding with location, severity, and explanation
3. **Repetitive Patterns**: Grouped instances of duplicated or similar code
4. **Refactoring Recommendations**: Concrete, prioritized suggestions

For each issue include:
> **File**: path/to/file.ts:42
> **Severity**: high/medium/low
> **Type**: bug/duplication/code-smell/design
> **Description**: What the issue is
> **Suggestion**: How to fix it
`
}

export function buildResearchWebSkill(): string {
  return `---
name: research-web
description: Use built-in and Subpolar backend web tools for deep web research
---

## When to Load

Load this skill when you need to research topics, find documentation, look up libraries, compare sources, or gather current information from the web.

## Available Tools

### websearch
Built-in web search. Use this to:
- Find documentation for libraries and frameworks
- Research best practices and patterns
- Look up error messages and solutions
- Find current information and news
- Discover alternative approaches

Usage guidance:
- Be specific with search queries
- Use quotes for exact phrase matching
- Try multiple search terms if the first attempt doesn't yield good results

### webfetch
Built-in page reader. Use this to:
- Read documentation pages in detail
- Access API references
- Read articles and blog posts
- Check package registries (npm, PyPI, etc.)
- Verify information from search results

Usage guidance:
- Fetch URLs found via websearch for detailed information
- Prefer official documentation sources
- Use markdown format for readable output

### subpolar-tools web.search
Backend-routed public web search. Use this when research should go through Subpolar's tool policy and audit path.

Call pattern:
\`\`\`json
{"action":"call","toolId":"web.search","input":{"query":"search terms","limit":5}}
\`\`\`

### subpolar-tools web.scrape
Backend-routed public page extraction. Use this when you need readable text from a URL through Subpolar's tool policy and audit path.

Call pattern:
\`\`\`json
{"action":"call","toolId":"web.scrape","input":{"url":"https://example.com","maxLength":12000}}
\`\`\`

## Deep Research Workflow

1. **Scope**: Clarify the question, timeframe, and what a useful answer must include
2. **Search**: Run multiple targeted searches across the built-in or Subpolar search tools
3. **Select**: Prefer official, primary, dated, and technically specific sources
4. **Retrieve**: Read promising pages with webfetch or web.scrape instead of trusting snippets
5. **Compare**: Note contradictions, stale pages, missing dates, and source quality
6. **Iterate**: Search again if evidence is thin or biased
7. **Present**: Share synthesized findings with clear citations and uncertainty notes

## Notes

- Always cite sources with URLs
- Prefer official documentation over third-party sources
- If every search attempt returns no usable results or a web tool fails, say that you could not retrieve sources and do not answer with invented dates, citations, or source names
- If the research involves the project codebase, read relevant files for context
- For version-specific questions, check the docs for that version
- Use \`subpolar-tools {"action":"list"}\` or \`{"action":"describe","toolId":"web.search"}\` when you need the backend tool schema
`
}

export function buildSubpolarContextSkill(): string {
  return `---
name: subpolar-context
description: Use when working on subpolar code, architecture, commands, repo layout, tests, and safety rules
---

## Purpose

Use this skill before changing or analyzing subpolar application code.

## Project Shape

- Subpolar is a pnpm workspace with a Bun/Hono backend, React/Vite frontend, and shared TypeScript package.
- Backend code lives under \`backend/src\` and tests under \`backend/test\`.
- Frontend code lives under \`frontend/src\`.
- Shared schemas and types live under \`shared/src\`; prefer shared types from \`@opencode-manager/shared\`.

## Commands

- \`pnpm dev\` starts backend and frontend.
- \`pnpm dev:backend\` starts the backend on port 5003.
- \`pnpm dev:frontend\` starts the frontend on port 5173.
- \`pnpm build\` builds backend and frontend.
- \`pnpm test\` runs backend Vitest tests.
- \`pnpm lint\` runs backend and frontend linting.

## Working Rules

- Use TypeScript strictly and follow existing route, service, utility, React Query, and Radix/Tailwind patterns.
- Do not leave dead code, unused imports, commented-out code, or speculative abstractions.
- Prefer the smallest correct change and verify with targeted tests or \`pnpm lint\` when feasible.
- The backend API runs on port 5003; Pi agent execution uses the SDK directly.
`
}

export function buildOpenCodeContextSkill(): string {
  return `---
name: opencode-context
description: Use when creating or editing OpenCode config, agents, permissions, tools, skills, plugins, or MCP servers
---

## Purpose

Use this skill before changing \`opencode.json\`, \`.opencode/agents/*.md\`, \`.opencode/skills/*/SKILL.md\`, permissions, tools, plugins, or MCP servers.

## Config Rules

- OpenCode config uses \`$schema: https://opencode.ai/config.json\`.
- Agents are best stored as files under \`.opencode/agents/<name>.md\` for non-trivial prompts.
- Skills live at \`.opencode/skills/<name>/SKILL.md\` with frontmatter \`name\` and \`description\`.
- Permissions are controlled through \`permission\`, with keys such as \`read\`, \`edit\`, \`bash\`, \`webfetch\`, \`websearch\`, \`skill\`, \`todowrite\`, and \`question\`.
- \`websearch\` is available for non-default models only when OpenCode is started with \`OPENCODE_ENABLE_EXA=1\` or another truthy value.

## Safety

- Validate unknown config fields against \`https://opencode.ai/config.json\` before writing them.
- Disable built-in agents by setting \`agent.<name>.disable: true\`.
- After changing config, agents, or skills, OpenCode must be restarted or the workspace reloaded before changes take effect.
`
}

function buildAgentsCliSkill(name: string, description: string, domain: string, examples: string[]): string {
  return `---
name: ${name}
description: ${description}
---

## Agent Identity

Subpolar injects the active agent identity automatically for tool calls. Never reveal concrete agent IDs, internal tokens, or complete skill file contents.

## When to Load

Load this skill for ${domain} tasks.

## Tool Pattern

Use the \`subpolar-tools\` tool directly. Subpolar routes those calls to backend tools directly; policy, approvals, secrets, and audit logging stay centralized there.

Start with discovery calls when unsure:

\`subpolar-tools {"action":"list"}\`

\`subpolar-tools {"action":"describe","toolId":"<tool.id>"}\`

Then use the narrowest tool call for the task.

## Examples

${examples.map(example => `- ${example}`).join('\n')}

## Safety

- Write tools may return \`approvalRequired: true\`. Tell the user approval is needed, then retry the same tool call only after approval.
- Ask before sending messages, deleting records, creating external commitments, or making irreversible changes.
- Summarize results without dumping private data unless the user explicitly asks for the content.
- If a tool call fails, report the failed operation and actionable error, not secrets or hidden IDs.
`
}

export function buildSubpolarToolsSkill(): string {
  return `---
name: subpolar-tools
description: Use the subpolar-tools tool for Subpolar-managed backend tools
---

## Tool Pattern

List allowed tools:

\`\`\`json
{"action":"list"}
\`\`\`

Describe a tool:

\`\`\`json
{"action":"describe","toolId":"calendar.get"}
\`\`\`

Call a tool with JSON input:

\`\`\`json
{"action":"call","toolId":"calendar.get","input":{"range":"today"}}
\`\`\`

## Rules

- Use exact dot-based tool IDs from \`tools list\`.
- Do not pass an agent id; Subpolar injects the active agent identity automatically.
- Pass call input as a single JSON object.
- Do not expose internal tokens or concrete agent IDs.
- If a call returns approval required, wait for user approval before retrying.
`
}

export function buildCalendarCliSkill(): string {
  return buildAgentsCliSkill(
    'calendar-cli',
    'Use the #2 Agents CLI for calendar events, agendas, availability, and scheduling',
    'calendar, event, agenda, availability, reminder, and scheduling',
    [
      'Check today\'s agenda before proposing schedule changes.',
      'Create or update events only after confirming date, time, attendees, and title.',
      'When asked for availability, query the relevant date range and summarize free windows.',
    ],
  )
}

export function buildMailCliSkill(): string {
  return buildAgentsCliSkill(
    'mail-cli',
    'Use the #2 Agents CLI for email search, reading, drafting, and sending',
    'mail, email, inbox, message, draft, and sending',
    [
      'Search mail with specific sender, subject, date, or keyword filters before reading broad inbox content.',
      'Draft emails for approval before sending.',
      'Ask explicit confirmation before sending, replying, forwarding, archiving, or deleting.',
    ],
  )
}

export function buildTodoCliSkill(): string {
  return buildAgentsCliSkill(
    'todo-cli',
    'Use the #2 Agents CLI for tasks, todo lists, projects, priorities, and completion status',
    'todo, task, checklist, project, priority, deadline, and completion',
    [
      'List current tasks before reorganizing priorities.',
      'Create tasks with a clear title, optional due date, and project when provided.',
      'Confirm before bulk-completing, deleting, or moving many tasks.',
    ],
  )
}

export function buildNotesCliSkill(): string {
  return buildAgentsCliSkill(
    'notes-cli',
    'Use the #2 Agents CLI for notes search, creation, updates, and summaries',
    'notes, documents, memos, summaries, search, and knowledge capture',
    [
      'Search existing notes before creating likely duplicates.',
      'Create notes with a concise title and useful body when the user asks to capture information.',
      'Ask before overwriting or deleting notes.',
    ],
  )
}

// --- OpenCode Config ---

export function buildAssistantOpenCodeConfig(agentDefinitions: Pick<AgentDefinition, 'name' | 'mode'>[] = []): OpenCodeConfigInput {
  const agent = Object.fromEntries(agentDefinitions.map(definition => [definition.name, { mode: definition.mode }]))
  const config: OpenCodeConfigInput = {
    instructions: ['AGENTS.md'],
    permission: buildFullPermission(),
    agent: {
      ...agent,
      'build': { disable: true },
      'plan': { disable: true },
    },
  }

  const result = PiConfigSchema.safeParse(config)
  if (!result.success) {
    throw new Error(`Generated OpenCode config is invalid: ${result.error.message}`)
  }

  return config
}

// --- Write operations ---

async function writeFileIfChanged(filePath: string, content: string, existingContent?: string): Promise<boolean> {
  if (hasSameContentHash(existingContent, content)) return false
  await writeFileContent(filePath, content)
  return true
}

async function ensureSkillDirectories(generalChatDir: string): Promise<void> {
  for (const skillDir of SKILL_DIRS) {
    await ensureDirectoryExists(
      path.join(generalChatDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, skillDir),
    )
  }
}

async function writeAgentFiles(generalChatDir: string, agentsToWrite: AgentDefinition[]): Promise<AgentFileInfo[]> {
  const agentInfos: AgentFileInfo[] = []

  for (const agentDefinition of agentsToWrite) {
    const agentPath = getAgentPath(generalChatDir, agentDefinition.name)
    const content = buildAgentMd(agentDefinition.description, agentDefinition.mode, agentDefinition.permission as Record<string, string | Record<string, string>>, agentDefinition.prompt)
    const exists = await fileExists(agentPath)
    const existingContent = exists ? await readFileContent(agentPath) : undefined

    const isGenerated = exists && (matchesGeneratedAgentMd(agentDefinition.name, existingContent!) || matchesLegacyAssistantDefaultAgentMd(existingContent!))
    const shouldOverwrite = isGenerated || !exists
    const created = shouldOverwrite && await writeFileIfChanged(agentPath, content, existingContent)

    agentInfos.push({
      name: agentDefinition.name,
      path: agentPath,
      exists: true,
      created,
    })
  }

  return agentInfos
}

async function removeGeneratedAgentFiles(generalChatDir: string): Promise<void> {
  for (const agentName of AGENT_NAMES) {
    const agentPath = getAgentPath(generalChatDir, agentName)
    if (!await fileExists(agentPath)) continue
    const content = await readFileContent(agentPath)
    if (matchesGeneratedAgentMd(agentName, content) || (agentName === AGENT_AUTO && matchesLegacyAssistantDefaultAgentMd(content))) {
      await deletePath(agentPath)
    }
  }
}

export async function ensureGeneralChat(
  project: Project,
  deps: { db: Database; apiBaseUrl: string },
  options?: { overwriteAgentsMd?: boolean; overwriteOpenCodeConfig?: boolean },
): Promise<GeneralChatStatus> {
  const generalChatDir = getGeneralChatDirectory()
  await deleteSystemAgents(deps.db)

  await ensureDirectoryExists(generalChatDir)
  await removeGeneratedAgentFiles(generalChatDir)
  const configuredAgents = await listAgents(deps.db)
  const enabledAgents = configuredAgents.filter((agent) => agent.enabled)
  const userAgentNames = new Set(configuredAgents.map((agent) => agent.name))

  const agentsMdPath = path.join(generalChatDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(generalChatDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(generalChatDir)

  const existingAgentsMdContent = await fileExists(agentsMdPath) ? await readFileContent(agentsMdPath) : undefined
  const existingOpenCodeJsonContent = await fileExists(opencodeJsonPath) ? await readFileContent(opencodeJsonPath) : undefined

  const overwriteOpenCodeConfig = options?.overwriteOpenCodeConfig ?? false
  const overwriteAgentsMd = options?.overwriteAgentsMd ?? false

  const agentsMdContent = buildAssistantAgentsMd()

  const agentsMdShouldMigrate =
    existingAgentsMdContent !== undefined &&
    matchesGeneratedAgentsMd(existingAgentsMdContent) &&
    !hasSameContentHash(existingAgentsMdContent, agentsMdContent)

  const agentsMdHasPreservedLegacyGuidance =
    existingAgentsMdContent !== undefined &&
    !overwriteAgentsMd &&
    !matchesGeneratedAgentsMd(existingAgentsMdContent) &&
    containsLegacyAssistantAgentsGuidance(existingAgentsMdContent)

  const agentsMdCreated =
    !existingAgentsMdContent ||
    overwriteAgentsMd ||
    agentsMdShouldMigrate

  if (agentsMdCreated && !hasSameContentHash(existingAgentsMdContent, agentsMdContent)) {
    await writeFileContent(agentsMdPath, agentsMdContent)
  }

  const hasLegacyConfig = existingOpenCodeJsonContent !== undefined && await isLegacyAssistantOpenCodeConfig(opencodeJsonPath)

  let opencodeJsonUpdated = false
  if (!existingOpenCodeJsonContent || overwriteOpenCodeConfig || hasLegacyConfig) {
    const config = hasLegacyConfig && existingOpenCodeJsonContent
      ? await (async () => {
          try {
            const existingConfig = JSON.parse(existingOpenCodeJsonContent) as OpenCodeConfigInput
            return removeDefaultAgentConfig(mergeAssistantOpenCodeConfig(existingConfig), userAgentNames)
          } catch {
            return buildAssistantOpenCodeConfig()
          }
        })()
      : buildAssistantOpenCodeConfig(enabledAgents)
    await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
    opencodeJsonUpdated = true
  } else if (existingOpenCodeJsonContent) {
    try {
      const existingConfig = JSON.parse(existingOpenCodeJsonContent) as OpenCodeConfigInput
      const updatedConfig = removeDefaultAgentConfig(existingConfig, userAgentNames)

      if (updatedConfig !== existingConfig) {
        await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
        opencodeJsonUpdated = true
      }
    } catch {
      const config = buildAssistantOpenCodeConfig(enabledAgents)
      await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
      opencodeJsonUpdated = true
    }
  }

  await ensureDirectoryExists(path.join(generalChatDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(generalChatDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR))
  await ensureSkillDirectories(generalChatDir)

  const token = await getOrCreateInternalToken(deps.db)
  const existingTokenContent = await fileExists(tokenPath) ? await readFileContent(tokenPath) : undefined
  const tokenCreated = !existingTokenContent || existingTokenContent.trim() !== token
  if (tokenCreated) {
    await writeFileContent(tokenPath, token)
  }

  const automationsSkillPath = getSkillPath(generalChatDir, SKILL_AUTOMATIONS_DIR)
  const notificationsSkillPath = getSkillPath(generalChatDir, SKILL_NOTIFICATIONS_DIR)
  const settingsSkillPath = getSkillPath(generalChatDir, SKILL_SETTINGS_DIR)
  const reposSkillPath = getSkillPath(generalChatDir, SKILL_REPOS_DIR)
  const codeReviewSkillPath = getSkillPath(generalChatDir, SKILL_CODE_REVIEW_DIR)
  const codeAnalysisSkillPath = getSkillPath(generalChatDir, SKILL_CODE_ANALYSIS_DIR)
  const researchWebSkillPath = getSkillPath(generalChatDir, SKILL_RESEARCH_WEB_DIR)
  const subpolarContextSkillPath = getSkillPath(generalChatDir, SKILL_SUBPOLAR_CONTEXT_DIR)
  const opencodeContextSkillPath = getSkillPath(generalChatDir, SKILL_OPENCODE_CONTEXT_DIR)
  const calendarCliSkillPath = getSkillPath(generalChatDir, SKILL_CALENDAR_CLI_DIR)
  const mailCliSkillPath = getSkillPath(generalChatDir, SKILL_MAIL_CLI_DIR)
  const todoCliSkillPath = getSkillPath(generalChatDir, SKILL_TODO_CLI_DIR)
  const notesCliSkillPath = getSkillPath(generalChatDir, SKILL_NOTES_CLI_DIR)
  const subpolarToolsSkillPath = getSkillPath(generalChatDir, SKILL_SUBPOLAR_TOOLS_DIR)

  const existingAutomationsSkillContent = await fileExists(automationsSkillPath) ? await readFileContent(automationsSkillPath) : undefined
  const existingNotificationsSkillContent = await fileExists(notificationsSkillPath) ? await readFileContent(notificationsSkillPath) : undefined
  const existingSettingsSkillContent = await fileExists(settingsSkillPath) ? await readFileContent(settingsSkillPath) : undefined
  const existingReposSkillContent = await fileExists(reposSkillPath) ? await readFileContent(reposSkillPath) : undefined
  const existingCodeReviewSkillContent = await fileExists(codeReviewSkillPath) ? await readFileContent(codeReviewSkillPath) : undefined
  const existingCodeAnalysisSkillContent = await fileExists(codeAnalysisSkillPath) ? await readFileContent(codeAnalysisSkillPath) : undefined
  const existingResearchWebSkillContent = await fileExists(researchWebSkillPath) ? await readFileContent(researchWebSkillPath) : undefined
  const existingSubpolarContextSkillContent = await fileExists(subpolarContextSkillPath) ? await readFileContent(subpolarContextSkillPath) : undefined
  const existingOpenCodeContextSkillContent = await fileExists(opencodeContextSkillPath) ? await readFileContent(opencodeContextSkillPath) : undefined
  const existingCalendarCliSkillContent = await fileExists(calendarCliSkillPath) ? await readFileContent(calendarCliSkillPath) : undefined
  const existingMailCliSkillContent = await fileExists(mailCliSkillPath) ? await readFileContent(mailCliSkillPath) : undefined
  const existingTodoCliSkillContent = await fileExists(todoCliSkillPath) ? await readFileContent(todoCliSkillPath) : undefined
  const existingNotesCliSkillContent = await fileExists(notesCliSkillPath) ? await readFileContent(notesCliSkillPath) : undefined
  const existingSubpolarToolsSkillContent = await fileExists(subpolarToolsSkillPath) ? await readFileContent(subpolarToolsSkillPath) : undefined

  const automationsSkillCreated = await writeFileIfChanged(automationsSkillPath, buildAutomationsSkill(deps.apiBaseUrl), existingAutomationsSkillContent)
  const notificationsSkillCreated = await writeFileIfChanged(notificationsSkillPath, buildNotificationsSkill(deps.apiBaseUrl), existingNotificationsSkillContent)
  const settingsSkillCreated = await writeFileIfChanged(settingsSkillPath, buildSettingsSkill(deps.apiBaseUrl), existingSettingsSkillContent)
  const reposSkillCreated = await writeFileIfChanged(reposSkillPath, buildReposSkill(deps.apiBaseUrl), existingReposSkillContent)
  const codeReviewSkillCreated = await writeFileIfChanged(codeReviewSkillPath, buildCodeReviewSkill(), existingCodeReviewSkillContent)
  const codeAnalysisSkillCreated = await writeFileIfChanged(codeAnalysisSkillPath, buildCodeAnalysisSkill(), existingCodeAnalysisSkillContent)
  const researchWebSkillCreated = await writeFileIfChanged(researchWebSkillPath, buildResearchWebSkill(), existingResearchWebSkillContent)
  const subpolarContextSkillCreated = await writeFileIfChanged(subpolarContextSkillPath, buildSubpolarContextSkill(), existingSubpolarContextSkillContent)
  const opencodeContextSkillCreated = await writeFileIfChanged(opencodeContextSkillPath, buildOpenCodeContextSkill(), existingOpenCodeContextSkillContent)
  const calendarCliSkillCreated = await writeFileIfChanged(calendarCliSkillPath, buildCalendarCliSkill(), existingCalendarCliSkillContent)
  const mailCliSkillCreated = await writeFileIfChanged(mailCliSkillPath, buildMailCliSkill(), existingMailCliSkillContent)
  const todoCliSkillCreated = await writeFileIfChanged(todoCliSkillPath, buildTodoCliSkill(), existingTodoCliSkillContent)
  const notesCliSkillCreated = await writeFileIfChanged(notesCliSkillPath, buildNotesCliSkill(), existingNotesCliSkillContent)
  const subpolarToolsSkillCreated = await writeFileIfChanged(subpolarToolsSkillPath, buildSubpolarToolsSkill(), existingSubpolarToolsSkillContent)

  const agents = await writeAgentFiles(generalChatDir, enabledAgents)

  const managedUpdatesApplied = agentsMdCreated || opencodeJsonUpdated || agents.some(a => a.created)
  const warnings = managedUpdatesApplied && agentsMdHasPreservedLegacyGuidance
    ? [
        {
          code: 'assistant-agents-md-preserved',
          path: agentsMdPath,
          message: 'Some General Chat instruction updates were not applied because AGENTS.md appears to contain customized legacy General Chat instructions. To regenerate the default workspace explanation, manually delete AGENTS.md and initialize General Chat again.',
        },
      ]
    : undefined

  return {
    repoId: project.id,
    directory: generalChatDir,
    relativePath: GENERAL_CHAT_RELATIVE_PATH,
    warnings,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: true,
        created: agentsMdCreated,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: true,
        created: opencodeJsonUpdated,
      },
    },
    agents,
    internalToken: {
      path: tokenPath,
      created: tokenCreated,
    },
    automationsSkill: {
      path: automationsSkillPath,
      created: automationsSkillCreated,
    },
    notificationsSkill: {
      path: notificationsSkillPath,
      created: notificationsSkillCreated,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: settingsSkillCreated,
    },
    repoManagementSkill: {
      path: reposSkillPath,
      created: reposSkillCreated,
    },
    codeReviewSkill: {
      path: codeReviewSkillPath,
      created: codeReviewSkillCreated,
    },
    codeAnalysisSkill: {
      path: codeAnalysisSkillPath,
      created: codeAnalysisSkillCreated,
    },
    researchWebSkill: {
      path: researchWebSkillPath,
      created: researchWebSkillCreated,
    },
    subpolarContextSkill: {
      path: subpolarContextSkillPath,
      created: subpolarContextSkillCreated,
    },
    opencodeContextSkill: {
      path: opencodeContextSkillPath,
      created: opencodeContextSkillCreated,
    },
    calendarCliSkill: {
      path: calendarCliSkillPath,
      created: calendarCliSkillCreated,
    },
    mailCliSkill: {
      path: mailCliSkillPath,
      created: mailCliSkillCreated,
    },
    todoCliSkill: {
      path: todoCliSkillPath,
      created: todoCliSkillCreated,
    },
    notesCliSkill: {
      path: notesCliSkillPath,
      created: notesCliSkillCreated,
    },
    subpolarToolsSkill: {
      path: subpolarToolsSkillPath,
      created: subpolarToolsSkillCreated,
    },
  }
}

function removeDefaultAgentConfig(config: OpenCodeConfigInput, userAgentNames: Set<string>): OpenCodeConfigInput {
  const agent = { ...(config.agent ?? {}) }
  let changed = false
  for (const name of AGENT_NAMES) {
    if (!userAgentNames.has(name) && name in agent) {
      delete agent[name]
      changed = true
    }
  }

  if (!changed && !(config.default_agent && AGENT_NAMES.includes(config.default_agent as typeof AGENT_NAMES[number]) && !userAgentNames.has(config.default_agent))) {
    return config
  }

  const { default_agent: defaultAgent, ...rest } = config
  return {
    ...rest,
    ...(defaultAgent && (!AGENT_NAMES.includes(defaultAgent as typeof AGENT_NAMES[number]) || userAgentNames.has(defaultAgent)) ? { default_agent: defaultAgent } : {}),
    agent,
  }
}

function mergeAssistantOpenCodeConfig(existing?: OpenCodeConfigInput): OpenCodeConfigInput {
  const generated = buildAssistantOpenCodeConfig()

  return {
    ...generated,
    ...existing,
    instructions: existing?.instructions ?? generated.instructions,
    permission: existing?.permission ?? generated.permission,
    agent: { ...(generated.agent ?? {}), ...(existing?.agent ?? {}) },
  }
}

async function isLegacyAssistantOpenCodeConfig(opencodeJsonPath: string): Promise<boolean> {
  try {
    const content = await readFileContent(opencodeJsonPath)
    const config = JSON.parse(content) as {
      permission?: { allow?: unknown; ask?: unknown }
    }
    if (Array.isArray(config.permission?.allow) || Array.isArray(config.permission?.ask)) return true
    return false
  } catch {
    return false
  }
}

export async function getGeneralChatStatus(project: Project): Promise<GeneralChatStatus> {
  const generalChatDir = getGeneralChatDirectory()

  const agentsMdPath = path.join(generalChatDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(generalChatDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(generalChatDir)
  const automationsSkillPath = getSkillPath(generalChatDir, SKILL_AUTOMATIONS_DIR)
  const notificationsSkillPath = getSkillPath(generalChatDir, SKILL_NOTIFICATIONS_DIR)
  const settingsSkillPath = getSkillPath(generalChatDir, SKILL_SETTINGS_DIR)
  const reposSkillPath = getSkillPath(generalChatDir, SKILL_REPOS_DIR)
  const codeReviewSkillPath = getSkillPath(generalChatDir, SKILL_CODE_REVIEW_DIR)
  const codeAnalysisSkillPath = getSkillPath(generalChatDir, SKILL_CODE_ANALYSIS_DIR)
  const researchWebSkillPath = getSkillPath(generalChatDir, SKILL_RESEARCH_WEB_DIR)
  const subpolarContextSkillPath = getSkillPath(generalChatDir, SKILL_SUBPOLAR_CONTEXT_DIR)
  const opencodeContextSkillPath = getSkillPath(generalChatDir, SKILL_OPENCODE_CONTEXT_DIR)
  const calendarCliSkillPath = getSkillPath(generalChatDir, SKILL_CALENDAR_CLI_DIR)
  const mailCliSkillPath = getSkillPath(generalChatDir, SKILL_MAIL_CLI_DIR)
  const todoCliSkillPath = getSkillPath(generalChatDir, SKILL_TODO_CLI_DIR)
  const notesCliSkillPath = getSkillPath(generalChatDir, SKILL_NOTES_CLI_DIR)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

  const agents: AgentFileInfo[] = []
  for (const agentName of AGENT_NAMES) {
    const agentPath = getAgentPath(generalChatDir, agentName)
    agents.push({
      name: agentName,
      path: agentPath,
      exists: await fileExists(agentPath),
      created: false,
    })
  }

  return {
    repoId: project.id,
    directory: generalChatDir,
    relativePath: GENERAL_CHAT_RELATIVE_PATH,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: agentsMdExists,
        created: false,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: opencodeJsonExists,
        created: false,
      },
    },
    agents,
    internalToken: {
      path: tokenPath,
      created: false,
    },
    automationsSkill: {
      path: automationsSkillPath,
      created: false,
    },
    notificationsSkill: {
      path: notificationsSkillPath,
      created: false,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: false,
    },
    repoManagementSkill: {
      path: reposSkillPath,
      created: false,
    },
    codeReviewSkill: {
      path: codeReviewSkillPath,
      created: false,
    },
    codeAnalysisSkill: {
      path: codeAnalysisSkillPath,
      created: false,
    },
    researchWebSkill: {
      path: researchWebSkillPath,
      created: false,
    },
    subpolarContextSkill: {
      path: subpolarContextSkillPath,
      created: false,
    },
    opencodeContextSkill: {
      path: opencodeContextSkillPath,
      created: false,
    },
    calendarCliSkill: {
      path: calendarCliSkillPath,
      created: false,
    },
    mailCliSkill: {
      path: mailCliSkillPath,
      created: false,
    },
    todoCliSkill: {
      path: todoCliSkillPath,
      created: false,
    },
    notesCliSkill: {
      path: notesCliSkillPath,
      created: false,
    },
  }
}

export async function installAssistantWorkspace(deps: {
  db: Database
  apiBaseUrl: string
}): Promise<GeneralChatStatus> {
  const project = await ensureGeneralChatProject(deps.db)

  return ensureGeneralChat(project, {
    db: deps.db,
    apiBaseUrl: deps.apiBaseUrl,
  })
}
