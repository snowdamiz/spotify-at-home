'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type CoverArtProps = {
  colorClass: string
  imageUrl?: string | null
  title: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  rounded?: 'md' | 'lg' | 'xl' | '2xl'
  className?: string
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
}: CoverArtProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(imageUrl && !imageFailed)

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  const initials = title
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

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
        <span className="font-bold tracking-tight text-foreground/95 drop-shadow-sm">
          {initials || '♪'}
        </span>
      )}
    </div>
  )
}
