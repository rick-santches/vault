'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEncKey } from '@/components/key-context'
import { VaultMark } from '@/components/vault-mark'
import {
  decryptFromPeer,
  decryptText,
  deriveKeys,
  encryptForPeer,
  encryptText,
  generateShareKeypair,
  keyFingerprint,
  unwrapPrivateKey,
  type EncryptedBlob,
} from '@/lib/crypto'

interface RawNote extends EncryptedBlob {
  id: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface DecryptedNote {
  id: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  text: string | null // null = couldn't decrypt with the current key
}

interface RawShare extends EncryptedBlob {
  id: string
  createdAt: string
  peerEmail: string
  peerPublicKey: string | null
}

interface DecryptedShare {
  id: string
  createdAt: string
  peerEmail: string
  text: string | null
}

type Tab = 'notes' | 'shared'

// Drop the in-memory keys after this much inactivity, like a password manager.
const IDLE_LOCK_MS = 15 * 60 * 1000

export default function VaultPage() {
  const router = useRouter()
  const { encKey, setEncKey } = useEncKey()
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<Tab>('notes')

  // Personal notes
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Sharing keypair (private key held in memory only, like encKey)
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [received, setReceived] = useState<DecryptedShare[]>([])
  const [sent, setSent] = useState<DecryptedShare[]>([])

  // Share form
  const [shareEmail, setShareEmail] = useState('')
  const [shareDraft, setShareDraft] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareOk, setShareOk] = useState<string | null>(null)

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

  const loadNotes = useCallback(async (key: CryptoKey): Promise<void> => {
    const response = await fetch('/api/notes')
    if (!response.ok) return
    const { notes: raw } = (await response.json()) as { notes: RawNote[] }
    const decrypted = await Promise.all(
      raw.map(async (n) => {
        try {
          return { id: n.id, pinned: n.pinned, createdAt: n.createdAt, updatedAt: n.updatedAt, text: await decryptText(key, n) }
        } catch {
          return { id: n.id, pinned: n.pinned, createdAt: n.createdAt, updatedAt: n.updatedAt, text: null }
        }
      }),
    )
    setNotes(decrypted)
  }, [])

  // After unlock, make sure this account has a sharing keypair. Existing
  // accounts (created before sharing shipped) get one generated on first visit.
  useEffect(() => {
    if (!encKey || checking) return
    let active = true
    void (async () => {
      try {
        const res = await fetch('/api/keys')
        const data = (await res.json()) as {
          publicKey: string | null
          encPrivKey: string | null
          encPrivKeyIv: string | null
        }
        let publicKey = data.publicKey
        let priv: CryptoKey
        if (publicKey && data.encPrivKey && data.encPrivKeyIv) {
          priv = await unwrapPrivateKey(encKey, {
            encPrivKey: data.encPrivKey,
            encPrivKeyIv: data.encPrivKeyIv,
          })
        } else {
          const { wrapped, privateKey: fresh } = await generateShareKeypair(encKey)
          const post = await fetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(wrapped),
          })
          if (!post.ok) {
            // Someone set it first (409) — reload and unwrap the stored one.
            const again = (await (await fetch('/api/keys')).json()) as typeof data
            if (again.publicKey && again.encPrivKey && again.encPrivKeyIv) {
              publicKey = again.publicKey
              priv = await unwrapPrivateKey(encKey, {
                encPrivKey: again.encPrivKey,
                encPrivKeyIv: again.encPrivKeyIv,
              })
            } else {
              return
            }
          } else {
            publicKey = wrapped.publicKey
            priv = fresh
          }
        }
        if (!active) return
        setPrivateKey(priv)
        if (publicKey) setFingerprint(await keyFingerprint(publicKey))
      } catch {
        /* sharing just stays unavailable; personal notes still work */
      }
    })()
    return () => {
      active = false
    }
  }, [encKey, checking])

  const loadShares = useCallback(async (priv: CryptoKey): Promise<void> => {
    const res = await fetch('/api/shares')
    if (!res.ok) return
    const data = (await res.json()) as { received: RawShare[]; sent: RawShare[] }
    const decode = (list: RawShare[]) =>
      Promise.all(
        list.map(async (s) => {
          let text: string | null = null
          if (s.peerPublicKey) {
            try {
              text = await decryptFromPeer(priv, s.peerPublicKey, s)
            } catch {
              text = null
            }
          }
          return { id: s.id, createdAt: s.createdAt, peerEmail: s.peerEmail, text }
        }),
      )
    setReceived(await decode(data.received))
    setSent(await decode(data.sent))
  }, [])

  useEffect(() => {
    if (encKey && !checking) void loadNotes(encKey)
  }, [encKey, checking, loadNotes])

  useEffect(() => {
    if (privateKey) void loadShares(privateKey)
  }, [privateKey, loadShares])

  // Auto-lock: after IDLE_LOCK_MS with no activity, drop the in-memory keys.
  // The page then falls through to the unlock screen (same as logout), so a
  // walk-away doesn't leave notes readable. Nothing is persisted or sent.
  useEffect(() => {
    if (!encKey) return
    let timer: ReturnType<typeof setTimeout>
    const lock = () => {
      setEncKey(null)
      setPrivateKey(null)
    }
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, IDLE_LOCK_MS)
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [encKey, setEncKey])

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

  function exportNotes(): void {
    // A browser-side backup. Everything is already decrypted in memory here, so
    // the plaintext file is assembled locally and never touches the network —
    // the honest safety net for a product with no password reset.
    const decrypted = notes.filter((n) => n.text !== null)
    if (decrypted.length === 0) return
    const stamp = new Date().toISOString().slice(0, 10)
    const header =
      `Vault backup — ${decrypted.length} note${decrypted.length === 1 ? '' : 's'} — ` +
      `${new Date().toLocaleString()}\n` +
      `Decrypted in your browser. Keep this file somewhere safe.\n`
    const body = decrypted
      .map((n) => `\n${'─'.repeat(40)}\n${new Date(n.createdAt).toLocaleString()}\n\n${n.text}\n`)
      .join('')
    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vault-notes-${stamp}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function togglePin(note: DecryptedNote): Promise<void> {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !note.pinned }),
    })
    if (res.ok && encKey) await loadNotes(encKey)
  }

  function copyNote(note: DecryptedNote): void {
    if (note.text === null || !navigator.clipboard) return
    void navigator.clipboard.writeText(note.text).then(() => {
      setCopiedId(note.id)
      setTimeout(() => setCopiedId((cur) => (cur === note.id ? null : cur)), 1400)
    })
  }

  function startEdit(note: DecryptedNote): void {
    if (note.text === null) return
    setEditingId(note.id)
    setEditDraft(note.text)
  }

  function cancelEdit(): void {
    setEditingId(null)
    setEditDraft('')
  }

  async function saveEdit(id: string): Promise<void> {
    if (!encKey || !editDraft.trim()) return
    setBusy(true)
    try {
      // Re-encrypt the edited text in the browser; the server sees only ciphertext.
      const blob = await encryptText(encKey, editDraft.trim())
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blob),
      })
      if (res.ok) {
        cancelEdit()
        await loadNotes(encKey)
      }
    } finally {
      setBusy(false)
    }
  }

  async function shareNote(): Promise<void> {
    setShareError(null)
    setShareOk(null)
    const to = shareEmail.trim().toLowerCase()
    if (!privateKey) return setShareError('Your sharing key isn’t ready yet — try again in a moment.')
    if (!to.includes('@')) return setShareError('Enter the recipient’s email.')
    if (!shareDraft.trim()) return setShareError('Write something to share.')
    setShareBusy(true)
    try {
      // Fetch the recipient's PUBLIC key, then lock the note to them locally.
      const lookup = await fetch(`/api/users/public-key?email=${encodeURIComponent(to)}`)
      if (!lookup.ok) {
        const { error } = (await lookup.json()) as { error?: string }
        setShareError(error ?? 'Could not find that recipient.')
        return
      }
      const { publicKey } = (await lookup.json()) as { publicKey: string }
      const blob = await encryptForPeer(privateKey, publicKey, shareDraft.trim())
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: to, ...blob }),
      })
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string }
        setShareError(error ?? 'Could not share.')
        return
      }
      setShareDraft('')
      setShareOk(`Shared with ${to}. Only they can open it.`)
      await loadShares(privateKey)
    } catch {
      setShareError('Something went wrong.')
    } finally {
      setShareBusy(false)
    }
  }

  async function deleteShare(id: string): Promise<void> {
    await fetch(`/api/shares/${id}`, { method: 'DELETE' })
    setReceived((prev) => prev.filter((s) => s.id !== id))
    setSent((prev) => prev.filter((s) => s.id !== id))
  }

  async function logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' })
    setEncKey(null)
    setPrivateKey(null)
    router.replace('/login')
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center text-neutral-500">
        Checking session…
      </main>
    )
  }

  // Session is valid but the key was lost on refresh — re-derive it locally.
  if (!encKey) {
    return <UnlockForm onUnlocked={setEncKey} />
  }

  const q = query.trim().toLowerCase()
  const visibleNotes = q
    ? notes.filter((n) => (n.text ?? '').toLowerCase().includes(q))
    : notes

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          <VaultMark size={30} withWord />
        </h1>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-neutral-600 sm:inline">
            Auto-locks after 15 min idle
          </span>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500"
          >
            Lock &amp; sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-sm">
        <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>
          My notes
        </TabButton>
        <TabButton active={tab === 'shared'} onClick={() => setTab('shared')}>
          Shared{' '}
          {received.length > 0 && <span className="text-emerald-400">({received.length})</span>}
        </TabButton>
      </div>

      {tab === 'notes' ? (
        <>
          <div className="mt-6">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void addNote()
                }
              }}
              placeholder="Write a note… it’s encrypted before it leaves this page."
              rows={3}
              className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-400"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => void addNote()}
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                {busy ? 'Encrypting…' : 'Add note'}
              </button>
              <span className="text-xs text-neutral-600">
                <kbd className="rounded border border-neutral-700 px-1">⌘</kbd>/
                <kbd className="rounded border border-neutral-700 px-1">Ctrl</kbd> +{' '}
                <kbd className="rounded border border-neutral-700 px-1">Enter</kbd> to save
              </span>
            </div>
          </div>

          {notes.length > 0 && (
            <div className="mt-8">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your notes…"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-neutral-600">
                  {query
                    ? `${visibleNotes.length} of ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
                    : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}{' '}
                  · searched in your browser — we never see your query.
                </p>
                <button
                  onClick={exportNotes}
                  title="Download a decrypted backup — stays on your device"
                  className="shrink-0 text-xs text-neutral-500 hover:text-emerald-400"
                >
                  Export ↓
                </button>
              </div>
            </div>
          )}

          <ul className="mt-4 space-y-3">
            {notes.length === 0 && (
              <li className="text-sm text-neutral-500">No notes yet. Add your first above.</li>
            )}
            {notes.length > 0 && visibleNotes.length === 0 && (
              <li className="text-sm text-neutral-500">No notes match “{query}”.</li>
            )}
            {visibleNotes.map((note) => (
              <li
                key={note.id}
                className={`rounded-lg border bg-neutral-900 p-4 ${
                  note.pinned ? 'border-emerald-500/30' : 'border-neutral-800'
                }`}
              >
                {editingId === note.id ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void saveEdit(note.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                      rows={3}
                      autoFocus
                      className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void saveEdit(note.id)}
                        disabled={busy || !editDraft.trim()}
                        className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
                      >
                        {busy ? 'Encrypting…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      {note.text === null ? (
                        <p className="text-sm italic text-amber-400/80">[could not decrypt — wrong key]</p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">
                          {note.text}
                        </p>
                      )}
                      <div className="flex shrink-0 gap-3 text-xs">
                        <button
                          onClick={() => void togglePin(note)}
                          title={note.pinned ? 'Unpin' : 'Pin to top'}
                          className={
                            note.pinned
                              ? 'text-emerald-400'
                              : 'text-neutral-500 hover:text-emerald-400'
                          }
                        >
                          {note.pinned ? 'Pinned' : 'Pin'}
                        </button>
                        {note.text !== null && (
                          <button
                            onClick={() => copyNote(note)}
                            className={
                              copiedId === note.id
                                ? 'text-emerald-400'
                                : 'text-neutral-500 hover:text-emerald-400'
                            }
                          >
                            {copiedId === note.id ? 'Copied' : 'Copy'}
                          </button>
                        )}
                        {note.text !== null && (
                          <button
                            onClick={() => startEdit(note)}
                            className="text-neutral-500 hover:text-emerald-400"
                          >
                            Edit
                          </button>
                        )}
                        {confirmDeleteId === note.id ? (
                          <>
                            <button
                              onClick={() => {
                                setConfirmDeleteId(null)
                                void deleteNote(note.id)
                              }}
                              className="font-semibold text-red-400 hover:text-red-300"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-neutral-500 hover:text-neutral-300"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(note.id)}
                            className="text-neutral-500 hover:text-red-400"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-neutral-600">
                      {note.pinned && <span className="text-emerald-400/80">📌 Pinned · </span>}
                      {new Date(note.createdAt).toLocaleString()}
                      {new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() >
                        2000 && (
                        <span className="text-neutral-500">
                          {' '}
                          · edited {new Date(note.updatedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <SharedTab
          fingerprint={fingerprint}
          shareEmail={shareEmail}
          setShareEmail={setShareEmail}
          shareDraft={shareDraft}
          setShareDraft={setShareDraft}
          shareBusy={shareBusy}
          shareError={shareError}
          shareOk={shareOk}
          onShare={() => void shareNote()}
          received={received}
          sent={sent}
          onDelete={(id) => void deleteShare(id)}
        />
      )}
    </main>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
        active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}

function SharedTab(props: {
  fingerprint: string | null
  shareEmail: string
  setShareEmail: (v: string) => void
  shareDraft: string
  setShareDraft: (v: string) => void
  shareBusy: boolean
  shareError: string | null
  shareOk: string | null
  onShare: () => void
  received: DecryptedShare[]
  sent: DecryptedShare[]
  onDelete: (id: string) => void
}) {
  return (
    <div className="mt-6 space-y-8">
      {/* Compose */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-200">Share a note with someone</h2>
        <p className="mt-1 text-xs text-neutral-500">
          It’s locked to their account in your browser — the server, and everyone else, only ever
          sees ciphertext. They must have a Vault account first.
        </p>
        {props.shareError && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {props.shareError}
          </p>
        )}
        {props.shareOk && (
          <p className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            {props.shareOk}
          </p>
        )}
        <input
          type="email"
          placeholder="recipient@example.com"
          value={props.shareEmail}
          onChange={(e) => props.setShareEmail(e.target.value)}
          className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
        />
        <textarea
          value={props.shareDraft}
          onChange={(e) => props.setShareDraft(e.target.value)}
          placeholder="What do you want to share privately?"
          rows={3}
          className="mt-2 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
        />
        <button
          onClick={props.onShare}
          disabled={props.shareBusy}
          className="mt-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
        >
          {props.shareBusy ? 'Encrypting…' : 'Share securely'}
        </button>
      </section>

      {/* Received */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-300">Shared with you</h2>
        <ul className="mt-3 space-y-3">
          {props.received.length === 0 && (
            <li className="text-sm text-neutral-500">Nothing shared with you yet.</li>
          )}
          {props.received.map((s) => (
            <ShareCard key={s.id} share={s} label="from" onDelete={props.onDelete} />
          ))}
        </ul>
      </section>

      {/* Sent */}
      {props.sent.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-300">You shared</h2>
          <ul className="mt-3 space-y-3">
            {props.sent.map((s) => (
              <ShareCard key={s.id} share={s} label="to" onDelete={props.onDelete} />
            ))}
          </ul>
        </section>
      )}

      {props.fingerprint && (
        <p className="border-t border-neutral-900 pt-4 text-xs text-neutral-600">
          Your key fingerprint:{' '}
          <span className="font-mono text-neutral-400">{props.fingerprint}</span>. Read it aloud to a
          contact to confirm no one swapped keys in the middle.
        </p>
      )}
    </div>
  )
}

function ShareCard({
  share,
  label,
  onDelete,
}: {
  share: DecryptedShare
  label: 'from' | 'to'
  onDelete: (id: string) => void
}) {
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-4">
        {share.text === null ? (
          <p className="text-sm italic text-amber-400/80">[could not decrypt]</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">{share.text}</p>
        )}
        <button
          onClick={() => onDelete(share.id)}
          className="shrink-0 text-xs text-neutral-500 hover:text-red-400"
        >
          Delete
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-600">
        {label} <span className="text-neutral-400">{share.peerEmail}</span> ·{' '}
        {new Date(share.createdAt).toLocaleString()}
      </p>
    </li>
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
      <VaultMark size={44} />
      <h1 className="mb-2 mt-4 text-2xl font-bold">Unlock your vault</h1>
      <p className="mb-6 max-w-sm text-center text-sm text-neutral-400">
        You&apos;re still signed in, but your encryption key isn&apos;t held in memory after a
        refresh. Re-enter your password to decrypt — it stays in this browser.
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
