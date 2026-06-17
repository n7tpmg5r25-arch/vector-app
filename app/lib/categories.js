// Single source of truth for the 15-category taxonomy used by Search and Outcomes.
// DATA_FRESHNESS #13 — extracted 2026-04-22 so adding a category is a one-file edit.
// Order matches the Search-page chip rail (most-used first). If you reorder,
// eyeball both /search and /outcomes — both render in this order.
export const CATEGORIES = [
  'All',
  'Health',
  'Education',
  'Criminal Justice',
  'Environment',
  'Government Operations',
  'Business / Commerce',
  'Budget / Appropriations',
  'Transportation',
  'Employment / Labor',
  'Housing',
  'Technology',
  'Veterans / Military',
  'Agriculture',
  'Natural Resources',
]