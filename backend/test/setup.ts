import { beforeAll, afterAll } from 'vitest'

const originalEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  originalEnv.NODE_ENV = process.env.NODE_ENV
  originalEnv.PORT = process.env.PORT
  originalEnv.WORKSPACE_PATH = process.env.WORKSPACE_PATH
})

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})
