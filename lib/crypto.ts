/**
 * The zero-knowledge core. Runs ONLY in the browser (Web Crypto API).
 *
 * password + email ──PBKDF2 310k──▶ master bits
 *                                    ├─HKDF("vault-auth")─▶ authKey  → sent to server, bcrypt-hashed there
 *                                    └─HKDF("vault-enc")──▶ encKey   → NEVER leaves the browser
 *
 * The server authenticates you with authKey but can never derive encKey
 * from it — so it can verify who you are without being able to read a
 * single note. encKey lives in React state only: no localStorage, no
 * cookies. Refresh the page and you re-derive it from your password.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface DerivedKeys {
  /** base64 — safe to send to the server for authentication */
  authKey: string
  /** non-extractable AES-GCM key — must never leave the browser */
  encKey: CryptoKey
}

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

// Returns a fresh ArrayBuffer (not SharedArrayBuffer-backed) so it
// satisfies BufferSource across TS lib versions.
function fromB64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function bytesToBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

/** Deterministic per-user salt: SHA-256 of the normalized email. */
async function saltFor(email: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(email.trim().toLowerCase()))
}

export async function deriveKeys(email: string, password: string): Promise<DerivedKeys> {
  const salt = await saltFor(email)

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
    passwordKey,
    256,
  )

  const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])

  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-auth') },
    hkdfKey,
    256,
  )

  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-enc') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: even our own JS can't export it
    ['encrypt', 'decrypt'],
  )

  return { authKey: toB64(authBits), encKey }
}

export interface EncryptedBlob {
  iv: string
  ciphertext: string
}

export async function encryptText(encKey: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ivBuffer = bytesToBuffer(iv)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    encKey,
    bytesToBuffer(enc.encode(plaintext)),
  )
  return { iv: toB64(ivBuffer), ciphertext: toB64(ciphertext) }
}

export async function decryptText(encKey: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    encKey,
    fromB64(blob.ciphertext),
  )
  return dec.decode(plaintext)
}
