'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const NAME_MAX = 120
const DESCRIPTION_MAX = 500

type PlaylistFormInput = { name: string; description: string | null }

type CreatePlaylistDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: PlaylistFormInput) => Promise<void>
}

export function CreatePlaylistDialog({
  open,
  onOpenChange,
  onCreate,
}: CreatePlaylistDialogProps) {
  return (
    <PlaylistDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create playlist"
      description="Give your playlist a name so you can drop songs into it."
      submitLabel="Create"
      submittingLabel="Creating…"
      namePlaceholder="My favorite mix"
      onSubmit={onCreate}
    />
  )
}

type EditPlaylistDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName: string
  initialDescription: string | null
  onSave: (input: PlaylistFormInput) => Promise<void>
}

export function EditPlaylistDialog({
  open,
  onOpenChange,
  initialName,
  initialDescription,
  onSave,
}: EditPlaylistDialogProps) {
  return (
    <PlaylistDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit playlist"
      description="Update the name or description for this playlist."
      submitLabel="Save"
      submittingLabel="Saving…"
      initialName={initialName}
      initialDescription={initialDescription ?? ''}
      onSubmit={onSave}
    />
  )
}

type PlaylistDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  submittingLabel: string
  namePlaceholder?: string
  initialName?: string
  initialDescription?: string
  onSubmit: (input: PlaylistFormInput) => Promise<void>
}

function PlaylistDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submittingLabel,
  namePlaceholder,
  initialName = '',
  initialDescription = '',
  onSubmit,
}: PlaylistDialogProps) {
  const [name, setName] = useState(initialName)
  const [descriptionValue, setDescriptionValue] = useState(initialDescription)
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescriptionValue(initialDescription)
      setTouched(false)
      setSubmitting(false)
    }
  }, [open, initialName, initialDescription])

  const trimmedName = name.trim()
  const nameIsEmpty = trimmedName.length === 0
  const showNameError = touched && nameIsEmpty
  const canSubmit = !nameIsEmpty && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: trimmedName,
        description:
          descriptionValue.trim() === '' ? null : descriptionValue.trim(),
      })
      onOpenChange(false)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field
              label="Name"
              hint={
                showNameError
                  ? 'Name is required.'
                  : undefined
              }
              counter={
                name.length > NAME_MAX - 20
                  ? `${name.length} / ${NAME_MAX}`
                  : undefined
              }
              hasError={showNameError}
            >
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder={namePlaceholder}
                maxLength={NAME_MAX}
                className={cn(inputClass, showNameError && inputErrorClass)}
              />
            </Field>
            <Field
              label="Description"
              counter={
                descriptionValue.length > DESCRIPTION_MAX - 40
                  ? `${descriptionValue.length} / ${DESCRIPTION_MAX}`
                  : undefined
              }
            >
              <textarea
                value={descriptionValue}
                onChange={(event) =>
                  setDescriptionValue(event.target.value)
                }
                placeholder="Optional"
                rows={3}
                maxLength={DESCRIPTION_MAX}
                className={cn(textareaClass)}
              />
            </Field>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-full px-5"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-10 rounded-full px-5"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {submittingLabel}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const inputClass =
  'h-11 w-full rounded-full bg-card/80 px-4 text-sm text-foreground placeholder:text-muted-foreground transition-shadow focus:bg-card focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_30%,transparent)]'

const inputErrorClass =
  'focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_30%,transparent)] ring-1 ring-destructive/40'

const textareaClass =
  'w-full resize-none rounded-2xl bg-card/80 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground transition-shadow focus:bg-card focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_30%,transparent)]'

function Field({
  label,
  hint,
  counter,
  hasError,
  children,
}: {
  label: string
  hint?: string
  counter?: string
  hasError?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between text-sm font-medium">
        <span>{label}</span>
        {counter ? (
          <span className="text-xs text-muted-foreground">{counter}</span>
        ) : null}
      </div>
      {children}
      {hint ? (
        <div
          className={cn(
            'mt-1.5 text-xs',
            hasError ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {hint}
        </div>
      ) : null}
    </label>
  )
}
