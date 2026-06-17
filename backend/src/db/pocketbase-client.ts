import PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'

const POCKETBASE_URL = ENV.POCKETBASE.URL

let pbClient: PocketBase | null = null

export async function getPocketBaseClient(): Promise<PocketBase> {
  if (pbClient) {
    return pbClient
  }

  const baseUrl = ENV.POCKETBASE.URL || 'http://localhost:8090'
  const email = ENV.POCKETBASE.EMAIL || 'admin@example.com'
  const password = ENV.POCKETBASE.PASSWORD || 'adminpassword'

  const client = new PocketBase(baseUrl)

  try {
    await authenticatePocketBaseAdmin(client, email, password)
    logger.info('PocketBase: Connected with superuser authentication')
  } catch (superuserError) {
    logger.error('PocketBase: Superuser authentication failed:', superuserError)
    throw new Error('Failed to authenticate with PocketBase superuser credentials')
  }

  pbClient = client
  return client
}

async function authenticatePocketBaseAdmin(client: PocketBase, email: string, password: string): Promise<void> {
  try {
    await client.collection('_superusers').authWithPassword(email, password)
  } catch (superuserError) {
    const response = await fetch(`${client.baseUrl}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    }).catch(() => null)

    if (!response?.ok) {
      throw superuserError
    }

    const auth = await response.json() as { token?: string; admin?: unknown }
    if (!auth.token) {
      throw superuserError
    }

    client.authStore.save(auth.token, auth.admin)
  }
}

export async function closePocketBaseClient(): Promise<void> {
  if (pbClient) {
    pbClient.authStore.clear()
    pbClient = null
    logger.info('PocketBase: Connection closed')
  }
}

export async function healthCheck(): Promise<boolean> {
  const client = await getPocketBaseClient()
  try {
    const response = await fetch(`${client.baseUrl}/api/health`)
    return response.ok
  } catch (error) {
    logger.error('PocketBase health check failed:', error)
    return false
  }
}

export { POCKETBASE_URL }
export type { PocketBase }
