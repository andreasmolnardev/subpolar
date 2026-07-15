import PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'
export async function signUpUser(pb: PocketBase, email: string, password: string, name: string) {
  return pb.collection('users').create({
    email,
    password,
    passwordConfirm: password,
    name,
  })
}

export async function signInUser(pb: PocketBase, email: string, password: string) {
  return pb.collection('users').authWithPassword(email, password)
}

export async function getSession(pb: PocketBase) {
  if (!pb.authStore.isValid) return null
  try {
    await pb.collection('users').authRefresh()
    return {
      user: pb.authStore.model,
      token: pb.authStore.token,
    }
  } catch {
    pb.authStore.clear()
    return null
  }
}

export async function signOutUser(pb: PocketBase) {
  pb.authStore.clear()
}

export async function getUserCount(pb: PocketBase) {
  const result = await pb.collection('users').getList(1, 1, { fields: 'id' })
  return result.totalItems
}

export async function getUserByEmail(pb: PocketBase, email: string) {
  try {
    return await pb.collection('users').getFirstListItem(`email="${email}"`)
  } catch {
    return null
  }
}

export async function updateUserPassword(
  pb: PocketBase,
  userId: string,
  currentPassword: string,
  newPassword: string
) {
  return pb.collection('users').update(userId, {
    password: newPassword,
    passwordConfirm: newPassword,
    oldPassword: currentPassword,
  })
}

export async function syncAdminFromEnv(pb: PocketBase) {
  const adminEmail = ENV.AUTH.ADMIN_EMAIL || ''
  const adminPassword = ENV.AUTH.ADMIN_PASSWORD || ''

  if (!adminEmail || !adminPassword) return

  const existing = await getUserByEmail(pb, adminEmail)
  if (existing) return

  try {
    await signUpUser(pb, adminEmail, adminPassword, 'Admin')
    logger.info('Created admin user from env')
  } catch (err) {
    logger.error('Failed to create admin user:', err)
  }
}
