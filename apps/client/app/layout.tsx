import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

const SITE_TITLE = 'Broadside — Your music, anywhere'
const SITE_DESCRIPTION =
  'A private music player for importing, syncing, and streaming your own library.'

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: 'Broadside',
  openGraph: {
    type: 'website',
    siteName: 'Broadside',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} bg-background`}>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Toaster />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
