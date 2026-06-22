import { CalDAVClient } from 'ts-caldav'
import type { Database } from '../db/schema'
import { listEnabledIntegrationsByType } from '../db/integrations'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'

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

export async function getUpcomingCalDavEvents(db: Database) {
  const integrations = await listEnabledIntegrationsByType(db, 'caldav')
  const start = new Date()
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

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
      const events = (await Promise.all(discoveredCalendars.map(async (calendar) => {
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
