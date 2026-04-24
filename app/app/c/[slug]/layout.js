/**
 * /c/[slug] — Thread 3 portal shell layout
 *
 * Segment layout for the client portal. Sets the Shorepine firm visual
 * tone (Forest + Parchment + Brass) in contrast with the Vector | WA app
 * UI (Dark Neutral + Brass) that the rest of the authed app uses.
 *
 * What this layout does:
 *   - Loads Cormorant Garamond via a Google Fonts stylesheet so the shell
 *     can use it for display text (firm-level type per Brand v4.6).
 *     Karla is already loaded globally by app/app/globals.css.
 *   - Nothing else — the page itself owns the card / header / banner.
 *     The root layout (app/app/layout.tsx) still provides <html>, <body>,
 *     SessionBanner and Footer. The firm ownership line in Footer is
 *     on-brand for the client portal.
 *
 * What this layout does NOT do:
 *   - Override the root body background. Thread 7 (desktop responsive)
 *     is where the 480px cap in globals.css gets lifted; until then the
 *     portal lives inside the app's mobile-first column and uses a
 *     Parchment card to carry the firm palette.
 *   - Inject a bottom nav. The shell is proof-of-life in Thread 3.
 *     Thread 4 fills in watchlist + bill detail with a portal top-bar.
 *
 * Reference: BRAND_V46_ROLLOUT_PLAN.md §Type, §Firm palette.
 */

export default function ClientPortalSegmentLayout({ children }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&display=swap"
      />
      {children}
    </>
  )
}
