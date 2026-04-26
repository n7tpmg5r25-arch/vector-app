/**
 * WA Legislature amendment-code reference + plain-English translator.
 *
 * Thread 14.1 — read-only display only. Does NOT touch scoreBill() or
 * extractFeatures() and never calls back into the scoring engine. The
 * 8,062-bill calibration cohort literal (G5) is unaffected — this module
 * has nothing to do with scoring.
 *
 * Real specimens harvested from public.amendments (2026-04-25 probe):
 *   "1204 AMH ESLI VASE 249"     (page-line amendment, sponsor Eslick)
 *   "1132-S AMH BURN BUR 305"    (substituted bill, page-line amendment)
 *   "1204 AMH ESLI H2544.1"      (striker amendment — WSL doc-id form)
 *   "1254-S AMH WALJ REHN 034"   (sponsor Walsh, on substitute version)
 *   "2192-S AMH LOW H3553.1"     (Rep. Low striker on 2192-S — Adopted)
 *
 * Token grammar (positional, whitespace-separated):
 *   <bill>[-S{n}?]   bill number, optional substitute version (S, S2, S3, …)
 *   AMH | AMS        chamber that filed the amendment (House / Senate)
 *   <sponsor-acro>   4-letter surname acronym (e.g. ESLI, BURN, WALJ, LOW)
 *   <series-or-doc>  either a 4-letter drafting-series acronym (REHN, BAKY,
 *                    BUR, ADAM, VASE) OR a WSL doc id like H3553.1 / S0421.2
 *   <counter>        3-digit floor counter (only present with series acronym)
 *
 * The translator does NOT need to decode the sponsor acronym — the amendments
 * table already carries a plain-English `sponsor` column. The parser exists to
 * (a) extract the chamber (House / Senate) from the AMH/AMS prefix, and
 * (b) detect the WSL-doc-id pattern that signals a striker / full-bill rewrite
 * when description doesn't already say "Striker".
 */

const CHAMBER_CODES = {
  AMH: 'House',
  AMS: 'Senate',
  AMC: 'Conference',  // observed rarely; safe default
}

/**
 * Parse a raw WSL amendment code into structured tokens. Returns null when the
 * code is missing or doesn't match the expected token count. Never throws.
 */
export function parseAmendmentCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return null
  const tokens = rawCode.trim().split(/\s+/)
  if (tokens.length < 2) return null

  const billToken = tokens[0]
  const chamberCode = tokens[1]
  const chamberLabel = CHAMBER_CODES[chamberCode] || null

  // The last token is either a 3-digit counter (e.g. "305") or a WSL doc id
  // (e.g. "H3553.1", "S0421.2"). Doc ids signal striker/full-bill rewrites.
  const last = tokens[tokens.length - 1]
  const docIdMatch = last.match(/^[HS]\d+\.\d+$/i)

  return {
    raw: rawCode,
    billToken,
    chamberCode,
    chamberLabel,
    sponsorAcronym: tokens[2] || null,
    isWslDocId: !!docIdMatch,
    docId: docIdMatch ? last : null,
    counter: !docIdMatch ? last : null,
  }
}

function formatFloorAction(action) {
  if (!action) return ''
  // "NOT CONSIDERED" → "Not considered", "WITHDRAWN" → "Withdrawn".
  return action.charAt(0).toUpperCase() + action.slice(1).toLowerCase()
}

/**
 * Compose a plain-English label for a single amendment row.
 *
 * Returns { label, fallback } where:
 *   - label    is the string to render in the timeline row's primary slot
 *   - fallback is true ONLY when neither sponsor nor chamber could be derived,
 *              meaning the row should also surface the raw code with a tooltip
 *              link to leg.wa.gov for self-service decoding.
 *
 * Inputs match the `amendments` table column names so the call-site stays
 * thin. All inputs are optional / nullable; the function will never throw.
 */
export function translateAmendmentEvent({
  amendmentNumber,
  sponsor,
  description,
  adopted,
  floorAction,
} = {}) {
  const parsed = parseAmendmentCode(amendmentNumber)

  // Disposition suffix
  let disposition = ''
  if (adopted) {
    disposition = ' — Adopted'
  } else if (floorAction) {
    disposition = ` — ${formatFloorAction(floorAction)}`
  }

  // Type word — "striker" if either the description or the parsed code hints
  // at a full-bill rewrite (WSL doc-id form, or description text).
  const isStriker =
    (description && /striker/i.test(description)) ||
    (parsed && parsed.isWslDocId)
  const typeWord = isStriker ? 'striker amendment' : 'amendment'

  const sponsorName = (sponsor && sponsor.trim()) || null
  const chamber = parsed?.chamberLabel || null

  if (sponsorName && chamber) {
    return { label: `${sponsorName} ${chamber} ${typeWord}${disposition}`, fallback: false }
  }
  if (sponsorName) {
    return { label: `${sponsorName} ${typeWord}${disposition}`, fallback: false }
  }
  if (chamber) {
    return { label: `${chamber} ${typeWord}${disposition}`, fallback: false }
  }

  // Total fallback: neither sponsor nor chamber could be derived. Caller will
  // also render the raw code + ?-tooltip link to leg.wa.gov.
  return {
    label: `Amendment ${amendmentNumber || '(unknown)'}${disposition}`,
    fallback: true,
  }
}

/**
 * Public reference URL for users who hit the fallback and want to look up the
 * raw code on the WA Legislature website. Bill detail pages on leg.wa.gov
 * surface every amendment filed against that bill, so the safest universal
 * link is the legislative documents search.
 */
export const WSL_AMENDMENT_REFERENCE_URL =
  'https://app.leg.wa.gov/billsummary'
