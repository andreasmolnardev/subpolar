import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { Database } from '../db/schema'
import type { SkillFileInfo, SkillScope, CreateSkillRequest, UpdateSkillRequest } from '@subpolar/shared'
import { SKILL_NAME_REGEX } from '@subpolar/shared'
import { getWorkspacePath } from '@subpolar/shared/config/env'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent, deletePath, listDirectory } from './file-operations'
import { logger } from '../utils/logger'
import type { Project } from '@subpolar/shared/types'
import { listProjects, getProjectById } from '../db/projects'

interface PiSkillInfo {
  name: string
  description: string
  location: string
  content: string
  source?: 'global' | 'project' | 'auto'
}

const SKILL_SCAN_IGNORES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vite', 'coverage'])

function getGlobalSkillsPath(): string {
  return path.join(getWorkspacePath(), '.config', 'opencode', 'skills')
}

function getOldGlobalSkillsPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'skills')
}

function getProjectSkillsPath(project: Project): string {
  return path.join(project.fullPath, '.opencode', 'skills')
}

export async function migrateGlobalSkills(): Promise<void> {
  const oldSkillsPath = getOldGlobalSkillsPath()
  const newSkillsPath = getGlobalSkillsPath()

  const oldSkillsExist = await fileExists(oldSkillsPath)
  if (!oldSkillsExist) {
    logger.debug('No old global skills found to migrate')
    return
  }

  const entries = await listDirectory(oldSkillsPath)
  const skillDirs = entries.filter(entry => entry.isDirectory)

  if (skillDirs.length === 0) {
    logger.debug('No skill directories found in old location')
    return
  }

  let migratedCount = 0
  let skippedCount = 0

  for (const entry of skillDirs) {
    const oldSkillPath = path.join(entry.path, 'SKILL.md')
    const newSkillPath = path.join(newSkillsPath, entry.name, 'SKILL.md')

    const alreadyMigrated = await fileExists(newSkillPath)
    if (alreadyMigrated) {
      skippedCount++
      continue
    }

    const skillExists = await fileExists(oldSkillPath)
    if (!skillExists) {
      logger.warn(`Skill ${entry.name} has no SKILL.md file, skipping`)
      continue
    }

    try {
      const content = await readFileContent(oldSkillPath)
      await writeFileContent(newSkillPath, content)
      logger.info(`Migrated skill ${entry.name} from ${oldSkillsPath} to ${newSkillsPath}`)
      migratedCount++
    } catch (error) {
      logger.error(`Failed to migrate skill ${entry.name}:`, error)
    }
  }

  if (migratedCount > 0 || skippedCount > 0) {
    logger.info(`Skill migration complete: ${migratedCount} migrated, ${skippedCount} skipped (already existed)`)
  }
}

function validateSkillName(name: string): void {
  if (!SKILL_NAME_REGEX.test(name)) {
    throw new Error('Invalid skill name. Must be lowercase alphanumeric with hyphens only.')
  }
}

async function getSkillFilePath(db: Database, scope: SkillScope, name: string, repoId?: number): Promise<string> {
  validateSkillName(name)
  if (scope === 'global') {
    return path.join(getGlobalSkillsPath(), name, 'SKILL.md')
  }
  if (!repoId) {
    throw new Error('project ID is required for project-scoped skills')
  }
  const project = await getProjectById(db, String(repoId))
  if (!project) {
    throw new Error(`Project with id ${repoId} not found`)
  }
  return path.join(getProjectSkillsPath(project), name, 'SKILL.md')
}

function buildSkillFileContent(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
}

function parseSkillContent(location: string, content: string, source?: 'global' | 'project' | 'auto'): PiSkillInfo {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const frontmatter = match?.[1] ?? ''
  const body = match?.[2] ?? content
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || path.basename(path.dirname(location))
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  return { name, description, location, content: body, source }
}

async function readSkillsFromPath(skillsPath: string, source: 'global' | 'project' | 'auto' = 'project'): Promise<PiSkillInfo[]> {
  if (!await fileExists(skillsPath)) return []
  const entries = await listDirectory(skillsPath)
  const skills: PiSkillInfo[] = []
  for (const entry of entries.filter((item) => item.isDirectory)) {
    const skillPath = path.join(entry.path, 'SKILL.md')
    if (!await fileExists(skillPath)) continue
    skills.push(parseSkillContent(skillPath, await readFileContent(skillPath), source))
  }
  return skills
}

async function readSkillsRecursive(root: string, source: 'project' | 'auto'): Promise<PiSkillInfo[]> {
  const rootExists = await fileExists(root)
  if (!rootExists) return []
  const skills: PiSkillInfo[] = []
  const visit = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    if (entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
      const skillPath = path.join(dir, 'SKILL.md')
      skills.push(parseSkillContent(skillPath, await readFileContent(skillPath), source))
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKILL_SCAN_IGNORES.has(entry.name)) continue
      await visit(path.join(dir, entry.name))
    }
  }
  await visit(root)
  return skills
}

function classifySkillLocation(
  location: string,
  globalPrefix: string,
  projects: Project[],
  customDirectory?: string,
): { scope: SkillScope; project?: Project } | null {
  if (location.startsWith(globalPrefix + path.sep)) {
    return { scope: 'global' }
  }
  if (customDirectory) {
    const projectPrefix = path.join(customDirectory, '.opencode', 'skills')
    if (location.startsWith(projectPrefix + path.sep) || location.startsWith(customDirectory + path.sep)) {
      return { scope: 'project' }
    }
  }
  for (const project of projects) {
    const projectPrefix = getProjectSkillsPath(project)
    if (location.startsWith(projectPrefix + path.sep) || location.startsWith(project.fullPath + path.sep)) {
      return { scope: 'project', project }
    }
  }
  return null
}

function toSkillFileInfo(
  skill: PiSkillInfo,
  classification: { scope: SkillScope; project?: Project },
): SkillFileInfo {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.content,
    scope: classification.scope,
    location: skill.location,
    repoId: classification.project?.id,
    repoName: classification.project?.name,
    source: skill.source ?? classification.scope,
    discoveryEligible: true,
  }
}

function addUniqueSkill(result: SkillFileInfo[], seenLocations: Set<string>, seenNames: Set<string>, skill: PiSkillInfo, classification: { scope: SkillScope; project?: Project }): void {
  const canonical = path.resolve(skill.location)
  if (seenLocations.has(canonical)) return
  const scopeKey = `${classification.scope}:${classification.project?.id ?? 'global'}:${skill.name}`
  if (seenNames.has(scopeKey)) return
  seenLocations.add(canonical)
  seenNames.add(scopeKey)
  result.push(toSkillFileInfo(skill, classification))
}

export async function listManagedSkills(
  db: Database,
  repoId?: number,
  directory?: string,
): Promise<SkillFileInfo[]> {
  const globalPrefix = getGlobalSkillsPath()
  const allProjects = await listProjects(db, 'default')

  const seenLocations = new Set<string>()
  const seenNames = new Set<string>()
  const result: SkillFileInfo[] = []

  if (directory) {
    const skills = [
      ...await readSkillsFromPath(globalPrefix, 'global'),
      ...await readSkillsRecursive(path.join(directory, '.opencode', 'skills'), 'project'),
      ...await readSkillsRecursive(directory, 'auto'),
    ]
    for (const skill of skills) {
      const classification = classifySkillLocation(skill.location, globalPrefix, allProjects, directory)
      if (classification) addUniqueSkill(result, seenLocations, seenNames, skill, classification)
    }
  } else {
    const targetProjects = repoId
      ? allProjects.filter(p => p.id === repoId)
      : allProjects

    if (repoId && targetProjects.length === 0) {
      throw new Error(`Project with id ${repoId} not found`)
    }

    const directories = targetProjects.length > 0
      ? targetProjects.map(p => p.fullPath)
      : [getWorkspacePath()]

    for (const dir of directories) {
      const skills = [
        ...await readSkillsFromPath(globalPrefix, 'global'),
        ...await readSkillsRecursive(path.join(dir, '.opencode', 'skills'), 'project'),
        ...await readSkillsRecursive(dir, 'auto'),
      ]
      for (const skill of skills) {
        const classification = classifySkillLocation(skill.location, globalPrefix, allProjects)
        if (classification) addUniqueSkill(result, seenLocations, seenNames, skill, classification)
      }
    }
  }

  return result
}

export async function getSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  repoId?: number,
): Promise<SkillFileInfo> {
  validateSkillName(name)
  const skills = await listManagedSkills(db, repoId)
  const match = skills.find(s =>
    s.name === name &&
    s.scope === scope &&
    (scope === 'global' || s.repoId === repoId),
  )
  if (!match) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }
  return match
}

export async function createSkill(
  db: Database,
  input: CreateSkillRequest,
): Promise<SkillFileInfo> {
  const { name, description, body, scope, repoId } = input

  const skillPath = await getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (exists) {
    throw new Error(`Skill "${name}" already exists in ${scope} scope`)
  }

  await ensureDirectoryExists(path.dirname(skillPath))
  await writeFileContent(skillPath, buildSkillFileContent(name, description, body))
  logger.info(`Created skill "${name}" at ${skillPath}`)

  const project = repoId ? await getProjectById(db, String(repoId)) : null

  return {
    name,
    description,
    body,
    scope,
    location: skillPath,
    repoId: scope === 'project' ? repoId : undefined,
    repoName: project?.name,
  }
}

export async function updateSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  input: UpdateSkillRequest,
  repoId?: number,
): Promise<SkillFileInfo> {
  const skillPath = await getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }

  const existing = await getSkill(db, name, scope, repoId)

  const description = input.description ?? existing.description
  const body = input.body ?? existing.body

  await writeFileContent(skillPath, buildSkillFileContent(name, description, body))
  logger.info(`Updated skill "${name}" at ${skillPath}`)

  return {
    name,
    description,
    body,
    scope,
    location: skillPath,
    repoId: existing.repoId,
    repoName: existing.repoName,
  }
}

export async function deleteSkill(
  db: Database,
  name: string,
  scope: SkillScope,
  repoId?: number,
): Promise<void> {
  const skillPath = await getSkillFilePath(db, scope, name, repoId)
  const exists = await fileExists(skillPath)

  if (!exists) {
    throw new Error(`Skill "${name}" not found in ${scope} scope`)
  }

  await deletePath(path.dirname(skillPath))
  logger.info(`Deleted skill "${name}" from ${path.dirname(skillPath)}`)
}
