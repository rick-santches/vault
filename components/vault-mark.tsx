/**
 * The Vault brand mark — a padlock in an emerald tile, matching the landing
 * page. `withWord` appends the "Vault" wordmark.
 */
export function VaultMark({ size = 40, withWord = false }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="grid shrink-0 place-items-center rounded-xl bg-emerald-400"
        style={{ width: size, height: size, boxShadow: '0 0 0 4px rgba(52,211,153,0.14)' }}
      >
        <svg
          width={Math.round(size * 0.55)}
          height={Math.round(size * 0.55)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#04120c"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      {withWord && <span className="text-lg font-bold tracking-tight">Vault</span>}
    </span>
  )
}
