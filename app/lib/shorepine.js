/**
 * Shorepine firm palette + type — shared module
 *
 * Brand v4.6 firm-side surfaces (client portal, PDF brief, email headers)
 * use this palette in contrast with the dark Vector | WA app palette.
 *
 * Lifted out of `app/app/c/[slug]/page.js` (Thread 3) at first duplication,
 * per the Thread 4 spec direction:
 *   "Reuse SHOREPINE palette constants + FONT_DISPLAY/FONT_BODY from
 *    app/app/c/[slug]/page.js, or lift them into a shared module at the
 *    first duplication."
 *
 * Why a JS module and not CSS vars:
 *   The Vector app already owns `--brass`, `--bg`, etc. via CSS vars at
 *   the root level. Mounting a competing set of vars under /c/* would
 *   require a separate stylesheet scoped via :root selectors — more
 *   ceremony than a small palette object deserves. Inline styles using
 *   these constants stay self-contained and don't fight the global CSS.
 *
 * See: BRAND_V46_ROLLOUT_PLAN.md §Firm palette + §Type.
 */

export const SHOREPINE = {
  forest: '#1a4a2e',
  forestMid: '#2d6b45',
  parchment: '#f5f0e6',
  parchmentDeep: '#ece5d3',
  brass: '#b8975a',
  brassLight: '#d4b47a',
  slate: '#4a5060',
  ink: '#1c1c1c',
  ember: '#c44730', // Warning / divergence accent
}

// Cormorant Garamond is loaded via the segment layout's <link>; Karla is
// loaded globally by app/app/globals.css.
export const FONT_DISPLAY = "'Cormorant Garamond', Georgia, serif"
export const FONT_BODY = "'Karla', system-ui, sans-serif"
export const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
