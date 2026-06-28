import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from '../db/schema'
import {
  createNote,
  createTodoItem,
  createTodoList,
  deleteNote,
  deleteTodoItem,
  deleteTodoList,
  listMailAccounts,
  listNotes,
  listTodoItems,
  listTodoLists,
  updateNote,
  updateTodoItem,
} from '../db/productivity'
import { logger } from '../utils/logger'

const DEFAULT_USER_ID = 'default'

const CreateTodoListSchema = z.object({ name: z.string().min(1).max(120) })
const CreateTodoItemSchema = z.object({ listId: z.string().min(1), text: z.string().min(1).max(500) })
const UpdateTodoItemSchema = z.object({ text: z.string().min(1).max(500).optional(), completed: z.boolean().optional() })
const NoteSchema = z.object({
  title: z.string().min(1).max(160),
  tags: z.array(z.string().min(1).max(48)).max(12),
  text: z.string().max(100_000),
})

function getUserId(queryValue: string | undefined): string {
  return queryValue || DEFAULT_USER_ID
}

export function createProductivityRoutes(db: Database) {
  const app = new Hono()

  app.get('/todos', async (c) => {
    const userId = getUserId(c.req.query('userId'))
    const lists = await listTodoLists(db, userId)
    const items = await listTodoItems(db, userId)
    return c.json({ lists, items })
  })

  app.post('/todo-lists', async (c) => {
    try {
      return c.json(await createTodoList(db, getUserId(c.req.query('userId')), CreateTodoListSchema.parse(await c.req.json()).name))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid todo list data', details: error.issues }, 400)
      logger.error('Failed to create todo list:', error)
      return c.json({ error: 'Failed to create todo list' }, 500)
    }
  })

  app.delete('/todo-lists/:id', async (c) => {
    await deleteTodoList(db, getUserId(c.req.query('userId')), c.req.param('id'))
    return c.json({ success: true })
  })

  app.post('/todo-items', async (c) => {
    try {
      const parsed = CreateTodoItemSchema.parse(await c.req.json())
      return c.json(await createTodoItem(db, getUserId(c.req.query('userId')), parsed.listId, parsed.text))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid todo item data', details: error.issues }, 400)
      logger.error('Failed to create todo item:', error)
      return c.json({ error: 'Failed to create todo item' }, 500)
    }
  })

  app.patch('/todo-items/:id', async (c) => {
    try {
      return c.json(await updateTodoItem(db, c.req.param('id'), UpdateTodoItemSchema.parse(await c.req.json())))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid todo item data', details: error.issues }, 400)
      logger.error('Failed to update todo item:', error)
      return c.json({ error: 'Failed to update todo item' }, 500)
    }
  })

  app.delete('/todo-items/:id', async (c) => {
    await deleteTodoItem(db, c.req.param('id'))
    return c.json({ success: true })
  })

  app.get('/notes', async (c) => c.json({ notes: await listNotes(db, getUserId(c.req.query('userId'))) }))

  app.post('/notes', async (c) => {
    try {
      return c.json(await createNote(db, getUserId(c.req.query('userId')), NoteSchema.parse(await c.req.json())))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid note data', details: error.issues }, 400)
      logger.error('Failed to create note:', error)
      return c.json({ error: 'Failed to create note' }, 500)
    }
  })

  app.put('/notes/:id', async (c) => {
    try {
      return c.json(await updateNote(db, c.req.param('id'), NoteSchema.parse(await c.req.json())))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid note data', details: error.issues }, 400)
      logger.error('Failed to update note:', error)
      return c.json({ error: 'Failed to update note' }, 500)
    }
  })

  app.delete('/notes/:id', async (c) => {
    await deleteNote(db, c.req.param('id'))
    return c.json({ success: true })
  })

  app.get('/mail/accounts', async (c) => c.json({ accounts: await listMailAccounts(db) }))

  return app
}
