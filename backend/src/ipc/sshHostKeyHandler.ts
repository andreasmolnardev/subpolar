import * as path from 'path'
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import type { IPCHandler } from './ipcServer'
import type PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { getWorkspacePath } from '@subpolar/shared/config/env'
import { broadcastSSHHostKeyRequest } from '../services/sse-aggregator'
import { executeCommand } from '../utils/process'
import { parseSSHHost, normalizeHostPort } from '../utils/ssh-key-manager'

interface SSHHostKeyRequest {
  id: string
  host: string
  ip: string
  keyType: string
  fingerprint: string
  timestamp: number
  isKeyChanged: boolean
}

export class SSHHostKeyHandler implements IPCHandler {
  private pendingRequests = new Map<string, {
    request: SSHHostKeyRequest
    resolve: (value: boolean) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private readonly timeoutMs: number
  private knownHostsPath: string
  private database: PocketBase

  constructor(database: PocketBase, timeoutMs: number = 120_000) {
    this.database = database
    this.timeoutMs = timeoutMs
    const configDir = path.join(getWorkspacePath(), 'config')
    this.knownHostsPath = path.join(configDir, 'known_hosts')
    logger.info(`SSHHostKeyHandler initialized with timeout=${timeoutMs}ms, known_hosts=${this.knownHostsPath}`)
  }

  private async ensureKnownHostsFile(): Promise<void> {
    try {
      const configDir = path.join(getWorkspacePath(), 'config')
      await fs.mkdir(configDir, { recursive: true })
      try {
        await fs.access(this.knownHostsPath)
      } catch {
        await fs.writeFile(this.knownHostsPath, '', { mode: 0o600 })
        logger.info(`Created known_hosts file at ${this.knownHostsPath}`)
      }
    } catch (error) {
      logger.error('Failed to ensure known_hosts file:', error)
    }
  }

  async verifyHostKeyBeforeOperation(repoUrl: string): Promise<boolean> {
    const { host, port } = parseSSHHost(repoUrl)
    const hostPort = normalizeHostPort(host, port)

    const trustedHost = await this.getTrustedHost(hostPort)
    if (trustedHost) {
      logger.info(`Host ${hostPort} already trusted, skipping verification`)
      return true
    }

    try {
      const publicKey = await this.fetchHostPublicKey(host, port)
      logger.info(`Fetched public key for ${hostPort}`)

      const parts = publicKey.split(' ')
      const keyType = parts[1] || 'UNKNOWN'
      const requestId = crypto.randomBytes(16).toString('hex')
      const hostKeyRequest: SSHHostKeyRequest = {
        id: requestId,
        host: hostPort,
        ip: '',
        keyType,
        fingerprint: publicKey,
        timestamp: Date.now(),
        isKeyChanged: false
      }

      logger.info(`Broadcasting SSH host key request: ${requestId} for host=${hostPort}`)
      broadcastSSHHostKeyRequest({ ...hostKeyRequest, requestId, action: 'verify' })

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          logger.info(`SSH host key request timed out: ${requestId}, rejecting connection`)
          this.pendingRequests.delete(requestId)
          resolve(false)
        }, this.timeoutMs)

        this.pendingRequests.set(requestId, { request: hostKeyRequest, resolve, timeout })
      })
    } catch (error) {
      logger.warn(`Failed to fetch host key for ${hostPort}, rejecting connection:`, (error as Error).message)
      return false
    }
  }

  async autoAcceptHostKey(repoUrl: string): Promise<void> {
    const { host, port } = parseSSHHost(repoUrl)
    const hostPort = normalizeHostPort(host, port)

    const trustedHost = await this.getTrustedHost(hostPort)
    if (trustedHost) {
      logger.info(`Host ${hostPort} already trusted, skipping auto-accept`)
      return
    }

    const publicKey = await this.fetchHostPublicKey(host, port)
    await this.addToKnownHosts(hostPort, publicKey)
    await this.saveTrustedHost(hostPort, publicKey)
    logger.info(`Auto-accepted SSH host key for ${hostPort}`)
  }

  private async fetchHostPublicKey(host: string, port?: string): Promise<string> {
    const portArgs = port ? ['-p', port] : []
    const result = await executeCommand(
      ['ssh-keyscan', '-t', 'ed25519,rsa,ecdsa', ...portArgs, host],
      { silent: true, ignoreExitCode: true }
    ) as string | { exitCode: number; stdout: string; stderr: string }
    const output = typeof result === 'string' ? result : result.stdout
    const bracketedHost = port && port !== '22' ? `[${host}]:${port}` : host
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (line.startsWith(host) || line.startsWith(bracketedHost)) {
        return line
      }
    }

    throw new Error('No valid host keys found')
  }

  async handle(request: unknown): Promise<unknown> {
    const response = request as { requestId: string; response: 'accept' | 'reject' }
    return await this.respond(response)
  }

  async respond(response: { requestId: string; response: 'accept' | 'reject' }): Promise<{ success: boolean; error?: string }> {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) {
      return { success: false, error: 'Request not found or expired' }
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.requestId)

    if (response.response === 'accept') {
      await this.addToKnownHosts(pending.request.host, pending.request.fingerprint)
      await this.saveTrustedHost(pending.request.host, pending.request.fingerprint)
      logger.info(`Accepted SSH host key for ${pending.request.host}`)
    } else {
      logger.info(`Rejected SSH host key for ${pending.request.host}`)
    }

    pending.resolve(response.response === 'accept')
    return { success: true }
  }

  private async addToKnownHosts(host: string, publicKey: string): Promise<void> {
    try {
      await fs.appendFile(this.knownHostsPath, publicKey + '\n')
      logger.info(`Added host to known_hosts: ${host}`)
    } catch (error) {
      logger.error(`Failed to add host to known_hosts: ${error}`)
    }
  }

  private async loadFromDatabaseToKnownHosts(): Promise<void> {
    try {
      const hosts = await this.database.collection('trusted_ssh_hosts').getFullList<{
        id: number
        host: string
        key_type: string
        public_key: string
        created_at: number
        updated_at: number
      }>()

      const entries = hosts.map(h => h.public_key).join('\n')
      await fs.writeFile(this.knownHostsPath, entries + '\n', { mode: 0o600 })
      logger.info(`Loaded ${hosts.length} trusted hosts from database to known_hosts`)
    } catch (error) {
      logger.error('Failed to load trusted hosts from database:', error)
    }
  }

  private async getTrustedHost(host: string): Promise<{ key_type: string; public_key: string } | null> {
    try {
      const result = await this.database.collection('trusted_ssh_hosts').getFirstListItem<{
        key_type: string
        public_key: string
      }>(`host = "${host}"`)
      return result || null
    } catch (error) {
      logger.error(`Failed to get trusted host ${host}:`, error)
      return null
    }
  }

  private async saveTrustedHost(host: string, publicKey: string): Promise<void> {
    try {
      const parts = publicKey.split(' ')
      const keyType = parts[1] || 'UNKNOWN'
      const now = Date.now()
      const existing = await this.getTrustedHost(host)
      if (existing) {
        await this.database.collection('trusted_ssh_hosts').update(existing.id, {
          key_type: keyType,
          public_key: publicKey,
          updated_at: now,
        })
        logger.info(`Updated trusted host in database: ${host}`)
      } else {
        await this.database.collection('trusted_ssh_hosts').create({
          host,
          key_type: keyType,
          public_key: publicKey,
          created_at: now,
          updated_at: now,
        })
        logger.info(`Saved new trusted host to database: ${host}`)
      }
    } catch (error) {
      logger.error(`Failed to save trusted host ${host}:`, error)
    }
  }

  async initialize(): Promise<void> {
    await this.ensureKnownHostsFile()
    await this.loadFromDatabaseToKnownHosts()
    logger.info('SSHHostKeyHandler initialized with known_hosts from database')
  }

  getKnownHostsPath(): string {
    return this.knownHostsPath
  }

  getEnv(): Record<string, string> {
    return {
      KNOWN_HOSTS_PATH: this.knownHostsPath
    }
  }

  getPendingCount(): number {
    return this.pendingRequests.size
  }
}

export function createSSHHostKeyHandler(database: PocketBase, timeoutMs?: number): SSHHostKeyHandler {
  return new SSHHostKeyHandler(database, timeoutMs)
}
