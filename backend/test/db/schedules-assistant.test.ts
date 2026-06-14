import { describe, it, expect, beforeEach } from 'vitest'
import type PocketBase from 'pocketbase'
import {
  cleanupOrphanedAutomations,
  listAllAutomationJobsWithRepos,
  listAllAutomationRuns,
} from '../../src/db/automations'

function createMockPocketBase(): PocketBase {
  const repos = new Map<string, Record<string, unknown>>()
  const automationJobs = new Map<string, Record<string, unknown>>()
  const automationRuns = new Map<string, Record<string, unknown>>()
  let idCounter = 0

  const collections: Record<string, Map<string, Record<string, unknown>>> = {
    repos,
    automation_jobs: automationJobs,
    automation_runs: automationRuns,
  }

  return {
    collection: (name: string) => {
      const col = collections[name] || (collections[name] = new Map())
      return {
        getOne: async <T = unknown>(id: string): Promise<T> => {
          const record = col.get(id)
          if (!record) throw new Error('Not found')
          return record as unknown as T
        },
        getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
          for (const record of col.values()) {
            return record as unknown as T
          }
          throw new Error('Not found')
        },
        getFullList: async <T = unknown>(options?: Record<string, unknown>): Promise<T[]> => {
          let items = Array.from(col.values())
          if (options?.filter && typeof options.filter === 'string') {
            const filterStr = options.filter
            const matches = filterStr.match(/(\w+)\s*=\s*"([^"]+)"/g)
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
            const field = (options.sort as string).replace(/^-/, '')
            items.sort((a, b) => {
              const aVal = (a as Record<string, unknown>)[field] as number
              const bVal = (b as Record<string, unknown>)[field] as number
              return ((aVal || 0) - (bVal || 0)) * dir
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
          const id = String(idCounter)
          const record = { ...data, id }
          col.set(id, record)
          return record as unknown as T
        },
        update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          const existing = col.get(id)
          if (!existing) throw new Error('Not found')
          const updated = { ...existing, ...data }
          col.set(id, updated)
          return updated as unknown as T
        },
        delete: async (id: string): Promise<boolean> => col.delete(id),
      }
    },
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

describe('assistant repo (repo_id=0) in global aggregate queries', () => {
  let pb: PocketBase

  beforeEach(async () => {
    pb = createMockPocketBase()
    const now = Date.now()

    await pb.collection('repos').create({
      id: '1',
      repo_url: 'https://github.com/test/my-repo',
      local_path: 'repos/my-repo',
      branch: 'main',
      default_branch: 'main',
      clone_status: 'ready',
      cloned_at: now,
    })

    await pb.collection('automation_jobs').create({
      id: '1',
      repo_id: '1',
      name: 'Real repo job',
      enabled: true,
      automation_mode: 'interval',
      prompt: 'Run the real repo job',
      created_at: now,
      updated_at: now,
    })

    await pb.collection('automation_jobs').create({
      id: '2',
      repo_id: '0',
      name: 'Assistant job',
      enabled: true,
      automation_mode: 'interval',
      prompt: 'Run the assistant job',
      created_at: now,
      updated_at: now,
    })

    await pb.collection('automation_runs').create({
      id: '1',
      job_id: '1',
      repo_id: '1',
      trigger_source: 'manual',
      status: 'completed',
      started_at: now,
      created_at: now,
    })

    await pb.collection('automation_runs').create({
      id: '2',
      job_id: '2',
      repo_id: '0',
      trigger_source: 'manual',
      status: 'completed',
      started_at: now,
      created_at: now,
    })
  })

  it('listAllAutomationJobsWithRepos includes assistant jobs with synthetic metadata', async () => {
    const jobs = await listAllAutomationJobsWithRepos(pb)
    expect(jobs).toHaveLength(2)

    const assistantJob = jobs.find(j => j.repoId === 0)
    expect(assistantJob).toBeDefined()
    if (assistantJob) {
      expect(assistantJob.repoName).toBe('Assistant')
      expect(assistantJob.repoPath).toBe('assistant')
      expect(assistantJob.repoUrl).toBe('')
      expect(assistantJob.name).toBe('Assistant job')
    }

    const realJob = jobs.find(j => j.repoId === 1)
    expect(realJob).toBeDefined()
    if (realJob) {
      expect(realJob.repoName).toBe('my-repo')
      expect(realJob.repoPath).toBe('repos/my-repo')
      expect(realJob.repoUrl).toBe('https://github.com/test/my-repo')
      expect(realJob.name).toBe('Real repo job')
    }
  })

  it('listAllAutomationRuns includes assistant runs with synthetic metadata', async () => {
    const runs = await listAllAutomationRuns(pb, {})
    expect(runs).toHaveLength(2)

    const assistantRun = runs.find(r => r.repoId === 0)
    expect(assistantRun).toBeDefined()
    if (assistantRun) {
      expect(assistantRun.repoName).toBe('Assistant')
      expect(assistantRun.repoPath).toBe('assistant')
      expect(assistantRun.jobName).toBe('Assistant job')
    }

    const realRun = runs.find(r => r.repoId === 1)
    expect(realRun).toBeDefined()
    if (realRun) {
      expect(realRun.repoName).toBe('my-repo')
      expect(realRun.repoPath).toBe('repos/my-repo')
      expect(realRun.jobName).toBe('Real repo job')
    }
  })

  it('listAllAutomationRuns with repoId=0 filter returns only assistant runs', async () => {
    const runs = await listAllAutomationRuns(pb, { repoId: 0 })
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(run.repoId).toBe(0)
    expect(run.repoName).toBe('Assistant')
    expect(run.repoPath).toBe('assistant')
  })

  it('cleanupOrphanedAutomations keeps assistant automations while deleting real repo orphans', async () => {
    await pb.collection('repos').delete('1')

    const result = await cleanupOrphanedAutomations(pb)

    expect(result).toEqual({ orphanedJobs: 1, orphanedRuns: 1 })
    const jobs = await listAllAutomationJobsWithRepos(pb)
    expect(jobs.map((job) => job.repoId)).toEqual([0])
    const runs = await listAllAutomationRuns(pb, {})
    expect(runs.map((run) => run.repoId)).toEqual([0])
  })
})
