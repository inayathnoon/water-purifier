'use client';

/**
 * Last line of defence — catches a crash in the root layout itself, where
 * app/error.tsx can't help. Must render its own <html>/<body>, and can't
 * rely on the app's fonts or Tailwind tokens having loaded, so everything
 * here is inline and self-contained.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: '2rem 1rem', font: '14px/1.5 Arial, Helvetica, sans-serif', color: '#1d1f20', background: '#f2f2f3' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', border: '1px solid #d4d4d7', padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Noon Enterprises
          </h1>
          <p style={{ marginTop: 12 }}>
            The app failed to start. Reload the page — if it keeps happening, show this line to whoever
            maintains the app.
          </p>
          <p style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #d4d4d7', fontSize: 12, color: '#5d5d60', wordBreak: 'break-word' }}>
            {error.message || 'Unknown error'}
            {error.digest ? ` · ${error.digest}` : ''}
          </p>
        </div>
      </body>
    </html>
  );
}
