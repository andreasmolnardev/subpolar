import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { createSubpolarClient } from '@/api/subpolar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MessageContextDialogProps {
  apiUrl: string
  sessionId: string
  directory?: string
  messageId: string | null
  onOpenChange: (open: boolean) => void
}

export function MessageContextDialog({
  apiUrl,
  sessionId,
  directory,
  messageId,
  onOpenChange,
}: MessageContextDialogProps) {
  const open = messageId !== null
  const context = useQuery({
    queryKey: ['message-context', apiUrl, sessionId, directory, messageId],
    queryFn: () => createSubpolarClient(apiUrl, directory).getMessageContext(sessionId, messageId as string),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            Agent context
          </DialogTitle>
        </DialogHeader>
        {context.isLoading && <p className="text-sm text-muted-foreground">Loading context...</p>}
        {context.isError && <p className="text-sm text-destructive">Failed to load message context.</p>}
        {context.data && (
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent</h3>
              <p className="text-sm">{context.data.agent}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">System prompt</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{context.data.systemPrompt || 'No custom system prompt.'}</pre>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation sent to agent</h3>
              <div className="space-y-2">
                {context.data.messages.map(message => (
                  <div key={message.id} className="rounded-md border border-border p-3">
                    <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{message.role}</div>
                    <pre className="whitespace-pre-wrap break-words text-xs">{message.content || '(empty)'}</pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
