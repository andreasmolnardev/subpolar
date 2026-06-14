import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { ensureAssistantMode, getAssistantModeStatus, buildAutomationsSkill, buildReposSkill, buildSettingsSkill, buildAssistantDefaultAgentMd, buildAssistantOpenCodeConfig, buildAssistantRepo, installAssistantWorkspace } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, mockRepo } from '../helpers/assistant-workspace'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getRepoById } from '../../src/db/queries'
import { ENV } from '@subpolar/shared/config/env'

function createMockPocketBase(): PocketBase {
  const repos = new Map<string, Record<string, unknown>>()
  const appSecrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  const jobs = new Map<string, Record<string, unknown>>()
  let idCounter = 0

  return {
    collection: (name: string) => {
      const collections: Record<string, Map<string, Record<string, unknown>>> = {
        repos, app_secrets: appSecrets, automation_jobs: jobs,
      }
      const col = collections[name] || new Map()

      return {
        getOne: async <T = unknown>(id: string): Promise<T> => {
          if (name === 'repos') {
            if (id === '0') {
              const existing = repos.get('0') || repos.get('1')
              if (existing) return existing as unknown as T
              const now = Date.now()
              const synthetic = {
                id: '0',
                repo_url: null,
                local_path: 'assistant',
                source_path: null,
                branch: null,
                default_branch: 'main',
                clone_status: 'ready',
                cloned_at: now,
                last_accessed_at: now,
                is_worktree: 0,
                is_local: 0,
              }
              repos.set('0', synthetic as Record<string, unknown>)
              return synthetic as unknown as T
            }
            const record = repos.get(id)
            if (record) return record as unknown as T
            throw new Error('Not found')
          }
          const record = col.get(id)
          if (!record) throw new Error('Not found')
          return record as unknown as T
        },
        getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
          const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
          if (key && name === 'app_secrets') {
            const record = col.get(key)
            if (record) return { id: String(++idCounter), key, ...record } as unknown as T
            const value = 'a'.repeat(64)
            appSecrets.set(key, { value, created_at: Date.now(), updated_at: Date.now() })
            return { id: String(++idCounter), key, value, created_at: Date.now(), updated_at: Date.now() } as unknown as T
          }
          if (name === 'repos') {
            const localPath = filter.match(/local_path\s*=\s*"([^"]+)"/)?.[1]
            if (localPath) {
              for (const record of repos.values()) {
                if ((record as Record<string, unknown>).local_path === localPath) {
                  return record as unknown as T
                }
              }
            }
          }
          if (col.size > 0) {
            return col.values().next().value as unknown as T
          }
          throw new Error('Not found')
        },
        getFullList: async <T = unknown>(options?: Record<string, unknown>): Promise<T[]> => {
          let items = Array.from(col.values())
          if (options?.filter && typeof options.filter === 'string') {
            const matches = (options.filter as string).match(/(\w+)\s*=\s*"([^"]+)"/g)
            if (matches) {
              items = items.filter(item =>
                (matches as string[]).every(m => {
                  const [, key, val] = (m as string).match(/(\w+)\s*=\s*"([^"]+)"/) || []
                  return key && String((item as Record<string, unknown>)[key]) === val
                }),
              )
            }
          }
          if (options?.sort && typeof options.sort === 'string') {
            const dir = (options.sort as string).startsWith('-') ? -1 : 1
            items.sort((a, b) => {
              const f = (options.sort as string).replace(/^-/, '')
              return (((a as Record<string, unknown>)[f] as number) || 0) - (((b as Record<string, unknown>)[f] as number) || 0) * dir
            })
          }
          return items as unknown as T[]
        },
        getList: async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => {
          const items = Array.from(col.values())
          return { items: items as unknown as T[], totalItems: items.length }
        },
        create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          idCounter++
          const id = data?.id as string || String(idCounter)
          const record = { ...data, id }
          col.set(id, record)
          return record as unknown as T
        },
        update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          const existing = col.get(id)
          if (existing) {
            const updated = { ...existing, ...data }
            col.set(id, updated)
            return updated as unknown as T
          }
          col.set(id, data)
          return { id, ...data } as unknown as T
        },
        delete: async (id: string): Promise<boolean> => col.delete(id),
      }
    },
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

describe('buildAutomationsSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildAutomationsSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })

  it('documents repoId 0 for Assistant automations', () => {
    const skill = buildAutomationsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('Use repo ID `0` for the built-in Assistant')
    expect(skill).toContain('/repos/0/automations')
  })
})

describe('buildReposSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildReposSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })

  it('contains GET /repos endpoint documentation', () => {
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('GET /repos')
  })

  it('contains Authorization Bearer header documentation', () => {
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('Authorization: Bearer')
    expect(skill).toContain('.opencode/internal-token')
  })

  it('contains internal localhost URL', () => {
    const localApiBaseUrl = 'http://localhost:5003/api/internal'
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain(localApiBaseUrl)
  })
})

describe('buildSettingsSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildSettingsSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })

  it('includes tts and stt in allowed non-secret preferences', () => {
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('tts')
    expect(skill).toContain('stt')
    expect(skill).toContain('enabled')
    expect(skill).toContain('provider')
    expect(skill).toContain('autoPlay')
    expect(skill).toContain('voice')
    expect(skill).toContain('model')
    expect(skill).toContain('speed')
    expect(skill).toContain('language')
  })

  it('documents the POST /assistant/reload endpoint', () => {
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('/assistant/reload')
    expect(skill).toContain('Always confirm with the user before reloading')
    expect(skill).toContain('5 requests per minute')
  })

  it('still lists apiKey and endpoint as forbidden', () => {
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('tts.apiKey')
    expect(skill).toContain('tts.endpoint')
    expect(skill).toContain('stt.apiKey')
    expect(skill).toContain('stt.endpoint')
    expect(skill).toContain('DO NOT attempt to set')
  })
})

describe('buildAssistantDefaultAgentMd', () => {
  it('contains description and mode in frontmatter', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('description: Default subpolar assistant workspace agent')
    expect(content).toContain('mode: primary')
  })

  it('references workspace skills', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('repo-management')
    expect(content).toContain('automation-management')
    expect(content).toContain('notifications')
    expect(content).toContain('manager-settings')
  })

  it('contains reload guidance in the agent prompt', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('/assistant/reload')
    expect(content).toContain('Always ask the user before reloading')
  })

  it('does not contain v file', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).not.toContain('v file')
  })
})

describe('buildAssistantOpenCodeConfig', () => {
  it('includes default_agent and agent.assistant with primary mode and no embedded persona', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.default_agent).toBe('assistant')
    expect(config.agent?.assistant).toEqual({ mode: 'primary' })
    expect(config.agent?.assistant?.prompt).toBeUndefined()
    expect(config.agent?.assistant?.description).toBeUndefined()
    expect(config.agent?.assistant?.permission).toBeUndefined()
  })
})

describe('ensureAssistantMode', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let pb: PocketBase
  const apiBaseUrl = 'http://example.test:5003/api/internal'
  const localApiBaseUrl = 'http://localhost:5003/api/internal'

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    pb = createMockPocketBase()
  })
  afterEach(async () => { await ws.cleanup() })

  it('creates AGENTS.md, opencode.json, internal-token, and SKILL.md on first run', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    const token = await readFile(path.join(ws.assistantDir, '.opencode/internal-token'), 'utf8')
    const skill = await readFile(path.join(ws.assistantDir, '.opencode/skills/automation-management/SKILL.md'), 'utf8')
    const repoSkill = await readFile(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'), 'utf8')
    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')

    expect(agentsMd).toContain('.opencode/agents/assistant.md')
    expect(agentsMd).not.toContain('Self-Editing Rules')
    const parsedConfig = JSON.parse(opencodeJson)
    expect(parsedConfig.default_agent).toBe('assistant')
    expect(parsedConfig).not.toHaveProperty('mcp')
    expect(parsedConfig.agent?.assistant).toEqual({ mode: 'primary' })
    expect(parsedConfig.agent?.assistant?.prompt).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.description).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.permission).toBeUndefined()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(skill).toContain('Authorization: Bearer')
    expect(skill).toContain(localApiBaseUrl)
    expect(skill).not.toContain(apiBaseUrl)
    expect(repoSkill).toContain('GET /repos')
    expect(repoSkill).toContain('Authorization: Bearer')
    expect(repoSkill).toContain('.opencode/internal-token')
    expect(repoSkill).toContain(localApiBaseUrl)
    expect(assistantAgent).toContain('mode: primary')
    expect(assistantAgent).toContain('Default subpolar assistant workspace agent')
    expect(assistantAgent).not.toContain('v file')
  })

  it('does not rewrite the token file on a second run with the same db', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const tokenPath = path.join(ws.assistantDir, '.opencode/internal-token')
    const firstToken = await readFile(tokenPath, 'utf8')
    const firstStat = await stat(tokenPath)

    await new Promise(r => setTimeout(r, 10))

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const secondToken = await readFile(tokenPath, 'utf8')
    const secondStat = await stat(tokenPath)

    expect(secondToken).toBe(firstToken)
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
    expect(result.internalToken?.created).toBe(false)
    expect(result.automationsSkill?.created).toBe(false)
    expect(result.repoManagementSkill?.created).toBe(false)
  })

  it('writes all files needed before OpenCode assistant session launch', async () => {
    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const automationsSkillPath = path.join(ws.assistantDir, '.opencode/skills/automation-management/SKILL.md')
    const notificationsSkillPath = path.join(ws.assistantDir, '.opencode/skills/notifications/SKILL.md')
    const settingsSkillPath = path.join(ws.assistantDir, '.opencode/skills/manager-settings/SKILL.md')
    const reposSkillPath = path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const opencodeJsonContent = await readFile(opencodeJsonPath, 'utf8')
    const opencodeJson = JSON.parse(opencodeJsonContent)

    expect(opencodeJson.default_agent).toBe('assistant')
    expect(opencodeJson.instructions).toEqual(['AGENTS.md'])
    expect(opencodeJson.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    })
    expect(opencodeJson.agent?.assistant).toEqual({ mode: 'primary' })
    expect(opencodeJson.agent?.assistant?.prompt).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.description).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.permission).toBeUndefined()

    const agentsMdContent = await readFile(agentsMdPath, 'utf8')
    expect(agentsMdContent).toContain('Assistant Mode Workspace')
    expect(agentsMdContent).toContain('.opencode/agents/assistant.md')
    expect(agentsMdContent).not.toContain('Self-Editing Rules')
    expect(agentsMdContent).not.toContain('automation Management')
    expect(agentsMdContent).not.toContain('Notifications')
    expect(agentsMdContent).not.toContain('Settings Management')
    expect(agentsMdContent).not.toContain('Repo Management')

    const automationsSkillContent = await readFile(automationsSkillPath, 'utf8')
    expect(automationsSkillContent).toContain('name: automation-management')
    expect(automationsSkillContent).toContain('Manage automation jobs')
    expect(automationsSkillContent).toContain('Use repo ID `0` for the built-in Assistant')
    expect(automationsSkillContent).toContain('/repos/0/automations')

    const notificationsSkillContent = await readFile(notificationsSkillPath, 'utf8')
    expect(notificationsSkillContent).toContain('name: notifications')
    expect(notificationsSkillContent).toContain('Send push notifications')

    const settingsSkillContent = await readFile(settingsSkillPath, 'utf8')
    expect(settingsSkillContent).toContain('name: manager-settings')
    expect(settingsSkillContent).toContain('Read and modify')

    const reposSkillContent = await readFile(reposSkillPath, 'utf8')
    expect(reposSkillContent).toContain('name: repo-management')
    expect(reposSkillContent).toContain('List repos available')

    const assistantAgentContent = await readFile(assistantAgentPath, 'utf8')
    expect(assistantAgentContent).toContain('mode: primary')
    expect(assistantAgentContent).toContain('Self-Editing')
    expect(assistantAgentContent).toContain('repo-management')
    expect(assistantAgentContent).toContain('automation-management')
    expect(assistantAgentContent).toContain('notifications')
    expect(assistantAgentContent).toContain('manager-settings')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.repoManagementSkill?.path).toBe(reposSkillPath)
    expect(result.repoManagementSkill?.created).toBe(true)
    expect(result.defaultAgent?.name).toBe('assistant')
    expect(result.defaultAgent?.path).toBe(assistantAgentPath)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('reports repo management skill status from getAssistantModeStatus', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const status = await getAssistantModeStatus(mockRepo)

    expect(status.repoManagementSkill?.path).toBe(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'))
    expect(status.repoManagementSkill?.created).toBe(false)
  })

  it('preserves custom assistant agent content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const customContent = '---\ndescription: Custom assistant\nmode: primary\n---\n\nCustom assistant instructions.'
    await writeFile(assistantAgentPath, customContent)

    const result2 = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const preservedContent = await readFile(assistantAgentPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result2.defaultAgent?.created).toBe(false)
  })

  it('repairs existing assistant opencode config missing configured assistant agent', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      model: 'provider/model',
      instructions: ['AGENTS.md'],
      default_agent: 'build',
      agent: {
        custom: { mode: 'primary', prompt: 'Custom agent' },
      },
      skills: { paths: ['.opencode/skills'] },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.default_agent).toBe('assistant')
    expect(repaired.agent.assistant).toEqual({ mode: 'primary', disable: false })
    expect(repaired.agent.assistant.prompt).toBeUndefined()
    expect(repaired.agent.custom.prompt).toBe('Custom agent')
    expect(repaired.model).toBe('provider/model')
    expect(repaired.skills.paths).toEqual(['.opencode/skills'])
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('preserves custom assistant config while making it selectable', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agent: {
        assistant: {
          mode: 'subagent',
          prompt: 'Custom assistant prompt',
          description: 'Custom assistant',
          permission: { bash: 'ask' },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.agent.assistant.prompt).toBe('Custom assistant prompt')
    expect(repaired.agent.assistant.description).toBe('Custom assistant')
    expect(repaired.agent.assistant.permission.bash).toBe('ask')
    expect(repaired.agent.assistant.mode).toBe('primary')
    expect(repaired.agent.assistant.disable).toBe(false)
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('migrates generated legacy AGENTS.md and assistant.md to the new split', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const legacyAgentsMd = `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for subpolar.

## Purpose

Assistant mode provides an isolated space for:
- Self-editing agent instructions and preferences
- Customized workflows specific to this assistant workspace
- Iterative improvement of assistant behavior

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
- \`opencode.json\` - OpenCode configuration for this workspace

## Constraints

- Changes outside this workspace require explicit user direction
- Self-edits should be concise and auditable
- Preserve user-customized content when modifying files
- Always ask for confirmation before making significant changes

## Guidelines

1. Keep instructions clear and actionable
2. Update AGENTS.md when learning durable preferences
3. Maintain version control awareness
4. Document significant changes in commit messages

## Repo Management

This workspace includes a skill at \`.opencode/skills/repo-management/SKILL.md\` for listing repos available to subpolar via the internal HTTP API. Load it before the automation-management skill when you don't know the repo ID.

## Automation Management

This workspace ships with a workspace-scoped skill at \`.opencode/skills/automation-management/SKILL.md\` that documents how to list, create, update, delete, run, inspect, and cancel automation jobs and runs across any repo via the internal HTTP API. Load it whenever the user asks about automations.

## Notifications

This workspace includes a skill at \`.opencode/skills/notifications/SKILL.md\` for sending push notifications to the user's registered devices via the internal HTTP API. Load it when you need to notify the user about important events.

## Settings Management

This workspace includes a skill at \`.opencode/skills/manager-settings/SKILL.md\` for reading and safely modifying user preferences via the internal HTTP API. Load it when you need to inspect or update UI settings.
`

    const legacyAssistantAgent = `---
description: Default subpolar assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
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

    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')
    const legacyAssistantPrompt = legacyAssistantAgent.split('---\n\n')[1]?.trimEnd()

    if (legacyAssistantPrompt === undefined) throw new Error('Legacy assistant prompt fixture is invalid')

    await writeFile(agentsMdPath, legacyAgentsMd)
    await writeFile(assistantAgentPath, legacyAssistantAgent)
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      instructions: ['AGENTS.md'],
      permission: {
        read: 'allow',
        edit: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        bash: 'allow',
        external_directory: 'ask',
      },
      agent: {
        assistant: {
          description: 'Default subpolar assistant workspace agent',
          mode: 'primary',
          prompt: legacyAssistantPrompt,
          permission: {
            read: 'allow',
            edit: 'allow',
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            bash: 'allow',
            external_directory: 'ask',
          },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const updatedAgentsMd = await readFile(agentsMdPath, 'utf8')
    const updatedAssistantAgent = await readFile(assistantAgentPath, 'utf8')
    const updatedOpenCodeJson = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(updatedAgentsMd).toContain('Assistant Mode Workspace')
    expect(updatedAgentsMd).toContain('.opencode/agents/assistant.md')
    expect(updatedAgentsMd).not.toContain('Self-Editing Rules')

    expect(updatedAssistantAgent).toContain('Self-Editing')
    expect(updatedAssistantAgent).toContain('/assistant/reload')
    expect(updatedAssistantAgent).toContain('Always ask the user before reloading')
    expect(updatedAssistantAgent).toContain('repo-management')
    expect(updatedAssistantAgent).toContain('automation-management')
    expect(updatedAssistantAgent).toContain('notifications')
    expect(updatedAssistantAgent).toContain('manager-settings')

    expect(updatedOpenCodeJson.agent.assistant.prompt).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.description).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.permission).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.mode).toBe('primary')

    expect(result.files.agentsMd?.created).toBe(true)
    expect(result.files.opencodeJson?.created).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('preserves custom AGENTS.md content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const preservedContent = await readFile(agentsMdPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(false)
  })

  it('warns when managed updates apply but customized legacy AGENTS.md is preserved', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    await writeFile(agentsMdPath, `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for subpolar.

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
`)
    await writeFile(assistantAgentPath, `---
description: Default subpolar assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
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
`)

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const preservedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(preservedAgentsMd).toContain('Self-Editing Rules')
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(true)
    expect(result.warnings?.[0]?.code).toBe('assistant-agents-md-preserved')
    expect(result.warnings?.[0]?.message).toContain('manually delete AGENTS.md')
  })

  it('overwrites custom AGENTS.md when overwriteAgentsMd is true', async () => {
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl }, { overwriteAgentsMd: true })

    const updatedContent = await readFile(agentsMdPath, 'utf8')
    expect(updatedContent).toContain('Assistant Mode Workspace')
    expect(updatedContent).toContain('.opencode/agents/assistant.md')
    expect(updatedContent).not.toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(true)
  })
})

describe('assistant-mode end-to-end', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let pb: PocketBase

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    pb = createMockPocketBase()
  })
  afterEach(async () => { await ws.cleanup() })

  it('token written by ensureAssistantMode authenticates a request to /api/internal/automations/all', async () => {
    const apiBaseUrl = 'http://127.0.0.1:5003/api/internal'
    await ensureAssistantMode(mockRepo, { db: pb, apiBaseUrl })

    const token = (await readFile(path.join(ws.assistantDir, '.opencode/internal-token'), 'utf8')).trim()

    const automationservice = new AutomationService(pb, createOpenCodeClient())
    const notificationService = new NotificationService(pb)
    const settingsService = new SettingsService(pb)
    const app = new Hono()
    app.route('/api/internal', createInternalRoutes(pb, automationservice, notificationService, settingsService, createOpenCodeClient()))

    const unauth = await app.request('/api/internal/automations/all')
    expect(unauth.status).toBe(401)

    const authed = await app.request('/api/internal/automations/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(authed.status).toBe(200)
    const body = await authed.json() as { jobs: unknown[] }
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})

describe('buildAssistantRepo', () => {
  it('returns the synthetic assistant repo with id 0', () => {
    const repo = buildAssistantRepo()
    expect(repo.id).toBe(0)
    expect(repo.localPath).toBe('assistant')
    expect(repo.cloneStatus).toBe('ready')
    expect(repo.repoUrl).toBeUndefined()
    expect(repo.isWorktree).toBe(false)
  })
})

describe('installAssistantWorkspace', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let pb: PocketBase
  const apiBaseUrl = 'http://localhost:5003/api/internal'

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    pb = createMockPocketBase()
  })
  afterEach(async () => { await ws.cleanup() })

  it('provisions the assistant workspace files without contacting OpenCode', async () => {
    const result = await installAssistantWorkspace({ db: pb, apiBaseUrl })

    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    expect(JSON.parse(opencodeJson).default_agent).toBe('assistant')

    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Assistant Mode Workspace')

    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')
    expect(assistantAgent).toContain('mode: primary')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.repoId).toBe(0)

    const assistantRepo = await getRepoById(pb, 0)
    expect(assistantRepo?.id).toBe(0)
    expect(assistantRepo?.localPath).toBe('assistant')
    expect(assistantRepo?.fullPath).toBe(ws.assistantDir)
    expect(assistantRepo?.cloneStatus).toBe('ready')
    expect(assistantRepo?.defaultBranch).toBe('main')
  })

  it('repairs an assistant row created with a non-zero id', async () => {
    await pb.collection('repos').create({
      id: '99',
      repo_url: null,
      local_path: 'assistant',
      source_path: null,
      branch: null,
      default_branch: 'main',
      clone_status: 'ready',
      cloned_at: Date.now(),
      last_accessed_at: Date.now(),
      is_worktree: 0,
      is_local: 0,
    })
    await pb.collection('automation_jobs').create({
      repo_id: '99',
      name: 'Assistant job',
      description: null,
      enabled: true,
      interval_minutes: 60,
      automation_mode: 'interval',
      cron_expression: null,
      timezone: null,
      agent_slug: null,
      prompt: 'hello',
      model: null,
      skill_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      last_run_at: null,
      next_run_at: null,
    })

    await installAssistantWorkspace({ db: pb, apiBaseUrl })

    expect(await getRepoById(pb, 99)).toBeNull()
    const assistantRepo = await getRepoById(pb, 0)
    expect(assistantRepo?.localPath).toBe('assistant')

    const migratedJobs = await pb.collection('automation_jobs').getFullList({ filter: 'name = "Assistant job"' })
    const migratedJob = migratedJobs[0] as Record<string, unknown>
    expect(migratedJob.repo_id).toBe('0')
  })

  it('is idempotent — second call does not recreate files and content is unchanged', async () => {
    await installAssistantWorkspace({ db: pb, apiBaseUrl })

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const firstContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    const result = await installAssistantWorkspace({ db: pb, apiBaseUrl })

    const secondContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    expect(secondContent.opencodeJson).toBe(firstContent.opencodeJson)
    expect(secondContent.agentsMd).toBe(firstContent.agentsMd)
    expect(secondContent.assistantAgent).toBe(firstContent.assistantAgent)

    expect(result.files.opencodeJson?.created).toBe(false)
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(false)
  })
})
