/**
 * Vector | WA — MemberBioSection component
 * Thread 113 (created) · Thread 124 (source attributions)
 *
 * Drop this into the member detail panel in app/app/members/page.js.
 *
 * USAGE — add to imports at top of page.js:
 *   import MemberBioSection from '../components/MemberBioSection'
 *
 * USAGE — add bio state + fetch inside MembersPage component:
 *   const [memberBio, setMemberBio] = useState(null)
 *
 * USAGE — add to loadMemberBills() (or selectMember()):
 *   // fetch bio alongside bills
 *   const { data: bio } = await supabase
 *     .from('legislator_bios')
 *     .select('bio_summary, education, occupation, family, first_elected_year, priorities')
 *     .eq('member_id', m.member_id)
 *     .maybeSingle()
 *   setMemberBio(bio || null)
 *
 * USAGE — add to selectMember():
 *   setMemberBio(null)   // clear previous member's bio
 *
 * USAGE — place the component in the detail JSX, after the committees block,
 *   before the "Sponsored Bills" label:
 *   <MemberBioSection bio={memberBio} />
 *
 * USAGE — pass bio to generateMemberPdf:
 *   generateMemberPdf(selectedMember, memberBills, SESSION, memberBio)
 */

'use client'

export default function MemberBioSection({ bio }) {
  if (!bio) return null

  const { bio_summary, education, occupation, family, first_elected_year, priorities } = bio

  // Nothing to show
  const hasEd   = education   && education.length > 0
  const hasOcc  = occupation  && occupation.length > 0
  const hasPrio = priorities  && priorities.length > 0
  const hasBio  = !!bio_summary

  if (!hasEd && !hasOcc && !hasPrio && !hasBio && !family && !first_elected_year) return null

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
    }}>
      {/* Section eyebrow */}
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

      {/* Education */}
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

      {/* Career */}
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

      {/* Family */}
      {family && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Family</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{family}</div>
        </div>
      )}

      {/* Priorities chips */}
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
                color: 'var(--teal)',   /* brass accent = --teal legacy token */
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

      {/* Bio summary */}
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
