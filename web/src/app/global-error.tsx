"use client";

/**
 * Last resort, when the root layout itself fails. It replaces the whole document, so the app's styles and fonts are
 * not loaded: plain inline styles in the Zen Linen colours, light or dark by the system setting.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <style>{`
          .qp-ge { min-height: 100dvh; display: grid; place-items: center; padding: 20px; background: #E9E4D8; color: #1E1E1E; }
          .qp-ge p { color: #5E5A52; line-height: 1.6; }
          .qp-ge button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 0; background: #2E2E2E; color: #E6E4D7; cursor: pointer; }
          @media (prefers-color-scheme: dark) {
            .qp-ge { background: #141414; color: #E8E3DA; }
            .qp-ge p { color: #8E8A83; }
            .qp-ge button { background: #D1CFC0; color: #363636; }
          }
        `}</style>
        <title>QuantsPulse didn&apos;t load</title>
        <main className="qp-ge">
          <div style={{ maxWidth: 440 }}>
            <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 28, margin: 0 }}>QuantsPulse didn&apos;t load.</h1>
            <p>That&apos;s on our side, and nothing you saved was lost. Trying again usually works.</p>
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
            {error.digest ? <p style={{ fontSize: 12, marginTop: 24 }}>Reference {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  );
}
