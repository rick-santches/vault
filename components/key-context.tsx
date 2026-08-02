'use client'

import { createContext, useContext, useState } from 'react'

/**
 * Holds the AES encKey in React state ONLY. It is never persisted:
 * a page refresh drops it by design, and the vault asks for the
 * password again to re-derive it. That's the zero-knowledge tradeoff.
 */
interface KeyState {
  encKey: CryptoKey | null
  setEncKey: (key: CryptoKey | null) => void
}

const KeyContext = createContext<KeyState>({ encKey: null, setEncKey: () => {} })

export function KeyProvider({ children }: { children: React.ReactNode }) {
  const [encKey, setEncKey] = useState<CryptoKey | null>(null)
  return <KeyContext.Provider value={{ encKey, setEncKey }}>{children}</KeyContext.Provider>
}

export function useEncKey(): KeyState {
  return useContext(KeyContext)
}
