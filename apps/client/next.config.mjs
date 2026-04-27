const apiBaseUrl =
  process.env.TUNELY_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:3101'

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiBaseUrl.replace(/\/$/, '')}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
