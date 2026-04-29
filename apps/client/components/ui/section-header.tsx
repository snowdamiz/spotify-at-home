import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SectionHeaderProps = {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  size?: 'lg' | 'md' | 'sm'
  className?: string
}

export function SectionHeader({
  title,
  subtitle,
  action,
  size = 'lg',
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn('mb-4 flex items-end justify-between gap-3', className)}
    >
      <div className="min-w-0">
        <h2
          className={cn(
            'tracking-tight',
            size === 'lg' && 'text-xl font-bold md:text-2xl',
            size === 'md' && 'text-base font-semibold md:text-lg',
            size === 'sm' &&
              'text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground',
          )}
        >
          {title}
        </h2>
        {subtitle ? (
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
