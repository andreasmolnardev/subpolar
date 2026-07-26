import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bold,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Clock3,
  Italic,
  ListTodo,
  Mail,
  MoreVertical,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
  Underline,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { settingsApi } from '@/api/settings'
import { productivityApi, type Note } from '@/api/productivity'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

const calendarColors = ['bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
const tabs = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'todos', label: 'Todo', icon: CheckSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
] as const
const emptyNotes: Note[] = []

type ProductivityTab = typeof tabs[number]['id']

function formatEventTime(start: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(start))
}

function formatUpdatedAt(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function getNotePreview(text: string) {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function ProductivitySidebar() {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<ProductivityTab>('calendar')
  const activeApp = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const ActiveAppIcon = activeApp.icon
  const { data: calDavData, isLoading: isCalDavLoading, isError: isCalDavError, error: calDavError } = useQuery({
    queryKey: ['productivity-calendar-upcoming'],
    queryFn: settingsApi.getUpcomingCalendarEvents,
    enabled: expanded && activeTab === 'calendar',
    staleTime: 60_000,
  })
  const { data: localCalendarData, isLoading: isLocalCalendarLoading, isError: isLocalCalendarError, error: localCalendarError } = useQuery({
    queryKey: ['productivity-local-calendar'],
    queryFn: productivityApi.getCalendarEvents,
    enabled: expanded && activeTab === 'calendar',
  })

  const calendars = [{ id: 'local', name: 'Local', url: '' }, ...(calDavData?.calendars ?? [])]
  const events = [
    ...(localCalendarData?.events ?? []).map((event) => ({ ...event, calendarId: 'local', uid: event.id, calendar: 'Local', source: 'local' as const })),
    ...(calDavData?.events ?? []).map((event) => ({ ...event, source: 'caldav' as const })),
  ]

  return (
    <aside
      className={cn(
        'hidden md:flex h-dvh flex-shrink-0 flex-col border-l border-border bg-card/60 backdrop-blur-sm pt-safe pb-safe transition-[width] duration-200',
        expanded ? 'w-[360px] max-w-[40vw]' : 'w-20'
      )}
      aria-label="Productivity integrations"
    >
      {expanded ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-accent"
                  aria-label="Switch productivity app"
                >
                  <ActiveAppIcon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{activeApp.label}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {tabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <DropdownMenuItem key={tab.id} onClick={() => setActiveTab(tab.id)} className="gap-2">
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(false)}
              aria-label="Close productivity sidebar"
              className="h-8 w-8 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'calendar' && (
              <CalendarPanel
                calendars={calendars}
                events={events}
                isLoading={isCalDavLoading || isLocalCalendarLoading}
                isError={isCalDavError && isLocalCalendarError}
                error={calDavError ?? localCalendarError}
              />
            )}
            {activeTab === 'todos' && <TodoPanel />}
            {activeTab === 'email' && <EmailPanel />}
            {activeTab === 'notes' && <NotesPanel />}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-3">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id)
                  setExpanded(true)
                }}
                className="flex flex-col items-center gap-1 rounded-lg p-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="h-5 w-5 shrink-0 text-primary" />
                <span className="truncate">{tab.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}

function CalendarPanel({
  calendars,
  events,
  isLoading,
  isError,
  error,
}: {
  calendars: Array<{ id: string; name: string; url: string }>
  events: Array<{ id: string; calendarId: string; uid: string; title: string; calendar: string; start: string; end: string | null; location?: string; description?: string; source: 'local' | 'caldav' }>
  isLoading: boolean
  isError: boolean
  error: unknown
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [calendarId, setCalendarId] = useState('local')
  const [start, setStart] = useState(() => toDateTimeLocal(new Date()))
  const [end, setEnd] = useState(() => toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000)))
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [editingEvent, setEditingEvent] = useState<typeof events[number] | null>(null)
  const createEvent = useMutation({
    mutationFn: (event: { calendarId?: string; title: string; start: string; end: string; location?: string; description?: string }) => event.calendarId === 'local'
      ? productivityApi.createCalendarEvent({ title: event.title, start: event.start, end: event.end, location: event.location, description: event.description })
      : settingsApi.createCalendarEvent(event),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productivity-calendar-upcoming'] })
      await queryClient.invalidateQueries({ queryKey: ['productivity-local-calendar'] })
      setOpen(false)
      setTitle('')
      setLocation('')
      setDescription('')
    },
  })
  const updateEvent = useMutation({
    mutationFn: (event: { source: 'local' | 'caldav'; id: string; calendarId: string; uid: string; title: string; start: string; end: string; location?: string; description?: string }) => event.source === 'local'
      ? productivityApi.updateCalendarEvent(event.id, { title: event.title, start: event.start, end: event.end, location: event.location, description: event.description })
      : settingsApi.updateCalendarEvent(event),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productivity-calendar-upcoming'] })
      await queryClient.invalidateQueries({ queryKey: ['productivity-local-calendar'] })
      setEditingEvent(null)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createEvent.mutate({
      calendarId: calendarId || undefined,
      title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      location: location || undefined,
      description: description || undefined,
    })
  }

  function openEditor(event: typeof events[number]) {
    setEditingEvent(event)
    setTitle(event.title)
    setStart(toDateTimeLocal(new Date(event.start)))
    setEnd(toDateTimeLocal(new Date(event.end ?? event.start)))
    setLocation(event.location ?? '')
    setDescription(event.description ?? '')
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingEvent) return
    updateEvent.mutate({
      source: editingEvent.source,
      id: editingEvent.id,
      calendarId: editingEvent.calendarId,
      uid: editingEvent.uid,
      title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      location: location || undefined,
      description: description || undefined,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input placeholder="Search events" className="h-9" />
        <Button type="button" size="icon" onClick={() => setOpen((value) => !value)} aria-label="Create event" aria-expanded={open}>
          <Plus className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon">
              <CalendarDays className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {calendars.map((calendar, index) => (
              <DropdownMenuItem key={calendar.id} className="gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', calendarColors[index % calendarColors.length])} />
                <span className="truncate">{calendar.name}</span>
              </DropdownMenuItem>
            ))}
            {calendars.length === 0 && <DropdownMenuItem disabled>No calendars</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 rounded-lg border border-border bg-card p-3">
            <form onSubmit={submit} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">New event</h2>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" required autoFocus />
              <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Default calendar</option>
                {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
              </select>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">Start<Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">End<Input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
              <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Notes" className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" />
              {createEvent.isError && <p className="text-sm text-destructive">{createEvent.error instanceof Error ? createEvent.error.message : 'Failed to create event'}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createEvent.isPending}>{createEvent.isPending ? 'Creating...' : 'Create event'}</Button>
              </div>
            </form>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {isLoading && <p className="px-1 text-sm text-muted-foreground">Loading upcoming events...</p>}
        {isError && <p className="px-1 text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load upcoming events'}</p>}
        {!isLoading && !isError && events.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">No upcoming events found.</p>
        )}
        {events.map((event) => (
          <article key={event.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium text-foreground">{event.title}</h3>
                <p className="truncate text-xs text-muted-foreground">{event.calendar}</p>
                <time className="mt-2 block text-xs text-muted-foreground">{formatEventTime(event.start)}</time>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${event.title}`} onClick={() => editingEvent === event ? setEditingEvent(null) : openEditor(event)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            {editingEvent === event && (
              <form onSubmit={submitEdit} className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200 border-t border-border pt-3 flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Edit event</h2>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" required autoFocus />
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Start<Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">End<Input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
                <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" />
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Notes" className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" />
                {updateEvent.isError && <p className="text-sm text-destructive">{updateEvent.error instanceof Error ? updateEvent.error.message : 'Failed to update event'}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setEditingEvent(null)}>Cancel</Button>
                  <Button type="submit" disabled={updateEvent.isPending}>{updateEvent.isPending ? 'Saving...' : 'Save changes'}</Button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function TodoPanel() {
  const queryClient = useQueryClient()
  const [itemText, setItemText] = useState('')
  const [selectedListId, setSelectedListId] = useState('')
  const [isTodoFormOpen, setIsTodoFormOpen] = useState(false)
  const { data: calDavData, isLoading: isCalDavLoading, isError: isCalDavError, error: calDavError } = useQuery({ queryKey: ['calendar-todos'], queryFn: settingsApi.getCalendarTodos })
  const { data: localData, isLoading: isLocalLoading, isError: isLocalError, error: localError } = useQuery({ queryKey: ['productivity-todos'], queryFn: productivityApi.getTodos })
  const lists = [
    ...(localData?.lists ?? []).map((list) => ({ id: `local:${list.id}`, name: list.name, source: 'local' as const })),
    ...(calDavData?.lists ?? []).map((list) => ({ id: `caldav:${list.id}`, name: list.name, source: 'caldav' as const })),
  ]
  const items = [
    ...(localData?.items ?? []).map((item) => ({ id: `local:${item.id}`, listId: `local:${item.list_id}`, text: item.text, completed: item.completed, source: 'local' as const, localId: item.id })),
    ...(calDavData?.items ?? []).map((item) => ({ ...item, id: `caldav:${item.id}`, listId: `caldav:${item.listId}`, source: 'caldav' as const })),
  ]
  const selectedList = lists.find((list) => list.id === selectedListId) ?? lists[0]
  const selectedItems = selectedList ? items.filter((item) => item.listId === selectedList.id) : []
  const invalidateTodos = async () => {
    await queryClient.invalidateQueries({ queryKey: ['calendar-todos'] })
    await queryClient.invalidateQueries({ queryKey: ['productivity-todos'] })
  }
  const createItem = useMutation({
    mutationFn: ({ listId, text }: { listId: string; text: string }) => listId.startsWith('local:')
      ? productivityApi.createTodoItem(listId.slice(6), text)
      : settingsApi.createCalendarTodo({ calendarId: listId.slice(7), text }),
    onSuccess: () => {
      setItemText('')
      setIsTodoFormOpen(false)
      invalidateTodos()
    },
  })
  const updateItem = useMutation({ mutationFn: (item: typeof items[number] & { completed: boolean }) => item.source === 'local'
    ? productivityApi.updateTodoItem(item.localId, { completed: item.completed })
    : settingsApi.updateCalendarTodo({ calendarId: item.calendarId, uid: item.uid, completed: item.completed }), onSuccess: invalidateTodos })
  const removeItem = useMutation({ mutationFn: (item: typeof items[number]) => item.source === 'local'
    ? productivityApi.deleteTodoItem(item.localId)
    : settingsApi.deleteCalendarTodo({ calendarId: item.calendarId, uid: item.uid }), onSuccess: invalidateTodos })

  const submitItem = (event: FormEvent) => {
    event.preventDefault()
    if (selectedList && itemText.trim()) createItem.mutate({ listId: selectedList.id, text: itemText.trim() })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="min-w-0 flex-1 justify-between">
              <span className="truncate">{selectedList?.name ?? 'Lists'}</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {lists.map((list) => (
              <DropdownMenuItem key={list.id} onClick={() => setSelectedListId(list.id)}>
                {list.name}
              </DropdownMenuItem>
            ))}
            {lists.length === 0 && <DropdownMenuItem disabled>No lists</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="icon" onClick={() => setIsTodoFormOpen((open) => !open)} disabled={!selectedList} aria-label="Create task">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {isTodoFormOpen && (
        <form onSubmit={submitItem} className="animate-in fade-in slide-in-from-top-2 duration-200 flex gap-2 rounded-lg border border-border bg-card p-3">
          <Input value={itemText} onChange={(event) => setItemText(event.target.value)} placeholder="Task" autoFocus />
          <Button type="submit" disabled={createItem.isPending}>{createItem.isPending ? 'Adding...' : 'Add'}</Button>
        </form>
      )}
      <div className="flex flex-col gap-2">
        {(isCalDavLoading || isLocalLoading) && <p className="px-1 text-sm text-muted-foreground">Loading todos...</p>}
        {isCalDavError && isLocalError && <p className="px-1 text-sm text-destructive">{calDavError instanceof Error ? calDavError.message : localError instanceof Error ? localError.message : 'Failed to load tasks'}</p>}
        {!isCalDavLoading && !isLocalLoading && lists.length === 0 && <p className="px-1 text-sm text-muted-foreground">No task lists found.</p>}
        {selectedItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <Checkbox checked={item.completed} onCheckedChange={(checked) => updateItem.mutate({ ...item, completed: checked === true })} />
            <span className={cn('min-w-0 flex-1 text-sm', item.completed && 'text-muted-foreground line-through')}>{item.text}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeItem.mutate(item)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {selectedList && selectedItems.length === 0 && <p className="px-1 text-sm text-muted-foreground">No todos in this list yet.</p>}
      </div>
    </div>
  )
}

function EmailPanel() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [mailForm, setMailForm] = useState({
    name: 'Mail',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 587,
    username: '',
    password: '',
    fromAddress: '',
  })
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['productivity-mail-accounts'], queryFn: productivityApi.getMailAccounts })
  const accounts = data?.accounts ?? []
  const createMailIntegration = useMutation({
    mutationFn: () => settingsApi.createIntegration({
      id: crypto.randomUUID(),
      type: 'mail',
      enabled: true,
      name: mailForm.name.trim() || 'Mail',
      imapHost: mailForm.imapHost.trim(),
      imapPort: mailForm.imapPort,
      smtpHost: mailForm.smtpHost.trim(),
      smtpPort: mailForm.smtpPort,
      username: mailForm.username.trim(),
      password: mailForm.password,
      fromAddress: mailForm.fromAddress.trim() || mailForm.username.trim(),
    }),
    onSuccess: () => {
      setMailForm({
        name: 'Mail',
        imapHost: '',
        imapPort: 993,
        smtpHost: '',
        smtpPort: 587,
        username: '',
        password: '',
        fromAddress: '',
      })
      setIsDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['productivity-mail-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['settings-integrations'] })
    },
  })
  const updateMailForm = (field: keyof typeof mailForm, value: string | number) => {
    setMailForm((current) => ({ ...current, [field]: value }))
  }
  const submitMailForm = (event: FormEvent) => {
    event.preventDefault()
    if (!mailForm.imapHost.trim() || !mailForm.smtpHost.trim() || !mailForm.username.trim() || !mailForm.password) return
    createMailIntegration.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input placeholder="Search mail accounts" className="h-9" />
        <Button type="button" size="icon" onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {isLoading && <p className="px-1 text-sm text-muted-foreground">Loading mail accounts...</p>}
        {isError && <p className="px-1 text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load mail accounts'}</p>}
        {!isLoading && accounts.length === 0 && <p className="px-1 text-sm text-muted-foreground">No enabled IMAP/SMTP accounts configured.</p>}
        {accounts.map((account) => (
          <article key={account.id} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-3">
              <h3 className="truncate text-sm font-medium text-foreground">{account.name}</h3>
              <p className="truncate text-xs text-muted-foreground">{account.fromAddress || account.username}</p>
            </div>
            <div className="flex flex-col gap-2">
              {account.folders.map((folder) => (
                <button key={folder.role} type="button" className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-accent">
                  <span className="truncate">{folder.name}</span>
                  {folder.role === 'inbox' && <span className="shrink-0 text-xs text-muted-foreground">Inbox</span>}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Email login</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitMailForm} className="grid gap-3">
            <Input value={mailForm.name} onChange={(event) => updateMailForm('name', event.target.value)} placeholder="Account name" />
            <Input value={mailForm.username} onChange={(event) => updateMailForm('username', event.target.value)} placeholder="Username" />
            <Input type="password" value={mailForm.password} onChange={(event) => updateMailForm('password', event.target.value)} placeholder="Password" />
            <Input type="email" value={mailForm.fromAddress} onChange={(event) => updateMailForm('fromAddress', event.target.value)} placeholder="From address" />
            <Input value={mailForm.imapHost} onChange={(event) => updateMailForm('imapHost', event.target.value)} placeholder="IMAP host" />
            <Input type="number" min={1} max={65535} value={mailForm.imapPort} onChange={(event) => updateMailForm('imapPort', Number(event.target.value) || 993)} placeholder="IMAP port" />
            <Input value={mailForm.smtpHost} onChange={(event) => updateMailForm('smtpHost', event.target.value)} placeholder="SMTP host" />
            <Input type="number" min={1} max={65535} value={mailForm.smtpPort} onChange={(event) => updateMailForm('smtpPort', Number(event.target.value) || 587)} placeholder="SMTP port" />
            <DialogFooter>
              <Button type="submit" disabled={createMailIntegration.isPending}>Save account</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NotesPanel() {
  const queryClient = useQueryClient()
  const [selectedNoteId, setSelectedNoteId] = useState('')
  const [search, setSearch] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['productivity-notes'], queryFn: productivityApi.getNotes })
  const notes = data?.notes ?? emptyNotes
  const selectedNote = notes.find((note) => note.id === selectedNoteId)
  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return notes
    return notes.filter((note) => {
      const haystack = `${note.title} ${note.tags.join(' ')} ${getNotePreview(note.text)}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [notes, search])
  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ['productivity-notes'] })
  const createNoteMutation = useMutation({
    mutationFn: productivityApi.createNote,
    onSuccess: (note) => {
      setSelectedNoteId(note.id)
      setIsCreateOpen(false)
      invalidateNotes()
    },
  })
  const updateNoteMutation = useMutation({ mutationFn: ({ id, note }: { id: string; note: { title: string; tags: string[]; text: string } }) => productivityApi.updateNote(id, note), onSuccess: invalidateNotes })
  const deleteNoteMutation = useMutation({
    mutationFn: productivityApi.deleteNote,
    onSuccess: () => {
      setSelectedNoteId('')
      invalidateNotes()
    },
  })

  if (selectedNote) {
    return (
      <NoteDetailScreen
        note={selectedNote}
        onBack={() => setSelectedNoteId('')}
        onSave={(note) => updateNoteMutation.mutate({ id: selectedNote.id, note })}
        onDelete={() => deleteNoteMutation.mutate(selectedNote.id)}
        isSaving={updateNoteMutation.isPending}
        isDeleting={deleteNoteMutation.isPending}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="h-9 pl-9" />
        </div>
        <Button type="button" size="icon" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {isLoading && <p className="px-1 text-sm text-muted-foreground">Loading notes...</p>}
        {filteredNotes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => setSelectedNoteId(note.id)}
            className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
          >
            <span className="block truncate text-sm font-medium text-foreground">{note.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{note.tags.join(', ') || formatUpdatedAt(note.updated_at)}</span>
            <span className="mt-2 line-clamp-2 text-xs text-muted-foreground">{getNotePreview(note.text) || 'No note text'}</span>
          </button>
        ))}
        {!isLoading && notes.length === 0 && <p className="px-1 text-sm text-muted-foreground">Create your first rich text note.</p>}
        {!isLoading && notes.length > 0 && filteredNotes.length === 0 && <p className="px-1 text-sm text-muted-foreground">No notes match your search.</p>}
      </div>
      <NoteEditorDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        title="Create note"
        submitLabel="Create"
        onSubmit={(note) => createNoteMutation.mutate(note)}
        isSubmitting={createNoteMutation.isPending}
      />
    </div>
  )
}

function NoteDetailScreen({
  note,
  onBack,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: {
  note: Note
  onBack: () => void
  onSave: (note: { title: string; tags: string[]; text: string }) => void
  onDelete: () => void
  isSaving: boolean
  isDeleting: boolean
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(note.title)
  const [tags, setTags] = useState(note.tags.join(', '))

  useEffect(() => {
    setTitle(note.title)
    setTags(note.tags.join(', '))
    if (editorRef.current) editorRef.current.innerHTML = note.text
  }, [note])

  const parsedTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  const format = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList') => {
    document.execCommand(command)
    editorRef.current?.focus()
  }
  const saveNote = () => {
    onSave({ title: title.trim() || 'Untitled note', tags: parsedTags, text: editorRef.current?.innerHTML ?? '' })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{note.title}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete} disabled={isDeleting} className="text-destructive">Delete note</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
      <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" />
      <div className="flex gap-1 overflow-x-auto">
        <Button type="button" variant="outline" size="icon-sm" onClick={() => format('bold')}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => format('italic')}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => format('underline')}><Underline className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => format('insertUnorderedList')}><ListTodo className="h-4 w-4" /></Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-label="Note text"
        className="min-h-80 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      />
      <Button type="button" onClick={saveNote} disabled={isSaving}>
        Save
      </Button>
    </div>
  )
}

function NoteEditorDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  onSubmit,
  isSubmitting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  submitLabel: string
  onSubmit: (note: { title: string; tags: string[]; text: string }) => void
  isSubmitting: boolean
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [noteTitle, setNoteTitle] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    if (!open) {
      setNoteTitle('')
      setTags('')
      if (editorRef.current) editorRef.current.innerHTML = ''
    }
  }, [open])

  const parsedTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ title: noteTitle.trim() || 'Untitled note', tags: parsedTags, text: editorRef.current?.innerHTML ?? '' })
  }
  const format = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList') => {
    document.execCommand(command)
    editorRef.current?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Title" />
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" />
          <div className="flex gap-1 overflow-x-auto">
            <Button type="button" variant="outline" size="icon-sm" onClick={() => format('bold')}><Bold className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => format('italic')}><Italic className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => format('underline')}><Underline className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => format('insertUnorderedList')}><ListTodo className="h-4 w-4" /></Button>
          </div>
          <div
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-label="Note text"
            className="min-h-48 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
