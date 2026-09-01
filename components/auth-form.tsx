'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deriveKeys } from '@/lib/crypto'
import { useEncKey } from './key-context'

// A rough strength estimate — length is the biggest factor for a master
// password (a long passphrase beats a short scramble), with a variety bonus.
// Runs entirely in the browser; the password never leaves this page.
function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' }
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (pw.length >= 20) score++
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (variety >= 3) score++
  score = Math.min(4, score)
  // Length alone shouldn't earn a green rating: a long run of one or two
  // characters ("aaaaaaaaaaaa") has almost no entropy. Cap it by distinct chars.
  const distinct = new Set(pw).size
  if (distinct <= 4) score = Math.min(score, 1)
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return { score, label: labels[score] }
}

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
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400"
        >
          {error}
        </p>
      )}
      <input
        type="email"
        required
        aria-label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
      />
      <input
        type="password"
        required
        aria-label="Master password"
        minLength={mode === 'signup' ? 10 : 1}
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
      />
      {mode === 'signup' && password.length > 0 && (
        <div className="space-y-1">
          <div className="flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => {
              const { score } = passwordStrength(password)
              const on = i < score
              const color =
                score <= 1 ? 'bg-red-500' : score === 2 ? 'bg-amber-400' : 'bg-emerald-400'
              return (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${on ? color : 'bg-neutral-800'}`}
                />
              )
            })}
          </div>
          <p className="text-xs text-neutral-500">
            Password strength: <span className="text-neutral-300">{passwordStrength(password).label}</span>
            {passwordStrength(password).score < 3 && ' — a long passphrase is strongest.'}
          </p>
        </div>
      )}
      {mode === 'signup' && (
        <>
          <input
            type="password"
            required
            aria-label="Confirm password"
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
        aria-busy={busy}
        className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
      >
        {busy ? 'Deriving keys…' : mode === 'signup' ? 'Create vault' : 'Unlock'}
      </button>
    </form>
  )
}
