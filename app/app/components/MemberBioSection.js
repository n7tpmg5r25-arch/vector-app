/**
 * Vector | WA — MemberBioSection component
 * Thread 113 (created) · Thread 114 (section prop) · Thread 124 (source attributions + hotfix)
 *
 * Props:
 *   bio     — row from legislator_bios table (or null)
 *   section — 'priorities' | 'background' | 'all' (default)
 *
 * section='priorities'  → Legislative Focus chips + AI bio summary
 * section='background'  → Background block (education / career / family)
 * section='all'         → Everything in one card (backward compat for PDF)
 */

'use client'

export default function MemberBioSection({ bio, section = 'all' }) {
  if (!bio) return null

  const { bio_summary, education, occupation, family, first_elected_year, priorities } = bio

  const hasEd   = education   && education.length > 0
  const hasOcc  = occupation  && occupation.length > 0
  const hasPrio = priorities  && priorities.length > 0
  const hasBio  = !!bio_summary

  // ── section="priorities": chips + bio_summary ──────────────────────────────
  if (section === 'priorities') {
    if (!hasPrio && !hasBio) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
          Legislative Focus
        </div>
        {hasPrio && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: hasBio ? 10 : 0 }}>
            {priorities.slice(0, 6).map((p, i) => (
              <span key={i} style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(184,151,90,0.08)',
                color: 'var(--teal)',
                border: '1px solid rgba(184,151,90,0.25)',
                textTransform: 'uppercase',
              }}>
                {p}
              </span>
            ))}
          </div>
        )}
        {/* Thread 124: source attribution for topic chips */}
        {hasPrio && (
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: hasBio ? 0 : 6, marginBottom: hasBio ? 8 : 0, letterSpacing: '0.02em' }}>
            Topics identified from member's official biography
          </div>
        )}
        {hasBio && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, fontStyle: 'italic', borderTop: hasPrio ? '1px solid var(--border)' : 'none', paddingTop: hasPrio ? 8 : 0 }}>
            {bio_summary}
            {/* Thread 124: source attribution for AI summary */}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6, fontStyle: 'normal', letterSpacing: '0.02em' }}>
              AI summary of public biography
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── section="background": education + career + family ─────────────────────
  if (section === 'background') {
    if (!hasEd && !hasOcc && !family && !first_elected_year) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
          Background
        </div>
        {hasEd && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Education</div>
            {education.slice(0, 3).map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {[e.school, e.degree && e.field ? `${e.degree} ${e.field}` : (e.degree || e.field), e.year].filter(Boolean).join(' · ')}
              </div>
            ))}
          </div>
        )}
        {(hasOcc || first_elected_year) && (
          <div style={{ marginBottom: family ? 8 : 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Career</div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {hasOcc && occupation.slice(0, 4).join('  ·  ')}
              {first_elected_year && (
                <span style={{ color: 'var(--text-muted)' }}>
                  {hasOcc ? '  ·  ' : ''}Legislature since {first_elected_year}
                </span>
              )}
            </div>
          </div>
        )}
        {family && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Family</div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{family}</div>
          </div>
        )}
      </div>
    )
  }

  // ── section="all" (default) — backward compat for PDF etc. ─────────────────
  if (!hasEd && !hasOcc && !hasPrio && !hasBio && !family && !first_elected_year) return null

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 9,
        color: 'var(--text-faint)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
        marginBottom: 10,
      }}>
        Background
      </div>

      {hasEd && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Education</div>
          {education.slice(0, 3).map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {[e.school, e.degree && e.field ? `${e.degree} ${e.field}` : (e.degree || e.field), e.year].filter(Boolean).join(' · ')}
            </div>
          ))}
        </div>
      )}

      {(hasOcc || first_elected_year) && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Career</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {hasOcc && occupation.slice(0, 4).join('  ·  ')}
            {first_elected_year && (
              <span style={{ color: 'var(--text-muted)' }}>
                {hasOcc ? '  ·  ' : ''}Legislature since {first_elected_year}
              </span>
            )}
          </div>
        </div>
      )}

      {family && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Family</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{family}</div>
        </div>
      )}

      {hasPrio && (
        <div style={{ marginBottom: hasBio ? 8 : 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>Legislative Focus</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {priorities.slice(0, 6).map((p, i) => (
              <span key={i} style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(184,151,90,0.08)',
                color: 'var(--teal)',
                border: '1px solid rgba(184,151,90,0.25)',
                textTransform: 'uppercase',
              }}>
                {p}
              </span>
            ))}
          </div>
          {/* Thread 124: source attribution for topic chips */}
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6, letterSpacing: '0.02em' }}>
            Topics identified from member's official biography
          </div>
        </div>
      )}

      {hasBio && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          fontStyle: 'italic',
          borderTop: hasPrio ? '1px solid var(--border)' : 'none',
          paddingTop: hasPrio ? 8 : 0,
        }}>
          {bio_summary}
          {/* Thread 124: source attribution for AI summary */}
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6, fontStyle: 'normal', letterSpacing: '0.02em' }}>
            AI summary of public biography
          </div>
        </div>
      )}
    </div>
  )
}
