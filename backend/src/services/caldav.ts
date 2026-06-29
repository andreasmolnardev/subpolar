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
            title: event.summary || 'Untitled event',
            calendar: calendar.name,
            start: event.start.toISOString(),
            end: event.end.toISOString(),
            location: event.location || undefined,
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

export async function discoverCalDavCalendars(serverUrl: string, username: string, password: string) {
  const client = await createCalDavClient(serverUrl, username, password)
  const calendars = await client.getCalendars()
  return calendars.map((calendar) => ({
    name: calendar.displayName || getCalendarName(calendar.url),
    url: resolveCalendarUrl(serverUrl, calendar.url),
  }))
}
