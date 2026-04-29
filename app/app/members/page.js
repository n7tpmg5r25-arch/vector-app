'use client'

import { POSITION_TIER_SCORES, CHAIR_BONUS, COMPOSITE_WEIGHTS, LOW_VOLUME_THRESHOLD, LOW_VOLUME_PENALTY, TIER_LABELS } from '../../lib/members-scoring'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, getAllSessions, bienniumShortLabel } from '../../lib/session-config'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'
import VoteHistoryTable from '../components/VoteHistoryTable'
import VotingRecordHeader from '../components/VotingRecordHeader'
import DropdownMenu from '../components/DropdownMenu'
import VectorLoader from '../components/VectorLoader'
import { ArrowUpRight } from 'lucide-react'

// Thread 22: procedural shelves to filter out of the "Top committees"
// readout on the Overview tab. Mirrors the same filter pattern used in
// app/app/committees/page.js so a sponsor's Rules-stack queue rows don't
// dominate over the substantive committee where they're actually working.
// "Rules 2 Review" = the post-2nd-reading parking lot every alive bill
// passes through; "Rules" = pre-floor queue. Empty string + null get
// dropped via a separate guard so we don't typo-protect them here.
const PROCEDURAL_SHELF_NAMES = new Set([
  'rules', 'rules 2 review',
])

// Derive the session list from session-config so we don't have to hand-edit
// every page at each biennium rollover. getAllSessions() returns newest-first
// and auto-includes the next biennium once prefiling opens (Dec 1, 2026).
const SESSIONS = getAllSessions()
const DEFAULT_SESSION = typeof window !== 'undefined' ? getCurrentSession() : SESSIONS[0]

// Thread 12.2: useSearchParams() requires a Suspense boundary in Next 16,
// so the inner component reads the URL and the default export wraps it in
// <Suspense>. Same pattern as app/app/search/page.js.
function MembersContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()
  // Phase 12 Batch 6 — capability-aware nav swap for anon visitors.
  // Thread 15.2: viewerLoading destructured + isAnonPublic gated on !viewerLoading
  // so authed users no longer flash PublicNav during auth resolve.
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user
  // Thread 12.2: deep-link from a bill page lands here with
  // ?selectedName=<full name>. We pre-fill the search input and, once the
  // members list loads, auto-select on exact case-insensitive match.
  const incomingName = searchParams?.get('selectedName') || ''

  const [members, setMembers]         = useState([])
  const [selectedMember, setSelected] = useState(null)
  const [memberBills, setMemberBills] = useState([])
  const [loading, setLoading]         = useState(true)
  const [billsLoading, setBillsLoading] = useState(false)
  // Thread 11: voting record for selectedMember (display-only, G5 frozen-engine).
  // Thread 11.1: surname-match fallback dropped — we now look up member_id
  // via legislator_party_history. No more collision banner: Wilson, C. and
  // Wilson, J. resolve to distinct member_ids and render as separate
  // legislators in the member list above (different members.name keys).
  const [memberVotes, setMemberVotes]     = useState([])  // by-member rows for VoteHistoryTable
  // Thread 22: per-roll-call party splits (D/R yes/no) for the same 100
  // roll calls loaded into memberVotes. Powers the cross-party voting
  // signal on the Overview tab. Display-only (G5).
  const [partyBucketsByRcId, setPartyBucketsByRcId] = useState({})
  const [votesLoading, setVotesLoading]   = useState(false)
  // Thread 22: tabbed member detail (Overview / Voting / Bills). Reset
  // to 'overview' whenever a member is opened so each click feels fresh.
  const [activeTab, setActiveTab] = useState('overview')
  const [chamber, setChamber]         = useState('All')
  const [party, setParty]             = useState('All')
  const [query, setQuery]             = useState('')
  const [selectedSession, setSelectedSession] = useState(DEFAULT_SESSION)
  const [viewMode, setViewMode]             = useState('list') // 'list' | 'heatmap'

  useEffect(() => {
    async function load() {
      setLoading(true)
      const isAll = selectedSession === 'all'

      // Fetch bills — if "All Sessions", fetch from all bienniums
      let allData = []
      if (isAll) {
        for (const s of SESSIONS) {
          const { data } = await supabase
            .from('bills')
            .select('prime_sponsor, prime_party, chamber, is_committee_chair, sponsor_tier, final_score, committee_passed, has_public_hearing, committee_name, outcome_passed_law, session')
            .eq('session', s)
            .not('prime_sponsor', 'is', null)
          if (data) allData = allData.concat(data)
        }
      } else {
        const { data } = await supabase
          .from('bills')
          .select('prime_sponsor, prime_party, chamber, is_committee_chair, sponsor_tier, final_score, committee_passed, has_public_hearing, committee_name, outcome_passed_law, session')
          .eq('session', selectedSession)
          .not('prime_sponsor', 'is', null)
        if (data) allData = data
      }

      if (!allData.length) { setMembers([]); setLoading(false); return }

      const map = {}
      for (const bill of allData) {
        const name = bill.prime_sponsor
        if (!name) continue
        if (!map[name]) {
          map[name] = {
            name, party: bill.prime_party || '?', chamber: bill.chamber || '?',
            is_chair: bill.is_committee_chair || false, tier: bill.sponsor_tier || 3,
            bill_count: 0, committee_passes: 0, hearing_count: 0, laws_passed: 0,
            scores: [], top_score: 0,
            committees: new Set(),
            // Per-biennium breakdown for "All Sessions" view
            bySession: {},
          }
        }
        const m = map[name]
        m.bill_count++
        m.scores.push(bill.final_score || 0)
        if (bill.committee_passed) m.committee_passes++
        if (bill.has_public_hearing) m.hearing_count++
        if (bill.outcome_passed_law) m.laws_passed++
        if ((bill.final_score || 0) > m.top_score) m.top_score = bill.final_score || 0
        if (bill.prime_party) m.party = bill.prime_party
        if (bill.chamber) m.chamber = bill.chamber
        if (bill.committee_name) m.committees.add(bill.committee_name)

        // Track per-session stats
        const sess = bill.session || selectedSession
        if (!m.bySession[sess]) {
          m.bySession[sess] = { bill_count: 0, committee_passes: 0, laws_passed: 0, scores: [] }
        }
        m.bySession[sess].bill_count++
        m.bySession[sess].scores.push(bill.final_score || 0)
        if (bill.committee_passed) m.bySession[sess].committee_passes++
        if (bill.outcome_passed_law) m.bySession[sess].laws_passed++
      }

      const list = Object.values(map).map(m => ({
        ...m,
        committees: [...m.committees],
        avg_score: m.scores.length > 0
          ? Math.round(m.scores.reduce((a, b) => a + b, 0) / m.scores.length) : 0,
        pass_rate: m.bill_count > 0
          ? Math.round((m.committee_passes / m.bill_count) * 100) : 0,
        bySession: Object.fromEntries(
          Object.entries(m.bySession).map(([s, d]) => [s, {
            ...d,
            avg_score: d.scores.length > 0
              ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
            pass_rate: d.bill_count > 0
              ? Math.round((d.committee_passes / d.bill_count) * 100) : 0,
          }])
        ),
      })).sort((a, b) => b.bill_count - a.bill_count)

      setMembers(list)
      setLoading(false)
    }
    load()
  }, [selectedSession])

  const loadMemberBills = useCallback(async (name) => {
    setBillsLoading(true)
    const isAll = selectedSession === 'all'
    if (isAll) {
      let allData = []
      for (const s of SESSIONS) {
        const { data } = await supabase
          .from('bills')
          .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, committee_passed, has_public_hearing, bipartisan, hearing_date, status, confidence_label, session, outcome_passed_law')
          .eq('session', s)
          .eq('prime_sponsor', name)
          .order('final_score', { ascending: false })
        if (data) allData = allData.concat(data)
      }
      allData.sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      setMemberBills(allData)
    } else {
      const { data } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, committee_passed, has_public_hearing, bipartisan, hearing_date, status, confidence_label, session, outcome_passed_law')
        .eq('session', selectedSession)
        .eq('prime_sponsor', name)
        .order('final_score', { ascending: false })
      setMemberBills(data || [])
    }
    setBillsLoading(false)
  }, [supabase, selectedSession])

  /* ── Thread 11.1: Voting record loader ───────────────────
   * Identity model on /members is full-name-keyed (`prime_sponsor` in
   * `bills`). To bridge to member_votes (member_id-keyed), we look up
   * the legislator's WA member_id from legislator_party_history using
   * (full_name, agency). The biennium-most-recent row wins so a member
   * who's been around for multiple cycles still resolves cleanly.
   *
   * Display-only (G5 frozen-engine): scoreBill() / extractFeatures()
   * are not imported, called, or referenced.
   *
   * Behavior on miss: members not in legislator_party_history (newly
   * seated, very recent appointment, or roster-sync hasn't run yet)
   * fall back to surname-only match, gated on a chamber filter, with
   * party left null per row. This keeps the UI defensible while a
   * roster sync run is pending — never lumps two same-surname members
   * together because the chamber check still fences out the wrong one.
   */
  // Hotfix 2026-04-26: rewritten to avoid Supabase's 1000-row cap.
  // Previous approach queried member_votes.eq('member_id', id) which hit
  // the cap for 146 of 148 legislators (everyone with >1000 distinct votes),
  // then chained .in('id', [1000 rcIds]) on roll_calls which built a URL
  // too long for PostgREST — silent failure, empty state for everyone.
  //
  // New approach: anchor on roll_calls with an embedded bills!inner(session)
  // filter, limit 100 most-recent. Then look up the member's votes on JUST
  // those 100 roll-call IDs. Both queries stay well under the cap.
  // Diagnostic confirmed: bills/session = 3,411 rows for 2025-2026 alone,
  // member_votes/member > 1,000 for nearly all members. See plan doc
  // §Thread 18 "Member voting record empty for everyone" hotfix notes.
  const loadMemberVotes = useCallback(async (m) => {
    setVotesLoading(true)
    setMemberVotes([])
    setPartyBucketsByRcId({})
    if (!m?.name) { setVotesLoading(false); return }

    try {
      // ── Step 1: resolve member_id via legislator_party_history (1 row). ──
      const { data: roster, error: rosterErr } = await supabase
        .from('legislator_party_history')
        .select('member_id, party')
        .eq('full_name', m.name)
        .eq('agency', m.chamber)
        .order('biennium', { ascending: false })
        .limit(1)
      if (rosterErr) console.warn('loadMemberVotes: roster lookup failed', rosterErr)
      const rosterRow = roster && roster.length > 0 ? roster[0] : null
      const memberId  = rosterRow?.member_id || null

      // ── Step 2: most-recent 100 roll_calls in the legislator's chamber,
      //           filtered to selectedSession via embedded bills!inner join.
      //           Bill metadata comes back in the same response — no second
      //           round-trip. ──
      const isAll = selectedSession === 'all'
      let rollsQ = supabase
        .from('roll_calls')
        .select('id, bill_id, chamber, vote_date, motion, yeas, nays, absent, excused, result, bills!inner(bill_id, bill_number, title, chamber, session, outcome_passed_law)')
        .eq('chamber', m.chamber)
        .order('vote_date', { ascending: false })
        .limit(100)
      if (!isAll) rollsQ = rollsQ.eq('bills.session', selectedSession)
      const { data: rolls, error: rollsErr } = await rollsQ
      if (rollsErr) console.warn('loadMemberVotes: roll_calls+bills lookup failed', rollsErr)
      if (!rolls || rolls.length === 0) return

      // ── Step 3: this member's votes on JUST those 100 roll_calls. ──
      // memberId path is the happy case; surname path is a v1 fallback for
      // legislators not yet in legislator_party_history.
      const rollIds = rolls.map(r => r.id)
      let votesQ = supabase
        .from('member_votes')
        .select('roll_call_id, member_id, member_name, vote, party')
        .in('roll_call_id', rollIds)
      if (memberId) {
        votesQ = votesQ.eq('member_id', memberId)
      } else {
        // bills.prime_sponsor format is "First Last" (e.g. "Jake Fey").
        const lastName = m.name.trim().split(/\s+/).pop()
        votesQ = votesQ.eq('member_name', lastName)
      }
      const { data: rawVotes, error: votesErr } = await votesQ
      if (votesErr) console.warn('loadMemberVotes: member_votes lookup failed', votesErr)
      if (!rawVotes || rawVotes.length === 0) return

      // ── Step 4: stitch. Bill metadata is embedded on each roll. ──
      const voteByRcId = Object.fromEntries(rawVotes.map(v => [v.roll_call_id, v]))
      const stitched = rolls
        .map(rc => {
          const v = voteByRcId[rc.id]
          if (!v) return null
          const bill = rc.bills
          if (!bill) return null
          return {
            roll_call_id: rc.id,
            member_id: v.member_id,
            member_vote: v.vote,
            member_party: v.party || rosterRow?.party || null,
            bill_id: rc.bill_id,
            bill_label: `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`,
            bill_title: bill.title,
            bill_session: bill.session,
            chamber: rc.chamber,
            vote_date: rc.vote_date,
            motion: rc.motion,
            yeas: rc.yeas,
            nays: rc.nays,
            result: rc.result,
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b.vote_date || '').localeCompare(a.vote_date || ''))

      setMemberVotes(stitched)

      // ── Thread 22: per-roll-call party splits for the cross-party signal.
      // One additional fetch over the same 100 roll calls — pull every D/R
      // member's vote (not just this member's), aggregate in JS into
      // {[rcId]: {yesD, yesR, noD, noR}}. Stays well under Supabase's 1000-row
      // cap because we're scoped to ≤100 rcIds × ~150 members. Display-only.
      try {
        const { data: allMv, error: pbErr } = await supabase
          .from('member_votes')
          .select('roll_call_id, vote, party')
          .in('roll_call_id', rollIds)
          .in('party', ['D', 'R'])
          .in('vote', ['YEA', 'NAY'])
        if (pbErr) console.warn('loadMemberVotes: party-split lookup failed', pbErr)
        const buckets = {}
        for (const r of (allMv || [])) {
          if (!buckets[r.roll_call_id]) {
            buckets[r.roll_call_id] = { yesD: 0, yesR: 0, noD: 0, noR: 0 }
          }
          const b = buckets[r.roll_call_id]
          if (r.party === 'D' && r.vote === 'YEA') b.yesD++
          else if (r.party === 'D' && r.vote === 'NAY') b.noD++
          else if (r.party === 'R' && r.vote === 'YEA') b.yesR++
          else if (r.party === 'R' && r.vote === 'NAY') b.noR++
        }
        setPartyBucketsByRcId(buckets)
      } catch (pbThrow) {
        console.error('loadMemberVotes: party-split aggregation threw', pbThrow)
      }
    } catch (err) {
      console.error('loadMemberVotes threw', err)
    } finally {
      setVotesLoading(false)
    }
  }, [supabase, selectedSession])

  function selectMember(m) {
    setSelected(m)
    setActiveTab('overview')  // Thread 22: each open lands on Overview
    loadMemberBills(m.name)
    loadMemberVotes(m)
  }
  // Thread 22: shared close handler. Inline rather than goBackOrFallback()
  // because the detail is a state-toggle on the same /members route — there
  // is no separate URL to back-navigate from. Keeps the existing UX.
  function closeDetail() {
    setSelected(null)
    setMemberBills([])
    setMemberVotes([])
    setPartyBucketsByRcId({})
    setActiveTab('overview')
  }
  // Note: no useEffect to refetch on selectedSession change — the list-view
  // select that owns selectedSession also calls setSelected(null), so a
  // member is never open while the session filter changes.

  // Thread 12.2: deep-link handler. Once `incomingName` is present and
  // members have loaded, pre-fill the search query and auto-select on
  // exact case-insensitive match (single-shot — guarded so we don't
  // re-fire if the user navigates back to the list).
  const [incomingHandled, setIncomingHandled] = useState(false)
  useEffect(() => {
    if (incomingHandled || !incomingName || loading || members.length === 0) return
    setQuery(incomingName)
    const exact = members.find(m => m.name?.toLowerCase() === incomingName.toLowerCase())
    if (exact) selectMember(exact)
    setIncomingHandled(true)
  }, [incomingName, members, loading, incomingHandled])

  const STAGE_LABELS = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

  const filtered = members.filter(m => {
    if (chamber !== 'All' && m.chamber !== chamber) return false
    if (party !== 'All' && m.party !== party) return false
    if (query.trim() && !m.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  // ── LEGISLATIVE SUCCESS COMPOSITE ─────────────────────────
  // Answers: "If this legislator sponsors a bill, how likely is it to move?"
  //
  // Position Power (25%) — tier + chair status. Majority leadership & chairs
  //   can schedule hearings, control committee agendas, whip floor votes.
  // Committee Pass Rate (30%) — % of sponsored bills that cleared committee.
  //   The hardest chokepoint in Olympia; most bills die here.
  // Law Rate (25%) — % of sponsored bills signed into law.
  //   The ultimate measure, but rare enough that it shouldn't dominate.
  // Avg Trajectory Score (20%) — mean bill quality signal.
  //   Kept lowest because it measures the bill, not the legislator.
  //
  // Volume guard: < 3 bills → 40% penalty (one lucky bill shouldn't crown you).
  function computeEffectiveness(m) {
    // See app/lib/members-scoring.js for weights + rationale.
    let positionPower = POSITION_TIER_SCORES[m.tier] || POSITION_TIER_SCORES[3]
    if (m.is_chair) positionPower = Math.min(positionPower + CHAIR_BONUS, 100)

    const cmteRate = m.bill_count > 0 ? (m.committee_passes / m.bill_count) * 100 : 0
    const lawRate  = m.bill_count > 0 ? (m.laws_passed / m.bill_count) * 100 : 0
    const avgNorm  = Math.min(m.avg_score, 100)

    let score =
      positionPower * COMPOSITE_WEIGHTS.positionPower +
      cmteRate      * COMPOSITE_WEIGHTS.committeeRate +
      lawRate       * COMPOSITE_WEIGHTS.lawRate +
      avgNorm       * COMPOSITE_WEIGHTS.avgTrajectory
    if (m.bill_count < LOW_VOLUME_THRESHOLD) score *= LOW_VOLUME_PENALTY
    return Math.round(Math.min(score, 100))
  }

  // Map success score 0–100 to Vector palette (dark bg-friendly)
  function effColor(score) {
    if (score >= 55) return { bg: 'rgba(122,171,110,0.55)', text: '#c8e6c0', label: 'High' }       // sage green
    if (score >= 35) return { bg: 'rgba(58,122,138,0.50)', text: '#a2d4dd', label: 'Moderate' }     // deep teal
    if (score >= 18) return { bg: 'rgba(196,122,48,0.40)', text: '#e4c89a', label: 'Low' }          // amber
    return { bg: 'rgba(138,128,112,0.25)', text: '#a09888', label: 'Very Low' }                     // stone
  }

  // Popover state for mobile tap
  const [popover, setPopover] = useState(null) // { name, x, y, member }
  // Thread 22: heatmap legend tooltip — explainer panel for the composite.
  // Toggled by the ? icon next to "LEGISLATIVE SUCCESS"; works on both
  // touch and pointer (no hover-only behavior). Audit-derived (Thread 20):
  // the score is opaque without context.
  const [legendOpen, setLegendOpen] = useState(false)

  const tierLabel = (tier) => TIER_LABELS[tier] || TIER_LABELS[4]

  // ── MEMBER DETAIL VIEW ──────────────────────────────
  if (selectedMember) {
    const tier = tierLabel(selectedMember.tier)
    return (
      <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
        {/* Phase 12 Batch 6 — PublicNav for anon when flag is on */}
        {isAnonPublic && <PublicNav />}
        <div style={{
          background: 'linear-gradient(180deg, #0e1014 0%, var(--bg) 100%)',
          padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(184,151,90,0.06) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}/>
          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* Thread 22: chip-styled back affordance. Inline state-toggle —
                see closeDetail() above for why this isn't goBackOrFallback(). */}
            <button
              onClick={closeDetail}
              style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--teal)', cursor: 'pointer', marginBottom: 12, padding: 0, fontFamily: 'inherit' }}
            >← Back</button>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(184,151,90,0.1)',
                border: '2px solid rgba(184,151,90,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: 'var(--gold)', flexShrink: 0,
                boxShadow: '0 0 16px rgba(184,151,90,0.15)',
              }}>
                {selectedMember.name.split(' ').map(n => n[0]).slice(-2).join('')}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {selectedMember.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {selectedMember.chamber === 'House' ? 'State House' : 'State Senate'} ·{' '}
                  {selectedMember.party === 'D' ? 'Democrat' : selectedMember.party === 'R' ? 'Republican' : selectedMember.party}
                  {selectedMember.is_chair && ' · Committee Chair'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>
                    {tier.text}
                  </span>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: 'var(--bg-surface)', color: 'var(--text-mid)', border: '1px solid var(--border)' }}>
                    {selectedMember.bill_count} bills sponsored
                  </span>
                  <a
                    href={`https://leg.wa.gov/${selectedMember.chamber === 'House' ? 'House/Representatives' : 'Senate/Senators'}/Pages/${selectedMember.name.split(' ').pop()}.aspx`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 9, padding: '3px 10px', borderRadius: 10,
                      background: 'rgba(184,151,90,0.08)', color: 'var(--teal)',
                      border: '1px solid rgba(184,151,90,0.2)',
                      textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    leg.wa.gov <ArrowUpRight size={10} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Thread 22: TAB STRIP ─────────────────────────
            Mirrors the bill detail tab pattern (Thread 18). Three tabs;
            Overview default. Per-session breakdown lives on Overview AND
            on Sponsored Bills (matches the existing "All Sessions" UX
            on both surfaces). G5 frozen-engine: nothing in any tab calls
            scoreBill / extractFeatures. */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
          marginBottom: 14,
          marginTop: 4,
          overflowX: 'auto',
        }}>
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'voting',   label: 'Voting Record' },
            { key: 'bills',    label: 'Sponsored Bills' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              padding: '10px 14px', background: 'none', border: 'none',
              borderBottom: activeTab === key ? '2px solid var(--teal)' : '2px solid transparent',
              fontSize: 12, fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? 'var(--teal)' : 'var(--text-muted)',
              cursor: 'pointer', flexShrink: 0, marginBottom: -1,
              textShadow: activeTab === key ? '0 0 8px rgba(184,151,90,0.3)' : 'none',
              whiteSpace: 'nowrap', fontFamily: 'inherit',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ─────────────────────────────────────────────
              OVERVIEW TAB
              ───────────────────────────────────────────── */}
          {activeTab === 'overview' && (() => {
            // ── Thread 22 derived intelligence (computed every render — cheap;
            //    bills/votes already in memory, no extra queries). G5: pure.
            const sessionLabel = selectedSession === 'all' ? 'All Sessions' : selectedSession
            const bienShort = selectedSession === 'all' ? null : (bienniumShortLabel(selectedSession) || selectedSession)

            // Cross-pollination: HIGH-tier bills (final_score >= 75) the member
            // is sponsoring + grouped category counts. Primary lobbyist signal.
            const highTierBills = (memberBills || []).filter(b => (b.final_score || 0) >= 75)
            const highTierCats = {}
            for (const b of highTierBills) {
              const c = (b.category && b.category.trim()) || 'Uncategorized'
              highTierCats[c] = (highTierCats[c] || 0) + 1
            }
            const highTierCatsSorted = Object.entries(highTierCats).sort((a, b) => b[1] - a[1])

            // Cross-party: count contested votes (parties split) + crosses with
            // opposite majority. Independent caucusers (party not D/R) gracefully
            // skipped — the card doesn't render at all in that case.
            const ownParty = selectedMember.party
            const oppParty = ownParty === 'D' ? 'R' : ownParty === 'R' ? 'D' : null
            let contested = 0, crossed = 0
            if (oppParty) {
              for (const v of (memberVotes || [])) {
                if (v.member_vote !== 'YEA' && v.member_vote !== 'NAY') continue
                const b = partyBucketsByRcId[v.roll_call_id]
                if (!b) continue
                const dMaj = b.yesD > b.noD ? 'YEA' : 'NAY'
                const rMaj = b.yesR > b.noR ? 'YEA' : 'NAY'
                if (dMaj === rMaj) continue  // unanimous → not contested
                contested++
                const oppMaj = oppParty === 'D' ? dMaj : rMaj
                if (v.member_vote === oppMaj) crossed++
              }
            }
            const crossPct = contested > 0 ? Math.round((crossed / contested) * 100) : null

            // Stage funnel: monotonic narrowing — every bill counts at every
            // stage it has reached. WA-actual stage values: 1 / 3 / 4 / 6.
            const funnel = [
              { key: 1, label: 'Introduced',  min: 1 },
              { key: 3, label: 'Comm. Pass',  min: 3 },
              { key: 4, label: 'Floor Pass',  min: 4 },
              { key: 6, label: 'Signed',      min: 6 },
            ].map(s => ({
              ...s,
              count: (memberBills || []).filter(b => (b.stage || 0) >= s.min).length,
            }))
            const funnelMax = funnel[0].count || 0

            // Top committees (procedural shelves filtered).
            const committeeCounts = {}
            for (const b of (memberBills || [])) {
              const raw = (b.committee_name || '').trim()
              if (!raw) continue
              if (PROCEDURAL_SHELF_NAMES.has(raw.toLowerCase())) continue
              committeeCounts[raw] = (committeeCounts[raw] || 0) + 1
            }
            const topCommittees = Object.entries(committeeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)

            // Pass-rate gauge (re-derived from currently loaded memberBills so
            // it's consistent with what we render below; selectedMember.pass_rate
            // is already-computed, but recomputing here costs nothing and stays
            // honest if memberBills has been filtered/scoped).
            const passRate = (memberBills || []).length > 0
              ? Math.round((memberBills.filter(b => b.committee_passed).length / memberBills.length) * 100)
              : 0
            const gaugeColor = passRate >= 60 ? 'var(--teal)' : passRate >= 30 ? 'var(--gold)' : 'var(--text-muted)'
            // Half-circle arc length: π × r where r = 30. Drawn from (8,38) to (68,38).
            const arcLen = Math.PI * 30
            const fillLen = (arcLen * passRate) / 100

            return (
              <>
                {/* Existing 4-stat strip */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Bills', value: selectedMember.bill_count, color: 'var(--teal)' },
                    { label: 'Cmte Passes', value: selectedMember.committee_passes, color: 'var(--teal-mid)' },
                    { label: 'Laws', value: selectedMember.laws_passed, color: selectedMember.laws_passed > 0 ? '#4ade80' : 'var(--text-muted)' },
                    { label: 'Avg Score', value: selectedMember.avg_score, color: selectedMember.avg_score >= 45 ? 'var(--teal)' : selectedMember.avg_score >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
                    }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color, lineHeight: 1, textShadow: color === 'var(--teal)' ? '0 0 8px rgba(184,151,90,0.3)' : 'none' }}>{value}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Per-biennium breakdown (preserved — still surfaces on Overview when "All Sessions" selected) */}
                {selectedSession === 'all' && selectedMember.bySession && Object.keys(selectedMember.bySession).length > 1 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                      Per-Session Breakdown
                    </div>
                    {SESSIONS.filter(s => selectedMember.bySession[s]).map(s => {
                      const d = selectedMember.bySession[s]
                      return (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 11, color: 'var(--teal)', fontFamily: 'var(--font-mono)', minWidth: 72 }}>{s}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-mid)', flex: 1 }}>
                            {d.bill_count} bills · {d.committee_passes} cmte · {d.laws_passed} laws · avg {d.avg_score}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Cross-pollination — HIGH-tier sponsorship + categories.
                    Primary lobbyist signal (audit Thread 20). */}
                {highTierBills.length > 0 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      HIGH-tier Activity
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 8 }}>
                      Sponsoring{' '}
                      <span style={{ color: 'var(--teal)', fontWeight: 700 }}>
                        {highTierBills.length} HIGH-tier bill{highTierBills.length === 1 ? '' : 's'}
                      </span>
                      {' '}{bienShort ? `in ${bienShort}` : 'across recent sessions'}.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {highTierCatsSorted.map(([cat, n]) => (
                        <span key={cat} style={{
                          fontSize: 10, padding: '3px 9px', borderRadius: 8,
                          background: 'rgba(184,151,90,0.08)', color: 'var(--gold)',
                          border: '1px solid rgba(184,151,90,0.25)',
                        }}>
                          {cat}<span style={{ color: 'var(--text-mid)', marginLeft: 4 }}>×{n}</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
                      HIGH-tier = trajectory score ≥ 75. Historically ~5 in 6 HIGH bills become law (N=8,062, 3 bienniums).
                    </div>
                  </div>
                )}

                {/* Cross-party voting signal — staffer persona (audit Thread 20).
                    Suppressed for independents and when contested sample is too
                    thin to be meaningful (< 5 contested votes loaded). */}
                {crossPct !== null && contested >= 5 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Cross-Party Signal
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      Crosses with the{' '}
                      <span style={{ color: oppParty === 'R' ? 'var(--party-r)' : 'var(--party-d)', fontWeight: 700 }}>
                        {oppParty === 'D' ? 'Democrats' : 'Republicans'}
                      </span>
                      {' '}on{' '}
                      <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {crossPct}%
                      </span>
                      {' '}of contested votes
                      <span style={{ color: 'var(--text-muted)' }}>{` (${crossed} of ${contested})`}</span>.
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 }}>
                      Sample: most-recent {memberVotes.length} roll calls in {sessionLabel}. Contested = D and R majorities split.
                    </div>
                  </div>
                )}

                {/* Stage funnel — where this member's bills end up. */}
                {funnelMax > 0 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                      Where Their Bills End Up
                    </div>
                    {funnel.map(s => {
                      const pct = funnelMax > 0 ? (s.count / funnelMax) * 100 : 0
                      const tone = s.key === 6 ? 'rgba(74,222,128,0.55)'
                                : s.key === 4 ? 'rgba(184,151,90,0.55)'
                                : s.key === 3 ? 'rgba(58,122,138,0.55)'
                                :               'rgba(138,128,112,0.45)'
                      return (
                        <div key={s.key} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10, marginBottom: 3 }}>
                            <span style={{ color: 'var(--text-mid)' }}>{s.label}</span>
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.count}</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--bg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              width: `${pct}%`, height: '100%', background: tone,
                              transition: 'width 0.3s',
                            }}/>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Committee pass-rate gauge */}
                {(memberBills || []).length > 0 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                      Committee Pass Rate
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <svg width="76" height="42" viewBox="0 0 76 42" style={{ flexShrink: 0 }}>
                        <path d="M 8 38 A 30 30 0 0 1 68 38" stroke="var(--bg-surface)" strokeWidth="6" fill="none" strokeLinecap="round" />
                        <path
                          d="M 8 38 A 30 30 0 0 1 68 38"
                          stroke={gaugeColor}
                          strokeWidth="6" fill="none" strokeLinecap="round"
                          strokeDasharray={`${fillLen} ${arcLen}`}
                        />
                      </svg>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: gaugeColor, lineHeight: 1 }}>
                          {passRate}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3 }}>
                          of sponsored bills cleared committee
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top committees (procedural shelves filtered) */}
                {topCommittees.length > 0 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                      Most Active Committees
                    </div>
                    {topCommittees.map(([name, n], i) => (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', width: 14, textAlign: 'right' }}>{i + 1}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{n} bill{n === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Existing committee-affiliations chip strip — preserved for
                    completeness (small text, fast scan of all committees) */}
                {selectedMember.committees && selectedMember.committees.length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                      All Committee Affiliations
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selectedMember.committees.sort().map(c => (
                        <span key={c} style={{
                          fontSize: 11, padding: '4px 10px', borderRadius: 8,
                          background: 'var(--bg-surface)', color: 'var(--text-mid)',
                          border: '1px solid var(--border)', lineHeight: 1.3,
                        }}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {/* ─────────────────────────────────────────────
              VOTING RECORD TAB
              Display-only (G5 frozen-engine). member_id resolved via the
              legislator_party_history roster cache; surname fallback only
              kicks in for legislators not yet in the roster (chamber-fenced
              so it can never lump two same-surname members together).
              ───────────────────────────────────────────── */}
          {activeTab === 'voting' && (
            <div>
              <VotingRecordHeader
                mode="by-member"
                scopeLabel={selectedSession === 'all' ? 'All Sessions' : selectedSession}
                count={memberVotes.length}
                showScopeStamp
              />
              {votesLoading ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading voting record...</div>
              ) : (
                <VoteHistoryTable
                  mode="by-member"
                  byMemberRows={memberVotes}
                  sessionContext={selectedSession}
                />
              )}
            </div>
          )}

          {/* ─────────────────────────────────────────────
              SPONSORED BILLS TAB
              Same card list that used to live below the stat strip — moved
              here unchanged so the visual + click target stays consistent.
              ───────────────────────────────────────────── */}
          {activeTab === 'bills' && (
            <>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                Sponsored Bills · {selectedSession === 'all' ? 'All Sessions' : selectedSession}
              </div>

              {billsLoading ? (
                <VectorLoader label="Loading sponsored bills" size="sm" />
              ) : memberBills.map((bill, idx) => (
                <Link
                  key={bill.bill_id}
                  href={`/bill/${bill.bill_id}`}
                  prefetch={false}
                  style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                    cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                    marginBottom: 6, transition: 'border-color 0.2s',
                    animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
                    textDecoration: 'none', color: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                      <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>{STAGE_LABELS[bill.stage] || 'Intro'}</span>
                      {selectedSession === 'all' && bill.session && (
                        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--teal)', opacity: 0.7 }}>{bill.session}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      {bill.committee_name || 'No committee assigned'}
                      {bill.committee_passed && <span style={{ marginLeft: 8, color: 'var(--teal)', fontWeight: 600 }}>Comm. Pass</span>}
                      {bill.has_public_hearing && <span style={{ marginLeft: 8, color: 'var(--teal-mid)' }}>● Hearing</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
        {!viewerLoading && !isAnonPublic && <Nav/>}
      </div>
    )
  }

  // ── MEMBERS LIST VIEW ────────────────────────────────
  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
      {/* Phase 12 Batch 6 — PublicNav for anon when flag is on */}
      {isAnonPublic && <PublicNav />}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 16px 14px' : '52px 16px 14px',
        position: 'sticky', top: isAnonPublic ? 60 : 0, zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
            Members
          </div>
          <DropdownMenu
            value={selectedSession}
            onChange={v => { setSelectedSession(v); setSelected(null); setMemberBills([]) }}
            options={[
              ...SESSIONS.map(s => ({ value: s, label: s })),
              { value: 'all', label: 'All Sessions' },
            ]}
            ariaLabel="Session selector"
            triggerStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '5px 28px 5px 10px',
              fontSize: 11,
              color: 'var(--teal)',
              fontFamily: 'var(--font-mono)',
              minHeight: 28,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {filtered.length} legislators · {selectedSession === 'all' ? 'Career View' : selectedSession}
          </div>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 2 }}>
            {[
              { key: 'list', label: 'List', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg> },
              { key: 'heatmap', label: 'Heatmap', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
            ].map(v => (
              <button key={v.key} onClick={() => setViewMode(v.key)} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
                fontSize: 10, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: viewMode === v.key ? 'var(--bg-surface)' : 'transparent',
                color: viewMode === v.key ? 'var(--teal)' : 'var(--text-faint)',
                transition: 'all 0.15s',
              }}>{v.icon}{v.label}</button>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name..."
            style={{
              width: '100%', padding: '9px 12px 9px 32px',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 13,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {['All', 'House', 'Senate'].map(c => (
            <button key={c} onClick={() => setChamber(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: chamber === c ? 'var(--bg-surface)' : 'transparent',
              color: chamber === c ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${chamber === c ? 'var(--border-light)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{c}</button>
          ))}
          <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }}/>
          {['All', 'D', 'R'].map(p => (
            <button key={p} onClick={() => setParty(p)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: party === p ? (p === 'D' ? 'rgba(30,100,200,0.2)' : p === 'R' ? 'rgba(200,50,50,0.2)' : 'var(--bg-surface)') : 'transparent',
              color: party === p ? (p === 'D' ? 'var(--party-d)' : p === 'R' ? 'var(--party-r)' : 'var(--text-primary)') : 'var(--text-muted)',
              border: `1px solid ${party === p ? 'transparent' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{p === 'D' ? 'Dem' : p === 'R' ? 'Rep' : 'All'}</button>
          ))}
        </div>
      </div>

      {/* ── HEATMAP VIEW ──────────────────────────────── */}
      {viewMode === 'heatmap' && (
        <div style={{ padding: '12px 16px' }} onClick={() => setPopover(null)}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading members...</div>
          ) : (() => {
            const withEff = filtered.map(m => ({ ...m, effectiveness: computeEffectiveness(m) }))
              .sort((a, b) => b.effectiveness - a.effectiveness)
            const houseMembers = chamber === 'Senate' ? [] : withEff.filter(m => m.chamber === 'House')
            const senateMembers = chamber === 'House' ? [] : withEff.filter(m => m.chamber === 'Senate')

            const renderCell = (m) => {
              const { bg, text } = effColor(m.effectiveness)
              const initials = m.name.split(' ').map(n => n[0]).slice(-2).join('')
              const isActive = popover && popover.name === m.name
              return (
                <div
                  key={m.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isActive) { selectMember(m); setPopover(null) }
                    else {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setPopover({ name: m.name, member: m, x: rect.left + rect.width / 2, y: rect.top })
                    }
                  }}
                  style={{
                    // Thread 15.5: cell grew 40→48 so the corner score glyph
                    // can render at 11px without colliding with the centered
                    // initials. Mobile-only — still fits 4 cells per chamber
                    // column at the 480px column width.
                    width: 48, height: 48, borderRadius: 6,
                    background: bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', position: 'relative',
                    border: isActive ? '1.5px solid var(--teal)' : '1px solid rgba(255,255,255,0.06)',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    fontSize: 11, fontWeight: 700, color: text,
                    fontFamily: 'var(--font-mono)',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                    zIndex: isActive ? 10 : 1,
                    boxShadow: isActive ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
                  }}
                  onMouseEnter={e => { if (!popover) { e.currentTarget.style.transform = 'scale(1.12)'; e.currentTarget.style.zIndex = '10' }}}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.zIndex = '1' }}}
                >
                  {initials}
                  {m.is_chair && <div style={{
                    position: 'absolute', top: -3, right: -3,
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--gold)', border: '1.5px solid var(--bg)',
                  }}/>}
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1,
                    fontSize: 11, fontWeight: 700, color: 'var(--text-primary)',
                    background: 'rgba(14,16,20,0.92)', borderRadius: '4px 0 4px 0',
                    padding: '2px 4px', lineHeight: 1,
                  }}>{m.effectiveness}</div>
                </div>
              )
            }

            // ── TOP 5 CALLOUT ──
            const renderTop5 = (label, list) => {
              const top = list.slice(0, 5)
              if (!top.length) return null
              return (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Top {label}
                  </div>
                  {top.map((m, i) => {
                    const { bg, text } = effColor(m.effectiveness)
                    return (
                      <div key={m.name} onClick={() => selectMember(m)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                        borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                        background: i === 0 ? 'rgba(122,171,110,0.08)' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = i === 0 ? 'rgba(122,171,110,0.08)' : 'transparent'}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', width: 14, textAlign: 'right' }}>{i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                          {m.name}
                          {m.is_chair && <span style={{ fontSize: 7, marginLeft: 5, padding: '1px 4px', background: 'var(--gold-pale)', color: 'var(--gold)', borderRadius: 4, verticalAlign: 'middle' }}>CHAIR</span>}
                        </span>
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: text, fontWeight: 700 }}>{m.effectiveness}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{m.laws_passed}L · {m.committee_passes}C · {m.bill_count}B</span>
                      </div>
                    )
                  })}
                </div>
              )
            }

            const renderChamber = (label, list) => (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--text-faint)',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  marginBottom: 8, textAlign: 'center',
                }}>
                  {label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({list.length})</span>
                </div>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 3,
                  justifyContent: 'center',
                }}>
                  {list.map(renderCell)}
                </div>
              </div>
            )

            return (
              <>
                {/* Legend */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>LEGISLATIVE SUCCESS</span>
                  {/* Thread 22: tappable explainer toggle — closes the audit
                      ask for a tooltip on the heatmap composite. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLegendOpen(o => !o) }}
                    aria-expanded={legendOpen}
                    aria-label="What is the legislative success score?"
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: legendOpen ? 'var(--bg-surface)' : 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontSize: 9, fontWeight: 700, lineHeight: 1,
                      padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >?</button>
                  {[
                    { label: '55+', ...effColor(60) },
                    { label: '35–54', ...effColor(40) },
                    { label: '18–34', ...effColor(25) },
                    { label: '<18', ...effColor(10) },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: 11, height: 11, borderRadius: 2, background: l.bg, border: '1px solid rgba(255,255,255,0.06)' }}/>
                      {/* Thread 15.5: legend labels lifted 8→11 to match the
                          score-glyph bump inside cells. */}
                      <span style={{ fontSize: 11, color: l.text }}>{l.label}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--gold)' }}/>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Chair</span>
                  </div>
                </div>
                {/* Thread 22: legend explainer panel. Lives between the legend
                    strip and the per-cell tap hint so it doesn't push layout
                    when collapsed (it just doesn't render). */}
                {legendOpen && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      margin: '4px auto 8px',
                      maxWidth: 420,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', padding: '10px 12px',
                      fontSize: 11, lineHeight: 1.5, color: 'var(--text-mid)',
                    }}
                  >
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                      How the score is built
                    </div>
                    A composite weighted across four signals: <b>Position Power</b> (25% — sponsor tier + chair bonus), <b>Committee Pass Rate</b> (30% — % of sponsored bills clearing committee, the hardest chokepoint), <b>Law Rate</b> (25% — % signed into law), and <b>Avg Trajectory</b> (20% — mean bill quality). Members under 3 sponsored bills get a 40% volume penalty so a single lucky bill can't dominate the leaderboard.
                  </div>
                )}
                <div style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center', marginBottom: 14, opacity: 0.7 }}>
                  Tap cell for info · tap again to open detail
                </div>

                {/* Top 5 per chamber */}
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 14,
                  display: 'flex', gap: 16,
                }}>
                  {houseMembers.length > 0 && <div style={{ flex: 1 }}>{renderTop5('House', houseMembers)}</div>}
                  {houseMembers.length > 0 && senateMembers.length > 0 && (
                    <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }}/>
                  )}
                  {senateMembers.length > 0 && <div style={{ flex: 1 }}>{renderTop5('Senate', senateMembers)}</div>}
                </div>

                {/* Chamber grids */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {houseMembers.length > 0 && renderChamber('House', houseMembers)}
                  {houseMembers.length > 0 && senateMembers.length > 0 && (
                    <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', flexShrink: 0 }}/>
                  )}
                  {senateMembers.length > 0 && renderChamber('Senate', senateMembers)}
                </div>

                {/* Summary stats */}
                <div style={{
                  marginTop: 16, padding: '10px 14px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'center', gap: 24,
                }}>
                  {[
                    { label: 'High (55+)', count: withEff.filter(m => m.effectiveness >= 55).length, color: 'rgba(122,171,110,0.9)' },
                    { label: 'Moderate', count: withEff.filter(m => m.effectiveness >= 35 && m.effectiveness < 55).length, color: 'rgba(58,122,138,0.9)' },
                    { label: 'Low', count: withEff.filter(m => m.effectiveness >= 18 && m.effectiveness < 35).length, color: 'rgba(196,122,48,0.9)' },
                    { label: 'Very Low', count: withEff.filter(m => m.effectiveness < 18).length, color: 'rgba(138,128,112,0.7)' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

          {/* ── POPOVER (appears above tapped cell) ── */}
          {popover && (() => {
            const m = popover.member
            const { bg, text, label: tierLbl } = effColor(m.effectiveness)
            const tierInfo = tierLabel(m.tier)
            return (
              <div style={{
                position: 'fixed', zIndex: 100,
                left: Math.min(Math.max(popover.x - 110, 8), window.innerWidth - 228),
                top: Math.max(popover.y - 110, 8),
                width: 220, padding: '10px 12px',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                      {m.chamber} · {m.party === 'D' ? 'Dem' : m.party === 'R' ? 'Rep' : m.party}
                      {m.is_chair && ' · Chair'}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)',
                    color: text, lineHeight: 1,
                  }}>{m.effectiveness}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: bg, color: text }}>{tierLbl}</span>
                  <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: tierInfo.bg, color: tierInfo.color, border: `1px solid ${tierInfo.border}` }}>{tierInfo.text}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4, marginBottom: 8 }}>
                  {[
                    { v: m.bill_count, l: 'Bills' },
                    { v: m.committee_passes, l: 'Cmte' },
                    { v: m.laws_passed, l: 'Laws' },
                    { v: m.avg_score, l: 'Avg' },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>{s.v}</div>
                      <div style={{ fontSize: 7, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => { selectMember(m); setPopover(null) }} style={{
                  width: '100%', padding: '6px 0', border: '1px solid rgba(184,151,90,0.3)',
                  borderRadius: 6, background: 'rgba(184,151,90,0.08)', color: 'var(--teal)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>View Full Profile</button>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── LIST VIEW ──────────────────────────────── */}
      {viewMode === 'list' && <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading members...</div>
        ) : filtered.map((member, idx) => {
          const scoreColor = member.avg_score >= 50 ? 'var(--teal)' : member.avg_score >= 35 ? 'var(--gold)' : 'var(--text-muted)'
          return (
            <div
              key={member.name}
              onClick={() => selectMember(member)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '12px 14px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                transition: 'border-color 0.2s',
                animation: `fadeUp 0.25s ease ${Math.min(idx * 0.02, 0.5)}s both`,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: member.party === 'D' ? 'var(--party-d-pale)' : member.party === 'R' ? 'var(--party-r-pale)' : 'var(--bg-surface)',
                border: `1.5px solid ${member.party === 'D' ? 'var(--party-d-border)' : member.party === 'R' ? 'var(--party-r-border)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                color: member.party === 'D' ? 'var(--party-d)' : member.party === 'R' ? 'var(--party-r)' : 'var(--text-muted)',
              }}>
                {member.name.split(' ').map(n => n[0]).slice(-2).join('')}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{member.name}</span>
                  {member.is_chair && (
                    <span style={{ fontSize: 8, padding: '1px 5px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 6 }}>
                      Chair
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {member.chamber === 'House' ? 'House' : 'Senate'} ·{' '}
                  {member.party === 'D' ? 'Democrat' : member.party === 'R' ? 'Republican' : member.party}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: scoreColor, textShadow: scoreColor === 'var(--teal)' ? '0 0 6px rgba(184,151,90,0.3)' : 'none' }}>
                  {member.avg_score}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  avg · {member.bill_count} bills
                </div>
              </div>

              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          )
        })}
      </div>}
      {!viewerLoading && !isAnonPublic && <Nav/>}
    </div>
  )
}

// Thread 12.2: Suspense wrapper required by Next 16 for any component
// that calls useSearchParams(). Mirrors the SearchPage pattern.
export default function MembersPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading members...</div>}>
      <MembersContent />
    </Suspense>
  )
}
