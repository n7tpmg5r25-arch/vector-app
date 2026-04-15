require('dotenv').config();
/**
 * VECTOR | WA — Committee Meetings Sync (Phase 11.1, v2)
 * lib/sync-meetings.js
 *
 * Fetches scheduled committee meetings from the WA Legislature
 * CommitteeMeetingService.asmx and upserts them into
 * committee_meetings + meeting_agenda_items.
 *
 * v2 fixes (2026-04-14):
 *   - Uses AgendaId as natural key (was composite string)
 *   - Second call to GetCommitteeMeetingItems per meeting for agenda bills
 *   - Preserves Pacific local time (no UTC conversion bug)
 *   - Uses CommitteeType as meeting_type
 *   - Skips cancelled meetings
 *
 * Self-contained: scoreBill() and bill pipeline untouched.
 * Idempotent: dedupes on wsl_meeting_id = AgendaId.
 * Dual-writes legacy bills.has_public_hearing / hearing_date for back-compat.
 * Hooks (onMeetingUpsert, onAgendaItemUpsert) reserved for Phase 11.2 alerts.
 */

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const WA_BASE = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';
const BIENNIUM = process.env.CURRENT_BIENNIUM || '2025-26';
const YEAR = process.env.CURRENT_YEAR || '2026';
const SESSION = `${parseInt(YEAR) - 1}-${YEAR}`;
const FORWARD_DAYS = parseInt(process.env.MEETING_FORWARD_DAYS || '14', 10);

// --- Helpers ----------------------------------------------------------------

async function fetchXML(service, endpoint, params) {
  const url = new URL(`${WA_BASE}/${service}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Accept: 'text/xml' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  return parser.parseStringPromise(text);
}

const asArray = x => (x === null || x === undefined) ? [] : (Array.isArray(x) ? x : [x]);
const ymd = d => d.toISOString().split('T')[0];

// Parse WSL's "2026-04-21T10:00:00" timestamp as-is, no timezone conversion.
// WSL times are Pacific local; Node's Date would convert to UTC. We split the
// string directly to preserve the committee's posted local time.
function splitWslTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return { date: null, time: null };
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!m) return { date: null, time: null };
  return { date: m[1], time: m[2] };
}

// --- Fetch -------------------------------------------------------------------

async function fetchMeetingsForAgency(agency, beginDate, endDate) {
  const data = await fetchXML('CommitteeMeetingService.asmx', 'GetCommitteeMeetings', {
    agency, beginDate, endDate,
  });
  return asArray(data?.ArrayOfCommitteeMeeting?.CommitteeMeeting);
}

async function fetchMeetingItems(agendaId) {
  try {
    const data = await fetchXML('CommitteeMeetingService.asmx', 'GetCommitteeMeetingItems', {
      agendaId,
    });
    return asArray(data?.ArrayOfCommitteeMeetingItem?.CommitteeMeetingItem);
  } catch (e) {
    console.warn(`  [agenda fetch failed for ${agendaId}]:`, e.message);
    return [];
  }
}

// --- Parse -------------------------------------------------------------------

function parseMeeting(m) {
  const agendaId = m?.AgendaId;
  if (!agendaId) return null;

  // Skip cancelled
  if (String(m?.Cancelled).toLowerCase() === 'true') return null;

  const committees = asArray(m?.Committees?.Committee);
  const primary = committees[0] || {};
  const agency = m?.Agency || primary?.Agency || '';
  const isJoint = agency === 'Joint' || committees.length > 1;
  const chamber = isJoint ? 'Joint' : (agency === 'House' || agency === 'Senate' ? agency : null);
  if (!chamber) return null;

  const { date: meetingDate, time: meetingTime } = splitWslTimestamp(m?.Date);
  if (!meetingDate) return null;

  const committeeName = primary?.Name || primary?.LongName || '';
  const location = [m?.Room, m?.Building].filter(Boolean).join(', ') || m?.Address || null;

  // meeting_type: use CommitteeType if available, else generic
  const meetingType = m?.CommitteeType || m?.MeetingType || 'Meeting';

  return {
    wsl_meeting_id: String(agendaId),
    agenda_id: agendaId,
    committee_name: committeeName,
    chamber,
    is_joint: isJoint,
    meeting_date: meetingDate,
    meeting_time: meetingTime,
    // meeting_datetime preserved as local timestamp string (no TZ) — Postgres
    // will store as "timestamp with time zone" interpreted in session TZ. For
    // display we use meeting_date + meeting_time, so this is a soft fallback.
    meeting_datetime: `${meetingDate}T${meetingTime || '00:00:00'}`,
    location,
    meeting_type: meetingType,
    agenda_url: null,
    notes: m?.Notes || null,
    session: SESSION,
  };
}

function parseAgendaItem(item, idx) {
  const billId = (item?.BillId || '').trim();
  const hearingDesc = item?.HearingTypeDescription || item?.HearingType || 'Agenda';
  const desc = item?.ItemDescription || null;
  const order = parseInt(item?.Order, 10);

  return {
    // WSL BillId format is like "1234" or "SB 1234" — normalize to digits
    bill_number: billId ? billId.replace(/\D/g, '') || null : null,
    item_type: hearingDesc,
    description: desc,
    display_order: isNaN(order) ? idx : order,
    has_bill: !!billId,
  };
}

// --- Upsert ------------------------------------------------------------------

// 11.1.1 — generate slug from name + chamber, matching the migration's logic
function slugify(name, chamber) {
  const s = (name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${chamber.toLowerCase()}-${s}`.slice(0, 80);
}

// 11.1.1 — auto-create committees row on first-seen so Joint committees (and
// any new committee WSL schedules that isn't in our backfill) have a clickable
// detail page. Idempotent via slug unique constraint.
async function ensureCommittee(supabase, cmap, name, chamber) {
  const key = `${name}|${chamber}`;
  if (cmap.has(key)) return cmap.get(key);
  if (!name || !chamber) return null;

  const slug = slugify(name, chamber);
  const { data, error } = await supabase
    .from('committees')
    .upsert({ name, chamber, slug, agency: chamber, active: true }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error || !data) {
    console.warn(`  [committee ensure failed for ${key}]:`, error?.message);
    return null;
  }
  cmap.set(key, data.id);
  return data.id;
}

async function upsertMeetings(supabase, meetings) {
  // Committee lookup
  const { data: committees } = await supabase
    .from('committees')
    .select('id, name, chamber');
  const cmap = new Map();
  (committees || []).forEach(c => cmap.set(`${c.name}|${c.chamber}`, c.id));

  // Bill lookup (current session)
  const { data: bills } = await supabase
    .from('bills')
    .select('bill_id, bill_number, chamber')
    .eq('session', SESSION);
  const billMap = new Map();
  (bills || []).forEach(b => {
    billMap.set(`${b.bill_number}|${b.chamber}`, b.bill_id);
    // Also index without chamber for joint meetings
    billMap.set(`${b.bill_number}|*`, b.bill_id);
  });

  let insertedMeetings = 0;
  let insertedAgenda = 0;
  const upsertedBillIds = new Set();

  let newCommittees = 0;
  for (const m of meetings) {
    let committeeId = cmap.get(`${m.committee_name}|${m.chamber}`) || null;
    if (!committeeId) {
      committeeId = await ensureCommittee(supabase, cmap, m.committee_name, m.chamber);
      if (committeeId) newCommittees++;
    }

    const { data: row, error: mErr } = await supabase
      .from('committee_meetings')
      .upsert({
        committee_id: committeeId,
        committee_name: m.committee_name,
        chamber: m.chamber,
        is_joint: m.is_joint,
        meeting_date: m.meeting_date,
        meeting_time: m.meeting_time,
        meeting_datetime: m.meeting_datetime,
        location: m.location,
        meeting_type: m.meeting_type,
        agenda_url: m.agenda_url,
        notes: m.notes,
        session: m.session,
        wsl_meeting_id: m.wsl_meeting_id,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'wsl_meeting_id' })
      .select('id')
      .single();

    if (mErr || !row) {
      console.warn('  [meeting upsert failed]', m.wsl_meeting_id, mErr?.message);
      continue;
    }
    insertedMeetings++;
    await onMeetingUpsert(row.id, m);

    // Fetch agenda items (second API call per meeting)
    const rawItems = await fetchMeetingItems(m.agenda_id);
    const parsed = rawItems.map((item, idx) => parseAgendaItem(item, idx));

    // Replace existing agenda items for this meeting (idempotent)
    await supabase.from('meeting_agenda_items').delete().eq('meeting_id', row.id);

    if (parsed.length) {
      const rows = parsed.map(a => {
        const billId = a.bill_number
          ? (billMap.get(`${a.bill_number}|${m.chamber}`) ||
             billMap.get(`${a.bill_number}|House`) ||
             billMap.get(`${a.bill_number}|Senate`) || null)
          : null;
        if (billId) upsertedBillIds.add(billId);
        return {
          meeting_id: row.id,
          bill_id: billId,
          bill_number: a.bill_number,
          item_type: a.item_type,
          description: a.description,
          display_order: a.display_order,
        };
      });
      const { error: aErr } = await supabase.from('meeting_agenda_items').insert(rows);
      if (!aErr) insertedAgenda += rows.length;
      else console.warn('  [agenda insert failed]', aErr.message);
      for (const r of rows) await onAgendaItemUpsert(r);
    }
  }

  // Dual-write legacy bills.has_public_hearing / hearing_date
  const today = ymd(new Date());
  for (const billId of upsertedBillIds) {
    const { data: next } = await supabase
      .from('meeting_agenda_items')
      .select('committee_meetings!inner(meeting_date)')
      .eq('bill_id', billId)
      .gte('committee_meetings.meeting_date', today)
      .order('committee_meetings(meeting_date)', { ascending: true })
      .limit(1)
      .maybeSingle();
    const nextDate = next?.committee_meetings?.meeting_date || null;
    await supabase
      .from('bills')
      .update({ has_public_hearing: true, hearing_date: nextDate ? new Date(nextDate).toISOString() : new Date().toISOString() })
      .eq('bill_id', billId);
  }

  return { insertedMeetings, insertedAgenda, linkedBills: upsertedBillIds.size, newCommittees };
}

// --- Phase 11.2 hooks --------------------------------------------------------

async function onMeetingUpsert(/* meetingId, meeting */) {}
async function onAgendaItemUpsert(/* agendaItem */) {}

// --- Main --------------------------------------------------------------------

async function syncCommitteeMeetings(supabaseClient) {
  const supabase = supabaseClient ||
    createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const today = new Date();
  const end = new Date(today.getTime() + FORWARD_DAYS * 24 * 60 * 60 * 1000);
  const beginDate = ymd(today);
  const endDate = ymd(end);

  console.log(`\n📅 Phase 11.1 — Committee Meetings sync (${beginDate} → ${endDate})`);

  const seen = new Set();
  const allMeetings = [];
  for (const agency of ['House', 'Senate']) {
    try {
      const raw = await fetchMeetingsForAgency(agency, beginDate, endDate);
      console.log(`  ${agency}: ${raw.length} scheduled meetings`);
      for (const m of raw) {
        const parsed = parseMeeting(m);
        if (!parsed) continue;
        if (seen.has(parsed.wsl_meeting_id)) continue; // Joint dedup
        seen.add(parsed.wsl_meeting_id);
        allMeetings.push(parsed);
      }
    } catch (e) {
      console.error(`  ${agency} fetch failed:`, e.message);
    }
  }

  if (allMeetings.length === 0) {
    console.log('  No meetings found in window.');
    return { insertedMeetings: 0, insertedAgenda: 0, linkedBills: 0 };
  }

  const result = await upsertMeetings(supabase, allMeetings);
  console.log(
    `  ✓ Upserted ${result.insertedMeetings} meetings, ` +
    `${result.insertedAgenda} agenda items, ${result.linkedBills} bills linked` +
    (result.newCommittees ? `, ${result.newCommittees} new committee rows` : '')
  );
  return result;
}

module.exports = { syncCommitteeMeetings, parseMeeting, parseAgendaItem };

if (require.main === module) {
  syncCommitteeMeetings()
    .then(r => { console.log('\nDone:', r); process.exit(0); })
    .catch(e => { console.error('FAILED:', e); process.exit(1); });
}
