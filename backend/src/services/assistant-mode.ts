import path from 'path'
import { createHash } from 'node:crypto'
import type { Project, AssistantModeStatus, OpenCodeConfigInput, AgentFileInfo } from '@subpolar/shared/types'
import {
  readFileContent,
  writeFileContent,
  fileExists,
  ensureDirectoryExists,
} from './file-operations'
import { OpenCodeConfigSchema } from '@subpolar/shared/schemas'
import { GENERAL_CHAT_PROJECT_ID, GENERAL_CHAT_PROJECT_PATH } from '@subpolar/shared/utils'
import { getWorkspacePath, ENV } from '@subpolar/shared/config/env'
import type { Database } from '../db/schema'
import { ensureGeneralChatProject } from '../db/projects'


const ASSISTANT_MODE_DIR = GENERAL_CHAT_PROJECT_PATH
const ASSISTANT_MODE_RELATIVE_PATH = 'general-chat'
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

const AGENT_NAMES = [
  AGENT_AUTO,
  AGENT_CODE_BUILD_SANDBOX,
  AGENT_CODE_BUILD_MASTER,
  AGENT_CODE_PLAN,
  AGENT_CODE_ANALYZE,
  AGENT_RESEARCH,
] as const

const SKILL_AUTOMATIONS_DIR = 'automation-management'
const SKILL_NOTIFICATIONS_DIR = 'notifications'
const SKILL_SETTINGS_DIR = 'manager-settings'
const SKILL_REPOS_DIR = 'repo-management'
const SKILL_CODE_REVIEW_DIR = 'code-review'
const SKILL_CODE_ANALYSIS_DIR = 'code-analysis'
const SKILL_RESEARCH_WEB_DIR = 'research-web'

const SKILL_DIRS = [
  SKILL_AUTOMATIONS_DIR,
  SKILL_NOTIFICATIONS_DIR,
  SKILL_SETTINGS_DIR,
  SKILL_REPOS_DIR,
  SKILL_CODE_REVIEW_DIR,
  SKILL_CODE_ANALYSIS_DIR,
  SKILL_RESEARCH_WEB_DIR,
] as const

export function getAssistantModeDirectory(): string {
  const workspacePath = getWorkspacePath()
  const assistantDir = path.join(workspacePath, ASSISTANT_MODE_DIR)
  const resolvedWorkspaceRoot = path.resolve(workspacePath)
  const resolvedAssistantDir = path.resolve(assistantDir)

  if (!resolvedAssistantDir.startsWith(resolvedWorkspaceRoot)) {
    throw new Error('Assistant mode directory must be within workspace root')
  }

  return resolvedAssistantDir
}

export function buildGeneralChatProject(): Project {
  return {
    id: GENERAL_CHAT_PROJECT_ID,
    name: 'General Chat',
    directory: ASSISTANT_MODE_DIR,
    fullPath: getAssistantModeDirectory(),
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGeneralChat: true,
  }
}

function getInternalTokenPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_INTERNAL_TOKEN_FILENAME)
}

function getAgentPath(assistantDir: string, agentName: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR, `${agentName}.md`)
}

function getSkillPath(assistantDir: string, skillDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, skillDir, ASSISTANT_SKILL_FILENAME)
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
    external_directory: 'allow',
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
    '- **research**: Web research agent with webfetch and websearch tools. Use this for gathering information from the web, researching libraries, or finding documentation.',
    '',
    '## Routing Rules',
    '',
    '- If the user wants to BUILD or MODIFY code, route to a build agent.',
    '- If the user wants to PLAN or DESIGN, route to code-plan.',
    '- If the user wants to ANALYZE code, find bugs, or review, route to code-analyze.',
    '- If the user is experimenting or wants a safe environment, route to code-build-sandbox.',
    '- If the user needs web research or documentation lookups, route to research.',
    '- If unsure, ask the user which agent they need.',
    '',
    'When routing, explain briefly why you chose that agent and hand off to it.',
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
    '- **repo-management**: List repos and look up repo IDs. Load before automation-management if you need a repo ID.',
    '- **automation-management**: Create, list, update, delete, run, and cancel automation jobs and runs.',
    '- **notifications**: Send push notifications to the user\'s registered devices.',
    '- **manager-settings**: Read and safely modify user preferences (theme, mode, etc.).',
    '- **code-review**: Review code for quality, bugs, security, and best practices.',
    '',
    '## Self-Editing Rules',
    '',
    'This workspace is the shared assistant workspace. Durable agent instructions belong in `.opencode/agents/`.',
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
    'You are the Research agent for subpolar. Your job is to gather information from the web.',
    '',
    '## Tools Available',
    '',
    '- **webfetch**: Fetch and read web page content. Use this to read documentation, blog posts, articles, or any specific URL.',
    '- **websearch**: Search the web for information. Use this to find relevant resources, libraries, documentation, or current information.',
    '',
    '## How to Research',
    '',
    '1. Use `websearch` first to find relevant information on a topic',
    '2. Use `webfetch` to read specific pages in detail',
    '3. Synthesize the information and present it clearly to the user',
    '4. Always cite sources with URLs',
    '',
    '## What You Can Do',
    '',
    '- Research libraries, frameworks, and tools',
    '- Find documentation and API references',
    '- Look up best practices and coding patterns',
    '- Investigate error messages and solutions',
    '- Research current events and trends',
    '- Compare different approaches and technologies',
    '',
    '## Constraints',
    '',
    '- You CAN read files in the project to understand context',
    '- You CANNOT edit files or run shell commands (except webfetch/websearch)',
    '- Focus on providing accurate, relevant information',
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
    'Web research agent with webfetch and websearch tools',
    'subagent',
    buildResearchPermission(),
    buildResearchAgentPrompt(),
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
  }
  return builders[agentName]()
}

// --- Legacy Support ---

function buildLegacyAssistantAgentsMd(): string {
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for subpolar.

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
description: Default subpolar assistant workspace agent
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

You are the default Assistant Mode agent for subpolar.

This workspace is the shared assistant workspace. Help the user manage repos, automations, notifications, settings, and assistant behavior safely.

Use the workspace skills when relevant:
- Load repo-management before automation-management when you need a repo ID.
- Load automation-management for automation jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this assistant workspace.
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
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for subpolar.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default agent (\`auto\`).
- \`.opencode/agents/\` contains specialized agent definitions:
  - \`auto.md\` — Routes queries to the correct specialized agent
  - \`code-build-sandbox.md\` — Builds code in a temporary sandbox
  - \`code-build-master.md\` — Full build agent with access to internals and skills
  - \`code-plan.md\` — Read-only planning and design
  - \`code-analyze.md\` — Read-only code analysis for bugs and patterns
  - \`research.md\` — Web research with webfetch and websearch
- \`.opencode/skills/\` contains managed workspace skills for repos, automations, notifications, settings, code analysis, code review, and research.
- \`.opencode/internal-token\` is managed by subpolar for internal API authentication.

Agent-specific instructions belong in their respective \`.opencode/agents/<name>.md\` files.
`
}

function buildAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for subpolar.',
    '',
    'This workspace is the shared assistant workspace for subpolar. Help the user manage repos, automations, notifications, settings, and assistant behavior safely.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable assistant instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
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
description: Default subpolar assistant workspace agent
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

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Assistant Automations

Use repo ID \`0\` for the built-in Assistant. For example, use \`/repos/0/automations\` to list or create automation jobs that run in the Assistant workspace.

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

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

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

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

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
    theme: 'dark' | 'light' | 'system',
    mode: 'plan' | 'build',
    defaultModel?: string,
    defaultAgent?: string,
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
- \`theme\`, \`mode\`, \`defaultModel\`, \`defaultAgent\`
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

Reload the assistant workspace by disposing the current OpenCode instance. Use this after editing agent files or \`opencode.json\` so changes take effect on the next message.

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

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

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
description: Use webfetch and websearch tools for web research
---

## When to Load

Load this skill when you need to research topics, find documentation, look up libraries, or gather information from the web.

## Available Tools

### websearch
Search the web for information. Use this to:
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
Fetch and read the content of a specific URL. Use this to:
- Read documentation pages in detail
- Access API references
- Read articles and blog posts
- Check package registries (npm, PyPI, etc.)
- Verify information from search results

Usage guidance:
- Fetch URLs found via websearch for detailed information
- Prefer official documentation sources
- Use markdown format for readable output

## Research Workflow

1. **Understand the question**: Clarify what information is needed
2. **Search**: Use websearch with targeted queries
3. **Retrieve**: Use webfetch on promising results
4. **Synthesize**: Combine information from multiple sources
5. **Present**: Share findings with clear citations

## Notes

- Always cite sources with URLs
- Prefer official documentation over third-party sources
- If the research involves the project codebase, read relevant files for context
- For version-specific questions, check the docs for that version
`
}

// --- OpenCode Config ---

export function buildAssistantOpenCodeConfig(): OpenCodeConfigInput {
  const config: OpenCodeConfigInput = {
    default_agent: AGENT_AUTO,
    instructions: ['AGENTS.md'],
    permission: buildFullPermission(),
    agent: {
      [AGENT_AUTO]: { mode: 'primary' },
      [AGENT_CODE_BUILD_SANDBOX]: { mode: 'subagent' },
      [AGENT_CODE_BUILD_MASTER]: { mode: 'subagent' },
      [AGENT_CODE_PLAN]: { mode: 'subagent' },
      [AGENT_CODE_ANALYZE]: { mode: 'subagent' },
      [AGENT_RESEARCH]: { mode: 'subagent' },
      'build': { disable: true },
      'plan': { disable: true },
    },
  }

  const result = OpenCodeConfigSchema.safeParse(config)
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

async function ensureSkillDirectories(assistantDir: string): Promise<void> {
  for (const skillDir of SKILL_DIRS) {
    await ensureDirectoryExists(
      path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, skillDir),
    )
  }
}

async function writeAgentFiles(assistantDir: string): Promise<AgentFileInfo[]> {
  const agentInfos: AgentFileInfo[] = []

  for (const agentName of AGENT_NAMES) {
    const agentPath = getAgentPath(assistantDir, agentName)
    const content = buildAgentContent(agentName)
    const exists = await fileExists(agentPath)
    const existingContent = exists ? await readFileContent(agentPath) : undefined

    const isGenerated = exists && (matchesGeneratedAgentMd(agentName, existingContent!) || matchesLegacyAssistantDefaultAgentMd(existingContent!))
    const shouldOverwrite = isGenerated || !exists
    const created = shouldOverwrite && await writeFileIfChanged(agentPath, content, existingContent)

    agentInfos.push({
      name: agentName,
      path: agentPath,
      exists: true,
      created,
    })
  }

  return agentInfos
}

async function handleLegacyAssistantAgent(assistantDir: string): Promise<void> {
  const assistantAgentPath = getAgentPath(assistantDir, 'assistant')
  if (await fileExists(assistantAgentPath)) {
    const existingContent = await readFileContent(assistantAgentPath)
    if (matchesGeneratedAgentMd(AGENT_AUTO, existingContent) || matchesLegacyAssistantDefaultAgentMd(existingContent)) {
      return
    }
    const autoAgentPath = getAgentPath(assistantDir, AGENT_AUTO)
    const autoExists = await fileExists(autoAgentPath)
    if (!autoExists) {
      await writeFileContent(autoAgentPath, buildAutoAgentMd())
    }
  }
}

export async function ensureAssistantMode(
  project: Project,
  deps: { db: Database; apiBaseUrl: string },
  options?: { overwriteAgentsMd?: boolean; overwriteOpenCodeConfig?: boolean },
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(assistantDir)

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
            const mergedConfig = mergeAssistantOpenCodeConfig(existingConfig)
            return assistantOpenCodeConfigHasGeneratedAgentPersona(mergedConfig)
              ? stripGeneratedAssistantAgentPersona(mergedConfig)
              : mergedConfig
          } catch {
            return buildAssistantOpenCodeConfig()
          }
        })()
      : buildAssistantOpenCodeConfig()
    await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
    opencodeJsonUpdated = true
  } else if (existingOpenCodeJsonContent) {
    try {
      const existingConfig = JSON.parse(existingOpenCodeJsonContent) as OpenCodeConfigInput
      const repairedConfig = assistantOpenCodeConfigNeedsRepair(existingConfig)
        ? mergeAssistantOpenCodeConfig(existingConfig)
        : existingConfig
      const updatedConfig = assistantOpenCodeConfigHasGeneratedAgentPersona(repairedConfig)
        ? stripGeneratedAssistantAgentPersona(repairedConfig)
        : repairedConfig

      if (updatedConfig !== existingConfig) {
        await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
        opencodeJsonUpdated = true
      }
    } catch {
      const config = buildAssistantOpenCodeConfig()
      await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
      opencodeJsonUpdated = true
    }
  }

  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR))
  await ensureSkillDirectories(assistantDir)

  const token = await getOrCreateInternalToken(deps.db)
  const existingTokenContent = await fileExists(tokenPath) ? await readFileContent(tokenPath) : undefined
  const tokenCreated = !existingTokenContent || existingTokenContent.trim() !== token
  if (tokenCreated) {
    await writeFileContent(tokenPath, token)
  }

  const automationsSkillPath = getSkillPath(assistantDir, SKILL_AUTOMATIONS_DIR)
  const notificationsSkillPath = getSkillPath(assistantDir, SKILL_NOTIFICATIONS_DIR)
  const settingsSkillPath = getSkillPath(assistantDir, SKILL_SETTINGS_DIR)
  const reposSkillPath = getSkillPath(assistantDir, SKILL_REPOS_DIR)
  const codeReviewSkillPath = getSkillPath(assistantDir, SKILL_CODE_REVIEW_DIR)
  const codeAnalysisSkillPath = getSkillPath(assistantDir, SKILL_CODE_ANALYSIS_DIR)
  const researchWebSkillPath = getSkillPath(assistantDir, SKILL_RESEARCH_WEB_DIR)

  const existingAutomationsSkillContent = await fileExists(automationsSkillPath) ? await readFileContent(automationsSkillPath) : undefined
  const existingNotificationsSkillContent = await fileExists(notificationsSkillPath) ? await readFileContent(notificationsSkillPath) : undefined
  const existingSettingsSkillContent = await fileExists(settingsSkillPath) ? await readFileContent(settingsSkillPath) : undefined
  const existingReposSkillContent = await fileExists(reposSkillPath) ? await readFileContent(reposSkillPath) : undefined
  const existingCodeReviewSkillContent = await fileExists(codeReviewSkillPath) ? await readFileContent(codeReviewSkillPath) : undefined
  const existingCodeAnalysisSkillContent = await fileExists(codeAnalysisSkillPath) ? await readFileContent(codeAnalysisSkillPath) : undefined
  const existingResearchWebSkillContent = await fileExists(researchWebSkillPath) ? await readFileContent(researchWebSkillPath) : undefined

  const automationsSkillCreated = await writeFileIfChanged(automationsSkillPath, buildAutomationsSkill(deps.apiBaseUrl), existingAutomationsSkillContent)
  const notificationsSkillCreated = await writeFileIfChanged(notificationsSkillPath, buildNotificationsSkill(deps.apiBaseUrl), existingNotificationsSkillContent)
  const settingsSkillCreated = await writeFileIfChanged(settingsSkillPath, buildSettingsSkill(deps.apiBaseUrl), existingSettingsSkillContent)
  const reposSkillCreated = await writeFileIfChanged(reposSkillPath, buildReposSkill(deps.apiBaseUrl), existingReposSkillContent)
  const codeReviewSkillCreated = await writeFileIfChanged(codeReviewSkillPath, buildCodeReviewSkill(), existingCodeReviewSkillContent)
  const codeAnalysisSkillCreated = await writeFileIfChanged(codeAnalysisSkillPath, buildCodeAnalysisSkill(), existingCodeAnalysisSkillContent)
  const researchWebSkillCreated = await writeFileIfChanged(researchWebSkillPath, buildResearchWebSkill(), existingResearchWebSkillContent)

  const agents = await writeAgentFiles(assistantDir)
  await handleLegacyAssistantAgent(assistantDir)

  const defaultAgentInfo: AgentFileInfo = {
    name: AGENT_AUTO,
    path: getAgentPath(assistantDir, AGENT_AUTO),
    exists: true,
    created: agents.find(a => a.name === AGENT_AUTO)?.created ?? false,
  }

  const managedUpdatesApplied = agentsMdCreated || opencodeJsonUpdated || agents.some(a => a.created)
  const warnings = managedUpdatesApplied && agentsMdHasPreservedLegacyGuidance
    ? [
        {
          code: 'assistant-agents-md-preserved',
          path: agentsMdPath,
          message: 'Some Assistant Mode instruction updates were not applied because AGENTS.md appears to contain customized legacy assistant instructions. To regenerate the default workspace explanation, manually delete AGENTS.md and initialize Assistant Mode again.',
        },
      ]
    : undefined

  return {
    repoId: project.id,
    directory: assistantDir,
    relativePath: ASSISTANT_MODE_RELATIVE_PATH,
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
    defaultAgent: defaultAgentInfo,
  }
}

function assistantOpenCodeConfigNeedsRepair(config: OpenCodeConfigInput): boolean {
  if (config.default_agent !== AGENT_AUTO) return true
  if (!config.agent || typeof config.agent !== 'object') return true
  const autoAgent = config.agent[AGENT_AUTO]
  if (!autoAgent || typeof autoAgent !== 'object') return true
  const mode = (autoAgent as { mode?: unknown }).mode
  if (mode !== 'primary') return true
  if ((autoAgent as { disable?: unknown }).disable === true) return true
  if (assistantOpenCodeConfigHasGeneratedAgentPersona(config)) return true
  return false
}

function assistantOpenCodeConfigHasGeneratedAgentPersona(config: OpenCodeConfigInput): boolean {
  const autoAgent = config.agent?.[AGENT_AUTO]
  if (typeof autoAgent !== 'object' || autoAgent === null) return false
  const prompt = (autoAgent as { prompt?: unknown }).prompt
  return matchesGeneratedAutoAgentPrompt(prompt)
}

function matchesGeneratedAutoAgentPrompt(prompt: unknown): prompt is string {
  if (typeof prompt !== 'string') return false
  const currentHash = hashContent(buildAutoAgentPrompt())
  const contentHash = hashContent(prompt)
  return contentHash === currentHash
}

function stripGeneratedAssistantAgentPersona(config: OpenCodeConfigInput): OpenCodeConfigInput {
  return {
    ...config,
    agent: {
      ...(config.agent ?? {}),
      [AGENT_AUTO]: { mode: 'primary' },
    },
  }
}

function mergeAssistantOpenCodeConfig(existing?: OpenCodeConfigInput): OpenCodeConfigInput {
  const generated = buildAssistantOpenCodeConfig()
  const existingAutoAgent = existing?.agent?.[AGENT_AUTO]

  const existingIsGenerated = existingAutoAgent != null &&
    typeof existingAutoAgent === 'object' &&
    matchesGeneratedAutoAgentPrompt(
      (existingAutoAgent as { prompt?: unknown }).prompt,
    )

  let mergedAutoAgent: Record<string, unknown>
  if (existingIsGenerated) {
    mergedAutoAgent = { mode: 'primary' }
  } else {
    mergedAutoAgent = {
      ...(typeof existingAutoAgent === 'object' && existingAutoAgent !== null ? existingAutoAgent : {}),
      mode: 'primary',
      disable: false,
    }
  }

  const mergedAgents: Record<string, unknown> = {
    ...(existing?.agent ?? {}),
    [AGENT_AUTO]: mergedAutoAgent,
  }

  for (const name of AGENT_NAMES) {
    if (!mergedAgents[name]) {
      mergedAgents[name] = generated.agent?.[name]
    }
  }

  if (mergedAgents['build'] === undefined) {
    mergedAgents['build'] = { disable: true }
  }
  if (mergedAgents['plan'] === undefined) {
    mergedAgents['plan'] = { disable: true }
  }

  return {
    ...generated,
    ...existing,
    default_agent: AGENT_AUTO,
    instructions: existing?.instructions ?? generated.instructions,
    permission: existing?.permission ?? generated.permission,
    agent: mergedAgents,
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

export async function getAssistantModeStatus(project: Project): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(assistantDir)
  const automationsSkillPath = getSkillPath(assistantDir, SKILL_AUTOMATIONS_DIR)
  const notificationsSkillPath = getSkillPath(assistantDir, SKILL_NOTIFICATIONS_DIR)
  const settingsSkillPath = getSkillPath(assistantDir, SKILL_SETTINGS_DIR)
  const reposSkillPath = getSkillPath(assistantDir, SKILL_REPOS_DIR)
  const codeReviewSkillPath = getSkillPath(assistantDir, SKILL_CODE_REVIEW_DIR)
  const codeAnalysisSkillPath = getSkillPath(assistantDir, SKILL_CODE_ANALYSIS_DIR)
  const researchWebSkillPath = getSkillPath(assistantDir, SKILL_RESEARCH_WEB_DIR)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

  const agents: AgentFileInfo[] = []
  for (const agentName of AGENT_NAMES) {
    const agentPath = getAgentPath(assistantDir, agentName)
    agents.push({
      name: agentName,
      path: agentPath,
      exists: await fileExists(agentPath),
      created: false,
    })
  }

  const defaultAgentPath = getAgentPath(assistantDir, AGENT_AUTO)

  return {
    repoId: project.id,
    directory: assistantDir,
    relativePath: ASSISTANT_MODE_RELATIVE_PATH,
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
    defaultAgent: {
      name: AGENT_AUTO,
      path: defaultAgentPath,
      exists: await fileExists(defaultAgentPath),
      created: false,
    },
  }
}

export async function installAssistantWorkspace(deps: {
  db: Database
  apiBaseUrl: string
}): Promise<AssistantModeStatus> {
  const project = await ensureGeneralChatProject(deps.db)

  return ensureAssistantMode(project, {
    db: deps.db,
    apiBaseUrl: deps.apiBaseUrl,
  })
}
