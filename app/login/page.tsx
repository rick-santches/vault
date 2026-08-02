import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6">
      <h1 className="mb-6 text-2xl font-bold">Unlock your vault</h1>
      <AuthForm mode="login" />
      <p className="mt-4 text-sm text-neutral-400">
        No vault yet?{' '}
        <Link href="/signup" className="text-emerald-400 hover:underline">
          Create one
        </Link>
      </p>
    </main>
  )
}
