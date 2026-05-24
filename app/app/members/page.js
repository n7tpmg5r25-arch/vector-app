'use client'

import { POSITION_TIER_SCORES, CHAIR_BONUS, COMPOSITE_WEIGHTS, LOW_VOLUME_THRESHOLD, LOW_VOLUME_PENALTY, TIER_LABELS } from '../../lib/members-scoring'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, getAllSessions, bienniumShortLabel } from '../../lib/session-config'
import { useSession } from '../../lib/useSession'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'
import VoteHistoryTable from '../components/VoteHistoryTable'
import VotingRecordHeader from '../components/VotingRecordHeader'
import DropdownMenu from '../components/DropdownMenu'
import VectorLoader from '../components/VectorLoader'
import { ArrowUpRight, Printer, Phone, Mail } from 'lucide-react'
import MemberBioSection from '../components/MemberBioSection'

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
  // Thread 83: global session from drawer; showAllSessions is members-specific
  // career-view toggle (aggregates all biennia, never stored globally).
  const [selectedSession, setSession] = useSession()
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [viewMode, setViewMode]             = useState('list') // 'list' | 'heatmap'
  // Thread 69 (2026-05-04): true when the selected biennium has enough roll-call
  // data to derive "currently seated" reliably — drives the "active legislators"
  // label vs. the historical "legislators served" label for past biennia.
  const [hasActiveSignal, setHasActiveSignal] = useState(false)
  // Thread 112: PDF card generation state
  const [pdfLoading, setPdfLoading] = useState(false)
  // Thread 113: biographical data from legislator_bios table
  const [memberBio, setMemberBio] = useState(null)
  // Thread 124: committee seat memberships for selected member (null=loading, []=loaded)
  const [memberCommittees, setMemberCommittees] = useState(null)
  // T126: election results for electoral margin display (null=loading, []=loaded/none)
  const [memberElections, setMemberElections] = useState(null)
  // T128: heroNameRef + stickyName removed — full-hero sticky replaces condensed bar

  useEffect(() => {
    async function load() {
      setLoading(true)
      const isAll = showAllSessions

      // Thread 69 (2026-05-04): server-side aggregation via v_member_stats_by_session.
      // Replaces the previous client-side reduce over raw bills, which was hitting
      // PostgREST's 1000-row default cap and silently truncating to ~1000 of 3,411
      // bills in 2025-2026 — causing the {N} legislators counter to oscillate
      // 146/147/148 across reloads (different physical-row slice each time).
      //
      // The view returns one row per (session, prime_sponsor) with all the stats
      // we used to compute in JS, plus a `currently_seated` flag derived from
      // roll-call recency (member voted in any of the last 30 days of the most
      // recent session in the biennium = currently seated). For 2025-2026 that
      // produces 98 House + 49 Senate = 147 exactly. Bill Ramos (replaced by Hunt)
      // and Tana Senn (replaced by Zahn) — both prime-sponsored bills before
      // resigning — drop out automatically.
      //
      // Past biennia (2021-22, 2023-24) have no roll-call data synced yet
      // (VOTE_DATA_FIRST_SESSION='2025-2026'), so biennium_has_vote_data is false
      // for them — we fall back to showing the full historical sponsor roster
      // for those sessions, with the count labeled "served" instead of "active".
      const baseSelect = 'session, name, party, chamber, member_id, district, bill_count, committee_passes, hearing_count, laws_passed, avg_score, top_score, is_chair, tier, committees, pass_rate, currently_seated, biennium_has_vote_data, phone, email'

      let rows = []
      if (isAll) {
        const { data } = await supabase
          .from('v_member_stats_by_session')
          .select(baseSelect)
          .in('session', SESSIONS)
        rows = data || []
      } else {
        const { data } = await supabase
          .from('v_member_stats_by_session')
          .select(baseSelect)
          .eq('session', selectedSession)
        rows = data || []
      }

      if (!rows.length) { setMembers([]); setLoading(false); return }

      // Single-session: filter to currently_seated when the biennium has reliable
      // roll-call data; otherwise show all sponsors who served. "All Sessions" is
      // a career view by design, so no active-filter is applied — we want
      // historical legislators visible there.
      let filteredRows = rows
      const hasVoteData = !isAll && rows.some(r => r.biennium_has_vote_data)
      if (hasVoteData) filteredRows = rows.filter(r => r.currently_seated)
      setHasActiveSignal(hasVoteData)

      // Single-session shape: one row per legislator, with a synthetic single-key
      // bySession map so downstream detail views keep working.
      // All-Sessions shape: group by name across biennia, sum stats, build a real
      // bySession breakdown with per-biennium fields.
      let list
      if (!isAll) {
        list = filteredRows.map(r => ({
          name: r.name,
          party: r.party || '?',
          chamber: r.chamber || '?',
          is_chair: !!r.is_chair,
          tier: r.tier ?? 3,
          bill_count: r.bill_count || 0,
          committee_passes: r.committee_passes || 0,
          hearing_count: r.hearing_count || 0,
          laws_passed: r.laws_passed || 0,
          top_score: r.top_score || 0,
          avg_score: r.avg_score || 0,
          pass_rate: r.pass_rate || 0,
          member_id: r.member_id || null,
          phone: r.phone || null,
          email: r.email || null,
          committees: r.committees || [],
          bySession: {
            [r.session]: {
              bill_count: r.bill_count || 0,
              committee_passes: r.committee_passes || 0,
              laws_passed: r.laws_passed || 0,
              avg_score: r.avg_score || 0,
              pass_rate: r.pass_rate || 0,
            },
          },
        })).sort((a, b) => b.bill_count - a.bill_count)
      } else {
        const byName = {}
        for (const r of filteredRows) {
          const m = byName[r.name] = byName[r.name] || {
            name: r.name,
            party: r.party || '?',
            chamber: r.chamber || '?',
            is_chair: false,
            tier: 3,
            bill_count: 0,
            committee_passes: 0,
            hearing_count: 0,
            laws_passed: 0,
            top_score: 0,
            avg_score_weighted_sum: 0,  // for weighted recompute across biennia
            member_id: null,
            phone: null,
            email: null,
            committees: new Set(),
            bySession: {},
          }
          m.bill_count       += r.bill_count       || 0
          m.committee_passes += r.committee_passes || 0
          m.hearing_count    += r.hearing_count    || 0
          m.laws_passed      += r.laws_passed      || 0
          m.top_score         = Math.max(m.top_score, r.top_score || 0)
          if (r.is_chair) m.is_chair = true
          if (r.tier && r.tier < m.tier) m.tier = r.tier
          if (r.party && r.party !== '?') m.party = r.party
          if (r.chamber && r.chamber !== '?') m.chamber = r.chamber
          ;(r.committees || []).forEach(c => m.committees.add(c))
          if (r.member_id) m.member_id = r.member_id
          if (r.phone) m.phone = r.phone
          if (r.email) m.email = r.email
          // Weighted avg across biennia: sum(avg_i * bills_i) / sum(bills_i)
          m.avg_score_weighted_sum += (r.avg_score || 0) * (r.bill_count || 0)
          m.bySession[r.session] = {
            bill_count: r.bill_count || 0,
            committee_passes: r.committee_passes || 0,
            laws_passed: r.laws_passed || 0,
            avg_score: r.avg_score || 0,
            pass_rate: r.pass_rate || 0,
          }
        }
        list = Object.values(byName).map(m => ({
          ...m,
          committees: [...m.committees],
          avg_score: m.bill_count > 0 ? Math.round(m.avg_score_weighted_sum / m.bill_count) : 0,
          pass_rate: m.bill_count > 0 ? Math.round((m.committee_passes / m.bill_count) * 100) : 0,
        })).map(m => {
          const { avg_score_weighted_sum: _, ...rest } = m
          return rest
        }).sort((a, b) => b.bill_count - a.bill_count)
      }

      setMembers(list)
      setLoading(false)
    }
    load()
  }, [selectedSession, showAllSessions])

  const loadMemberBills = useCallback(async (name) => {
    setBillsLoading(true)
    const isAll = showAllSessions
    // T127: added `category` to SELECT so HIGH-tier category grouping works correctly
    const billSelect = 'bill_id, bill_number, title, final_score, stage, chamber, committee_name, committee_passed, has_public_hearing, bipartisan, hearing_date, status, confidence_label, session, outcome_passed_law, category'
    if (isAll) {
      let allData = []
      for (const s of SESSIONS) {
        const { data } = await supabase
          .from('bills')
          .select(billSelect)
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
        .select(billSelect)
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
      const isAll = showAllSessions
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

  const loadMemberCommittees = useCallback(async (m) => {
    setMemberCommittees(null)
    if (!m?.member_id) { setMemberCommittees([]); return }
    const { data, error } = await supabase
      .from('legislator_committee_seats')
      .select('committee_name, role')
      .eq('session', selectedSession)
      .eq('member_id', String(m.member_id))
      .order('committee_name')
    if (error) { console.warn('loadMemberCommittees:', error.message); setMemberCommittees([]); return }
    setMemberCommittees(data || [])
  }, [supabase, selectedSession])

  function selectMember(m) {
    setSelected(m)
    setActiveTab('overview')  // Thread 22: each open lands on Overview
    setMemberBio(null)        // Thread 113: clear previous member's bio
    setMemberElections(null)  // T126: clear previous election data
    loadMemberBills(m.name)
    loadMemberVotes(m)
    loadMemberCommittees(m)  // Thread 124: real seat membership data
    // Thread 113: fetch bio data from legislator_bios
    // T127: added leadership_role to select
    if (m.member_id) {
      supabase
        .from('legislator_bios')
        .select('bio_summary, education, occupation, family, first_elected_year, priorities, caucus_url, leadership_role')
        .eq('member_id', m.member_id)
        .maybeSingle()
        .then(({ data }) => setMemberBio(data || null))
      // T126: fetch election results for electoral margin display
      supabase
        .from('legislator_elections')
        .select('election_year, vote_pct, margin_pct, opponent_name, total_votes, unopposed')
        .eq('member_id', m.member_id)
        .order('election_year', { ascending: false })
        .limit(3)
        .then(({ data }) => setMemberElections(data || []))
    } else {
      setMemberElections([])
    }
  }
  // Thread 22: shared close handler. Inline rather than goBackOrFallback()
  // because the detail is a state-toggle on the same /members route — there
  // is no separate URL to back-navigate from. Keeps the existing UX.
  function closeDetail() {
    setSelected(null)
    setMemberBills([])
    setMemberVotes([])
    setPartyBucketsByRcId({})
    setMemberBio(null)        // Thread 113
    setMemberCommittees(null) // Thread 124
    setMemberElections(null)  // T126
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

  // T128: sticky scroll logic removed — full-hero wrapper is always-sticky, no JS needed

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

        {/* T128: full sticky header — hero + tab strip locked as one unit.
            Replaces the condensed name bar (T124/T127). The entire hero
            section (back, photo, name, chips) stays visible while scrolling. */}
        <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)' }}>

        <div style={{
          background: 'var(--bg)',
          padding: '52px 20px 10px',
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
                width: 80, height: 80, borderRadius: '50%',
                border: `3px solid ${selectedMember.party === 'D' ? '#4d9aff' : selectedMember.party === 'R' ? '#ef4444' : 'var(--border)'}`,
                overflow: 'hidden', background: 'var(--bg-card)', flexShrink: 0,
              }}>
                <img
                  src={`https://leg.wa.gov/memberphoto/${selectedMember.member_id}.jpg`}
                  alt={selectedMember.name}
                  width={80}
                  height={80}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                  onError={e => {
                    e.target.style.display = 'none'
                    e.target.parentNode.insertAdjacentHTML('beforeend',
                      `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:20px;font-weight:700;color:var(--text-muted);font-family:var(--font-body)">${selectedMember.name.split(' ').map(n=>n[0]).slice(-2).join('')}</span>`
                    )
                  }}
                />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {selectedMember.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {selectedMember.chamber === 'House' ? 'State House' : 'State Senate'} ·{' '}
                  {selectedMember.party === 'D' ? 'Democrat' : selectedMember.party === 'R' ? 'Republican' : selectedMember.party}
                  {selectedMember.is_chair && ' · Committee Chair'}
                  {memberBio?.first_elected_year && ` · Since ${memberBio.first_elected_year}`}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>
                    {tier.text}
                  </span>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: 'var(--bg-surface)', color: 'var(--text-mid)', border: '1px solid var(--border)' }}>
                    {selectedMember.bill_count} bills sponsored
                  </span>
                  {/* T127: leadership role badge — only for named leadership positions */}
                  {memberBio?.leadership_role && (
                    <span style={{
                      fontSize: 9, padding: '3px 10px', borderRadius: 10,
                      background: 'rgba(184,151,90,0.12)', color: 'var(--teal)',
                      border: '1px solid rgba(184,151,90,0.35)',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
                    }}>
                      {memberBio.leadership_role}
                    </span>
                  )}
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
                  {/* Thread 112: Print Card — generates single-page PDF member brief */}
                  <button
                    disabled={pdfLoading}
                    onClick={async e => {
                      e.stopPropagation()
                      if (pdfLoading) return
                      setPdfLoading(true)
                      try {
                        const { generateMemberPdf } = await import('../../lib/generate-member-pdf')
                        await generateMemberPdf(selectedMember, memberBills, selectedSession, memberBio)
                      } catch (err) {
                        console.error('[Print Card] PDF generation failed:', err)
                      } finally {
                        setPdfLoading(false)
                      }
                    }}
                    style={{
                      fontSize: 9, padding: '3px 10px', borderRadius: 10,
                      background: pdfLoading ? 'var(--bg-surface)' : 'rgba(184,151,90,0.08)',
                      color: pdfLoading ? 'var(--text-muted)' : 'var(--teal)',
                      border: '1px solid rgba(184,151,90,0.2)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      cursor: pdfLoading ? 'default' : 'pointer',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    }}
                  >
                    <Printer size={9} aria-hidden="true" />
                    {pdfLoading ? 'Generating…' : 'Print Card'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── TAB STRIP — inside the sticky wrapper, no longer independently sticky */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
          marginBottom: 0,
          marginTop: 0,
          overflowX: 'auto',
          background: 'var(--bg)',
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
        </div>{/* end T128 sticky wrapper */}

        <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ─────────────────────────────────────────────
              OVERVIEW TAB
              T127: restructured into 3 tiers.
              Tier 1: contact + committee memberships (actionable, fast)
              Tier 2: HIGH-tier activity, voting pattern, bio (intelligence)
              Tier 3: bill funnel, career breakdown (deep dive)
              Removed: 4-stat strip, committee pass-rate gauge.
              Added: electoral margin card, party cohesion %.
              ───────────────────────────────────────────── */}
          {activeTab === 'overview' && (() => {
            // ── Thread 22 derived intelligence (computed every render — cheap;
            //    bills/votes already in memory, no extra queries). G5: pure.
            const sessionLabel = showAllSessions ? 'All Sessions' : selectedSession
            const bienShort = showAllSessions ? null : (bienniumShortLabel(selectedSession) || selectedSession)

            // Cross-pollination: HIGH-tier bills (final_score >= 75) the member
            // is sponsoring + grouped category counts. Primary lobbyist signal.
            // T127 fix: `category` now included in loadMemberBills SELECT.
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
            const crossPct    = contested > 0 ? Math.round((crossed / contested) * 100) : null
            const cohesionPct = crossPct !== null ? 100 - crossPct : null

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

            return (
              <>
                {/* ── Tier 1: Direct Contact ── */}
                {(selectedMember.phone || selectedMember.email) && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px',
                    display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', flexBasis: '100%' }}>
                      Direct Contact
                    </span>
                    {selectedMember.phone && (
                      <a
                        href={`tel:${selectedMember.phone.replace(/\D/g, '')}`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Phone size={11} color="var(--text-faint)" aria-hidden="true" />
                        {selectedMember.phone}
                      </a>
                    )}
                    {selectedMember.email && (
                      <a
                        href={`mailto:${selectedMember.email}`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Mail size={11} color="var(--text-faint)" aria-hidden="true" />
                        {selectedMember.email}
                      </a>
                    )}
                  </div>
                )}

                {/* ── Tier 1: Committee Memberships (moved up from bottom) ── */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                    Committee Memberships
                  </div>
                  {memberCommittees === null ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
                  ) : memberCommittees.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {selectedMember.member_id
                        ? `No seat data for ${selectedSession}`
                        : 'Seat data not available for this member'}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', marginBottom: 8 }}>
                        {selectedSession} · {memberCommittees.length} committee{memberCommittees.length === 1 ? '' : 's'}
                      </div>
                      {memberCommittees.map((seat, i) => (
                        <div key={seat.committee_name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                          <span style={{ fontSize: 12, flex: 1, color: seat.role === 'chair' ? 'var(--teal)' : 'var(--text-primary)' }}>
                            {seat.committee_name}
                          </span>
                          {seat.role === 'chair' && (
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--teal)', letterSpacing: '0.08em', padding: '2px 6px', background: 'rgba(184,151,90,0.1)', borderRadius: 4 }}>CHAIR</span>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* ── Tier 2: HIGH-tier sponsorship + categories ── */}
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
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.4 }}>
                      HIGH-tier = trajectory score ≥ 75. Historically ~5 in 6 HIGH bills become law (N=8,062, 3 bienniums).
                    </div>
                  </div>
                )}

                {/* ── Tier 2: Voting pattern — cohesion + cross-party ──
                    T127: merged cross-party signal + party cohesion % into
                    one card. Shows both: how often they vote with their own
                    party (cohesion) and how often they cross the aisle. */}
                {crossPct !== null && contested >= 5 && (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                      Voting Pattern
                    </div>
                    <div style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', lineHeight: 1 }}>
                          {cohesionPct}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>party cohesion</div>
                      </div>
                      <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }}/>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: oppParty === 'R' ? 'var(--party-r)' : 'var(--party-d)', lineHeight: 1 }}>
                          {crossPct}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                          crosses w/ {oppParty === 'D' ? 'Dems' : 'Reps'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontStyle: 'italic', lineHeight: 1.4 }}>
                      Based on {memberVotes.length} most-recent roll calls in {sessionLabel}. Contested = D and R majorities split ({contested} votes).
                    </div>
                  </div>
                )}

                {/* ── Tier 2: Bio card ── */}
                <MemberBioSection bio={memberBio} caucusUrl={memberBio?.caucus_url} />

                {/* ── Tier 3: Electoral record (T126 data) ── */}
                {memberElections && memberElections.length > 0 && (() => {
                  const recent = memberElections[0]
                  const prev   = memberElections[1] || null
                  return (
                    <div style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', padding: '12px 14px',
                    }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
                        Electoral Record
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', lineHeight: 1 }}>
                          {recent.unopposed ? 'Unopposed' : `${recent.vote_pct}%`}
                        </span>
                        {!recent.unopposed && recent.margin_pct != null && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            +{recent.margin_pct}pt margin
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                          {recent.election_year} general
                        </span>
                      </div>
                      {!recent.unopposed && recent.opponent_name && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          vs. {recent.opponent_name}
                          {recent.total_votes && (
                            <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>
                              {recent.total_votes.toLocaleString()} total votes
                            </span>
                          )}
                        </div>
                      )}
                      {prev && (
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                          {prev.election_year}: {prev.unopposed ? 'Unopposed' : `${prev.vote_pct}%`}
                          {!prev.unopposed && prev.margin_pct != null && ` (+${prev.margin_pct}pt)`}
                          {!prev.unopposed && prev.opponent_name && ` vs. ${prev.opponent_name}`}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── Tier 3: Stage funnel (with % labels) ── */}
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
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              {s.count}
                              <span style={{ color: 'var(--text-faint)', fontSize: 9, marginLeft: 4 }}>
                                ({Math.round(pct)}%)
                              </span>
                            </span>
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

                {/* ── Tier 3: Per-biennium career breakdown ── */}
                {showAllSessions && selectedMember.bySession && Object.keys(selectedMember.bySession).length > 1 && (
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
                scopeLabel={showAllSessions ? 'All Sessions' : selectedSession}
                count={memberVotes.length}
                showScopeStamp
              />
              {votesLoading ? (
                <VectorLoader label="Loading record…" size="sm" />
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
                Sponsored Bills · {showAllSessions ? 'All Sessions' : selectedSession}
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
                      {showAllSessions && bill.session && (
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
          {/* Thread 83: session picker moved to SideDrawer (global).
              Career View toggle is members-specific — aggregates all biennia. */}
          <button
            type="button"
            onClick={() => { setShowAllSessions(s => !s); setSelected(null); setMemberBills([]) }}
            style={{
              background: showAllSessions ? 'rgba(184,151,90,0.12)' : 'transparent',
              border: `1px solid ${showAllSessions ? 'rgba(184,151,90,0.50)' : 'var(--border)'}`,
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 11,
              color: showAllSessions ? 'var(--brass-light, var(--gold))' : 'var(--text-faint)',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'all 0.12s',
            }}
          >
            Career
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {/* Thread 69 (2026-05-04): label adapts to whether we have a reliable
                "currently seated" signal for the selected biennium. With vote
                data: "147 active legislators" (2025-2026, the canonical
                49 districts × 3 seats). Without: "{N} legislators" (the full
                historical sponsor roster, including any mid-biennium replacements). */}
            {filtered.length} {hasActiveSignal ? 'active legislators' : 'legislators'} · {showAllSessions ? 'Career View' : (selectedSession || getCurrentSession())}
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
            <VectorLoader label="Loading members" />
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
                    width: 48, height: 48, borderRadius: 6,
                    background: bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', position: 'relative',
                    border: isActive ? '2px solid var(--teal)' : `2px solid ${m.party === 'D' ? '#4d9aff' : m.party === 'R' ? '#ef4444' : 'rgba(255,255,255,0.06)'}`,
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                    zIndex: isActive ? 10 : 1,
                    boxShadow: isActive ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
                  }}
                  onMouseEnter={e => { if (!popover) { e.currentTarget.style.transform = 'scale(1.12)'; e.currentTarget.style.zIndex = '10' }}}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.zIndex = '1' }}}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: `2px solid ${m.party === 'D' ? '#4d9aff' : m.party === 'R' ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                    overflow: 'hidden', background: 'rgba(14,16,20,0.6)',
                    flexShrink: 0,
                  }}>
                    <img
                      src={`https://leg.wa.gov/memberthumbnail/${m.member_id}.jpg`}
                      alt={m.name}
                      width={32}
                      height={32}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
                      onError={e => {
                        e.target.style.display = 'none'
                        e.target.parentNode.insertAdjacentHTML('beforeend',
                          `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:10px;font-weight:700;color:${text};font-family:var(--font-mono)">${initials}</span>`
                        )
                      }}
                    />
                  </div>
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
                          {m.is_chair && <span style={{ fontSize: 9, marginLeft: 5, padding: '1px 4px', background: 'var(--gold-pale)', color: 'var(--gold)', borderRadius: 4, verticalAlign: 'middle' }}>CHAIR</span>}
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
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLegendOpen(o => !o) }}
                    aria-expanded={legendOpen}
                    aria-label="What is the legislative success score?"
                    style={{ padding: 15, margin: -15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: legendOpen ? 'var(--bg-surface)' : 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontSize: 9, fontWeight: 700, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'inherit', flexShrink: 0, pointerEvents: 'none',
                    }}>?</span>
                  </button>
                  {[
                    { label: '55+', ...effColor(60) },
                    { label: '35–54', ...effColor(40) },
                    { label: '18–34', ...effColor(25) },
                    { label: '<18', ...effColor(10) },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: 11, height: 11, borderRadius: 2, background: l.bg, border: '1px solid rgba(255,255,255,0.06)' }}/>
                      <span style={{ fontSize: 11, color: l.text }}>{l.label}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--gold)' }}/>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Chair</span>
                  </div>
                </div>
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
                left: 'calc(50vw - 160px)',
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
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: bg, color: text }}>{tierLbl}</span>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: tierInfo.bg, color: tierInfo.color, border: `1px solid ${tierInfo.border}` }}>{tierInfo.text}</span>
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
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{s.l}</div>
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
          <VectorLoader label="Loading members" />
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
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                border: `3px solid ${member.party === 'D' ? '#4d9aff' : member.party === 'R' ? '#ef4444' : 'var(--border)'}`,
                overflow: 'hidden', background: 'var(--bg-card)',
              }}>
                <img
                  src={`https://leg.wa.gov/memberthumbnail/${member.member_id}.jpg`}
                  alt={member.name}
                  width={36}
                  height={36}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
                  onError={e => {
                    e.target.style.display = 'none'
                    e.target.parentNode.insertAdjacentHTML('beforeend',
                      `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:12px;font-weight:700;color:${member.party === 'D' ? '#4d9aff' : member.party === 'R' ? '#ef4444' : 'var(--text-muted)'};font-family:var(--font-body)">${member.name.split(' ').map(n=>n[0]).slice(-2).join('')}</span>`
                    )
                  }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{member.name}</span>
                  {member.is_chair && (
                    <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 6 }}>
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

              <div style={{ padding: 16, margin: -16 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
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
    <Suspense fallback={<VectorLoader label="Loading members" />}>
      <MembersContent />
    </Suspense>
  )
}
