/**
 * Vector | WA - Neutral news selection (NEWS-1, 2026-06-09).
 *
 * The display half of the neutral inclusion rule that begins in
 * app/lib/sync-news.js. Ingestion gathers every working Washington outlet and
 * beat-filters whole-newsroom feeds; this module decides WHICH archived items
 * render, mechanically:
 *
 *   1. Per-source cap - no outlet fills more than `perSourceCap` of the rows
 *      on a surface, no matter how much it publishes.
 *   2. Newest-first round-robin - sources take turns, freshest source first:
 *      every source's newest item is seated before any source's second item.
 *   3. Display order - the chosen set then renders newest-first; the balance
 *      lives in which items are picked, not in a shuffled timeline.
 *
 * The same rule serves every viewer - anonymous and registered see the same
 * default selection. A future per-user source preference must layer on top of
 * this rule (an additive filter), never replace it as the default.
 *
 * Surfaces: the home "In the news" card picks { perSourceCap: 2, limit: 4 }
 * from the 24-row pool page.js / PublicHome.js fetch; /news picks
 * { perSourceCap: 5, limit: 30 } from a 120-row pool. While the table holds a
 * single source (the NEWS-1 starting state) the card therefore shows 2 rows,
 * not 4 - the cap is the rule; rows fill back in as the broadened FEEDS list
 * resolves on nightly runs.
 *
 * Plain CommonJS on purpose: required by node smoke tests alongside
 * sync-news.js and imported by client components (webpack CJS interop).
 * Pure - no dependencies, no I/O, never throws.
 */

// Epoch ms for an item's published_at; missing/unparseable dates sort last.
function publishedMs(item) {
  if (!item || !item.published_at) return -Infinity;
  const t = Date.parse(item.published_at);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Pick up to `limit` items with at most `perSourceCap` per source, rotating
 * newest-first across sources. Returns a new array, newest-first. Non-array
 * input returns [].
 */
function selectBalanced(items, { perSourceCap = 2, limit = 4 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const cap = Math.max(1, Math.floor(perSourceCap) || 1);
  const max = Math.max(1, Math.floor(limit) || 1);

  // Group by source, newest-first within each group.
  const groups = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.source || '(unattributed)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const lists = Array.from(groups.values());
  for (const list of lists) list.sort((a, b) => publishedMs(b) - publishedMs(a));

  // Sources take turns; the source holding the freshest item goes first.
  lists.sort((a, b) => publishedMs(b[0]) - publishedMs(a[0]));
  const picked = [];
  for (let round = 0; round < cap && picked.length < max; round++) {
    for (const list of lists) {
      if (picked.length >= max) break;
      if (round < list.length) picked.push(list[round]);
    }
  }

  // Render newest-first; balance already lives in the picks above.
  picked.sort((a, b) => publishedMs(b) - publishedMs(a));
  return picked;
}

module.exports = { selectBalanced, publishedMs };
