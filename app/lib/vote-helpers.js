/**
 * vote-helpers.js — Vector | WA Thread 18 (2026-04-26)
 *
 * Pure utilities shared by VoteSplitBar, the inline LatestFloorVoteStrip
 * on bill/[id]/page.js, and the per-row partisan splits in
 * VoteHistoryTable. All functions are read-only display helpers
 * (G5 frozen-engine — never imports or calls scoreBill() / extractFeatures()).
 *
 * Thread 21 (2026-04-26): tightened characterize() vocabulary so all
 * strings fit ≤14 chars. Was: "Mostly D, narrow R crossover" (28),
 * "Mostly R, narrow D crossover" (28), "Unanimous against" (17). Now:
 * "D + narrow R" (12), "R + narrow D" (12), "Unanimous No" (12). Fixes
 * mobile wrap on VoteSplitBar header + LatestFloorVoteStrip at 480px
 * (the longest verdict was pushing PartyMicrobar to a second row).
 */

/** True when a roll_call.motion looks like a final-passage / 3rd-reading
 *  vote — the lobbyist-grade headline cut. Match is permissive (handles
 *  "Final Passage", "Final passage", "Third Reading", "3rd Reading"). */
export function isFinalPassage(motion = '') {
  return /final\s+passage|3rd\s+reading|third\s+reading/i.test(motion || '')
}

/** Bucket member_vote rows into yesD/yesR/yesU and noD/noR/noU.
 *  Excused/Absent/unrecorded rows are ignored. Missing or unknown
 *  party labels (Independents, pre-roster-sync rows, third-party)
 *  fall into the *U buckets so they still show up on the bar. */
export function bucketMemberVotes(votes = []) {
  let yesD = 0, yesR = 0, yesU = 0
  let noD = 0,  noR = 0,  noU = 0
  for (const v of (votes || [])) {
    const yes = (v.vote || '').toUpperCase() === 'YEA'
    const no  = (v.vote || '').toUpperCase() === 'NAY'
    if (!yes && !no) continue
    const p = v.party
    if (yes) {
      if (p === 'D') yesD++
      else if (p === 'R') yesR++
      else yesU++
    } else {
      if (p === 'D') noD++
      else if (p === 'R') noR++
      else noU++
    }
  }
  return { yesD, yesR, yesU, noD, noR, noU }
}

/** Pad an existing buckets object to match a roll_call's reported totals,
 *  filling any gap with 'unknown' (yesU / noU). Useful when member_votes
 *  is sparse (newly-seated members not yet in roster cache, etc.) so the
 *  bar always reflects the recorded yeas/nays count. */
export function padBucketsToReported(buckets, rc) {
  const memberYes = buckets.yesD + buckets.yesR + buckets.yesU
  const memberNo  = buckets.noD  + buckets.noR  + buckets.noU
  const padYes = Math.max(0, (rc?.yeas || 0) - memberYes)
  const padNo  = Math.max(0, (rc?.nays || 0) - memberNo)
  return {
    ...buckets,
    yesU: buckets.yesU + padYes,
    noU:  buckets.noU  + padNo,
  }
}

/** Build a one-phrase verdict from a buckets object.
 *  Uses Yes-side party split as the primary signal (Yes is the action
 *  vote — Nay-side composition is mostly redundant once Yes is known).
 *
 *  Vocabulary is tight by design: every string fits ≤14 chars so the
 *  verdict never pushes the chamber chip / date / PartyMicrobar onto a
 *  second row at the 480px column the app targets (see Thread 21). */
export function characterize({ yesD = 0, yesR = 0, noD = 0, noR = 0 }) {
  const totalYes = yesD + yesR
  const totalNo  = noD + noR
  if (totalYes + totalNo === 0) return ''
  if (totalNo === 0) return 'Unanimous'
  if (totalYes === 0) return 'Unanimous No'
  if (yesD > 0 && yesR === 0) return 'Party-line (D)'
  if (yesR > 0 && yesD === 0) return 'Party-line (R)'
  if (yesD >= 3 && yesR >= 3) return 'Bipartisan'
  if (yesR > 0 && yesR <= 3) return 'D + narrow R'
  if (yesD > 0 && yesD <= 3) return 'R + narrow D'
  return 'Mixed'
}
