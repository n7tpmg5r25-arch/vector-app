/**
 * Shared parser for AI / custom bill summaries — ER-B1 (2026-06-03).
 *
 * Bill summaries have drifted across generations into two header dialects:
 *   • "**HEADER**" on its own line          (newer summaries)
 *   • ATX "# / ## … HEADER"                 (older — ~36% of the catalog)
 *
 * The on-screen renderer historically only understood the "**" dialect, so
 * "#"-format summaries leaked raw "# BILL BRIEF: …" / "## EXECUTIVE SUMMARY"
 * lines onto the page. This parser normalizes both dialects into one section
 * shape and drops the redundant leading "# BILL BRIEF:" title line (the page
 * already shows the bill's identity block).
 *
 * Pure — no JSX — so it can be shared by the client bill page
 * (app/app/bill/[id]/page.js) and the team-portal mirror
 * (app/app/c/[slug]/bill/[id]/page.js). Each surface renders the returned
 * sections in its own styling.
 *
 * @param {string} text raw summary (custom_summary || ai_summary)
 * @returns {{ header: string|null, lines: string[] }[]}
 */
export function parseSummarySections(text) {
  const raw = (text || '').split('\n')
  const sections = []
  let cur = { header: null, lines: [] }
  const flush = () => {
    if (cur.header !== null || cur.lines.some(l => l.trim())) sections.push(cur)
  }
  for (const line of raw) {
    const t = line.trim()
    // ATX header: 1-6 leading "#", optional trailing "#" run (e.g. "## TITLE ##").
    const atx = t.match(/^#{1,6}\s+(.+?)\s*#*$/)
    // A line that is entirely bold is treated as a header (legacy behavior).
    const bold = t.match(/^\*\*(.+?)\*\*$/)
    let header = null
    if (atx) header = atx[1].replace(/^\*\*(.+?)\*\*$/, '$1').trim()
    else if (bold) header = bold[1].trim()
    if (header !== null) {
      // Drop the redundant "BILL BRIEF: HB 1271" title line entirely.
      if (/^BILL BRIEF\b/i.test(header)) continue
      flush()
      cur = { header, lines: [] }
    } else {
      cur.lines.push(line)
    }
  }
  flush()
  return sections
}

/**
 * Splits a line into alternating plain / bold segments for inline "**bold**"
 * rendering. Even indices are plain, odd indices are bold — the same contract
 * as String.prototype.split with a capturing group, exposed here so multiple
 * surfaces render inline emphasis identically.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitInlineBold(line) {
  return String(line || '').split(/\*\*(.+?)\*\*/)
}

/**
 * Strips inline "**bold**" markup down to plain text. Used by flat-paragraph
 * surfaces (the team portal) that don't render emphasis.
 *
 * @param {string} line
 * @returns {string}
 */
export function stripInlineBold(line) {
  return String(line || '').replace(/\*\*(.+?)\*\*/g, '$1')
}
