import { CalDAVClient } from 'ts-caldav'
import type { Database } from '../db/schema'
import { listEnabledIntegrationsByType } from '../db/integrations'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'
import type { Integration } from '@subpolar/shared/types'

export type CalDavEventQuery = {
  range?: string
  start?: string
  end?: string
  calendarId?: string
  integrationId?: string
}

export type CreateCalDavEventInput = {
  calendarId?: string
  integrationId?: string
  title: string
  start: string
  end?: string
  location?: string
  description?: string
}

export type UpdateCalDavEventInput = {
  calendarId: string
  uid: string
  title: string
  start: string
  end: string
  location?: string
  description?: string
}

export type CreateCalDavTodoInput = {
  calendarId?: string
  text: string
}

export type UpdateCalDavTodoInput = {
  calendarId: string
  uid: string
  completed: boolean
}

export type DeleteCalDavTodoInput = {
  calendarId: string
  uid: string
}

type CalDavDateRange = {
  start: Date
  end: Date
}

async function createCalDavClient(serverUrl: string, username: string, password: string) {
  return CalDAVClient.create({
    baseUrl: serverUrl,
    auth: {
      type: 'basic',
      username,
      password,
    },
    rejectUnauthorized: !ENV.CALDAV.IGNORE_INSECURE_CERTIFICATES,
  })
}

function getCalendarName(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'Calendar'
}

function resolveCalendarUrl(baseUrl: string, calendarUrl: string): string {
  return new URL(calendarUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfNextWeek(now: Date): Date {
  const today = startOfDay(now)
  const day = today.getDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  return addDays(today, daysUntilMonday)
}

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseRangeValue(range: string, now: Date): CalDavDateRange | null {
  const normalized = range.trim().toLowerCase()
  const today = startOfDay(now)
  if (normalized === 'today') return { start: today, end: addDays(today, 1) }
  if (normalized === 'tomorrow') return { start: addDays(today, 1), end: addDays(today, 2) }
  if (normalized === 'week' || normalized === 'this week') return { start: today, end: addDays(today, 7) }
  if (normalized === 'next week') {
    const start = startOfNextWeek(now)
    return { start, end: addDays(start, 7) }
  }
  const [startValue, endValue] = range.split('/')
  if (startValue && endValue) {
    const start = parseDate(startValue)
    const end = parseDate(endValue)
    if (start && end) return { start, end }
  }
  return null
}

export function resolveCalDavDateRange(query: CalDavEventQuery = {}, now = new Date()): CalDavDateRange {
  const start = query.start ? parseDate(query.start) : null
  const end = query.end ? parseDate(query.end) : null
  const range = query.range ? parseRangeValue(query.range, now) : null
  const invalidStartOrEnd = Boolean((query.start && !start) || (query.end && !end) || ((query.start || query.end) && (!start || !end)))
  const invalidRange = Boolean(query.range && !range && (!start || !end))
  if (invalidStartOrEnd || invalidRange) {
    throw Object.assign(new Error('Calendar range must use today, tomorrow, this week, next week, ISO interval, or valid start and end dates'), { code: 'INVALID_CALENDAR_RANGE' })
  }
  const resolved = start && end ? { start, end } : range ?? { start: now, end: addDays(now, 7) }
  if (resolved.end.getTime() <= resolved.start.getTime()) {
    throw Object.assign(new Error('Calendar range end must be after start'), { code: 'INVALID_CALENDAR_RANGE' })
  }
  return resolved
}

function selectIntegrations(integrations: Integration[], query: CalDavEventQuery): Integration[] {
  const calendarIntegrationId = query.calendarId?.split(':')[0]
  const integrationId = query.integrationId ?? calendarIntegrationId
  return integrationId ? integrations.filter(integration => integration.id === integrationId) : integrations
}

export async function getUpcomingCalDavEvents(db: Database, query: CalDavEventQuery = {}) {
  const integrations = selectIntegrations(await listEnabledIntegrationsByType(db, 'caldav'), query)
  if (integrations.length === 0) {
    throw Object.assign(new Error('No enabled caldav integration is configured'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  }
  const { start, end } = resolveCalDavDateRange(query)

  const results = await Promise.all(integrations.map(async (integration) => {
    const serverUrl = String(integration.config.serverUrl ?? '')
    const username = String(integration.config.username ?? '')
    const password = String(integration.config.password ?? '')
    const calendarUrl = String(integration.config.calendarUrl ?? '')
    if (!serverUrl || !username || !password) return { calendars: [], events: [] }

    try {
      const client = await createCalDavClient(serverUrl, username, password)
      const discoveredCalendars = calendarUrl
        ? [{ name: integration.name, url: resolveCalendarUrl(serverUrl, calendarUrl) }]
        : (await client.getCalendars()).map((calendar) => ({
          name: calendar.displayName || getCalendarName(calendar.url),
          url: resolveCalendarUrl(serverUrl, calendar.url),
        }))
      const calendars = discoveredCalendars.map((calendar) => ({
        id: `${integration.id}:${calendar.url}`,
        name: calendar.name,
        url: calendar.url,
      }))
      const selectedCalendars = query.calendarId ? discoveredCalendars.filter(calendar => `${integration.id}:${calendar.url}` === query.calendarId || calendar.url === query.calendarId || calendar.name === query.calendarId) : discoveredCalendars
      const events = (await Promise.all(selectedCalendars.map(async (calendar) => {
        try {
          const calDavEvents = await client.getEvents(calendar.url, { start, end })
          return calDavEvents.map((event) => ({
            id: `${integration.id}:${calendar.url}:${event.uid}`,
            calendarId: `${integration.id}:${calendar.url}`,
            uid: event.uid,
            title: event.summary || 'Untitled event',
            calendar: calendar.name,
            start: event.start.toISOString(),
            end: event.end.toISOString(),
            location: event.location || undefined,
            description: event.description || undefined,
          }))
        } catch (error) {
          logger.error(`Failed to load CalDAV calendar ${calendar.name}:`, error)
          return []
        }
      }))).flat()
      return { calendars, events }
    } catch (error) {
      logger.error(`Failed to load CalDAV events for ${integration.name}:`, error)
      return { calendars: [], events: [] }
    }
  }))

  const calendars = results.flatMap((result) => result.calendars)
  const events = results.flatMap((result) => result.events).sort((a, b) => String(a.start).localeCompare(String(b.start)))

  return { calendars, events }
}

export async function createCalDavEvent(db: Database, input: CreateCalDavEventInput) {
  const start = parseDate(input.start)
  const end = input.end ? parseDate(input.end) : new Date((start?.getTime() ?? 0) + 60 * 60 * 1000)
  if (!start || !end || end.getTime() <= start.getTime()) {
    throw Object.assign(new Error('Calendar event end must be after its start'), { code: 'INVALID_CALENDAR_EVENT' })
  }

  const integrations = selectIntegrations(await listEnabledIntegrationsByType(db, 'caldav'), input)
  if (integrations.length === 0) {
    throw Object.assign(new Error('No enabled caldav integration is configured'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  }

  for (const integration of integrations) {
    const serverUrl = String(integration.config.serverUrl ?? '')
    const username = String(integration.config.username ?? '')
    const password = String(integration.config.password ?? '')
    const calendarUrl = String(integration.config.calendarUrl ?? '')
    if (!serverUrl || !username || !password) continue

    const client = await createCalDavClient(serverUrl, username, password)
    const calendars = calendarUrl
      ? [{ name: integration.name, url: resolveCalendarUrl(serverUrl, calendarUrl) }]
      : (await client.getCalendars()).map((calendar) => ({
        name: calendar.displayName || getCalendarName(calendar.url),
        url: resolveCalendarUrl(serverUrl, calendar.url),
      }))
    const calendar = input.calendarId
      ? calendars.find(item => `${integration.id}:${item.url}` === input.calendarId || item.url === input.calendarId || item.name === input.calendarId)
      : calendars[0]
    if (!calendar) continue

    await client.createEvent(calendar.url, {
      summary: input.title,
      start,
      end,
      location: input.location || undefined,
      description: input.description || undefined,
    })
    return { calendarId: `${integration.id}:${calendar.url}`, calendar: calendar.name, title: input.title, start: start.toISOString(), end: end.toISOString() }
  }

  throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
}

export async function updateCalDavEvent(db: Database, input: UpdateCalDavEventInput) {
  const start = parseDate(input.start)
  const end = parseDate(input.end)
  if (!start || !end || end.getTime() <= start.getTime()) {
    throw Object.assign(new Error('Calendar event end must be after its start'), { code: 'INVALID_CALENDAR_EVENT' })
  }

  const integrations = selectIntegrations(await listEnabledIntegrationsByType(db, 'caldav'), input)
  for (const integration of integrations) {
    const serverUrl = String(integration.config.serverUrl ?? '')
    const username = String(integration.config.username ?? '')
    const password = String(integration.config.password ?? '')
    const calendarUrl = String(integration.config.calendarUrl ?? '')
    if (!serverUrl || !username || !password) continue

    const client = await createCalDavClient(serverUrl, username, password)
    const calendars = calendarUrl
      ? [{ name: integration.name, url: resolveCalendarUrl(serverUrl, calendarUrl) }]
      : (await client.getCalendars()).map((calendar) => ({
        name: calendar.displayName || getCalendarName(calendar.url),
        url: resolveCalendarUrl(serverUrl, calendar.url),
      }))
    const calendar = calendars.find(item => `${integration.id}:${item.url}` === input.calendarId)
    if (!calendar) continue

    const event = (await client.getEvents(calendar.url, { all: true })).find(item => item.uid === input.uid)
    if (!event) throw Object.assign(new Error('Calendar event was not found'), { code: 'CALENDAR_EVENT_NOT_FOUND' })

    await client.updateEvent(calendar.url, {
      ...event,
      summary: input.title,
      start,
      end,
      location: input.location || undefined,
      description: input.description || undefined,
    })
    return { calendarId: input.calendarId, uid: input.uid, title: input.title, start: start.toISOString(), end: end.toISOString() }
  }

  throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
}

export async function getCalDavTodos(db: Database) {
  const integrations = await listEnabledIntegrationsByType(db, 'caldav')
  if (integrations.length === 0) {
    throw Object.assign(new Error('No enabled caldav integration is configured'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  }

  const results = await Promise.all(integrations.map(async (integration) => {
    const serverUrl = String(integration.config.serverUrl ?? '')
    const username = String(integration.config.username ?? '')
    const password = String(integration.config.password ?? '')
    const calendarUrl = String(integration.config.calendarUrl ?? '')
    if (!serverUrl || !username || !password) return { lists: [], items: [] }

    try {
      const client = await createCalDavClient(serverUrl, username, password)
      const calendars = calendarUrl
        ? [{ name: integration.name, url: resolveCalendarUrl(serverUrl, calendarUrl) }]
        : (await client.getCalendars()).map((calendar) => ({
          name: calendar.displayName || getCalendarName(calendar.url),
          url: resolveCalendarUrl(serverUrl, calendar.url),
        }))
      const lists = calendars.map((calendar) => ({ id: `${integration.id}:${calendar.url}`, name: calendar.name }))
      const items = (await Promise.all(calendars.map(async (calendar) => {
        const todos = await client.getTodos(calendar.url, { all: true })
        return todos.map((todo) => ({
          id: `${integration.id}:${calendar.url}:${todo.uid}`,
          calendarId: `${integration.id}:${calendar.url}`,
          uid: todo.uid,
          listId: `${integration.id}:${calendar.url}`,
          text: todo.summary || 'Untitled task',
          completed: todo.status === 'COMPLETED',
        }))
      }))).flat()
      return { lists, items }
    } catch (error) {
      logger.error(`Failed to load CalDAV todos for ${integration.name}:`, error)
      return { lists: [], items: [] }
    }
  }))

  return { lists: results.flatMap((result) => result.lists), items: results.flatMap((result) => result.items) }
}

export async function createCalDavTodo(db: Database, input: CreateCalDavTodoInput) {
  const integrations = await listEnabledIntegrationsByType(db, 'caldav')
  const [integrationId, ...calendarUrlParts] = input.calendarId?.split(':') ?? []
  const integration = input.calendarId ? integrations.find(item => item.id === integrationId) : integrations[0]
  if (!integration) throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
  const configuredCalendarUrl = String(integration.config.calendarUrl ?? '')
  const calendarUrl = calendarUrlParts.join(':') || (configuredCalendarUrl ? resolveCalendarUrl(String(integration.config.serverUrl), configuredCalendarUrl) : '')
  const client = await createCalDavClient(String(integration.config.serverUrl), String(integration.config.username), String(integration.config.password))
  const resolvedCalendarUrl = calendarUrl || (await client.getCalendars())[0]?.url
  if (!resolvedCalendarUrl) throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
  const created = await client.createTodo(resolvedCalendarUrl, { summary: input.text, status: 'NEEDS-ACTION' })
  const calendarId = input.calendarId ?? `${integration.id}:${resolvedCalendarUrl}`
  return { id: `${calendarId}:${created.uid}`, calendarId, uid: created.uid, text: input.text, completed: false }
}

export async function updateCalDavTodo(db: Database, input: UpdateCalDavTodoInput) {
  const [integrationId, ...calendarUrlParts] = input.calendarId.split(':')
  const calendarUrl = calendarUrlParts.join(':')
  const integration = (await listEnabledIntegrationsByType(db, 'caldav')).find(item => item.id === integrationId)
  if (!integration || !calendarUrl) throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
  const client = await createCalDavClient(String(integration.config.serverUrl), String(integration.config.username), String(integration.config.password))
  const todo = (await client.getTodos(calendarUrl, { all: true })).find(item => item.uid === input.uid)
  if (!todo) throw Object.assign(new Error('Calendar task was not found'), { code: 'CALENDAR_TODO_NOT_FOUND' })
  await client.updateTodo(calendarUrl, { ...todo, status: input.completed ? 'COMPLETED' : 'NEEDS-ACTION', completed: input.completed ? new Date() : undefined })
  return { calendarId: input.calendarId, uid: input.uid, completed: input.completed }
}

export async function deleteCalDavTodo(db: Database, input: DeleteCalDavTodoInput) {
  const [integrationId, ...calendarUrlParts] = input.calendarId.split(':')
  const calendarUrl = calendarUrlParts.join(':')
  const integration = (await listEnabledIntegrationsByType(db, 'caldav')).find(item => item.id === integrationId)
  if (!integration || !calendarUrl) throw Object.assign(new Error('Calendar was not found or is unavailable'), { code: 'CALENDAR_NOT_FOUND' })
  const client = await createCalDavClient(String(integration.config.serverUrl), String(integration.config.username), String(integration.config.password))
  const todo = (await client.getTodos(calendarUrl, { all: true })).find(item => item.uid === input.uid)
  if (!todo) throw Object.assign(new Error('Calendar task was not found'), { code: 'CALENDAR_TODO_NOT_FOUND' })
  await client.deleteTodo(calendarUrl, todo.uid, todo.etag)
}

export async function discoverCalDavCalendars(serverUrl: string, username: string, password: string) {
  const client = await createCalDavClient(serverUrl, username, password)
  const calendars = await client.getCalendars()
  return calendars.map((calendar) => ({
    name: calendar.displayName || getCalendarName(calendar.url),
    url: resolveCalendarUrl(serverUrl, calendar.url),
  }))
}
