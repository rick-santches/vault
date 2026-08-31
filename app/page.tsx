import type { Metadata } from 'next'
import { Landing } from '@/components/landing'

export const metadata: Metadata = {
  title: "Vault — Notes your server can't read",
  description:
    'Zero-knowledge encrypted notes. Everything is locked in your browser before it touches the network, and the server stores only ciphertext it cannot read. Share a note with one other person, end to end.',
}

export default function HomePage() {
  return <Landing />
}
