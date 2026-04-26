'use client'

import { POSITION_TIER_SCORES, CHAIR_BONUS, COMPOSITE_WEIGHTS, LOW_VOLUME_THRESHOLD, LOW_VOLUME_PENALTY, TIER_LABELS } from '../../lib/members-scoring'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, getAllSessions } from '../../lib/session-config'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'
import VoteHistoryTable from '../components/VoteHistoryTable'

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
  const { user, publicLayerEnabled } = useViewer()
  const isAnonPublic = publicLayerEnabled && !user
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
  const [votesLoading, setVotesLoading]   = useState(false)
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
  const loadMemberVotes = useCallback(async (m) => {
    setVotesLoading(true)
    setMemberVotes([])
    if (!m?.name) { setVotesLoading(false); return }

    // ── Step 1: resolve member_id via legislator_party_history. ──
    // Match on (full_name, agency); take the most-recent biennium so a
    // returning legislator gets the correct current-session identity.
    const { data: roster } = await supabase
      .from('legislator_party_history')
      .select('member_id, party, biennium, full_name, agency')
      .eq('full_name', m.name)
      .eq('agency', m.chamber)
      .order('biennium', { ascending: false })
      .limit(1)

    const rosterRow = roster && roster.length > 0 ? roster[0] : null
    const memberId  = rosterRow?.member_id || null

    // ── Step 2: pull member_vote rows. Prefer member_id; fall back to
    //           surname+chamber if the roster lookup missed. ──
    let rawVotes = null
    if (memberId) {
      const { data } = await supabase
        .from('member_votes')
        .select('roll_call_id, member_id, member_name, vote, party')
        .eq('member_id', memberId)
      rawVotes = data
    } else {
      const lastName = m.name.trim().split(/\s+/).pop()
      const { data } = await supabase
        .from('member_votes')
        .select('roll_call_id, member_id, member_name, vote, party')
        .eq('member_name', lastName)
      rawVotes = data
    }
    if (!rawVotes || rawVotes.length === 0) { setVotesLoading(false); return }

    // ── Step 3: pull roll_calls (chamber-filtered) for those vote rows. ──
    const rcIds = [...new Set(rawVotes.map(v => v.roll_call_id))]
    const { data: rolls } = await supabase
      .from('roll_calls')
      .select('id, bill_id, chamber, vote_date, motion, yeas, nays, absent, excused, result')
      .in('id', rcIds)
      .eq('chamber', m.chamber)
      .order('vote_date', { ascending: false })
    if (!rolls || rolls.length === 0) { setVotesLoading(false); return }

    // ── Step 4: fetch bill metadata for the surviving roll_calls' bills. ──
    const billIds = [...new Set(rolls.map(r => r.bill_id))]
    let billMeta = {}
    if (billIds.length > 0) {
      const billQuery = supabase
        .from('bills')
        .select('bill_id, bill_number, title, chamber, session, outcome_passed_law')
        .in('bill_id', billIds)
      const { data: billRows } = selectedSession === 'all'
        ? await billQuery
        : await billQuery.eq('session', selectedSession)
      for (const b of (billRows || [])) billMeta[b.bill_id] = b
    }

    // ── Step 5: stitch and apply the session filter via bill presence. ──
    const rcById = Object.fromEntries(rolls.map(r => [r.id, r]))
    const stitched = rawVotes
      .map(v => {
        const rc = rcById[v.roll_call_id]
        if (!rc) return null
        const bill = billMeta[rc.bill_id]
        if (!bill) return null  // selectedSession filtered it out
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
      .slice(0, 100)  // most-recent 100 votes; full-history toggle is Thread 11.2 work

    setMemberVotes(stitched)
    setVotesLoading(false)
  }, [supabase, selectedSession])

  function selectMember(m) {
    setSelected(m)
    loadMemberBills(m.name)
    loadMemberVotes(m)
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
            <button
              onClick={() => { setSelected(null); setMemberBills([]) }}
              style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--teal)', cursor: 'pointer', marginBottom: 12, padding: 0 }}
            >← Members</button>

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
                    leg.wa.gov ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
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

          {/* Per-biennium breakdown when viewing All Sessions */}
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

          {selectedMember.committees && selectedMember.committees.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Committee Affiliations
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

          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
            Sponsored Bills · {selectedSession === 'all' ? 'All Sessions' : selectedSession}
          </div>

          {billsLoading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
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
                  {bill.committee_passed && <span style={{ marginLeft: 8, color: 'var(--teal)', fontWeight: 600 }}>✓ Pass</span>}
                  {bill.has_public_hearing && <span style={{ marginLeft: 8, color: 'var(--teal-mid)' }}>● Hearing</span>}
                </div>
              </div>
            </Link>
          ))}

          {/* ── Thread 11.1: Voting record ───────────────────
              Display-only (G5 frozen-engine). member_id resolved via the
              legislator_party_history roster cache; surname fallback only
              kicks in for legislators not yet in the roster (chamber-fenced
              so it can never lump two same-surname members together). */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Voting Record · {selectedSession === 'all' ? 'All Sessions' : selectedSession}
              <span style={{ marginLeft: 8, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
                ({memberVotes.length} most-recent votes)
              </span>
            </div>
            {votesLoading ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading voting record...</div>
            ) : (
              <VoteHistoryTable mode="by-member" byMemberRows={memberVotes} />
            )}
          </div>
        </div>
        {!isAnonPublic && <Nav/>}
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
          <select
            value={selectedSession}
            onChange={e => { setSelectedSession(e.target.value); setSelected(null); setMemberBills([]) }}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '5px 10px', fontSize: 11,
              color: 'var(--teal)', fontFamily: 'var(--font-mono)',
              cursor: 'pointer', outline: 'none',
            }}
          >
            {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="all">All Sessions</option>
          </select>
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
              color: party === p ? (p === 'D' ? '#4d9aff' : p === 'R' ? '#ff6b6b' : 'var(--text-primary)') : 'var(--text-muted)',
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
                    width: 40, height: 40, borderRadius: 6,
                    background: bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', position: 'relative',
                    border: isActive ? '1.5px solid var(--teal)' : '1px solid rgba(255,255,255,0.06)',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    fontSize: 10, fontWeight: 700, color: text,
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
                    fontSize: 7, fontWeight: 600, color: 'var(--text-faint)',
                    background: 'rgba(14,16,20,0.85)', borderRadius: '4px 0 4px 0',
                    padding: '1px 3px', lineHeight: 1,
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
                  {[
                    { label: '55+', ...effColor(60) },
                    { label: '35–54', ...effColor(40) },
                    { label: '18–34', ...effColor(25) },
                    { label: '<18', ...effColor(10) },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: l.bg, border: '1px solid rgba(255,255,255,0.06)' }}/>
                      <span style={{ fontSize: 8, color: l.text }}>{l.label}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)' }}/>
                    <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>Chair</span>
                  </div>
                </div>
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
                background: member.party === 'D' ? 'rgba(30,100,200,0.12)' : member.party === 'R' ? 'rgba(200,50,50,0.12)' : 'var(--bg-surface)',
                border: `1.5px solid ${member.party === 'D' ? 'rgba(77,154,255,0.3)' : member.party === 'R' ? 'rgba(255,107,107,0.3)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                color: member.party === 'D' ? '#4d9aff' : member.party === 'R' ? '#ff6b6b' : 'var(--text-muted)',
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
      {!isAnonPublic && <Nav/>}
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
