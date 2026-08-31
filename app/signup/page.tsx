import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'
import { VaultMark } from '@/components/vault-mark'

export default function SignupPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(50% 50% at 50% 0%, rgba(52,211,153,0.10), rgba(10,10,10,0) 70%)',
        }}
      />
      <Link
        href="/"
        className="absolute left-6 top-6 text-sm text-neutral-500 transition hover:text-neutral-300"
      >
        ← Home
      </Link>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <Link href="/" aria-label="Vault home">
            <VaultMark size={48} />
          </Link>
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-emerald-400">
            Zero-knowledge notes
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Create your vault</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Everything is encrypted in this browser before it ever reaches us.
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]">
          <AuthForm mode="signup" />
        </div>

        <p className="mt-5 text-center text-sm text-neutral-400">
          Already have one?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
