// Single source of truth for bill-stage short labels (DATA_FRESHNESS #16).
// Extracted 2026-04-22. Previously duplicated across 5 files; watchlist had
// drifted ('Opp.Ch.' vs 'Opp. Ch.', 'Signed' vs 'Gov.').
//
// Index = bills.stage value:
//   0 = not yet classified (empty placeholder)
//   1 = introduced
//   2 = committee (origin chamber)
//   3 = floor (origin chamber)
//   4 = opposite chamber (committee / floor / rules)
//   5 = conference committee
//   6 = reached the governor (signed, vetoed, or awaiting action)
//
// Why "Gov." not "Signed" for stage 6: the index names the STAGE (bill
// reached the governor's desk), not the OUTCOME. Governor action (signed,
// vetoed, partial veto, became law without signature) lives in
// bills.governor_action. Labeling a vetoed bill "Signed" would be wrong.
export const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']