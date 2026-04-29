import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type EmptyStateVariant = 'card' | 'section' | 'inline'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  variant?: EmptyStateVariant
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'card',
  className,
}: EmptyStateProps) {
  if (variant === 'section') {
    return (
      <section
        className={cn(
          'rounded-xl bg-card/40 px-5 py-6 text-sm text-muted-foreground',
          className,
        )}
      >
        {title}
        {description ? (
          <span className="ml-1 text-muted-foreground/80">— {description}</span>
        ) : null}
      </section>
    )
  }

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg bg-card/40 px-4 py-3 text-sm text-muted-foreground',
          className,
        )}
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="flex-1">{title}</span>
        {action}
      </div>
    )
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-dashed border-border bg-card/30 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-card/60 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}
