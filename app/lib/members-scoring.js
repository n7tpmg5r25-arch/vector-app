// Members-page effectiveness scoring configuration.
// Answers: "If this legislator sponsors a bill, how likely is it to move?"
//
// Position Power  (25%) — tier + chair status. Majority leadership & chairs
//   schedule hearings, control committee agendas, whip floor votes.
// Committee Pass  (30%) — % of sponsored bills that cleared committee.
//   The hardest chokepoint in Olympia; most bills die here.
// Law Rate        (25%) — % of sponsored bills signed into law.
//   The ultimate measure, but rare enough that it shouldn't dominate.
// Avg Trajectory  (20%) — mean bill quality signal.
//   Kept lowest because it measures the bill, not the legislator.
//
// Volume guard: < 3 bills → x 0.6 penalty (one lucky bill shouldn't crown you).
//
// NOTE: these are MEMBER-scoring constants. The bill-trajectory scorer
// (scoreBill) is frozen for the 2027 session and lives elsewhere — the two
// systems do NOT share weights. Changing values here affects the members
// page ranking only.

export const POSITION_TIER_SCORES = { 1: 100, 2: 70, 3: 40, 4: 20 }
export const CHAIR_BONUS = 20

export const COMPOSITE_WEIGHTS = {
  positionPower: 0.25,
  committeeRate: 0.30,
  lawRate:       0.25,
  avgTrajectory: 0.20,
}

export const LOW_VOLUME_THRESHOLD = 3
export const LOW_VOLUME_PENALTY   = 0.6

// Tier 1 = majority leadership, 2 = senior, 3 = member, 4 = minority.
// Labels surface in the member-detail header and mobile popover. When
// chamber control flips (D ↔ R), the "Minority" row's palette is what
// needs review — the copy is neutral.
export const TIER_LABELS = {
  1: { text: 'Majority Leadership', color: 'var(--teal)',       bg: 'var(--teal-pale)',  border: 'rgba(184,151,90,0.2)'  },
  2: { text: 'Senior Member',       color: 'var(--teal-mid)',   bg: 'var(--teal-pale)',  border: 'rgba(184,151,90,0.15)' },
  3: { text: 'Member',              color: 'var(--text-mid)',   bg: 'var(--bg-surface)', border: 'var(--border)'         },
  4: { text: 'Minority',            color: 'var(--text-muted)', bg: 'var(--bg-surface)', border: 'var(--border)'         },
}