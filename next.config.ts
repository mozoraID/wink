import type { NextConfig } from 'next'

const config: NextConfig = {
  async redirects() {
    // The glasses app is a static Vite build copied into public/g2.
    return [{ source: '/g2', destination: '/g2/index.html', permanent: false }]
  },
  async headers() {
    return [
      {
        // The glasses app runs inside the Even app WebView on another origin.
        source: '/api/glasses/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
}

export default config
