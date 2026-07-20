import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const environments = ['development', 'production'] as const
const services = {
  development: ['backend', 'frontend', 'pocketbase'],
  production: ['app', 'pocketbase'],
} as const

type Environment = typeof environments[number]

function composeFile(environment: Environment): string {
  return path.join(root, environment === 'development' ? 'docker-compose.dev.yml' : 'docker-compose.yml')
}

function serviceSchema(environment: Environment) {
  return z.enum(services[environment])
}

async function dockerCompose(environment: Environment, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['compose', '-f', composeFile(environment), ...args], { cwd: root })
    return [stdout, stderr].filter(Boolean).join('\n').trim() || 'Command completed successfully.'
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string }
    const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join('\n').trim()
    throw new Error(output || 'Docker Compose command failed.')
  }
}

function response(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

const server = new McpServer({ name: 'subpolar-stack', version: '1.0.0' })

server.registerTool('stack_status', {
  title: 'Stack status',
  description: 'Show all containers and their current state for the development or production stack.',
  inputSchema: {
    environment: z.enum(environments).default('development'),
  },
}, async ({ environment }) => response(await dockerCompose(environment, ['ps', '--all'])))

server.registerTool('stack_up', {
  title: 'Start stack or service',
  description: 'Start the complete Docker Compose stack or one service. Set recreate to replace its container.',
  inputSchema: {
    environment: z.enum(environments).default('development'),
    service: z.enum(['backend', 'frontend', 'pocketbase', 'app']).optional(),
    recreate: z.boolean().default(false),
  },
}, async ({ environment, service, recreate }) => {
  if (service && !serviceSchema(environment).safeParse(service).success) {
    throw new Error(`Service "${service}" is not available in the ${environment} stack.`)
  }
  return response(await dockerCompose(environment, ['up', '-d', ...(recreate ? ['--force-recreate'] : []), ...(service ? [service] : [])]))
})

server.registerTool('stack_restart', {
  title: 'Restart stack or service',
  description: 'Restart the complete Docker Compose stack or one service without rebuilding images.',
  inputSchema: {
    environment: z.enum(environments).default('development'),
    service: z.enum(['backend', 'frontend', 'pocketbase', 'app']).optional(),
  },
}, async ({ environment, service }) => {
  if (service && !serviceSchema(environment).safeParse(service).success) {
    throw new Error(`Service "${service}" is not available in the ${environment} stack.`)
  }
  return response(await dockerCompose(environment, ['restart', ...(service ? [service] : [])]))
})

server.registerTool('stack_logs', {
  title: 'Stack logs',
  description: 'Read recent Docker Compose logs for the complete stack or one service.',
  inputSchema: {
    environment: z.enum(environments).default('development'),
    service: z.enum(['backend', 'frontend', 'pocketbase', 'app']).optional(),
    tail: z.number().int().min(1).max(1000).default(200),
  },
}, async ({ environment, service, tail }) => {
  if (service && !serviceSchema(environment).safeParse(service).success) {
    throw new Error(`Service "${service}" is not available in the ${environment} stack.`)
  }
  return response(await dockerCompose(environment, ['logs', '--tail', String(tail), ...(service ? [service] : [])]))
})

server.registerTool('build_production_images', {
  title: 'Build production images',
  description: 'Build the production app, PocketBase, or every production Docker image.',
  inputSchema: {
    service: z.enum(['all', 'app', 'pocketbase']).default('all'),
    noCache: z.boolean().default(false),
  },
}, async ({ service, noCache }) => response(await dockerCompose('production', [
  'build',
  ...(noCache ? ['--no-cache'] : []),
  ...(service === 'all' ? [] : [service]),
])))

await server.connect(new StdioServerTransport())
