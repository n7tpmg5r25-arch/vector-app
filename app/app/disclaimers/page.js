'use client'
/**
 * Disclaimers — Phase 5 polish (2026-05-01).
 *
 * Converted to a 'use client' component to bring the page in line with
 * the about / methodology / install shell pattern: PublicNav for
 * anon visitors when the public-layer flag is on, owner Nav for authed
 * viewers, and a viewer-aware sticky HEADER (locked when !isAnonPublic
 * so the brand chrome stays anchored as users scroll the long body).
 *
 * Metadata moved to disclaimers/layout.js since 'use client' modules
 * can't export `metadata`. SEO behavior is unchanged.
 *
 * Mobile-only by design (Vector | WA mobile column directive).
 */
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import CohortCitation from '../components/CohortCitation'
import { useViewer } from '../../lib/viewer-capabilities'

function H2({ children }) {
  return (
    <h2 style={{
      fontSize: 11,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      fontWeight: 600,
      color: 'var(--teal)',       // Brass #b8975a via CSS var
      marginTop: 32,
      marginBottom: 10,
    }}>
      {children}
    </h2>
  )
}

function P({ children }) {
  return (
    <p style={{
      fontSize: 14,
      lineHeight: 1.7,
      color: 'var(--text-primary)', // Cream #e8e9ec via CSS var
      marginBottom: 12,
    }}>
      {children}
    </p>
  )
}

export default function DisclaimersPage() {
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-karla, Karla, sans-serif)' }}>
      {isAnonPublic && <PublicNav />}

      {/* Locked HEADER (Phase 5 polish 2026-05-01).
          Sticky only when !isAnonPublic -- PublicNav already pins for
          anon viewers and stacking two sticky-top-0 siblings conflicts.
          The 52px top padding clears the fixed-position HamburgerButton. */}
      <div style={{
        position: !isAnonPublic ? 'sticky' : 'static',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <div style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)', // #6c7078 via CSS var (was hardcoded #7a8090)
          marginBottom: 6,
          fontFamily: 'var(--font-body)',
        }}>
          Vector | WA
        </div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>
          Disclaimers
        </div>
      </div>

      <main style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '20px 24px 80px',
      }}>
        <P>
          Vector | WA is a Washington State legislative intelligence tool. It reads the public legislative record and turns it into plain-English summaries and a 0&ndash;99 trajectory score. This page explains where the data comes from, how the signals are generated, what Vector | WA is &mdash; and, just as important, what it is not.
        </P>

        <H2>What Vector | WA is &mdash; and isn&rsquo;t</H2>
        <P>
          Vector | WA is an information tool, not a professional adviser. Nothing on Vector | WA is legal, financial, political, or lobbying advice, and it is not a substitute for a licensed professional or for the official legislative record. Vector | WA is nonpartisan: it does not endorse candidates, take positions on legislation, or recommend how anyone should act. Its job is to make the record easier to read.
        </P>

        <H2>Independent and not affiliated</H2>
        <P>
          Vector | WA is an independent project. It is not affiliated with, endorsed by, sponsored by, or speaking for the Washington State Legislature, any legislator, the Office of the Governor, any state agency, or any government body. References to the Legislature and to public officials are for identification and commentary only. Vector | WA is not a registered lobbying entity and does not represent clients before the Legislature or any agency.
        </P>

        <H2>Data sources and freshness</H2>
        <P>
          Vector | WA pulls from the Washington State Legislature&rsquo;s public records: bill text, committee actions, roll calls, fiscal notes, and floor calendars. The data is mirrored nightly into Vector | WA&rsquo;s database. Between syncs, the site reflects the state of the record at the last refresh, not the live docket. A timestamp on each bill page shows the last sync. The data may be delayed, incomplete, or contain errors.
        </P>

        <H2>How signals are generated</H2>
        <P>
          Every bill receives a trajectory score from 0 to 99. The score is a weighted composite of five signals (committee placement, vote margins, fiscal note status, calendar movement, and companion status), adjusted by documented X factors when a bill sits outside the ordinary procedural path. Scores are bucketed into four tiers: HIGH (75 to 99), MODERATE (60 to 74), LOW (45 to 59), and VERY LOW (0 to 44). Bucket thresholds are calibrated across <CohortCitation variant="biennia-first" /> of Washington State session data and rechecked each session. See the methodology page for the full calibration table.
        </P>

        <H2>Algorithmic authorship</H2>
        <P>
          Scores, tiers, and momentum indicators in Vector | WA are produced by algorithm, not by a human analyst. No human writes or reviews individual bill scores before they appear on the site. Bill summaries on each bill page are generated by a large language model from the bill&rsquo;s official text and metadata, also without individual human review. <strong style={{ color: 'var(--text-primary)' }}>Summaries may be incomplete or contain errors. Always confirm anything you rely on against the official bill text, which is linked on every bill page.</strong> The underlying bill text and procedural record come directly from the Washington State Legislature.
        </P>

        <H2>The score is an estimate, not a prediction</H2>
        <P>
          A trajectory score is a signal about where a bill is likely heading based on its procedural record. It is not a prediction, a guarantee, or a probability in the strict statistical sense. Bills with identical scores can and do reach different outcomes. Vector | WA makes no representation that any score will correspond to any particular legislative result.
        </P>

        <H2>Interim-period framing</H2>
        <P>
          Between legislative sessions, trajectory scores reflect a bill&rsquo;s terminal position in the most recent session, not its prospects in the next one. Carry-over and prefile activity are labeled separately. Users should treat interim scores as historical, not predictive.
        </P>

        <H2>No warranty</H2>
        <P>
          Vector | WA is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind, whether express or implied &mdash; including, without limitation, any warranty of accuracy, completeness, reliability, merchantability, or fitness for a particular purpose. You use Vector | WA at your own risk.
        </P>

        <H2>Limitation of liability</H2>
        <P>
          To the fullest extent permitted by law, Vector | WA and its operator will not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages &mdash; including lost profits, lost opportunities, or decisions made or not made &mdash; arising out of or relating to your use of, or reliance on, Vector | WA or its data, even if advised of the possibility of such damages.
        </P>

        <H2>Privacy and data handling</H2>
        <P>
          Vector | WA collects only what it needs to run. If you create an account, that means your email address; if you build a watchlist, save tags, or write notes, it means those items. The site uses privacy-friendly, cookieless analytics to count page views in aggregate; this does not track you across sites or collect personal information. Vector | WA does not sell personal information. Bill, member, and committee data on the site is public information from the Washington State Legislature. Questions about data handling: <a href={'mailto:' + 'corrections' + '@' + 'vectorwa.com'} style={{ color: 'var(--teal)', textDecoration: 'underline' }}>{'corrections' + '@' + 'vectorwa.com'}</a>.
        </P>

        <H2>Corrections and contact</H2>
        <P>
          The Washington State Legislature&rsquo;s public record is the authoritative source for any bill referenced in Vector | WA. Where Vector | WA and the Legislature&rsquo;s record disagree, the Legislature&rsquo;s record controls. Corrections and questions: <a href={'mailto:' + 'corrections' + '@' + 'vectorwa.com'} style={{ color: 'var(--teal)', textDecoration: 'underline' }}>{'corrections' + '@' + 'vectorwa.com'}</a>.
        </P>

        <H2>Changes to these disclaimers</H2>
        <P>
          These disclaimers may be updated as Vector | WA evolves. Last updated June 2026.
        </P>
      </main>

      {!isAnonPublic && !viewerLoading && <Nav />}
    </div>
  )
}
