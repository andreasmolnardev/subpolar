import { Hono } from 'hono'
import { z } from 'zod'
import type PocketBase from 'pocketbase'
import { listProjects, getProjectById, createProject, updateProject, deleteProject, updateProjectLastAccessed, updateProjectConfigName } from '../db/projects'
import { handleServiceError } from '../utils/route-helpers'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { getPiConfigFilePath } from '@subpolar/shared/config/env'
import { logger } from '../utils/logger'

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
  userId: z.string().optional(),
})

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  directory: z.string().max(1024).optional(),
  openCodeConfigName: z.string().optional(),
})

const SwitchConfigSchema = z.object({
  configName: z.string().min(1),
})

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
        openCodeConfigName: input.openCodeConfigName,
      })
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
      const updated = await updateProject(database, id, input)
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
      const configContent = await settingsService.getOpenCodeConfigContent(configName)
      if (!configContent) throw new ProjectServiceError(`Config '${configName}' not found`, 404)

      const openCodeConfigPath = getPiConfigFilePath()
      await writeFileContent(openCodeConfigPath, configContent)
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
