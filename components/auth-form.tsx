'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deriveKeys } from '@/lib/crypto'
import { useEncKey } from './key-context'

/**
 * Shared signup/login form. The password NEVER goes in a request:
 * keys are derived locally and only authKey is posted.
 */
export function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const router = useRouter()
  const { setEncKey } = useEncKey()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    if (mode === 'signup') {
      if (password.length < 10) return setError('Use at least 10 characters.')
      if (password !== confirm) return setError('Passwords don’t match.')
    }
    setBusy(true)
    try {
      const { authKey, encKey } = await deriveKeys(email, password)
      const response = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, authKey }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? 'Something went wrong.')
        return
      }
      setEncKey(encKey)
      router.push('/vault')
    } catch {
      setError('Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-3">
      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
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
        minLength={mode === 'signup' ? 10 : 1}
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
      />
      {mode === 'signup' && (
        <>
          <input
            type="password"
            required
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
          />
          <p className="text-xs leading-relaxed text-amber-400/90">
            ⚠ This password is your only key. There is no reset — if you lose
            it, your notes are unrecoverable. That&apos;s what makes them private.
          </p>
        </>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
      >
        {busy ? 'Deriving keys…' : mode === 'signup' ? 'Create vault' : 'Unlock'}
      </button>
    </form>
  )
}
