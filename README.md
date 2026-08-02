# Vault — zero-knowledge encrypted notes

Notes encrypted **in your browser** before they touch the network. The server
authenticates you but stores only ciphertext it cannot read. Same core pattern
as Bitwarden, deliberately small.

## Run it

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Open http://localhost:3000 → create a vault → add a note.

**Prove it works:** open `npx prisma studio` → the `Note` table holds only
base64 `iv` + `ciphertext`, no readable text. Or open DevTools → Network,
sign up, and inspect the POST to `/api/signup`: you'll see `authKey` (base64
gibberish), never your password.

## How the keys work

```
password + email
   └─ PBKDF2-SHA256, 310,000 iterations, salt = SHA-256(email)  ──▶ master (256 bits)
        ├─ HKDF "vault-auth" ──▶ authKey  → sent to server → bcrypt(cost 12) → stored
        └─ HKDF "vault-enc"  ──▶ encKey   → AES-256-GCM key, NEVER leaves the browser
```

- The server sees `authKey` and can check *who you are*, but cannot derive
  `encKey` from it — so it can never read a note.
- `encKey` is non-extractable and lives in React state only (no localStorage,
  no cookies). A page refresh drops it, and the vault asks for your password
  again to re-derive it locally (no new login round-trip).
- Notes are AES-256-GCM with a fresh random 12-byte IV each; the DB stores
  `{ iv, ciphertext }` as base64.
- Only the native Web Crypto API is used. No third-party crypto libraries.

## What's production-ready vs. a demo shortcut

**Real security (keep it):**
- Zero-knowledge: server never sees password, encKey, or plaintext.
- 310k PBKDF2 iterations (OWASP guidance), HKDF domain separation, bcrypt on
  the stored authKey, non-extractable AES key, per-note IVs.
- Notes deletes and reads are scoped to the session user.
- Generic login error (no account enumeration); basic auth rate limiting.

**Demo shortcuts (change before real users):**
- **No password reset — by design.** Zero-knowledge means the server can't
  recover your notes. A real product adds *user-controlled* recovery (recovery
  codes, an emergency-contact key) — read the Bitwarden security whitepaper.
- **SQLite** is for local dev. Use PostgreSQL in production (swap the Prisma
  `datasource`).
- **`JWT_SECRET`** in `.env` is a placeholder — set a real one
  (`openssl rand -base64 32`) and never commit it.
- **Rate limiting is in-memory** — fine for one instance; production behind
  several instances needs a shared store (Redis).
- **Host must enforce HTTPS.** The whole model assumes the JS you receive is
  authentic; serve it only over TLS.

## The honest limitation

The server ships the JavaScript that does the encryption. If the server is
compromised, it could ship malicious JS that steals keys — which is why the
strongest tools (Signal) are native apps, not websites. For higher assurance,
wrap this in a desktop app (Tauri/Electron) or a browser extension. Be honest
about this in any marketing.

## Structure

```
lib/crypto.ts        the zero-knowledge core (Web Crypto only)
lib/session.ts       JWT session cookie (jose)
lib/rate-limit.ts    in-memory auth throttle
app/api/*            signup/login/logout/me + notes CRUD (server sees only ciphertext)
app/vault/page.tsx   decrypts in-browser; handles the refresh/unlock case honestly
components/*          key context (in-memory encKey) + shared auth form
```
