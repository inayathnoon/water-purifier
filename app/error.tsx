'use client';

/**
 * Catches a render/runtime crash anywhere under the root layout. Without
 * this, Next renders a bare empty page in production — indistinguishable,
 * to whoever is sitting in front of it, from "the app is broken and I
 * don't know why". Shows what actually failed and offers a retry.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full border border-rule bg-surface p-6">
        <h1 className="font-condensed text-[22px] uppercase tracking-[0.04em]">Something broke</h1>
        <p className="text-[13px] text-ink-2 mt-2">
          This screen failed to load. Trying again often works — if it doesn&apos;t, send the line below to
          whoever maintains the app.
        </p>
        <p className="text-[12px] text-ink-3 mt-3 border-t border-rule pt-3 break-words">
          {error.message || 'Unknown error'}
          {error.digest && <> · {error.digest}</>}
        </p>
        <button
          onClick={reset}
          className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
