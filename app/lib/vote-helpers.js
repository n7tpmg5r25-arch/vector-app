/**
 * vote-helpers.js — Vector | WA Thread 18 (2026-04-26)
 *
 * Pure utilities shared by VoteSplitBar, the inline LatestFloorVoteStrip
 * on bill/[id]/page.js, and the per-row partisan splits in
 * VoteHistoryTable. Read-only display helpers (G5 frozen-engine — never
 * imports or calls scoreBill() / extractFeatures()).
 */

export function isFinalPassage(motion = '') {
  return /final\s+passage|3rd\s+reading|third\s+reading/i.test(motion || '')
}

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

export function characterize({ yesD = 0, yesR = 0, noD = 0, noR = 0 }) {
  const totalYes = yesD + yesR
  const totalNo  = noD + noR
  if (totalYes + totalNo === 0) return ''
  if (totalNo === 0) return 'Unanimous'
  if (totalYes === 0) return 'Unanimous against'
  if (yesD > 0 && yesR === 0) return 'Party-line (D)'
  if (yesR > 0 && yesD === 0) return 'Party-line (R)'
  if (yesD >= 3 && yesR >= 3) return 'Bipartisan'
  if (yesR > 0 && yesR <= 3) return 'Mostly D, narrow R crossover'
  if (yesD > 0 && yesD <= 3) return 'Mostly R, narrow D crossover'
  return 'Mixed'
}