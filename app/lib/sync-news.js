/**
 * VECTOR | WA — Statewide News Ingestion (Thread DASH-4, Dashboard Rebuild)
 *
 * Polls a curated set of Washington-State RSS/Atom feeds and archives each item
 * (text-only: title + snippet + link + source + published time) into the
 * public.news_items table, so the DASH-5 "In the news" block can render one
 * calm, statewide news card on the dashboard. DASH-4 only INGESTS — there is no
 * user-facing behavior change yet.
 *
 * Design (matches the rest of app/lib — dependency-light, fault-isolated):
 *   - No new dependencies. Uses the Node-24 global fetch (the nightly Action
 *     pins node-version '24') and a tiny hand-rolled RSS/Atom parser; the only
 *     require is @supabase/supabase-js, already a dependency. (sync-bill-text.js
 *     leans on node-fetch + xml2js, which are unlisted hoisted transitives — we
 *     deliberately avoid both here to keep the build + cost flat.)
 *   - Per-feed fault isolation: one dead / slow / malformed feed is logged and
 *     skipped; it never aborts the batch. The whole run also exits 0 on any
 *     thrown error so it can NEVER fail the surrounding nightly sync.
 *   - Dedup on a normalized key — lower(trim(url || title)) — mirroring the DB
 *     unique index md5(lower(trim(coalesce(url,title)))). Duplicates across
 *     feeds and across nights collapse to one row (no duplicate floods).
 *   - Neutral by rule (NEWS-1): the pool spans public media, commercial
 *     dailies, radio, wire, and independent Olympia press; whole-newsroom
 *     feeds pass one fixed government-beat keyword test, and what renders is
 *     capped per source with newest-first rotation (app/lib/news-select.js).
 *     Inclusion is mechanical - no editorial picks, no per-outlet tuning.
 *   - 60-day retention: items older than the window are pruned every run, so the
 *     table stays small and $0 on the Supabase free tier.
 *   - Writes use the service-role key (RLS-bypassing). Client reads are public
 *     read-only via the news_items RLS policy.
 *
 * Cadence: wired into nightly-sync.yml. News is NOT session-gated — it ingests
 * year-round (off-session signings, interim committee news, pre-filing season).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *   [NEWS_RETENTION_DAYS=60] [NEWS_FETCH_TIMEOUT_MS=15000] \
 *   [NEWS_MAX_ITEMS_PER_FEED=50] \
 *   node app/lib/sync-news.js
 */

const { createClient } = require('@supabase/supabase-js');

// Native fetch on Node 18+ (the Action pins node 24); fall back to node-fetch
// only if some older runtime ever calls this. No hard dependency either way.
const fetchFn = (typeof globalThis.fetch === 'function')
  ? globalThis.fetch.bind(globalThis)
  : require('node-fetch');

// ── Config (env-overridable) ───────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const RETENTION_DAYS = Math.max(1, parseInt(process.env.NEWS_RETENTION_DAYS || '60', 10) || 60);
const FETCH_TIMEOUT_MS = Math.max(2000, parseInt(process.env.NEWS_FETCH_TIMEOUT_MS || '15000', 10) || 15000);
const MAX_ITEMS_PER_FEED = Math.max(1, parseInt(process.env.NEWS_MAX_ITEMS_PER_FEED || '50', 10) || 50);
const UPSERT_CHUNK = 200;

// ── Curated WA feed list ───────────────────────────────────────────────────────
// Each entry: { source, url, type, beat }.
//   type  'article' | 'legislation' -> news_items.item_type ('legislation' is
//         the official-filing glyph in DASH-5; everything else is journalism).
//   beat  'politics' = the feed itself is a politics/government section, so
//                      every item is already on-beat and ingests as-is.
//         'general'  = a whole-newsroom feed; items must pass isNewsBeat()
//                      (the fixed keyword test below) to ingest.
//
// NEUTRAL INCLUSION RULE (NEWS-1, 2026-06-09). The feed must not read as
// favoring any outlet or viewpoint; inclusion is mechanical, never editorial:
//   1. POOL    Every Washington outlet with a working public RSS/Atom feed and
//              statewide government coverage qualifies - public media,
//              commercial dailies, radio, wire, independent. No outlet is
//              excluded or boosted for its editorial lean. Outlets we could
//              not add: McClatchy's four WA dailies (News Tribune, Olympian*,
//              Tri-City Herald, Bellingham Herald), the Puget Sound Business
//              Journal (no public feeds; fetch blocked), and AP (no public
//              RSS). *The Olympian keeps its pre-NEWS-1 best-effort line.
//   2. BEAT    Politics / government / Legislature coverage only - via the
//              outlet's own politics-section feed where one exists, or
//              isNewsBeat() for whole-newsroom feeds. Same test for everyone.
//   3. DISPLAY What renders is capped per source and rotated newest-first
//              round-robin across sources (app/lib/news-select.js), so no
//              single outlet can dominate a card no matter how much it
//              publishes. Anonymous and registered viewers get the same
//              default selection; any future per-user source preference must
//              layer on top of this rule, never replace it.
//
// This list is the single editing surface - add/remove a line to change
// coverage. Every feed is fault-isolated: a wrong/dead URL is a logged no-op,
// never a failure, so the nightly per-feed log is the source of truth for
// which resolve.
//   [verified] returned RSS/Atom when checked (DASH-4 build or NEWS-1 2026-06-09)
//   [confirm]  best-effort URL - confirm from the first run's per-feed log line
const FEEDS = [
  // ── Statewide nonprofit & public media ──────────────────────────────────────
  // [verified] WordPress / States Newsroom - live in prod (NEWS-1 audit: the
  //   only source delivering rows, which is exactly the imbalance this thread
  //   fixes from the pool side).
  { source: 'WA State Standard', url: 'https://washingtonstatestandard.com/feed/', type: 'article', beat: 'politics' },
  // [verified] NPR-member (Grove) /index.rss - whole-newsroom, beat-filtered.
  { source: 'KNKX', url: 'https://www.knkx.org/index.rss', type: 'article', beat: 'general' },
  // [confirm] Same NPR-member pattern as KNKX; 0 rows so far - confirm on log.
  { source: 'KUOW', url: 'https://www.kuow.org/index.rss', type: 'article', beat: 'general' },
  // [confirm] Cascade PBS (formerly Crosscut), Brightspot CMS; 0 rows so far.
  { source: 'Cascade PBS', url: 'https://www.cascadepbs.org/index.rss', type: 'article', beat: 'general' },
  // ── Commercial dailies ──────────────────────────────────────────────────────
  // [verified] Official Spokesman-Review WA-government section feed.
  { source: 'Spokesman-Review', url: 'https://www.spokesman.com/feeds/stories/washington-government/', type: 'article', beat: 'politics' },
  // [confirm] WordPress politics-section feed; origin returned empty to the
  //   NEWS-1 fetch check (likely bot-gating) - the Action's fetch may differ.
  { source: 'Seattle Times', url: 'https://www.seattletimes.com/seattle-news/politics/feed/', type: 'article', beat: 'politics' },
  // [verified NEWS-1] Sound Publishing /feed/ - whole-newsroom, beat-filtered.
  { source: 'Everett Herald', url: 'https://www.heraldnet.com/feed/', type: 'article', beat: 'general' },
  // [verified NEWS-1] BLOX CMS search feed - whole-newsroom, beat-filtered.
  { source: 'Union-Bulletin', url: 'https://www.union-bulletin.com/search/?f=rss&l=25&s=start_time&sd=desc', type: 'article', beat: 'general' },
  // [confirm] WordPress politics-section feed; empty to the NEWS-1 fetch check.
  { source: 'The Columbian', url: 'https://www.columbian.com/news/politics/feed/', type: 'article', beat: 'politics' },
  // [confirm] McClatchy RSS widget (pre-NEWS-1 line, kept); the contentId is
  //   site-specific - replace from the first run's log if it stays at zero.
  { source: 'The Olympian', url: 'https://www.theolympian.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true', type: 'article', beat: 'general' },
  // ── Commercial radio ────────────────────────────────────────────────────────
  // [verified NEWS-1] Bonneville / KIRO Newsradio - whole-newsroom, beat-filtered.
  { source: 'MyNorthwest', url: 'https://mynorthwest.com/feed/', type: 'article', beat: 'general' },
  // ── Wire & independent Olympia press ────────────────────────────────────────
  // [confirm] Statehouse wire; BLOX CMS - empty to the NEWS-1 fetch check.
  { source: 'The Center Square', url: 'https://www.thecentersquare.com/washington/search/?f=rss&l=25', type: 'article', beat: 'politics' },
  // [verified NEWS-1] Independent Olympia politics newsletter (Substack feed).
  { source: 'Washington Observer', url: 'https://washingtonobserver.substack.com/feed', type: 'article', beat: 'politics' },
  // ── Official ────────────────────────────────────────────────────────────────
  // [confirm] legislation-typed slot. The WA Legislature publishes only per-bill
  //   and per-topic RSS (no single "legislation news" feed); point this at a
  //   chosen topic feed from app.leg.wa.gov/bi/topicalindex. No-op until set.
  { source: 'WA Legislature', url: 'https://app.leg.wa.gov/billsbytopic/Rss.aspx?topic=&year=2026', type: 'legislation', beat: 'politics' },
];

// ── Government-beat test (NEWS-1) ──────────────────────────────────────────────
// One fixed pattern, applied identically to every 'general' (whole-newsroom)
// feed - never tuned per outlet. Generous on purpose: it admits the broad
// government beat (Legislature, elections, budgets, agencies, councils, courts
// as government) and drops the rest of a newsroom feed (sports, weather,
// features, crime blotter). Title and snippet both count.
const BEAT_RE = new RegExp('\\b(?:' + [
  'legislat\\w*', 'lawmaker\\w*', 'olympia', 'capitol', 'statehouse',
  'governor\\w*', 'gubernatorial', 'gov', 'mayor\\w*', 'attorney general', 'secretary of state',
  'state (?:house|senate|budget\\w*|agenc\\w*|patrol|lands|law\\w*|capitol)',
  '(?:house|senate) (?:bill|committee|floor|democrats|republicans)',
  'special session', 'sine die', 'veto\\w*',
  'ballot\\w*', 'initiative\\w*', 'referendum\\w*', 'election\\w*',
  'primar(?:y|ies)', 'voters?', 'redistrict\\w*', 'campaign\\w*',
  'city council', 'county (?:council|commission\\w*)', 'school board',
  'lev(?:y|ies)', 'tax(?:es|ed|ation|payer\\w*)?', 'budget\\w*',
  'medicaid', 'medicare', 'public school\\w*', 'public health',
  'wsdot', 'ferr(?:y|ies)', 'minimum wage', 'rulemaking', 'regulat\\w*',
  'polic(?:y|ies)', 'public records?', 'open government',
  'congress\\w*', 'senator\\w*', 'representative\\w*', 'supreme court',
  'democrat\\w*', 'republican\\w*', 'bipartisan\\w*', 'caucus\\w*',
].join('|') + ')\\b', 'i');

function isNewsBeat(item) {
  if (!item) return false;
  return BEAT_RE.test((item.title || '') + ' ' + (item.snippet || ''));
}

// 'politics'-beat feeds are already section-filtered by the outlet; 'general'
// feeds keep only items that pass the beat test.
function onBeat(items, feed) {
  if (!feed || feed.beat !== 'general') return items;
  return items.filter(isNewsBeat);
}

// ── Fetch with timeout + light retry (mirrors sync-bill-text.js) ───────────────
async function fetchText(url, { timeoutMs = FETCH_TIMEOUT_MS, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'VectorWA-NewsSync/1.0 (+https://vectorwa.com)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt > retries) break;
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr || new Error('fetch failed');
}

// ── Tiny no-dep XML helpers ────────────────────────────────────────────────────
function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch (_) { return ''; }
}
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'");
}
// Strip tags -> decode -> collapse whitespace. Keeps the table text-only (no
// markup, no images). Decodes twice to flatten the occasional double-encoded
// snippet (entities wrapping markup).
function toPlainText(s) {
  if (!s) return '';
  let out = decodeEntities(String(s));
  out = out.replace(/<[^>]+>/g, ' ');
  out = decodeEntities(out);
  return out.replace(/\s+/g, ' ').trim();
}
function clip(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+$/, '') + '…';
}

// First inner text of <name>...</name> (namespace-tolerant), or ''.
function firstTag(block, names) {
  for (const name of names) {
    const re = new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?' + name + '>', 'i');
    const m = block.match(re);
    if (m && m[1] != null) return m[1];
  }
  return '';
}
// Atom <link href="..."> — prefer rel="alternate" (or no rel), http(s) only.
function atomLink(block) {
  const tags = block.match(/<(?:\w+:)?link\b[^>]*>/gi) || [];
  let fallback = '';
  for (const tag of tags) {
    const href = (tag.match(/\bhref\s*=\s*"([^"]*)"/i) || tag.match(/\bhref\s*=\s*'([^']*)'/i) || [])[1];
    if (!href || !/^https?:\/\//i.test(href)) continue;
    const rel = (tag.match(/\brel\s*=\s*"([^"]*)"/i) || [])[1] || '';
    if (rel === '' || rel.toLowerCase() === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}
function pickUrl(block) {
  // RSS: <link>URL</link> (text). Atom: <link href="URL"/>. Last resort: a
  // permalink <guid>.
  const rss = toPlainText(firstTag(block, ['link'])).trim();
  if (/^https?:\/\//i.test(rss)) return rss;
  const atom = atomLink(block);
  if (atom) return decodeEntities(atom).trim();
  const guid = toPlainText(firstTag(block, ['guid'])).trim();
  return /^https?:\/\//i.test(guid) ? guid : '';
}
function pickDate(block) {
  const txt = toPlainText(firstTag(block, ['pubDate', 'published', 'updated', 'date'])).trim();
  if (txt) {
    const t = Date.parse(txt);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null; // caller falls back to ingest time
}

// Split a feed body into item/entry blocks (RSS <item> + Atom <entry>).
function itemBlocks(xml) {
  const blocks = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[2]);
  return blocks;
}

// Parse a raw feed string into normalized item rows. Never throws.
function parseFeed(xml, feed) {
  const out = [];
  if (!xml || typeof xml !== 'string') return out;
  let blocks;
  try { blocks = itemBlocks(xml); } catch (_) { return out; }
  for (const block of blocks) {
    const title = clip(toPlainText(firstTag(block, ['title'])), 500);
    if (!title) continue; // an item with no title is unusable
    const url = pickUrl(block);
    const snippet = clip(toPlainText(firstTag(block, ['description', 'summary', 'content'])), 280) || null;
    out.push({
      source: feed.source,
      title,
      snippet,
      url: url || null,
      published_at: pickDate(block), // may be null; filled with ingest time before upsert
      item_type: feed.type === 'legislation' ? 'legislation' : 'article',
    });
    if (out.length >= MAX_ITEMS_PER_FEED) break;
  }
  return out;
}

// In-run dedup key — mirrors the DB md5(lower(trim(coalesce(url,title)))).
function dedupKey(row) {
  const basis = (row.url && row.url.trim()) ? row.url : (row.title || '');
  return basis.trim().toLowerCase();
}
function dedupeInRun(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = dedupKey(r);
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, r);
  }
  return Array.from(seen.values());
}
function cutoffISO(days = RETENTION_DAYS, now = Date.now()) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function syncNews() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('FATAL: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const start = Date.now();
  console.log('=== Statewide News Ingestion (DASH-4) ===');
  console.log('Feeds: ' + FEEDS.length + '; retention ' + RETENTION_DAYS + 'd; cap ' + MAX_ITEMS_PER_FEED + '/feed.');

  // 1) Fetch + parse every feed, fault-isolated.
  let collected = [];
  const perFeed = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const parsed = parseFeed(xml, feed);
      const items = onBeat(parsed, feed); // NEWS-1: government-beat gate for whole-newsroom feeds
      collected = collected.concat(items);
      perFeed.push(feed.source + ': ' + items.length + (parsed.length !== items.length ? ' (' + (parsed.length - items.length) + ' off-beat)' : ''));
      console.log('  ' + feed.source + ' -> ' + items.length + ' of ' + parsed.length + ' item(s) on-beat');
    } catch (err) {
      perFeed.push(feed.source + ': SKIPPED');
      console.warn('  ' + feed.source + ' [skipped]: ' + (err && err.message ? err.message : err));
    }
  }

  // 2) Normalize published_at (fallback to ingest time) + in-run dedupe.
  const nowISO = new Date().toISOString();
  for (const r of collected) if (!r.published_at) r.published_at = nowISO;
  const rows = dedupeInRun(collected);
  console.log('Parsed ' + collected.length + ' item(s); ' + rows.length + ' after in-run dedupe.');

  // 3) Upsert in chunks. onConflict=dedup_key + ignoreDuplicates => ON CONFLICT
  //    DO NOTHING, so cross-night duplicates never flood. .select() returns only
  //    the genuinely-new rows, giving an accurate "new" count.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await supabase
      .from('news_items')
      .upsert(chunk, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.warn('  upsert chunk error (non-fatal): ' + error.message);
      continue;
    }
    inserted += (data ? data.length : 0);
  }

  // 4) Prune to the retention window. published_at is always populated above, so
  //    the published_at index fully covers this delete.
  let pruned = 0;
  const { data: del, error: delErr } = await supabase
    .from('news_items')
    .delete()
    .lt('published_at', cutoffISO())
    .select('id');
  if (delErr) console.warn('  prune error (non-fatal): ' + delErr.message);
  else pruned = del ? del.length : 0;

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log('Done in ' + secs + 's — ' + inserted + ' new, ' + pruned + ' pruned. [' + perFeed.join(' | ') + ']');
}

// Run only when invoked directly (node app/lib/sync-news.js). When required by a
// smoke test the pure helpers below are importable without a network pass.
if (require.main === module) {
  syncNews().catch(err => {
    // Last-resort guard: a thrown error must not fail the nightly workflow.
    console.error('News ingestion error (non-fatal):', err);
    process.exit(0);
  });
}

module.exports = {
  FEEDS,
  BEAT_RE,
  isNewsBeat,
  onBeat,
  parseFeed,
  itemBlocks,
  firstTag,
  atomLink,
  pickUrl,
  pickDate,
  toPlainText,
  decodeEntities,
  clip,
  dedupKey,
  dedupeInRun,
  cutoffISO,
};
