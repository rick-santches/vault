'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEncKey } from '@/components/key-context'
import { decryptText, deriveKeys, encryptText, type EncryptedBlob } from '@/lib/crypto'

interface RawNote extends EncryptedBlob {
  id: string
  createdAt: string
}

interface DecryptedNote {
  id: string
  createdAt: string
  text: string | null // null = couldn't decrypt with the current key
}

export default function VaultPage() {
  const router = useRouter()
  const { encKey, setEncKey } = useEncKey()
  const [checking, setChecking] = useState(true)
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  // Confirm there's a valid session; bounce to login if not.
  useEffect(() => {
    let active = true
    void fetch('/api/me')
      .then((r) => r.json() as Promise<{ authenticated: boolean }>)
      .then((d) => {
        if (!active) return
        if (!d.authenticated) router.replace('/login')
        else setChecking(false)
      })
    return () => {
      active = false
    }
  }, [router])

  const loadNotes = useCallback(
    async (key: CryptoKey): Promise<void> => {
      const response = await fetch('/api/notes')
      if (!response.ok) return
      const { notes: raw } = (await response.json()) as { notes: RawNote[] }
      const decrypted = await Promise.all(
        raw.map(async (n) => {
          try {
            return { id: n.id, createdAt: n.createdAt, text: await decryptText(key, n) }
          } catch {
            return { id: n.id, createdAt: n.createdAt, text: null }
          }
        }),
      )
      setNotes(decrypted)
    },
    [],
  )

  useEffect(() => {
    if (encKey && !checking) void loadNotes(encKey)
  }, [encKey, checking, loadNotes])

  async function addNote(): Promise<void> {
    if (!encKey || !draft.trim()) return
    setBusy(true)
    try {
      const blob = await encryptText(encKey, draft.trim())
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blob),
      })
      if (response.ok) {
        setDraft('')
        await loadNotes(encKey)
      }
    } finally {
      setBusy(false)
    }
  }

  async function deleteNote(id: string): Promise<void> {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  async function logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' })
    setEncKey(null)
    router.replace('/login')
  }

  if (checking) {
    return <main className="flex min-h-screen items-center justify-center text-neutral-500">Checking session…</main>
  }

  // Session is valid but the key was lost on refresh — re-derive locally.
  if (!encKey) {
    return <UnlockForm onUnlocked={setEncKey} />
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          <span className="text-emerald-400">Vault</span>
        </h1>
        <button
          onClick={() => void logout()}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500"
        >
          Lock &amp; sign out
        </button>
      </div>

      <div className="mt-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a note… it’s encrypted before it leaves this page."
          rows={3}
          className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
        />
        <button
          onClick={() => void addNote()}
          disabled={busy || !draft.trim()}
          className="mt-2 rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
        >
          {busy ? 'Encrypting…' : 'Add note'}
        </button>
      </div>

      <ul className="mt-8 space-y-3">
        {notes.length === 0 && (
          <li className="text-sm text-neutral-500">No notes yet. Add your first above.</li>
        )}
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-start justify-between gap-4">
              {note.text === null ? (
                <p className="text-sm italic text-amber-400/80">
                  [could not decrypt — wrong key]
                </p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">
                  {note.text}
                </p>
              )}
              <button
                onClick={() => void deleteNote(note.id)}
                className="shrink-0 text-xs text-neutral-500 hover:text-red-400"
              >
                Delete
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-600">
              {new Date(note.createdAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </main>
  )
}

/** After a refresh the session cookie survives but encKey doesn't — re-derive it locally, no server round-trip. */
function UnlockForm({ onUnlocked }: { onUnlocked: (key: CryptoKey) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { encKey } = await deriveKeys(email, password)
      onUnlocked(encKey)
    } catch {
      setError('Could not derive key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-2xl font-bold">Unlock your vault</h1>
      <p className="mb-6 max-w-sm text-center text-sm text-neutral-400">
        You&apos;re still signed in, but your encryption key isn&apos;t held in
        memory after a refresh. Re-enter your password to decrypt — it stays in
        this browser.
      </p>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
        />
        <input
          type="password"
          required
          placeholder="Master password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
        >
          {busy ? 'Deriving key…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
