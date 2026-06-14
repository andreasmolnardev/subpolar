import type PocketBase from 'pocketbase'

const KEY = 'internal_token'

export async function getOrCreateInternalToken(pb: PocketBase): Promise<string> {
  try {
    const record = await pb.collection('app_secrets').getFirstListItem(`key = "${KEY}"`)
    return (record as unknown as { value: string }).value
  } catch {
    const { randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    await pb.collection('app_secrets').create({
      key: KEY,
      value: token,
      created_at: now,
      updated_at: now,
    })
    return token
  }
}

export async function rotateInternalToken(pb: PocketBase): Promise<string> {
  const { randomBytes } = await import('node:crypto')
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  try {
    const existing = await pb.collection('app_secrets').getFirstListItem(`key = "${KEY}"`)
    await pb.collection('app_secrets').update(existing.id, {
      value: token,
      updated_at: now,
    })
  } catch {
    await pb.collection('app_secrets').create({
      key: KEY,
      value: token,
      created_at: now,
      updated_at: now,
    })
  }
  return token
}
