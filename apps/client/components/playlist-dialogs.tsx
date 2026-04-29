'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type CreatePlaylistDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: { name: string; description: string | null }) => Promise<void>
}

export function CreatePlaylistDialog({
  open,
  onOpenChange,
  onCreate,
}: CreatePlaylistDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setSubmitting(false)
    }
  }, [open])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onCreate({
        name: trimmedName,
        description: description.trim() === '' ? null : description.trim(),
      })
      onOpenChange(false)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create playlist</DialogTitle>
            <DialogDescription>
              Give your playlist a name so you can drop songs into it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My favorite mix"
                maxLength={120}
                className="mt-1 h-10 w-full rounded-md bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="block text-sm font-medium">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
                rows={3}
                maxLength={500}
                className="mt-1 w-full resize-none rounded-md bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type EditPlaylistDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName: string
  initialDescription: string | null
  onSave: (input: { name: string; description: string | null }) => Promise<void>
}

export function EditPlaylistDialog({
  open,
  onOpenChange,
  initialName,
  initialDescription,
  onSave,
}: EditPlaylistDialogProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription ?? '')
      setSubmitting(false)
    }
  }, [open, initialName, initialDescription])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSave({
        name: trimmedName,
        description: description.trim() === '' ? null : description.trim(),
      })
      onOpenChange(false)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit playlist</DialogTitle>
            <DialogDescription>
              Update the name or description for this playlist.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className="mt-1 h-10 w-full rounded-md bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="block text-sm font-medium">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1 w-full resize-none rounded-md bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
