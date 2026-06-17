/**
 * Vector | WA — cockpit session clock (DASH-1).
 *
 * Pure compute off session-config.js. No scoreBill(), no queries, no I/O.
 * Answers two glance questions for the dashboard chrome: "how far into the
 * session are we?" and "what's the next statutory cutoff?"
 *
 * WA regular sessions convene the 2nd Monday of January (Const. Art II §12).
 * Odd years are 105-day long sessions; even years are 60-day short sessions.
 * Deriving the annual session window here (rather than from the biennium-wide
 * BIENNIUMS start/end) keeps "Day X / Y" honest across both session types.
 */
import {
  getCurrentBiennium,
  getSessionCutoffs,
  bienniumShortLabel,
  daysUntil,
} from './session-config'

function secondMondayOfJanuary(year) {
  const jan1 = new Date(year, 0, 1)
  const dow = jan1.getDay()                  // 0 Sun … 6 Sat
  const firstMonday = 1 + ((8 - dow) % 7)    // date (1–31) of the first Monday
  return new Date(year, 0, firstMonday + 7)  // the second Monday
}

function sessionLengthForYear(year) {
  return year % 2 === 1 ? 105 : 60
}

/**
 * @returns {{
 *   inSession: boolean,
 *   day: number|null,
 *   total: number,
 *   pct: number,
 *   label: string,
 *   sessionLabel: string,
 *   nextCutoff: {label:string, daysLeft:number, dateFormatted:string}|null,
 *   daysToNextSession: number
 * }}
 */
export function getSessionClock(now = new Date()) {
  const year = now.getFullYear()
  const start = secondMondayOfJanuary(year)
  const total = sessionLengthForYear(year)
  const end = new Date(start.getTime() + total * 86400000)
  const inSession = now >= start && now < end

  const sessionLabel = bienniumShortLabel(getCurrentBiennium()?.session || '')
  const upcoming = getSessionCutoffs().filter((c) => !c.passed)
  const nextCutoff = inSession && upcoming.length ? upcoming[0] : null

  if (inSession) {
    const day = Math.floor((now - start) / 86400000) + 1
    return {
      inSession: true,
      day,
      total,
      pct: Math.max(0, Math.min(1, day / total)),
      label: `Day ${day} / ${total}`,
      sessionLabel,
      nextCutoff,
      daysToNextSession: 0,
    }
  }

  // Not in session — count down to the next convening (this year's 2nd Monday
  // if it's still ahead, otherwise next year's).
  const nextConvene = now < start ? start : secondMondayOfJanuary(year + 1)
  const daysToNextSession = daysUntil(nextConvene.toISOString().slice(0, 10))
  return {
    inSession: false,
    day: null,
    total,
    pct: 0,
    label: daysToNextSession <= 60 ? `Pre-session · ${daysToNextSession}d` : 'Interim',
    sessionLabel,
    nextCutoff: null,
    daysToNextSession,
  }
}
