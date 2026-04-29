import type { SVGProps } from 'react'

export function OnVibeLogo({
  withWaves = true,
  ...props
}: SVGProps<SVGSVGElement> & { withWaves?: boolean }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="OnVibe"
      {...props}
    >
      <rect width="512" height="512" rx="112" fill="#fd923e" />
      {withWaves ? (
        <g
          fill="none"
          stroke="#0a0a0a"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="46"
        >
          <circle cx="174" cy="256" r="72" />
          <path d="M282 168l68 176 80-176" />
        </g>
      ) : (
        <path
          fill="#0a0a0a"
          d="M173 122c-75 0-134 59-134 134s59 134 134 134 134-59 134-134-59-134-134-134zm0 55c44 0 78 35 78 79s-34 79-78 79-78-35-78-79 34-79 78-79zm110 4c-8-21 8-44 31-44 14 0 26 9 31 22l47 123 58-124c8-18 29-26 47-18 18 9 26 30 17 48l-92 196c-6 13-19 21-33 20-14 0-26-9-31-22L283 181z"
        />
      )}
    </svg>
  )
}
