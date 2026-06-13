/**
 * PocketBase Client
 * 
 * A client wrapper for PocketBase that provides basic CRUD operations.
 * This replaces the SQLite database with PocketBase running in Docker.
 * 
 * Uses the PocketBase JS SDK: https://github.com/pocketbase/js-sdk
 */

import PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'

export interface PbCollectionClient {
  getOne(id: string): Promise<Record<string, any> | null>
  getFirst(filter?: string): Promise<Record<string, any> | null>
  getList(page?: number, perPage?: number, options?: any): Promise<{ items: Record<string, any>[], total: number }>
  getFullList(options?: any): Promise<Record<string, any>[]>
  create(data: Record<string, any>): Promise<Record<string, any>>
  update(id: string, data: Record<string, any>): Promise<Record<string, any>>
  delete(id: string): Promise<void>
}

class PbCollection implements PbCollectionClient {
  private client: PocketBase
  private collectionName: string
  
  constructor(client: PocketBase, collectionName: string) {
    this.client = client
    this.collectionName = collectionName
  }
  
  async getOne(id: string): Promise<Record<string, any> | null> {
    try {
      const record = await this.client.records.getOne(this.collectionName, id)
      return { ...record, id: String(record.id) }
    } catch (error: any) {
      if (error.status === 404) {
        return null
      }
      throw error
    }
  }
  
  async getFirst(filter?: string): Promise<Record<string, any> | null> {
    try {
      const record = await this.client.records.getFirstListItem(
        this.collectionName,
        filter || '',
        { expand: '' }
      )
      return { ...record, id: String(record.id) }
    } catch (error: any) {
      if (error.status === 404) {
        return null
      }
      throw error
    }
  }
  
  async getList(page = 1, perPage = 100, options: any = {}): Promise<{ items: Record<string, any>[], total: number }> {
    const result = await this.client.records.getList(
      this.collectionName,
      page,
      perPage,
      options
    )
    return {
      items: result.items.map(r => ({ ...r, id: String(r.id) })),
      total: result.totalItems
    }
  }
  
  async getFullList(options: any = {}): Promise<Record<string, any>[]> {
    const result = await this.client.records.getFullList(
      this.collectionName,
      options
    )
    return result.map(r => ({ ...r, id: String(r.id) }))
  }
  
  async create(data: Record<string, any>): Promise<Record<string, any>> {
    const record = await this.client.records.create(this.collectionName, data)
    return { ...record, id: String(record.id) }
  }
  
  async update(id: string, data: Record<string, any>): Promise<Record<string, any>> {
    const record = await this.client.records.update(this.collectionName, id, data)
    return { ...record, id: String(record.id) }
  }
  
  async delete(id: string): Promise<void> {
    await this.client.records.delete(this.collectionName, id)
  }
}

// Singleton PocketBase client instance
let pbClient: PocketBase | null = null

/**
 * Get or create the PocketBase client instance
 */
export async function getPocketBaseClient(): Promise<PocketBase> {
  if (pbClient) {
    return pbClient
  }

  const baseUrl = ENV.POCKETBASE.URL || 'http://localhost:8090'
  const email = ENV.POCKETBASE.EMAIL || 'admin@example.com'
  const password = ENV.POCKETBASE.PASSWORD || 'adminpassword'

  const client = new PocketBase(baseUrl)

  // Authenticate with PocketBase
  try {
    await client.admins.authWithPassword(email, password)
    logger.info('PocketBase: Connected with admin authentication')
  } catch (error) {
    logger.warn('PocketBase: Admin auth failed, trying user auth:', error)
    try {
      await client.users.authWithPassword(email, password)
      logger.info('PocketBase: Connected with user authentication')
    } catch (authError) {
      logger.error('PocketBase: All authentication attempts failed:', authError)
      throw new Error('Failed to authenticate with PocketBase')
    }
  }

  pbClient = client
  return client
}

/**
 * Close the PocketBase client connection
 */
export async function closePocketBaseClient(): Promise<void> {
  if (pbClient) {
    pbClient.authStore.clear()
    pbClient = null
    logger.info('PocketBase: Connection closed')
  }
}

/**
 * Check PocketBase health
 */
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

/**
 * Get a collection reference
 */
export function getCollection(client: PocketBase, collectionName: string): PbCollectionClient {
  return new PbCollection(client, collectionName)
}

export type { PocketBase }
