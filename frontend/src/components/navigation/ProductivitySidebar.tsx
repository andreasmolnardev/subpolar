import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, Clock3, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { settingsApi } from '@/api/settings'

const calendarColors = ['bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']

function formatEventTime(start: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(start))
}

export function ProductivitySidebar() {
  const [expanded, setExpanded] = useState(false)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['productivity-calendar-upcoming'],
    queryFn: settingsApi.getUpcomingCalendarEvents,
    enabled: expanded,
    staleTime: 60_000,
  })

  const calendars = data?.calendars ?? []
  const events = data?.events ?? []

  return (
    <aside
      className={cn(
        'hidden md:flex h-dvh flex-shrink-0 flex-col border-l border-border bg-card/60 backdrop-blur-sm pt-safe pb-safe transition-[width] duration-200',
        expanded ? 'w-[40vw] min-w-96 max-w-[720px]' : 'w-20'
      )}
      aria-label="Productivity integrations"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Collapse productivity sidebar"
          >
            <PanelRightClose className="h-5 w-5" />
          </button>
        )}
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Expand productivity sidebar"
          >
            <PanelRightOpen className="h-5 w-5" />
          </button>
        )}
      </div>

      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <section className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Calendars</h2>
                <p className="text-xs text-muted-foreground">Connected productivity sources</p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {calendars.map((calendar, index) => (
                <div key={calendar.name} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn('h-2.5 w-2.5 rounded-full', calendarColors[index % calendarColors.length])} />
                    {calendar.name}
                  </div>
                </div>
              ))}
              {!isLoading && calendars.length === 0 && (
                <p className="text-sm text-muted-foreground sm:col-span-3">No enabled CalDAV calendars configured.</p>
              )}
            </div>
          </section>

          <section className="min-h-0 rounded-xl border border-border bg-background/70 p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Upcoming events</h2>
            </div>
            <div className="space-y-3">
              {isLoading && <p className="text-sm text-muted-foreground">Loading upcoming events...</p>}
              {isError && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load upcoming events'}</p>}
              {!isLoading && !isError && events.length === 0 && (
                <p className="text-sm text-muted-foreground">No upcoming events found.</p>
              )}
              {events.map((event) => (
                <article key={`${event.title}-${event.start}`} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-foreground">{event.title}</h3>
                      <p className="text-xs text-muted-foreground">{event.calendar}</p>
                    </div>
                    <time className="shrink-0 text-right text-xs text-muted-foreground">{formatEventTime(event.start)}</time>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex flex-col items-center gap-1 rounded-lg p-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <CalendarDays className="h-5 w-5 flex-shrink-0 text-primary" />
            <span className="truncate">Calendar</span>
          </button>
        </div>
      )}
    </aside>
  )
}
