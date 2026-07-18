import { Hono } from 'hono'
import { z } from 'zod'
import type PocketBase from 'pocketbase'
import fs from 'fs/promises'
import path from 'path'
import { listProjects, getProjectById, createProject, updateProject, deleteProject, updateProjectLastAccessed, updateProjectConfigName, setProjectAgentNames } from '../db/projects'
import { handleServiceError } from '../utils/route-helpers'
import { SettingsService } from '../services/settings'
import { fileExists, readFileContent, writeFileContent } from '../services/file-operations'
import { getPiConfigFilePath, getWorkspacePath } from '@subpolar/shared/config/env'
import { logger } from '../utils/logger'
import { listManagedSkills } from '../services/skills'

export class ProjectServiceError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message)
    this.name = 'ProjectServiceError'
  }
}

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(256),
  directory: z.string().max(1024).optional(),
  openCodeConfigName: z.string().optional(),
  piConfigName: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
  userId: z.string().optional(),
})

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  directory: z.string().max(1024).optional(),
  openCodeConfigName: z.string().optional(),
  piConfigName: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
})

const SwitchConfigSchema = z.object({
  configName: z.string().min(1),
})

const DirectoryQuerySchema = z.object({
  path: z.string().optional(),
  userId: z.string().optional(),
})

const MentionQuerySchema = z.object({
  directory: z.string().min(1),
  query: z.string().optional(),
})

const MentionContextSchema = z.object({
  directory: z.string().min(1),
  mentions: z.array(z.object({
    type: z.enum(['file', 'skill']),
    value: z.string().min(1),
  })).max(10),
})

function slugifyProjectName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

function getDefaultProjectDirectory(userId: string, projectName: string): string {
  return path.join(getWorkspacePath(), 'users', userId, 'workspaces', slugifyProjectName(projectName))
}

function canShowDirectory(directory: string, userId: string): boolean {
  const resolved = path.resolve(directory)
  const usersRoot = path.resolve(getWorkspacePath(), 'users')
  const userRoot = path.join(usersRoot, userId)
  return resolved === usersRoot || !resolved.startsWith(`${usersRoot}${path.sep}`) || resolved.startsWith(`${userRoot}${path.sep}`) || resolved === userRoot
}

async function listAccessibleDirectories(targetPath: string, userId: string) {
  const resolved = path.resolve(targetPath || getWorkspacePath())
  const entries = await fs.readdir(resolved, { withFileTypes: true })
  const parentPath = path.dirname(resolved)
  const directories = parentPath !== resolved && canShowDirectory(parentPath, userId)
    ? [{ name: '..', path: parentPath }]
    : []
  const childDirectories = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const fullPath = path.join(resolved, entry.name)
    if (!canShowDirectory(fullPath, userId)) continue
    try {
      await fs.access(fullPath)
      childDirectories.push({ name: entry.name, path: fullPath })
    } catch {
      continue
    }
  }
  return [...directories, ...childDirectories.sort((a, b) => a.name.localeCompare(b.name))]
}

async function walkFiles(root: string, query: string, limit: number): Promise<string[]> {
  const found: string[] = []
  const normalizedRoot = path.resolve(root)
  async function visit(dir: string, depth: number): Promise<void> {
    if (found.length >= limit || depth > 5) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (found.length >= limit) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1)
        continue
      }
      const relative = path.relative(normalizedRoot, fullPath)
      if (!query || relative.toLowerCase().includes(query.toLowerCase())) found.push(relative)
    }
  }
  await visit(normalizedRoot, 0)
  return found
}

async function readMentionContext(database: PocketBase, directory: string, mentions: z.infer<typeof MentionContextSchema>['mentions']) {
  const skills = await listManagedSkills(database, undefined, directory)
  const sections = []
  for (const mention of mentions) {
    if (mention.type === 'skill') {
      const skill = skills.find((item) => item.name === mention.value)
      if (skill) sections.push(`<skill-context name="${skill.name}">\n${skill.body}\n</skill-context>`)
      continue
    }
    const filePath = path.resolve(directory, mention.value)
    const root = path.resolve(directory)
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) continue
    if (!await fileExists(filePath)) continue
    const stats = await fs.stat(filePath).catch(() => null)
    if (!stats || stats.isDirectory() || stats.size > 256_000) continue
    sections.push(`<file-context path="${mention.value}">\n${await readFileContent(filePath)}\n</file-context>`)
  }
  return sections.join('\n\n')
}

export function createProjectRoutes(database: PocketBase) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const projects = await listProjects(database, userId)
      return c.json({ projects })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list projects', ProjectServiceError)
    }
  })

  app.get('/default-directory', async (c) => {
    const projectName = c.req.query('projectName') || 'project'
    const userId = c.req.query('userId') || 'default'
    return c.json({ directory: getDefaultProjectDirectory(userId, projectName) })
  })

  app.get('/directories', async (c) => {
    try {
      const input = DirectoryQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams))
      const userId = input.userId || 'default'
      const targetPath = input.path || getWorkspacePath()
      return c.json({ currentPath: path.resolve(targetPath), directories: await listAccessibleDirectories(targetPath, userId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list directories', ProjectServiceError)
    }
  })

  app.get('/mentions', async (c) => {
    try {
      const input = MentionQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams))
      const query = input.query?.trim() ?? ''
      const files = await walkFiles(input.directory, query, 10)
      const skills = (await listManagedSkills(database, undefined, input.directory))
        .filter((skill) => !query || skill.name.toLowerCase().includes(query.toLowerCase()) || skill.description.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10)
        .map((skill) => ({ name: skill.name, description: skill.description }))
      return c.json({ files, skills })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list mentions', ProjectServiceError)
    }
  })

  app.post('/mention-context', async (c) => {
    try {
      const input = MentionContextSchema.parse(await c.req.json())
      return c.json({ context: await readMentionContext(database, input.directory, input.mentions) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to load mention context', ProjectServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const input = CreateProjectSchema.parse(body)
      const userId = input.userId || c.req.query('userId') || 'default'
      const directory = input.directory || input.name
      const project = await createProject(database, {
        userId,
        name: input.name,
        directory,
        fullPath: directory,
        openCodeConfigName: input.openCodeConfigName ?? input.piConfigName,
      })
      if (input.agentNames) await setProjectAgentNames(database, String(project.id), input.agentNames)
      return c.json({ project }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create project', ProjectServiceError)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const project = await getProjectById(database, id)
      if (!project) throw new ProjectServiceError('Project not found', 404)
      return c.json({ project })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get project', ProjectServiceError)
    }
  })

  app.patch('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const project = await getProjectById(database, id)
      if (!project) throw new ProjectServiceError('Project not found', 404)
      const body = await c.req.json()
      const input = UpdateProjectSchema.parse(body)
      if (input.agentNames) await setProjectAgentNames(database, id, input.agentNames)
      const updated = await updateProject(database, id, {
        name: input.name,
        directory: input.directory,
        openCodeConfigName: input.openCodeConfigName ?? input.piConfigName,
      })
      return c.json({ project: updated })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update project', ProjectServiceError)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      if (id === '0') throw new ProjectServiceError('Cannot delete the General Chat project', 403)
      const project = await getProjectById(database, id)
      if (!project) throw new ProjectServiceError('Project not found', 404)
      await deleteProject(database, id)
      return c.body(null, 204)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete project', ProjectServiceError)
    }
  })

  app.post('/:id/access', async (c) => {
    try {
      const id = c.req.param('id')
      const project = await getProjectById(database, id)
      if (!project) throw new ProjectServiceError('Project not found', 404)
      await updateProjectLastAccessed(database, id)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update project access', ProjectServiceError)
    }
  })

  app.post('/:id/config/switch', async (c) => {
    try {
      const id = c.req.param('id')
      const project = await getProjectById(database, id)
      if (!project) throw new ProjectServiceError('Project not found', 404)

      const body = await c.req.json()
      const { configName } = SwitchConfigSchema.parse(body)

      const settingsService = new SettingsService(database)
      const configContent = await settingsService.getPiConfigContent(configName)
      if (!configContent) throw new ProjectServiceError(`Config '${configName}' not found`, 404)

      const piConfigPath = getPiConfigFilePath()
      await writeFileContent(piConfigPath, configContent)
      await updateProjectConfigName(database, id, configName)

      logger.info(`Switched config for project ${id} to '${configName}'`)

      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to switch project config', ProjectServiceError)
    }
  })

  app.get('/:id/general-chat', async (c) => {
    try {
      const id = c.req.param('id')
      if (id !== '0') throw new ProjectServiceError('General chat is only available for the General Chat project', 404)
      const { getGeneralChatStatus } = await import('../services/general-chat')
      const { buildGeneralChatProject } = await import('../services/general-chat')
      const project = buildGeneralChatProject()
      const status = await getGeneralChatStatus(project)
      return c.json(status)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get general chat status', ProjectServiceError)
    }
  })

  app.post('/:id/general-chat', async (c) => {
    try {
      const id = c.req.param('id')
      if (id !== '0') throw new ProjectServiceError('General chat is only available for the General Chat project', 404)
      const { ensureGeneralChat, buildGeneralChatProject } = await import('../services/general-chat')
      const { GeneralChatInitRequestSchema } = await import('@subpolar/shared/schemas')
      const project = buildGeneralChatProject()
      const body = await c.req.json().catch(() => ({}))
      const options = GeneralChatInitRequestSchema.parse(body)
      const protocol = c.req.header('x-forwarded-proto') || 'http'
      const host = c.req.header('host') || 'localhost:5003'
      const apiBaseUrl = `${protocol}://${host}/api/internal`
      const status = await ensureGeneralChat(project, { db: database, apiBaseUrl }, options)
      return c.json(status)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to initialize general chat', ProjectServiceError)
    }
  })

  return app
}
