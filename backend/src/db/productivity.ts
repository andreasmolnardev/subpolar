import type PocketBase from 'pocketbase'
import { listIntegrations } from './integrations'

export interface TodoList {
  id: string
  user_id: string
  name: string
  created_at: number
  updated_at: number
}

export interface TodoItem {
  id: string
  user_id: string
  list_id: string
  text: string
  completed: boolean
  created_at: number
  updated_at: number
}

export interface Note {
  id: string
  user_id: string
  title: string
  tags: string[]
  text: string
  created_at: number
  updated_at: number
}

export interface MailAccount {
  id: string
  name: string
  username: string
  fromAddress: string
  folders: Array<{ name: string; role: string }>
}

const DEFAULT_MAIL_FOLDERS = [
  { name: 'Inbox', role: 'inbox' },
  { name: 'Sent', role: 'sent' },
  { name: 'Drafts', role: 'drafts' },
  { name: 'Archive', role: 'archive' },
  { name: 'Trash', role: 'trash' },
]

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toTodoList(record: Record<string, unknown>): TodoList {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    name: String(record.name),
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

function toTodoItem(record: Record<string, unknown>): TodoItem {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    list_id: String(record.list_id),
    text: String(record.text),
    completed: record.completed === true,
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

function toNote(record: Record<string, unknown>): Note {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    title: String(record.title),
    tags: toStringArray(record.tags),
    text: String(record.text ?? ''),
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

function escapeFilterValue(value: string): string {
  return value.replaceAll('"', '\\"')
}

export async function listTodoLists(pb: PocketBase, userId: string): Promise<TodoList[]> {
  const records = await pb.collection('todo_lists').getFullList({
    filter: `user_id = "${escapeFilterValue(userId)}"`,
    sort: '-updated_at',
  })
  return records.map(record => toTodoList(record as unknown as Record<string, unknown>))
}

export async function createTodoList(pb: PocketBase, userId: string, name: string): Promise<TodoList> {
  const now = Date.now()
  const record = await pb.collection('todo_lists').create({ user_id: userId, name, created_at: now, updated_at: now })
  return toTodoList(record as unknown as Record<string, unknown>)
}

export async function deleteTodoList(pb: PocketBase, userId: string, id: string): Promise<void> {
  const items = await listTodoItems(pb, userId, id)
  await Promise.all(items.map(item => pb.collection('todo_items').delete(item.id)))
  await pb.collection('todo_lists').delete(id)
}

export async function listTodoItems(pb: PocketBase, userId: string, listId?: string): Promise<TodoItem[]> {
  const userFilter = `user_id = "${escapeFilterValue(userId)}"`
  const listFilter = listId ? ` && list_id = "${escapeFilterValue(listId)}"` : ''
  const records = await pb.collection('todo_items').getFullList({ filter: `${userFilter}${listFilter}`, sort: 'created_at' })
  return records.map(record => toTodoItem(record as unknown as Record<string, unknown>))
}

export async function createTodoItem(pb: PocketBase, userId: string, listId: string, text: string): Promise<TodoItem> {
  const now = Date.now()
  const record = await pb.collection('todo_items').create({ user_id: userId, list_id: listId, text, completed: false, created_at: now, updated_at: now })
  await pb.collection('todo_lists').update(listId, { updated_at: now })
  return toTodoItem(record as unknown as Record<string, unknown>)
}

export async function updateTodoItem(pb: PocketBase, id: string, data: { text?: string; completed?: boolean }): Promise<TodoItem> {
  const record = await pb.collection('todo_items').update(id, { ...data, updated_at: Date.now() })
  return toTodoItem(record as unknown as Record<string, unknown>)
}

export async function deleteTodoItem(pb: PocketBase, id: string): Promise<void> {
  await pb.collection('todo_items').delete(id)
}

export async function listNotes(pb: PocketBase, userId: string): Promise<Note[]> {
  const records = await pb.collection('notes').getFullList({
    filter: `user_id = "${escapeFilterValue(userId)}"`,
    sort: '-updated_at',
  })
  return records.map(record => toNote(record as unknown as Record<string, unknown>))
}

export async function createNote(pb: PocketBase, userId: string, data: { title: string; tags: string[]; text: string }): Promise<Note> {
  const now = Date.now()
  const record = await pb.collection('notes').create({ user_id: userId, ...data, created_at: now, updated_at: now })
  return toNote(record as unknown as Record<string, unknown>)
}

export async function updateNote(pb: PocketBase, id: string, data: { title: string; tags: string[]; text: string }): Promise<Note> {
  const record = await pb.collection('notes').update(id, { ...data, updated_at: Date.now() })
  return toNote(record as unknown as Record<string, unknown>)
}

export async function deleteNote(pb: PocketBase, id: string): Promise<void> {
  await pb.collection('notes').delete(id)
}

export async function listMailAccounts(pb: PocketBase): Promise<MailAccount[]> {
  const integrations = await listIntegrations(pb)
  return integrations
    .filter(integration => integration.type === 'imap_smtp' && integration.enabled)
    .map((integration) => ({
      id: integration.id,
      name: integration.name,
      username: typeof integration.config.username === 'string' ? integration.config.username : '',
      fromAddress: typeof integration.config.fromAddress === 'string' ? integration.config.fromAddress : '',
      folders: DEFAULT_MAIL_FOLDERS,
    }))
}
