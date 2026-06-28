import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bold, CalendarDays, CheckSquare, ChevronDown, Clock3, Italic, ListTodo, Mail, NotebookPen, PanelRightClose, PanelRightOpen, Plus, Trash2, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'
import { settingsApi } from '@/api/settings'
import { productivityApi, type Note } from '@/api/productivity'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export function ProductivitySidebar() {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<ProductivityTab>('calendar')
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['productivity-calendar-upcoming'],
    queryFn: settingsApi.getUpcomingCalendarEvents,
    enabled: expanded && activeTab === 'calendar',
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
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid grid-cols-4 gap-1 border-b border-border p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors',
                    activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeTab === 'calendar' && (
              <CalendarPanel
                calendars={calendars}
                events={events}
                isLoading={isLoading}
                isError={isError}
                error={error}
              />
            )}
            {activeTab === 'todos' && <TodoPanel />}
            {activeTab === 'email' && <EmailPanel />}
            {activeTab === 'notes' && <NotesPanel />}
          </div>
        </div>
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
                className="flex flex-col items-center gap-1 rounded-lg p-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Icon className="h-5 w-5 flex-shrink-0 text-primary" />
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
  events: Array<{ title: string; calendar: string; start: string; end: string | null; location?: string }>
  isLoading: boolean
  isError: boolean
  error: unknown
}) {
  return (
    <div className="flex flex-col gap-5">
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
  )
}

function TodoPanel() {
  const queryClient = useQueryClient()
  const [listName, setListName] = useState('')
  const [itemText, setItemText] = useState('')
  const [selectedListId, setSelectedListId] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['productivity-todos'], queryFn: productivityApi.getTodos })
  const lists = data?.lists ?? []
  const items = data?.items ?? []
  const selectedList = lists.find((list) => list.id === selectedListId) ?? lists[0]
  const selectedItems = selectedList ? items.filter((item) => item.list_id === selectedList.id) : []
  const invalidateTodos = () => queryClient.invalidateQueries({ queryKey: ['productivity-todos'] })
  const createList = useMutation({ mutationFn: productivityApi.createTodoList, onSuccess: (list) => {
    setListName('')
    setSelectedListId(list.id)
    invalidateTodos()
  } })
  const deleteList = useMutation({ mutationFn: productivityApi.deleteTodoList, onSuccess: () => {
    setSelectedListId('')
    invalidateTodos()
  } })
  const createItem = useMutation({ mutationFn: ({ listId, text }: { listId: string; text: string }) => productivityApi.createTodoItem(listId, text), onSuccess: () => {
    setItemText('')
    invalidateTodos()
  } })
  const updateItem = useMutation({ mutationFn: ({ id, completed }: { id: string; completed: boolean }) => productivityApi.updateTodoItem(id, { completed }), onSuccess: invalidateTodos })
  const removeItem = useMutation({ mutationFn: productivityApi.deleteTodoItem, onSuccess: invalidateTodos })

  const submitList = (event: FormEvent) => {
    event.preventDefault()
    if (listName.trim()) createList.mutate(listName.trim())
  }

  const submitItem = (event: FormEvent) => {
    event.preventDefault()
    if (selectedList && itemText.trim()) createItem.mutate({ listId: selectedList.id, text: itemText.trim() })
  }

  return (
    <div className="grid min-h-full gap-4 lg:grid-cols-[180px_1fr]">
      <section className="rounded-xl border border-border bg-background/70 p-3 shadow-sm">
        <form onSubmit={submitList} className="mb-3 flex gap-2">
          <Input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="New list" className="h-8" />
          <Button type="submit" size="icon-sm" disabled={createList.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        <div className="space-y-1">
          {isLoading && <p className="text-sm text-muted-foreground">Loading lists...</p>}
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => setSelectedListId(list.id)}
              className={cn(
                'w-full rounded-md px-2 py-2 text-left text-sm transition-colors',
                selectedList?.id === list.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
            >
              {list.name}
            </button>
          ))}
          {!isLoading && lists.length === 0 && <p className="text-sm text-muted-foreground">Create a list to start tracking todos.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{selectedList?.name ?? 'Todo'}</h2>
            <p className="text-xs text-muted-foreground">{selectedItems.filter(item => !item.completed).length} open</p>
          </div>
          {selectedList && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => deleteList.mutate(selectedList.id)} disabled={deleteList.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {selectedList && (
          <form onSubmit={submitItem} className="mb-4 flex gap-2">
            <Input value={itemText} onChange={(event) => setItemText(event.target.value)} placeholder="Add todo" />
            <Button type="submit" disabled={createItem.isPending}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
        )}
        <div className="space-y-2">
          {selectedItems.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <Checkbox checked={item.completed} onCheckedChange={(checked) => updateItem.mutate({ id: item.id, completed: checked === true })} />
              <span className={cn('min-w-0 flex-1 text-sm', item.completed && 'text-muted-foreground line-through')}>{item.text}</span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeItem.mutate(item.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {selectedList && selectedItems.length === 0 && <p className="text-sm text-muted-foreground">No todos in this list yet.</p>}
        </div>
      </section>
    </div>
  )
}

function EmailPanel() {
  const queryClient = useQueryClient()
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
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Email login</h2>
        </div>
        <form onSubmit={submitMailForm} className="grid gap-3 sm:grid-cols-2">
          <Input value={mailForm.name} onChange={(event) => updateMailForm('name', event.target.value)} placeholder="Account name" />
          <Input value={mailForm.username} onChange={(event) => updateMailForm('username', event.target.value)} placeholder="Username" />
          <Input type="password" value={mailForm.password} onChange={(event) => updateMailForm('password', event.target.value)} placeholder="Password" />
          <Input type="email" value={mailForm.fromAddress} onChange={(event) => updateMailForm('fromAddress', event.target.value)} placeholder="From address" />
          <Input value={mailForm.imapHost} onChange={(event) => updateMailForm('imapHost', event.target.value)} placeholder="IMAP host" />
          <Input type="number" min={1} max={65535} value={mailForm.imapPort} onChange={(event) => updateMailForm('imapPort', Number(event.target.value) || 993)} placeholder="IMAP port" />
          <Input value={mailForm.smtpHost} onChange={(event) => updateMailForm('smtpHost', event.target.value)} placeholder="SMTP host" />
          <Input type="number" min={1} max={65535} value={mailForm.smtpPort} onChange={(event) => updateMailForm('smtpPort', Number(event.target.value) || 587)} placeholder="SMTP port" />
          <Button type="submit" className="sm:col-span-2" disabled={createMailIntegration.isPending}>
            <Plus className="h-4 w-4" />
            Save account
          </Button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Folders</h2>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading mail accounts...</p>}
        {isError && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load mail accounts'}</p>}
        {!isLoading && accounts.length === 0 && <p className="text-sm text-muted-foreground">No enabled IMAP/SMTP accounts configured.</p>}
        <div className="space-y-4">
          {accounts.map((account) => (
            <article key={account.id} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-3">
                <h3 className="truncate text-sm font-medium text-foreground">{account.name}</h3>
                <p className="truncate text-xs text-muted-foreground">{account.fromAddress || account.username}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {account.folders.map((folder) => (
                  <button key={folder.role} type="button" className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-accent">
                    <span>{folder.name}</span>
                    {folder.role === 'inbox' && <span className="text-xs text-muted-foreground">Inbox</span>}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function NotesPanel() {
  const queryClient = useQueryClient()
  const editorRef = useRef<HTMLDivElement>(null)
  const [selectedNoteId, setSelectedNoteId] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['productivity-notes'], queryFn: productivityApi.getNotes })
  const notes = data?.notes ?? emptyNotes
  const selectedNote = notes.find((note) => note.id === selectedNoteId)
  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ['productivity-notes'] })
  const createNoteMutation = useMutation({ mutationFn: productivityApi.createNote, onSuccess: (note) => {
    setSelectedNoteId(note.id)
    invalidateNotes()
  } })
  const updateNoteMutation = useMutation({ mutationFn: ({ id, note }: { id: string; note: { title: string; tags: string[]; text: string } }) => productivityApi.updateNote(id, note), onSuccess: invalidateNotes })
  const deleteNoteMutation = useMutation({ mutationFn: productivityApi.deleteNote, onSuccess: () => {
    setSelectedNoteId('')
    setTitle('')
    setTags('')
    if (editorRef.current) editorRef.current.innerHTML = ''
    invalidateNotes()
  } })

  useEffect(() => {
    if (!selectedNote && notes[0] && !selectedNoteId) setSelectedNoteId(notes[0].id)
  }, [notes, selectedNote, selectedNoteId])

  useEffect(() => {
    setTitle(selectedNote?.title ?? '')
    setTags(selectedNote?.tags.join(', ') ?? '')
    if (editorRef.current) editorRef.current.innerHTML = selectedNote?.text ?? ''
  }, [selectedNote])

  const parsedTags = tags.split(',').map(tag => tag.trim()).filter(Boolean)
  const currentText = () => editorRef.current?.innerHTML ?? ''
  const saveNote = () => {
    const note = { title: title.trim() || 'Untitled note', tags: parsedTags, text: currentText() }
    if (selectedNote) updateNoteMutation.mutate({ id: selectedNote.id, note })
    else createNoteMutation.mutate(note)
  }
  const newNote = () => {
    setSelectedNoteId('')
    setTitle('')
    setTags('')
    if (editorRef.current) editorRef.current.innerHTML = ''
  }
  const format = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList') => {
    document.execCommand(command)
    editorRef.current?.focus()
  }

  return (
    <div className="grid min-h-full gap-4 lg:grid-cols-[180px_1fr]">
      <section className="rounded-xl border border-border bg-background/70 p-3 shadow-sm">
        <Button type="button" className="mb-3 w-full" size="sm" onClick={newNote}>
          <Plus className="h-4 w-4" />
          New
        </Button>
        <div className="space-y-1">
          {isLoading && <p className="text-sm text-muted-foreground">Loading notes...</p>}
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setSelectedNoteId(note.id)}
              className={cn('w-full rounded-md px-2 py-2 text-left transition-colors', selectedNoteId === note.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            >
              <span className="block truncate text-sm font-medium">{note.title}</span>
              <span className="block truncate text-xs opacity-75">{note.tags.join(', ') || 'No tags'}</span>
            </button>
          ))}
          {!isLoading && notes.length === 0 && <p className="text-sm text-muted-foreground">Create your first rich text note.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-background/70 p-4 shadow-sm">
        <div className="mb-3 flex gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
          {selectedNote && (
            <Button type="button" variant="ghost" size="icon" onClick={() => deleteNoteMutation.mutate(selectedNote.id)} disabled={deleteNoteMutation.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" className="mb-3" />
        <div className="mb-2 flex gap-1">
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
          className="min-h-56 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={saveNote} disabled={createNoteMutation.isPending || updateNoteMutation.isPending}>
            Save
          </Button>
        </div>
      </section>
    </div>
  )
}
