/**
 * Vector | WA — MemberBioSection component
 * Thread 113 (created) · Thread 114 (section prop) · Thread 124 (source attributions)
 * Thread 125 (hotfix 2): merged card, neutral chips, brass AI attribution
 *
 * Props:
 *   bio     — row from legislator_bios table (or null)
 *   section — 'priorities' | 'background' | 'all' (default)
 *
 * section='all' (default) — single combined card: chips → AI summary → background
 * section='priorities'    — chips + AI summary only (used by PDF, etc.)
 * section='background'    — background block only (education / career / family)
 */

'use client'

export default function MemberBioSection({ bio, section = 'all' }) {
  if (!bio) return null

  const { bio_summary, education, occupation, family, first_elected_year, priorities } = bio

  const hasEd   = education   && education.length > 0
  const hasOcc  = occupation  && occupation.length > 0
  const hasPrio = priorities  && priorities.length > 0
  const hasBio  = !!bio_summary
  const hasBg   = hasEd || hasOcc || !!family || !!first_elected_year

  // ── section="priorities": chips + AI bio summary (PDF / standalone use) ───
  if (section === 'priorities') {
    if (!hasPrio && !hasBio) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
          Legislative Focus
        </div>
        {hasPrio && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
              {priorities.slice(0, 6).map((p, i) => (
                <span key={i} style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text-mid)',
                  border: '1px solid var(--border)',
                  textTransform: 'uppercase',
                }}>
                  {p}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: hasBio ? 8 : 0, letterSpacing: '0.02em' }}>
              Topics identified from member's official biography
            </div>
          </>
        )}
        {hasBio && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, fontStyle: 'italic', borderTop: hasPrio ? '1px solid var(--border)' : 'none', paddingTop: hasPrio ? 8 : 0 }}>
            {bio_summary}
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', marginTop: 6, fontStyle: 'normal', letterSpacing: '0.02em', color: 'var(--teal)' }}>
              AI summary of public biography
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── section="background": education + career + family ─────────────────────
  if (section === 'background') {
    if (!hasBg) return null
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

  // ── section="all" (default) — single combined card ─────────────────────────
  const hasAnything = hasPrio || hasBio || hasBg
  if (!hasAnything) return null

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>

      {/* Legislative Focus chips */}
      {hasPrio && (
        <>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
            Legislative Focus
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {priorities.slice(0, 6).map((p, i) => (
              <span key={i} style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                padding: '3px 8px',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text-mid)',
                border: '1px solid var(--border)',
                textTransform: 'uppercase',
              }}>
                {p}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: hasBio || hasBg ? 10 : 0, letterSpacing: '0.02em' }}>
            Topics identified from member's official biography
          </div>
        </>
      )}

      {/* AI bio summary */}
      {hasBio && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          fontStyle: 'italic',
          borderTop: hasPrio ? '1px solid var(--border)' : 'none',
          paddingTop: hasPrio ? 10 : 0,
          marginBottom: hasBg ? 10 : 0,
        }}>
          {bio_summary}
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', marginTop: 6, fontStyle: 'normal', letterSpacing: '0.02em', color: 'var(--teal)' }}>
            AI summary of public biography
          </div>
        </div>
      )}

      {/* Background (education / career / family) */}
      {hasBg && (
        <div style={{ borderTop: (hasPrio || hasBio) ? '1px solid var(--border)' : 'none', paddingTop: (hasPrio || hasBio) ? 10 : 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
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
      )}
    </div>
  )
}
