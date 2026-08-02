import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6">
      <h1 className="mb-6 text-2xl font-bold">Create your vault</h1>
      <AuthForm mode="signup" />
      <p className="mt-4 text-sm text-neutral-400">
        Already have one?{' '}
        <Link href="/login" className="text-emerald-400 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
