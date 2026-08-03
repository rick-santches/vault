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

/** AES-256-GCM encrypt with any AES key (fresh random 12-byte IV each call). */
async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ivBuffer = bytesToBuffer(iv)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    bytesToBuffer(enc.encode(plaintext)),
  )
  return { iv: toB64(ivBuffer), ciphertext: toB64(ciphertext) }
}

async function decryptWithKey(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ciphertext),
  )
  return dec.decode(plaintext)
}

/** Encrypt a personal note with the user's own encKey. */
export function encryptText(encKey: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  return encryptWithKey(encKey, plaintext)
}

export function decryptText(encKey: CryptoKey, blob: EncryptedBlob): Promise<string> {
  return decryptWithKey(encKey, blob)
}

/* ------------------------------------------------------------------ *
 * Sharing: ECDH P-256 keypair per user.
 *
 * publicKey is public — the server hands it to anyone who wants to
 * share TO this user. The private key is exported and AES-GCM-wrapped
 * with the user's own encKey before it ever leaves the browser, so the
 * server only stores an unusable ciphertext of it.
 *
 * To share A→B: pairwiseKey(A_private, B_public) === pairwiseKey(B_private,
 * A_public) — the ECDH shared secret is symmetric, so both derive the very
 * same AES key without the server (or anyone else) being able to.
 * ------------------------------------------------------------------ */

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' }

export interface WrappedKeypair {
  publicKey: string // base64 SPKI
  encPrivKey: string // base64 AES-GCM ciphertext of pkcs8 private key
  encPrivKeyIv: string // base64 IV
}

/** Make a fresh sharing keypair and wrap the private half with encKey. */
export async function generateShareKeypair(
  encKey: CryptoKey,
): Promise<{ wrapped: WrappedKeypair; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits'])
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ivBuffer = bytesToBuffer(iv)
  const wrappedPriv = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuffer }, encKey, pkcs8)

  return {
    wrapped: {
      publicKey: toB64(spki),
      encPrivKey: toB64(wrappedPriv),
      encPrivKeyIv: toB64(ivBuffer),
    },
    privateKey: pair.privateKey,
  }
}

/** Recover the private key from its encKey-wrapped form (after login/unlock). */
export async function unwrapPrivateKey(
  encKey: CryptoKey,
  wrapped: { encPrivKey: string; encPrivKeyIv: string },
): Promise<CryptoKey> {
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapped.encPrivKeyIv) },
    encKey,
    fromB64(wrapped.encPrivKey),
  )
  return crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, false, ['deriveKey', 'deriveBits'])
}

async function importPublicKey(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromB64(spkiB64), ECDH_PARAMS, false, [])
}

/** The AES key shared by exactly two people, via ECDH. */
async function pairwiseKey(privateKey: CryptoKey, theirPublicKeyB64: string): Promise<CryptoKey> {
  const theirPublic = await importPublicKey(theirPublicKeyB64)
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublic },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptForPeer(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
  plaintext: string,
): Promise<EncryptedBlob> {
  const key = await pairwiseKey(myPrivateKey, theirPublicKeyB64)
  return encryptWithKey(key, plaintext)
}

export async function decryptFromPeer(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
  blob: EncryptedBlob,
): Promise<string> {
  const key = await pairwiseKey(myPrivateKey, theirPublicKeyB64)
  return decryptWithKey(key, blob)
}

/**
 * A short, human-comparable fingerprint of a public key. Two people can read
 * these to each other (out of band) to be sure the server didn't swap a key —
 * the same idea as Signal's "safety numbers".
 */
export async function keyFingerprint(publicKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fromB64(publicKeyB64))
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // First 8 bytes, grouped for readability: "a1b2 c3d4 e5f6 0718".
  return (hex.slice(0, 16).match(/.{4}/g) ?? []).join(' ')
}
