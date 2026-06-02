/**
 * VECTOR | WA — Bill Text Ingestion (Thread R5, Radar Phase 3a)
 *
 * Archives the plain text of each current-session bill's CURRENT authoritative
 * version into bill_text_versions, so that Phase 3b (Thread R6) can do true
 * full-text diffing ("what language literally changed") and full-text term
 * matching. R5 only ingests — there is NO user-facing behavior change yet.
 *
 * Pipeline (entirely additive — never touches sync, scoring, or alerts):
 *   1. radar_bill_text_due(session, MAX) → a bounded, round-robin batch of
 *      current-session bills (legislation_type='bill'), never-ingested first,
 *      then least-recently-confirmed. The bound caps WA Leg API volume + run
 *      time; the full set backfills over several nightly runs.
 *   2. For each bill, resolve its current bill-text document via the WA Leg
 *      LegislativeDocumentService (GetDocuments?namedLike=<billNumber>): of the
 *      Class="Bills" documents, take the most recently modified one — that is
 *      the latest authoritative full text (original → substitute → engrossed →
 *      passed → session law, in posting order).
 *   3. Fetch that htm, strip to normalized plain text, sha256-hash it.
 *   4. Upsert into bill_text_versions ON CONFLICT (bill_id, text_hash):
 *        - new hash  → a NEW version row is inserted (history preserved);
 *        - same hash → the existing row's fetched_at is touched (re-confirmed),
 *          which advances the round-robin watermark so the bill rotates to the
 *          back of the queue.
 *
 * Robustness: a bill that fails to resolve / fetch / parse is logged and
 * skipped — it is simply retried on a later run. A failure NEVER aborts the
 * batch or the surrounding sync workflow (this script always exits 0 unless its
 * own bootstrap env is missing).
 *
 * Cadence: wired into nightly-sync.yml ONLY (not midday) to keep volume bounded
 * to one pass per day. See .github/workflows/nightly-sync.yml.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *   CURRENT_BIENNIUM=2025-26 CURRENT_YEAR=2026 \
 *   [RADAR_TEXT_MAX=300] [WA_API_BASE=https://wslwebservices.leg.wa.gov] \
 *   node app/lib/sync-bill-text.js
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

// ── Bootstrap env (fatal if missing — same contract as sync-v2.js) ─────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// WA API short-form biennium (YYYY-YY), e.g. '2025-26' — the leg.wa.gov contract.
// SESSION (YYYY-YYYY) is the bills.session key. Both are derived the same way
// sync-v2.js derives them, so the ingester stays in lockstep across the 2027
// rollover. The nightly workflow sets CURRENT_BIENNIUM + CURRENT_YEAR; if they
// are absent (ad-hoc local run) we fall back to the active biennium by date.
function resolveSession() {
  const biennium = process.env.CURRENT_BIENNIUM;
  const year = process.env.CURRENT_YEAR;
  if (biennium && /^\d{4}-\d{2}$/.test(biennium) && year && /^\d{4}$/.test(year)) {
    return { biennium, session: `${parseInt(year) - 1}-${year}` };
  }
  // Date-based fallback (mirrors detect-radar.js getCurrentSession).
  const BIENNIUMS = [
    { biennium: '2025-26', session: '2025-2026', trigger: '2025-01-13' },
    { biennium: '2027-28', session: '2027-2028', trigger: '2026-12-01' },
  ];
  const now = new Date();
  for (let i = BIENNIUMS.length - 1; i >= 0; i--) {
    if (now >= new Date(BIENNIUMS[i].trigger)) {
      return { biennium: BIENNIUMS[i].biennium, session: BIENNIUMS[i].session };
    }
  }
  return { biennium: BIENNIUMS[0].biennium, session: BIENNIUMS[0].session };
}

const { biennium: BIENNIUM, session: SESSION } = resolveSession();
const WA_BASE = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';

// Max bills processed per run. 300/night clears ~3,100 current bills in ~11
// nights, then steady-state re-confirms the oldest each night. Override via env.
const MAX_BILLS = Math.max(1, parseInt(process.env.RADAR_TEXT_MAX || '300', 10) || 300);

// Concurrency for the WA Leg fetches — small + polite. Each bill = 1 doc-list
// XML call + (at most) 1 htm fetch.
const CONCURRENCY = Math.max(1, parseInt(process.env.RADAR_TEXT_CONCURRENCY || '4', 10) || 4);

const FETCH_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 800;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Fetch helper (timeout + exponential backoff) ───────────────────────────────
async function fetchWithRetry(url, opts = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
    }
  }
}

// ── HTML → normalized plain text ───────────────────────────────────────────────
// WA legislative htm is clean, well-formed markup. A lightweight tag strip is
// enough (and keeps this dependency-light, matching the rest of app/lib). The
// output is normalized so the hash is stable across re-fetches of identical
// text: block-level tags become newlines, inline tags vanish, entities are
// decoded, and whitespace is collapsed per-line + de-blanked.
function htmlToText(html) {
  if (!html) return '';
  let s = html;
  // Drop non-content elements entirely.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block-level boundaries → newline.
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|section|article|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/td>/gi, '\t');
  // Remove all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode the entities that actually appear in these files.
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
  // Normalize whitespace: trim each line, collapse internal runs, drop blank lines.
  const lines = s
    .split(/\r?\n/)
    .map(l => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(l => l.length > 0);
  return lines.join('\n').trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ── WA Leg document resolution ─────────────────────────────────────────────────
// GetDocuments returns ALL documents for a bill number (the bill text in its
// various versions, plus bill reports, amendments, session laws). We want the
// current authoritative full TEXT, which is the most recently modified document
// with Class="Bills". Bill reports (Class="Bill Reports") and amendment docs
// (Class="Amendments") are excluded. The numeric prefix of the doc Name is
// matched against billNumber so a "namedLike" partial can't pull a neighbor.
async function resolveCurrentBillDoc(billNumber) {
  const url = `${WA_BASE}/legislativedocumentservice.asmx/GetDocuments`
    + `?biennium=${encodeURIComponent(BIENNIUM)}&namedLike=${encodeURIComponent(billNumber)}`;
  const res = await fetchWithRetry(url, { headers: { Accept: 'text/xml' } });
  const xml = await res.text();
  const parsed = await new xml2js.Parser({ explicitArray: false, ignoreAttrs: true })
    .parseStringPromise(xml);

  const node = parsed?.ArrayOfLegislativeDocument?.LegislativeDocument;
  const docs = Array.isArray(node) ? node : (node ? [node] : []);
  if (docs.length === 0) return null;

  const numPrefix = (name) => {
    const m = String(name || '').match(/^(\d+)/);
    return m ? m[1] : null;
  };
  const billDocs = docs.filter(d =>
    d && d.Class === 'Bills'
    && d.HtmUrl
    && numPrefix(d.Name) === String(billNumber)
  );
  if (billDocs.length === 0) return null;

  // Most recently modified = most advanced version.
  billDocs.sort((a, b) => {
    const da = Date.parse(a.HtmLastModifiedDate || a.HtmCreateDate || 0) || 0;
    const db = Date.parse(b.HtmLastModifiedDate || b.HtmCreateDate || 0) || 0;
    return db - da;
  });
  const top = billDocs[0];
  return {
    versionLabel: (top.ShortFriendlyName || top.Name || '').toString().trim() || null,
    // lawfilesext serves https; the API returns http — upgrade + encode the path
    // (these URLs contain spaces, e.g. ".../House Bills/1023-S.htm").
    htmUrl: encodeURI(String(top.HtmUrl).replace(/^http:\/\//i, 'https://')),
  };
}

// ── Per-bill ingest ────────────────────────────────────────────────────────────
async function ingestBill(bill) {
  const { bill_id, bill_number } = bill;
  let doc;
  try {
    doc = await resolveCurrentBillDoc(bill_number);
  } catch (err) {
    return { status: 'doc_error', detail: err.message };
  }
  if (!doc) return { status: 'no_doc' };

  let html;
  try {
    const res = await fetchWithRetry(doc.htmUrl, { headers: { Accept: 'text/html' } });
    html = await res.text();
  } catch (err) {
    return { status: 'fetch_error', detail: err.message };
  }

  const text = htmlToText(html);
  if (!text || text.length < 40) {
    // Empty/te­ny parse → treat as a miss; retried next run rather than stored.
    return { status: 'empty_parse' };
  }
  const text_hash = sha256(text);
  const nowISO = new Date().toISOString();

  // Was this exact version already stored? (Distinguishes "new version" from
  // "re-confirmed" for logging; the upsert below handles both either way.)
  let isNew = true;
  const { data: existing } = await supabase
    .from('bill_text_versions')
    .select('id')
    .eq('bill_id', bill_id)
    .eq('text_hash', text_hash)
    .limit(1);
  if (existing && existing.length > 0) isNew = false;

  const { error: upErr } = await supabase
    .from('bill_text_versions')
    .upsert(
      {
        bill_id,
        version_label: doc.versionLabel,
        doc_url: doc.htmUrl,
        text,
        text_hash,
        fetched_at: nowISO,
      },
      { onConflict: 'bill_id,text_hash' }
    );
  if (upErr) return { status: 'db_error', detail: upErr.message };

  return {
    status: isNew ? 'new_version' : 'reconfirmed',
    versionLabel: doc.versionLabel,
    bytes: text.length,
  };
}

// ── Bounded concurrency pool ────────────────────────────────────────────────────
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function lane() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function syncBillText() {
  const start = Date.now();
  console.log('=== Bill Text Ingestion (Radar Phase 3a) ===');
  console.log(`Session: ${SESSION} (biennium ${BIENNIUM}); batch cap ${MAX_BILLS}, concurrency ${CONCURRENCY}.`);

  const { data: due, error: dueErr } = await supabase.rpc('radar_bill_text_due', {
    p_session: SESSION,
    p_limit: MAX_BILLS,
  });
  if (dueErr) {
    console.error('FATAL: radar_bill_text_due failed:', dueErr.message);
    process.exit(1);
  }
  if (!due || due.length === 0) {
    console.log('No bills due for text ingestion. Done.');
    return;
  }
  console.log(`Processing ${due.length} bill(s).`);

  const tally = {
    new_version: 0, reconfirmed: 0, no_doc: 0,
    doc_error: 0, fetch_error: 0, empty_parse: 0, db_error: 0,
  };
  let totalBytes = 0;

  const results = await runPool(due, async (bill) => {
    const r = await ingestBill(bill);
    if (r.status in tally) tally[r.status]++;
    if (r.bytes) totalBytes += r.bytes;
    if (r.status === 'new_version') {
      console.log(`  ${bill.bill_id} → NEW "${r.versionLabel}" (${r.bytes} chars)`);
    } else if (['doc_error', 'fetch_error', 'db_error'].includes(r.status)) {
      console.warn(`  ${bill.bill_id} [${r.status}]: ${r.detail}`);
    }
    return r;
  }, CONCURRENCY);

  const duration = Date.now() - start;
  console.log(
    `Done in ${(duration / 1000).toFixed(1)}s — ` +
    `${tally.new_version} new, ${tally.reconfirmed} reconfirmed, ${tally.no_doc} no-doc, ` +
    `${tally.empty_parse} empty, ${tally.doc_error + tally.fetch_error + tally.db_error} errors ` +
    `(${tally.doc_error} doc / ${tally.fetch_error} fetch / ${tally.db_error} db). ` +
    `~${Math.round(totalBytes / 1024)}KB text this run.`
  );
  void results;
}

syncBillText().catch(err => {
  // Last-resort guard: a thrown error here must not fail the surrounding sync
  // workflow. Log and exit 0 — the batch retries on the next nightly run.
  console.error('Bill text ingestion error (non-fatal):', err);
  process.exit(0);
});
