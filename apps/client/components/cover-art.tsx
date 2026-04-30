'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Music } from 'lucide-react'
import { cn } from '@/lib/utils'

type CoverArtProps = {
  colorClass: string
  imageUrl?: string | null
  title: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  rounded?: 'md' | 'lg' | 'xl' | '2xl'
  className?: string
  // When set (and there is no imageUrl), render this node instead of the
  // 2-letter initials fallback. Used for symbolic covers like Liked Songs.
  icon?: ReactNode
}

const sizeMap = {
  sm: 'h-10 w-10 text-base',
  md: 'h-14 w-14 text-lg',
  lg: 'h-40 w-40 text-3xl',
  xl: 'h-56 w-56 text-4xl',
  full: 'aspect-square w-full text-3xl',
}

const roundedMap = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
}

export function CoverArt({
  colorClass,
  imageUrl,
  title,
  size = 'md',
  rounded = 'md',
  className,
  icon,
}: CoverArtProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(imageUrl && !imageFailed)

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  // We deliberately don't render two-letter initials anymore — every cover
  // either shows artwork, an explicitly-passed icon (e.g. Heart for Liked
  // Songs), or a music-note glyph for visual consistency.

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-gradient-to-br shadow-md shrink-0',
        colorClass,
        sizeMap[size],
        roundedMap[rounded],
        className,
      )}
      aria-hidden="true"
      title={title}
    >
      {showImage ? (
        <img
          alt=""
          src={imageUrl ?? undefined}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-foreground/95 drop-shadow-sm">
          {icon ?? (
            <Music className="h-[38%] w-[38%]" strokeWidth={1.75} />
          )}
        </span>
      )}
    </div>
  )
}
