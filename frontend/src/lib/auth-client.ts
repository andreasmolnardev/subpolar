import PocketBase from 'pocketbase'
import { API_BASE_URL } from '@/config'

export const pb = new PocketBase(API_BASE_URL)

export type AuthUser = Record<string, unknown> | null

export async function changePassword(currentPassword: string, newPassword: string) {
  if (!pb.authStore.model?.id) throw new Error('Not authenticated')
  return pb.collection('users').update(pb.authStore.model.id, {
    password: newPassword,
    passwordConfirm: newPassword,
    oldPassword: currentPassword,
  })
}

export function getSession() {
  return {
    user: pb.authStore.model,
    token: pb.authStore.token,
    isValid: pb.authStore.isValid,
  }
}
