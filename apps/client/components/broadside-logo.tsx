import type { SVGProps } from 'react'

export function BroadsideLogo({
  withWaves = true,
  ...props
}: SVGProps<SVGSVGElement> & { withWaves?: boolean }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Broadside"
      {...props}
    >
      <rect width="512" height="512" rx="112" fill="#fd923e" />
      {withWaves ? (
        <g fill="#0a0a0a">
          <path d="M112 96h112c40 0 70 11 89 33 14 16 21 35 21 56 0 36-19 60-56 73 22 5 40 16 53 33 13 17 19 36 19 58 0 27-9 49-26 65-22 22-56 34-100 34H112V96zm67 60v74h45c20 0 35-3 45-10 11-7 17-19 17-36 0-15-5-26-15-33s-25-11-44-11h-48zm0 134v76h54c22 0 38-3 49-10 12-7 18-19 18-36 0-15-6-26-17-33-12-7-29-11-50-11h-54z" />
          <rect x="370" y="220" width="16" height="72" rx="8" />
          <rect x="402" y="188" width="16" height="136" rx="8" />
          <rect x="434" y="232" width="16" height="48" rx="8" />
        </g>
      ) : (
        <path
          fill="#0a0a0a"
          d="M168 96h126c44 0 76 12 96 35 15 17 23 38 23 61 0 39-21 65-61 79 23 5 43 17 56 35 14 18 21 39 21 62 0 30-10 53-29 71-23 23-58 37-105 37H168V96zm71 64v82h46c22 0 39-3 50-11 12-8 19-21 19-39 0-17-6-29-17-37-11-7-27-11-49-11H239zm0 144v82h57c23 0 41-4 52-11 13-8 20-21 20-39 0-17-7-29-19-37-12-7-31-12-53-12H239z"
        />
      )}
    </svg>
  )
}
