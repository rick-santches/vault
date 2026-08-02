import type { Metadata } from 'next'
import { KeyProvider } from '@/components/key-context'
import './globals.css'

export const metadata: Metadata = {
  title: 'Vault — zero-knowledge notes',
  description:
    'Notes encrypted in your browser before they ever touch the network. The server stores ciphertext it cannot read.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KeyProvider>{children}</KeyProvider>
      </body>
    </html>
  )
}
