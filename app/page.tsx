import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">Vault</p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">
        Notes your server can&apos;t read.
      </h1>
      <p className="mt-4 text-neutral-400">
        Everything is encrypted in your browser with a key derived from your
        password — before any network request. The server authenticates you
        without ever seeing the password, and stores only ciphertext.
      </p>
      <ul className="mt-6 space-y-1 text-left text-sm text-neutral-400">
        <li>• Key derivation: PBKDF2 (310k) + HKDF split, Web Crypto API only</li>
        <li>• Encryption: AES-256-GCM, fresh IV per note, in-browser</li>
        <li>• The tradeoff: lose the password, lose the notes. No reset exists.</li>
      </ul>
      <div className="mt-8 flex gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-emerald-400 px-5 py-2.5 font-semibold text-neutral-950 hover:bg-emerald-300"
        >
          Create a vault
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-neutral-700 px-5 py-2.5 font-semibold hover:border-neutral-500"
        >
          Sign in
        </Link>
      </div>
    </main>
  )
}
