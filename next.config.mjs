/** @type {import('next').NextConfig} */

// Content-Security-Policy. The app loads nothing external — no CDN, no fonts,
// no analytics — so every fetch/script/style is locked to same-origin.
//
// The load-bearing directives for a zero-knowledge app:
//   connect-src 'self'   → even an injected script cannot POST your key/plaintext
//                          to an attacker's server; the browser blocks off-origin.
//   frame-ancestors 'none' → the unlock/password form can't be framed (clickjacking).
//   default-src 'self' + no external origins → no third-party script can load at all.
//
// script-src keeps 'unsafe-inline' because Next.js App Router streams hydration
// via inline <script> tags on statically-generated pages. The strictly-correct
// alternative is a per-request nonce set in middleware with every page rendered
// dynamically (export const dynamic = 'force-dynamic'); it's stricter but gives
// up static generation and needs a live deploy to validate. Note content is
// rendered as auto-escaped React text (no dangerouslySetInnerHTML), so the
// inline-script XSS surface this leaves open is small.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `font-src 'self'`,
  `connect-src 'self'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Force HTTPS for two years, including subdomains. The whole zero-knowledge
  // model assumes the JS you receive is authentic — TLS is what guarantees that.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // The unlock form must never be framed (clickjacking a password prompt).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Never leak a note id / route in a Referer header to anywhere.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
