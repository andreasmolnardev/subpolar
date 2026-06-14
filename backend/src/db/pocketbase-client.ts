import PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'

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
    await client.admins.authWithPassword(email, password)
    logger.info('PocketBase: Connected with admin authentication')
  } catch (error) {
    logger.warn('PocketBase: Admin auth failed, trying user auth:', error)
    try {
      await client.collection('users').authWithPassword(email, password)
      logger.info('PocketBase: Connected with user authentication')
    } catch (authError) {
      logger.error('PocketBase: All authentication attempts failed:', authError)
      throw new Error('Failed to authenticate with PocketBase')
    }
  }

  pbClient = client
  return client
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

export type { PocketBase }
