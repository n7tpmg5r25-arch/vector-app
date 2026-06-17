/**
 * Vector | WA — MemberBioSection component
 * Thread 113 (created) · Thread 114 (section prop) · Thread 124 (source attributions)
 * Thread 125: merged card, neutral chips, brass AI label, source citation, compliance pass
 *
 * Props:
 *   bio       — row from legislator_bios (or null)
 *   caucusUrl — caucus_url from legislator_bios; shown as "Source" citation
 *   section   — 'priorities' | 'background' | 'all' (default)
 *
 * section='all'         — single combined card: chips → AI summary → background facts
 * section='priorities'  — chips + AI summary only (PDF / standalone)
 * section='background'  — education / career / family only (PDF / standalone)
 */

'use client'

// Extract a clean domain label from a URL for display (e.g. "houserepublicans.wa.gov")
function sourceDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function MemberBioSection({ bio, caucusUrl, section = 'all' }) {
  if (!bio) return null

  const { bio_summary, education, occupation, family, first_elected_year, priorities } = bio
  const sourceUrl = caucusUrl || bio?.caucus_url || null

  // ER-B5 A10: reuse the corrections@vectorwa.com mailbox — same "Report a
  // discrepancy" affordance as the bill-summary disclosure (ER6/F10).
  // Obfuscated to keep it off naive scrapers. Honest disclosure: does NOT
  // imply human review or verification.
  const discrepancyMailto = `mailto:${'corrections' + '@' + 'vectorwa.com'}?subject=${encodeURIComponent('Vector | WA \u2014 possible discrepancy in a member bio')}`

  const hasEd   = education   && education.length > 0
  const hasOcc  = occupation  && occupation.length > 0
  const hasPrio = priorities  && priorities.length > 0
  const hasBio  = !!bio_summary
  const hasBg   = hasEd || hasOcc || !!first_elected_year  // family excluded — private individuals

  // ── AI label chip — reused across sections ─────────────────────────────────
  // ER-B5 A10: softened from a brass "AI Generated" badge to a neutral grey
  // "AI Summary" pill, matching the bill-summary disclosure tone (ER6/F10).
  const AiChip = () => (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 8,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '2px 7px',
      borderRadius: 4,
      background: 'rgba(100,120,140,0.08)',
      color: 'var(--text-faint)',
      border: '1px solid rgba(100,120,140,0.2)',
    }}>
      AI Summary
    </span>
  )

  // ── "Report a discrepancy" affordance — parity with bill summaries ─────────
  const DiscrepancyLink = ({ extraStyle }) => (
    <a
      href={discrepancyMailto}
      onClick={e => e.stopPropagation()}
      style={{
        fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
        textDecoration: 'underline', letterSpacing: '0.02em', ...extraStyle,
      }}
    >
      Report a discrepancy
    </a>
  )

  // ── Source citation line ────────────────────────────────────────────────────
  const SourceLine = ({ extraStyle }) => sourceUrl ? (
    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em', ...extraStyle }}>
      Source:{' '}
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
      >
        {sourceDomain(sourceUrl)}
      </a>
    </div>
  ) : null

  // ── section="priorities": chips + AI bio summary ───────────────────────────
  if (section === 'priorities') {
    if (!hasPrio && !hasBio) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            Legislative Focus
          </div>
        </div>
        {hasPrio && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
              {priorities.slice(0, 6).map((p, i) => (
                <span key={i} style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  letterSpacing: '0.05em', padding: '3px 8px', borderRadius: 6,
                  background: 'var(--bg)', color: 'var(--text-mid)',
                  border: '1px solid var(--border)', textTransform: 'uppercase',
                }}>
                  {p}
                </span>
              ))}
            </div>
            <SourceLine extraStyle={{ marginBottom: hasBio ? 8 : 0 }} />
          </>
        )}
        {hasBio && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65, borderTop: hasPrio ? '1px solid var(--border)' : 'none', paddingTop: hasPrio ? 8 : 0 }}>
            {bio_summary}
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <AiChip />
              <SourceLine extraStyle={{ display: 'inline' }} />
              <DiscrepancyLink />
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            Background
          </div>
          <SourceLine extraStyle={{}} />
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
      </div>
    )
  }

  // ── section="all" (default) — single combined card ─────────────────────────
  if (!hasPrio && !hasBio && !hasBg) return null

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>

      {/* Card header: eyebrow + AI chip + source */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', flex: 1 }}>
          Profile
        </div>
        <AiChip />
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              fontSize: 8,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-faint)',
              textDecoration: 'underline',
              letterSpacing: '0.04em',
            }}
          >
            Source: {sourceDomain(sourceUrl)}
          </a>
        )}
        <DiscrepancyLink />
      </div>

      {/* Legislative Focus chips */}
      {hasPrio && (
        <div style={{ marginBottom: hasBio || hasBg ? 10 : 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>Legislative Focus</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {priorities.slice(0, 6).map((p, i) => (
              <span key={i} style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                letterSpacing: '0.05em', padding: '3px 8px', borderRadius: 6,
                background: 'var(--bg)', color: 'var(--text-mid)',
                border: '1px solid var(--border)', textTransform: 'uppercase',
              }}>
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI bio summary */}
      {hasBio && (
        <div style={{
          fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65,
          borderTop: hasPrio ? '1px solid var(--border)' : 'none',
          paddingTop: hasPrio ? 10 : 0,
          marginBottom: hasBg ? 10 : 0,
        }}>
          {bio_summary}
        </div>
      )}

      {/* Background: education / career / family */}
      {hasBg && (
        <div style={{ borderTop: (hasPrio || hasBio) ? '1px solid var(--border)' : 'none', paddingTop: (hasPrio || hasBio) ? 10 : 0 }}>
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
        </div>
      )}
    </div>
  )
}
