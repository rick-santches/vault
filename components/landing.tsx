'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import '@/app/landing.css'

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function Landing() {
  useEffect(() => {
    const plain = document.getElementById('vlp-plain') as HTMLTextAreaElement | null
    const out = document.getElementById('vlp-cipher')
    const copyBtn = document.getElementById('vlp-copy')
    if (!plain || !out) return

    const enc = new TextEncoder()
    let key: CryptoKey | null = null
    let lastCipher = ''
    let engaged = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let inputTimer: ReturnType<typeof setTimeout> | null = null
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    const b64 = (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf)
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
      return btoa(s)
    }
    const renderEmpty = () => {
      out.innerHTML =
        '<span style="color:var(--faint)">The moment you type, this becomes unreadable base64 — the only version that ever leaves your device.</span>'
      lastCipher = ''
    }
    const ensureKey = async () => {
      if (!key && window.crypto && crypto.subtle) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
      }
      return key
    }
    const update = async () => {
      const text = plain.value
      if (!text) return renderEmpty()
      try {
        await ensureKey()
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key as CryptoKey, enc.encode(text))
        const ivs = b64(iv.buffer)
        const cts = b64(ct)
        lastCipher = ivs + '·' + cts
        out.classList.remove('pulse')
        void out.offsetWidth
        out.classList.add('pulse')
        out.innerHTML = '<span class="iv">' + ivs + '·</span>' + cts
      } catch {
        lastCipher = btoa(unescape(encodeURIComponent(text))).split('').reverse().join('')
        out.textContent = lastCipher
      }
    }

    const onCopy = () => {
      if (!lastCipher || !navigator.clipboard) return
      navigator.clipboard.writeText(lastCipher).then(() => {
        if (!copyBtn) return
        const prev = copyBtn.textContent
        copyBtn.textContent = 'Copied'
        copyBtn.style.color = 'var(--accent)'
        setTimeout(() => {
          copyBtn.textContent = prev
          copyBtn.style.color = ''
        }, 1400)
      })
    }
    const onInput = () => {
      if (inputTimer) clearTimeout(inputTimer)
      inputTimer = setTimeout(update, 80)
    }
    const engage = () => {
      if (engaged) return
      engaged = true
      if (timer) clearTimeout(timer)
      plain.value = ''
      renderEmpty()
    }

    copyBtn?.addEventListener('click', onCopy)
    plain.addEventListener('input', onInput)
    plain.addEventListener('focus', engage)
    plain.addEventListener('keydown', engage)

    const samples = [
      'bank PIN: 4815 — do not text this',
      'recovery phrase: orbit lunar amber cedar',
      'client login: dagny@stofa.is / hafid-2231',
      'the thing I keep forgetting to write down',
    ]
    const typeSample = (i: number) => {
      if (engaged) return
      const s = samples[i % samples.length]
      let n = 0
      const step = () => {
        if (engaged) return
        plain.value = s.slice(0, n)
        void update()
        n++
        if (n <= s.length) timer = setTimeout(step, 52)
        else timer = setTimeout(() => eraseThen(i + 1), 1700)
      }
      step()
    }
    const eraseThen = (next: number) => {
      if (engaged) return
      const del = () => {
        if (engaged) return
        const cur = plain.value.slice(0, -1)
        plain.value = cur
        void update()
        if (cur.length) timer = setTimeout(del, 22)
        else timer = setTimeout(() => typeSample(next), 320)
      }
      del()
    }

    renderEmpty()
    if (!reduced) timer = setTimeout(() => typeSample(0), 800)

    let io: IntersectionObserver | null = null
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.vlp .reveal'))
    if (!reduced && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in')
              io?.unobserve(e.target)
            }
          })
        },
        { threshold: 0.12 },
      )
      reveals.forEach((el) => io?.observe(el))
    } else {
      reveals.forEach((el) => el.classList.add('in'))
    }

    return () => {
      if (timer) clearTimeout(timer)
      if (inputTimer) clearTimeout(inputTimer)
      copyBtn?.removeEventListener('click', onCopy)
      plain.removeEventListener('input', onInput)
      plain.removeEventListener('focus', engage)
      plain.removeEventListener('keydown', engage)
      io?.disconnect()
    }
  }, [])

  return (
    <div className="vlp">
      <nav>
        <div className="wrap nav-in">
          <div className="brand">
            <span className="dot" aria-hidden="true">
              <span style={{ color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
                <LockIcon />
              </span>
            </span>
            Vault
          </div>
          <div className="nav-links">
            <a href="#keys">How the keys work</a>
            <a href="#share">Sharing</a>
            <a href="#honest">What we can&apos;t do</a>
            <Link className="btn" href="/signup">
              Create a vault
            </Link>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap hero-in">
          <span className="eyebrow">Zero-knowledge notes</span>
          <h1>
            Notes your server can<span className="cross">&apos;</span>t read.
          </h1>
          <p className="lede">
            Everything is encrypted in your browser with a key derived from your password — before any
            network request. We authenticate you without ever seeing the password, and store only
            ciphertext. Watch, live, what we&apos;d actually keep.
          </p>
          <div className="hero-cta">
            <Link className="btn" href="/signup">
              Create a vault →
            </Link>
            <a className="btn ghost" href="#keys">
              See how it works
            </a>
          </div>
          <div className="trust">
            <span className="chip">
              <b>Web Crypto</b> only — no third-party crypto
            </span>
            <span className="chip">
              <b>AES-256-GCM</b> · fresh IV per note
            </span>
            <span className="chip">
              <b>310k</b> PBKDF2 rounds
            </span>
          </div>

          <div className="demo" role="group" aria-label="Live encryption demo">
            <div className="demo-bar">
              <span className="lamp" aria-hidden="true" />
              AES-256-GCM · key stays in this tab · nothing sent anywhere
            </div>
            <div className="demo-grid">
              <div className="pane">
                <div className="pane-label">
                  <span>What you type</span>
                  <span className="tag">plaintext · you</span>
                </div>
                <textarea
                  id="vlp-plain"
                  className="plain"
                  spellCheck={false}
                  aria-label="Type a secret to encrypt"
                  placeholder="Type a secret — watch it turn to ciphertext…"
                />
              </div>
              <div className="pane">
                <div className="pane-label">
                  <span>What the server stores</span>
                  <button className="copy" id="vlp-copy" type="button">
                    Copy
                  </button>
                </div>
                <div className="cipher" id="vlp-cipher" aria-hidden="true" />
                <div className="server-note">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>
                    Real encryption, right here in your browser. We never receive the key, so this
                    gibberish is all we could ever hand over.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section id="keys">
        <div className="wrap reveal">
          <div className="sec-head">
            <span className="eyebrow">The mechanism</span>
            <h2>Your password is the only key. We never hold it.</h2>
            <p className="sec-sub">
              One password does two jobs, split apart so they can&apos;t be recombined. The half we
              get proves who you are; the half that unlocks your notes never leaves the page.
            </p>
          </div>
          <div className="pipe">
            <div className="step">
              <span className="n">01 · derive</span>
              <h3>Password + email</h3>
              <p>
                Stretched with <code>PBKDF2</code>, 310,000 rounds, salted per account — slow to
                brute-force, fast for you.
              </p>
            </div>
            <div className="step">
              <span className="n">02 · split</span>
              <h3>Two keys, one root</h3>
              <p>
                <code>HKDF</code> splits the result into an <b>auth key</b> and an <b>encryption key</b>{' '}
                that can&apos;t derive each other.
              </p>
            </div>
            <div className="step">
              <span className="n">03 · prove</span>
              <h3>Auth key → us</h3>
              <p>
                We store only a <code>bcrypt</code> hash of it. Enough to verify you; useless for
                reading a single note.
              </p>
            </div>
            <div className="step">
              <span className="n">04 · lock</span>
              <h3>Encryption key stays</h3>
              <p>
                Non-extractable, held in memory only. Refresh the page and it&apos;s gone — re-typed,
                never stored.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="share">
        <div className="wrap reveal">
          <div className="sec-head">
            <span className="eyebrow">New · one-to-one sharing</span>
            <h2>Share a note with one person. No one else — us included.</h2>
            <p className="sec-sub">
              Give your accountant a number, your partner a password. Each of you holds a keypair; a
              handshake between your private key and their public one produces a secret only the two
              of you can rebuild.
            </p>
          </div>
          <div className="shake">
            <div className="party">
              <div className="who">You</div>
              <div className="key">
                private key · <span className="pub">public key</span>
              </div>
              <p>
                Your private key is wrapped with your own encryption key before it&apos;s stored. We
                keep a copy we can&apos;t open.
              </p>
            </div>
            <div className="join">
              <div className="lock" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </div>
              <div className="bar">
                ECDH
                <br />
                handshake
              </div>
            </div>
            <div className="party">
              <div className="who">Them</div>
              <div className="key">
                <span className="pub">public key</span> · private key
              </div>
              <p>
                They combine their private key with your public one — and derive the identical secret,
                in their browser.
              </p>
            </div>
          </div>
          <p className="shared-out">
            Both sides compute the <b>same</b> key from opposite halves. The server only relays{' '}
            <span className="code">{'{ iv, ciphertext }'}</span> — and can&apos;t forge either side.
          </p>
        </div>
      </section>

      <section id="honest">
        <div className="wrap reveal">
          <div className="sec-head">
            <span className="eyebrow">The honest part</span>
            <h2>What we can&apos;t do — and won&apos;t pretend to.</h2>
            <p className="sec-sub">Real zero-knowledge means real trade-offs. Here they are, up front.</p>
          </div>
          <div className="honest">
            <div className="card">
              <span className="k">No password reset</span>
              <h3>Lose the password, lose the notes.</h3>
              <p>
                There&apos;s no &quot;forgot password&quot; link, because a reset would mean we could
                get in. We can&apos;t. Save your password somewhere safe — that&apos;s the guarantee
                working, not a gap.
              </p>
            </div>
            <div className="card">
              <span className="k">The browser caveat</span>
              <h3>We serve the code that encrypts.</h3>
              <p>
                A compromised server could ship bad code — the limit of every in-browser crypto tool.
                That&apos;s why the app shows a key fingerprint you can read aloud to confirm nothing
                was swapped.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap reveal">
          <span className="eyebrow">Ninety seconds to prove it</span>
          <h2>Make a vault. Write a secret. Watch it come back only for you.</h2>
          <p className="sec-sub">
            Free, open, and built on the browser&apos;s own Web Crypto — no third-party crypto
            libraries, anywhere.
          </p>
          <div className="hero-cta">
            <Link className="btn" href="/signup">
              Create a vault →
            </Link>
            <Link className="btn ghost" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-in">
          <div className="brand" style={{ fontSize: '0.95rem' }}>
            <span className="dot" aria-hidden="true">
              <span style={{ color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
                <LockIcon />
              </span>
            </span>
            Vault
          </div>
          <span className="mono">PBKDF2 · HKDF · AES-256-GCM · ECDH P-256 — Web Crypto only</span>
        </div>
      </footer>
    </div>
  )
}
