import { describe, expect, it } from 'vitest'
import { discoverOpenApiDocument, normalizeProviderName } from '../../src/services/openapi'

const document = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Example', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'Get a user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/users': {
      post: {
        operationId: 'createUser',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
      },
    },
  },
})

describe('OpenAPI discovery', () => {
  it('creates adapter-neutral tool IDs and grouped parameter schemas', () => {
    const tools = discoverOpenApiDocument({ providerName: 'Example API', document })
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'example-api.getUser', method: 'get', path: '/users/{id}' }),
      expect.objectContaining({ toolId: 'example-api.createUser', method: 'post', path: '/users' }),
    ]))
    expect(tools.find(tool => tool.subtool === 'getUser')?.inputSchema).toMatchObject({ required: ['path'], properties: { path: { required: ['id'] } } })
    expect(tools.find(tool => tool.subtool === 'createUser')?.inputSchema).toMatchObject({ required: ['body'], properties: { body: { required: ['name'] } } })
  })

  it('rejects unsupported documents and normalizes providers', () => {
    expect(normalizeProviderName(' GitHub API ')).toBe('github-api')
    expect(() => discoverOpenApiDocument({ providerName: 'api', document: JSON.stringify({ swagger: '2.0', paths: {} }) })).toThrow('Only OpenAPI 3.0 and 3.1 JSON documents are supported')
  })
})
