/**
 * Changelog data — Vector | WA.
 *
 * Filed Phase 6 Thread 60 (2026-05-02). Newest-first array consumed by
 * /changelog/page.js. Each entry shape:
 *
 *   {
 *     version:    string      // matches lib/version.js VERSION at the time of ship
 *     date:       string      // ISO yyyy-mm-dd
 *     phase:      string      // 'alpha' | 'beta' | 'release' (free-form, lowercase)
 *     highlights: string[]    // 3-5 bullets in Karla body voice
 *   }
 *
 * Conventions:
 *   - Prepend new entries on each phase ship (not on every PR — this is a
 *     user-facing transparency surface, not a git log).
 *   - Highlights are written in plain Karla body voice. Each bullet should
 *     stand on its own; cross-references like "(Phase 5 Thread 55)" are
 *     fine for traceability but copy stays neutral.
 *   - Quantified before qualitative per Brand Guide v1.2 §05 voice rules.
 *   - No banned vocab (see BRAND_COMPLIANCE_AUDIT_2026-05-01.md Check 1).
 *
 * Future structure note:
 *   When the list grows past ~12 entries this file becomes the right place
 *   to introduce a `category` field (UI / Data / Methodology / Brand) so
 *   the page can offer light filtering. Resist adding it before then —
 *   premature schema adds maintenance churn for no reader benefit.
 */

export const CHANGELOG = [
  {
    version: '5.56.0',
    date: '2026-06-30',
    phase: 'alpha',
    highlights: [
      'Welcome page: the PDF-brief visual now sits in a desktop browser-window frame instead of a tilted floating page.',
    ],
  },
  {
    version: '5.55.0',
    date: '2026-06-30',
    phase: 'alpha',
    highlights: [
      'Welcome page: rewrote the section headlines in plainer, more factual language and dropped the salesier lines (for example, the whole desk in your pocket is now simply built for your phone).',
    ],
  },
  {
    version: '5.54.0',
    date: '2026-06-30',
    phase: 'alpha',
    highlights: [
      'Welcome page: trimmed repeated calls to action -- kept the primary Open the app buttons in the header, hero, and closing, and removed the duplicate per-feature buttons that all led to the same sign-in.',
    ],
  },
  {
    version: '5.53.0',
    date: '2026-06-30',
    phase: 'alpha',
    highlights: [
      'Welcome page: added a real photo of Vector installed on a phone home screen, and made the free, independent promise explicit -- no ads, no subscriptions, no data selling.',
      'Corrected the data-refresh wording across the app to every few hours (the record updates through the day, not once nightly).',
    ],
  },
  {
    version: '5.52.0',
    date: '2026-06-29',
    phase: 'alpha',
    highlights: [
      'The Disclaimers page now states plainly that Vector is not legal, financial, political, or lobbying advice, and that it is an independent project -- not affiliated with, endorsed by, or speaking for the Washington State Legislature or any government body.',
      'Added clear "as is" / no-warranty and limitation-of-liability sections, a short privacy and data-handling summary, and a reminder to verify AI-drafted summaries against the official bill text.',
    ],
  },
  {
    version: '5.51.0',
    date: '2026-06-29',
    phase: 'alpha',
    highlights: [
      'Signed-out visitors now land on the welcome page first -- a desktop-ready overview of what Vector does (one-tap PDF briefs, bill-text Radar alerts, and watchlists) instead of a bare sign-in screen. Signed-in users still go straight to the app.',
      'The welcome page now uses real screenshots of a bill page, a watchlist, and an exported PDF brief in place of the earlier mockups.',
      'Methodology is now a short, plain-English breakdown -- the five signals, the ~84% track record for HIGH-tier bills, and the limits -- with the dense calibration tables removed.',
      'Retired the outdated About page; its links now point to the welcome overview and methodology.',
    ],
  },
  {
    version: '5.50.0',
    date: '2026-06-20',
    phase: 'alpha',
    highlights: [
      'New welcome page at /welcome -- a desktop-ready public front door that shows what Vector does at a glance: one-tap PDF briefs for bills, watchlists, and legislators; Radar bill-text alerts; the device watchlist; and plain-English summaries. The app itself stays mobile-first; this is the one desktop-ready marketing surface.',
      'The welcome page is reachable without signing in, links straight into the app, and is labeled alpha / in active development. Built in the Vector | WA brand -- Playfair Display, Karla, and DM Mono on brass over dark -- with a live screenshot of the app.',
    ],
  },
  {
    version: '5.49.0',
    date: '2026-06-17',
    phase: 'alpha',
    highlights: [
      'Vector | WA is now open source: the code behind the site is public under an MIT license, reflected across the site and in a new project README.',
      'Methodology page rewritten about 65% shorter -- the same calibration data (84% of HIGH-tier bills became law across an 8,062-bill cohort), the five signals, and the X-factor list, with the dense explanation and redundant callouts cut.',
    ],
  },

  {
    version: '5.48.0',
    date: '2026-06-17',
    phase: 'alpha',
    highlights: [
      'Live data refresh: bill statuses, Radar matches, and alert emails now update throughout the day, year-round -- hourly while the Legislature is in session and during the December pre-filing run-up, every four hours in the interim -- instead of only once nightly.',
      'During session, a new-bill or status-change alert that used to take up to a day now reaches you within the hour.',
      'Added a daily automated health check that flags a stalled data feed within a day, so refreshes keep running reliably.',
    ],
  },

  {
    version: '5.47.0',
    date: '2026-06-14',
    phase: 'alpha',
    highlights: [
      'Alert and digest emails: fixed every in-app link (they pointed at a /app path that no longer exists), added a one-click unsubscribe and a Manage notification preferences link, and refreshed the styling to the Vector | WA palette (dark header, brass accent).',
      'Radar match labels clarified: a bill amended or substituted into a term now reads "Updated", distinct from "New language", which quotes the exact text that changed.',
      'Radar phrase matching: search terms entered with curly quotes are normalized to straight quotes so an exact phrase is matched as a phrase.',
    ],
  },

  {
    version: '5.46.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'PDF-C1: C-suite polish for the single-bill and watchlist briefs. Serif (Times) headlines for bill numbers, titles, and the verdict word; the 0-99 trajectory score now prints beside the tier on both; at-risk bills (low score or imminent cutoff) carry an AT RISK flag in full-strength ink so urgency reads first; watchlist one-liners are now bill-specific (no repeated boilerplate); the single-bill brief closes with a synthesized BOTTOM LINE; and the watchlist continuation header is fully unbranded.',
    ],
  },

  {
    version: '5.45.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'PDF-B2 / PDF-W2: Single-bill and watchlist briefs given the member-brief C-suite finish -- the single-bill footer drops the redundant "Not legal advice / AI-generated content" disclaimer (the export confirmation already carries the verify-the-record notice), both footers gain a data sources attribution line, and the footer divider and spacing now match the member brief.',
    ],
  },

  {
    version: '5.44.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'PDF-M3: Member brief C-suite scrub -- removed redundant AI note from bio; fixed Top Bills to resolve bill array before drawing header (eliminates stats contradiction); corrected Success Rate to show laws enacted / bills sponsored; data sources attribution added to footer; single-page guarantee (stage funnel dropped gracefully when cramped, addPage removed); section title separator updated to middle dot.',
    ],
  },

  {
    version: '5.43.0',
    date: '2026-06-13',
    phase: 'PDF-M2',
    highlights: [
      'Member PDF: removed internal "Tier N" jargon — role now shows plain majority/minority English (Majority Member, Minority Member, etc.)',
      'Member PDF: identity block now always shows a role line for every member, including tier-3/tier-4 (previously tier-3 showed nothing)',
      'Member PDF: dynamic stat grid suppresses any stat with no real value — no more dash-labeled rows in C-suite documents',
      'Member PDF: bio fallback to occupation when bio_summary is absent or short — data-sparse members now always have context text',
    ],
  },
  {
    version: '5.42.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'Watchlist PDF (PDF-W1): three clarity fixes matching the bill export improvements. Companion bill scores now show tier labels (HIGH / MODERATE / LIMITED) rather than raw numbers.',
      'Affects line in each bill card now falls back to the first sentence of the executive summary when the AI summary has no WHO IS AFFECTED heading.',
      'Portfolio overview table score column now labeled SCORE/99 so scale is clear on first read.',
    ],
  },
  {
    version: '5.41.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'Bill export PDF (PDF-B1): four clarity fixes for non-insider readers. Key Signals now include a footnote explaining that delta values are score model impact, not passage probability.',
      'Companion bill line now shows the tier label (HIGH / MODERATE / LIMITED) alongside the raw score so decision-makers can read it at a glance.',
      'Fiscal Note section always appears — bills with no fiscal note now show "No fiscal note on file" rather than silently omitting the section.',
      'Affects line now falls back to the first sentence of the executive summary when the AI summary has no dedicated WHO IS AFFECTED heading, so the field is never blank.',
    ],
  },
  {
    version: '5.40.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'Member PDF rewritten for C-suite clarity: bio summary expanded from one line to three, seat safety label (SAFE SEAT / COMPETITIVE SEAT / VULNERABLE SEAT) added under the electoral margin, and all eight Legislative Record stats relabeled in plain English.',
      'Stat labels now read as plain language: "Laws Enacted", "Success Rate", "Party-Line Votes", "Floor Attendance", "Bills Advanced", and "Top Bill Score" replace the previous jargon equivalents. Footnotes explain Success Rate and Top Bill Score for readers with no legislative context.',
      'Score circles on the Top Bills list are slightly larger and use a bigger font for legibility on printed pages.',
    ],
  },
  {
    version: '5.39.0',
    date: '2026-06-13',
    phase: 'alpha',
    highlights: [
      'AI-source labeling is now consistent across every surface that shows an AI-drafted summary: the search results snippet gains a small “AI·” prefix, the portfolio PDF gains a per-bill attribution line, and the two pre-launch backup tables holding earlier AI text were moved off the public API surface.',
      'The single-bill and member PDFs already carried AI attribution (confirmed unchanged); all three PDF paths are now verified clean.',
      'LAUNCH_CHECKLIST.md published — the public-layer flip is a single Vercel environment variable change. The checklist covers the flag flip, custom SMTP via Resend, auth email rate-limit raise, and the Resend volume decision before registration opens.',
    ],
  },
  {
    version: '5.38.0',
    date: '2026-06-11',
    phase: 'alpha',
    highlights: [
      'Editing a bill\u2019s public summary is now an explicit admin permission \u2014 ahead of open registration, a regular signed-in account no longer carries that switch, and the database enforces the same rule independently of the app.',
      'Fixed a silent save bug: summary edits previously looked saved but never reached the database. Admin edits now persist and survive a reload.',
      'Waitlist confirmation messages now say registration opens at the public launch instead of naming a beta month.',
      'Email volume audited ahead of multi-user sign-ups: a new account receives no alert or digest email until it opts in on Settings.',
    ],
  },
  {
    version: '5.37.0',
    date: '2026-06-11',
    phase: 'alpha',
    highlights: [
      'Signing in and creating an account become the same box: enter an email, get an 8-digit code \u2014 new emails get a free account, existing ones sign straight in. Like all public-tier work, this stays switched off until the free public launch.',
      'Bills saved on a device move into the new account automatically at first sign-in \u2014 tags, notes, and original saved dates survive the trip, and a one-time notice confirms how many made it. Anything that cannot sync stays safely on the device with a retry; a partial move never loses data.',
      'A list already in the account always wins: syncing never overwrites tags or notes saved while signed in \u2014 device notes fill in only where the account had none.',
    ],
  },
  {
    version: '5.36.0',
    date: '2026-06-10',
    phase: 'alpha',
    highlights: [
      'The device watchlist gets its page: visitors without an account can open the watchlist itself \u2014 the same cards, scores, score changes, tags, and notes, the same swipe-to-remove \u2014 fed entirely from the list saved in their browser. A one-line notice states where the data lives, with a one-tap path to a free account that syncs it everywhere. Like all public-tier work, none of this is visible until the free public launch.',
      'Signed-out navigation converges with the signed-in app: the same five-tab bottom bar \u2014 Home, Watchlist, Search, Members, Committees \u2014 so the product reads identically either way. Radar, whose saved terms and email alerts need an inbox, shows visitors a one-card explanation instead of a bounce to the login page.',
      'Two dead ends close: the statewide news page opens for visitors (the home news card\u2019s "All" arrow now goes where it points), and the home dashboard\u2019s attention card goes live for device-saved lists \u2014 the same at-risk and hearings triage signed-in users get, computed over the bills saved on the device.',
    ],
  },
  {
    version: '5.35.0',
    date: '2026-06-10',
    phase: 'alpha',
    highlights: [
      'The watchlist can now run entirely on your device: up to 200 bills, each with a tag and notes, saved in your browser with no account. This is the second piece of groundwork for the free public tier and stays switched off for visitors until that launch — signed-in watchlists keep working exactly as before, in your account.',
      'Device-saved lists are honest about where they live: a one-line "saved on this device" notice with a link to create a free account, and at the 200-bill device cap the watch button itself becomes that prompt.',
      'Saved bills survive reloads and are shared across tabs on the same device. Moving a device list into a real account arrives in an upcoming update.',
    ],
  },
  {
    version: '5.34.0',
    date: '2026-06-10',
    phase: 'alpha',
    highlights: [
      'Under-the-hood reliability work on the watchlist. Every watch, unwatch, tag, and note action across the app — bill pages, search, Radar, committees, hearings, the home dashboard, and the menu badge — now flows through one shared module instead of nine separate code paths.',
      'Nothing changes on screen: the same actions, the same data, the same account. This is the foundation for an upcoming update that lets anyone try the watchlist before creating an account.',
    ],
  },
  {
    version: '5.33.0',
    date: '2026-06-09',
    phase: 'alpha',
    highlights: [
      'The statewide news feed now draws on 14 Washington outlets, up from 7 \u2014 adding the Everett Herald, the Walla Walla Union-Bulletin, MyNorthwest (KIRO Newsradio), and The Washington Observer, with best-effort slots for the Seattle Times, The Columbian, and The Center Square. The pool spans public media, commercial dailies, radio, wire, and independent Olympia press.',
      'No single outlet can dominate what you see: the home card seats at most 2 items per source across its 4 rows, and the full news page at most 5 per source across 30. Sources take turns newest-first \u2014 a fixed rule, not a judgment call, and identical whether or not you are signed in.',
      'Whole-newsroom feeds now pass one government-beat test \u2014 Legislature, elections, budgets, agencies \u2014 applied identically to every outlet, so off-beat stories stay out without anyone hand-picking the news.',
    ],
  },
  {
    version: '5.32.0',
    date: '2026-06-09',
    phase: 'alpha',
    highlights: [
      'All three PDF exports — single bill, member, and watchlist — now print fully neutral: black and white, with no logo, brand name, web address, or accent color. Only the date and time the file was generated remain.',
      'Downloaded briefs now carry plain, unbranded file names like “HB-1234-brief-2026-06-09.pdf” and “member-jane-doe-2026-06-09.pdf”, so a saved or forwarded brief stands on its own.',
      'The app itself stays fully branded — this change applies only to the documents you export and share.',
    ],
  },
  {
    version: '5.31.0',
    date: '2026-06-08',
    phase: 'alpha',
    highlights: [
      'Every PDF export now reads “Export as PDF” across the bill, member, and watchlist pages — one consistent label in place of the older mix of “Share PDF” and “Export PDF”. On phones the button now downloads the file directly, like it does everywhere else, instead of opening the share sheet.',
      'Before a PDF is generated, a short confirmation now asks you to acknowledge that you are responsible for verifying the information against the official record before relying on it or sharing it.',
    ],
  },
  {
    version: '5.30.0',
    date: '2026-06-08',
    phase: 'alpha',
    highlights: [
      'The home dashboard now greets signed-out visitors with the same cockpit registered users see, reading live statewide data in place of a personal watchlist. A survival gauge leads — the share of this session’s bills still alive, 924 of 3,111 (about 30%) as of this release — over a four-tier breakdown of where every scored bill stands.',
      'Momentum, issue heat, today’s movers, and the “In the news” card are identical to the signed-in view, now drawn from the full statewide field rather than a tracked set. Between sessions, when scores are frozen, the movers and momentum read as frozen instead of inventing movement.',
      'In place of the personal “needs attention” card, a quiet “track your bills — free” prompt invites visitors to sign in for a watchlist and their own trajectory gauge. This closes the six-part dashboard rebuild — the cockpit now reads the same whether or not you’re signed in.',
    ],
  },
  {
    version: '5.29.0',
    date: '2026-06-08',
    phase: 'alpha',
    highlights: [
      'The dashboard now closes with an “In the news” card — up to four of the latest Washington legislative and political stories, each with its source, how long ago it ran, and a one-tap link out to the original. Press coverage and Legislature filings carry distinct marks, so reporting and official action read apart at a glance.',
      'The card reads the statewide feed gathered nightly, shows the four most recent items, and opens each source in a new tab. A full “All →” view lists the thirty most recent.',
      'When the feed has nothing new the card steps aside instead of showing an empty shell, so the home stays clean between updates.',
    ],
  },
  {
    version: '5.28.0',
    date: '2026-06-08',
    phase: 'alpha',
    highlights: [
      'Groundwork landed for a statewide news feed on the dashboard. A nightly job now gathers Washington legislative and political coverage from seven curated sources — Washington State Standard, the Spokesman-Review, KNKX, KUOW, Cascade PBS, The Olympian, and the state Legislature — and files each story as a headline, a one-line summary, its source, and a link.',
      'The feed stays lean and honest: duplicate stories collapse to a single entry, items are kept for 60 days and then retired, and any source that goes quiet is skipped without holding up the rest. It runs year-round, including between sessions.',
      'Nothing changes on screen yet — this is the data layer. The “In the news” card that reads from it arrives in the next update.',
    ],
  },
  {
    version: '5.27.0',
    date: '2026-06-07',
    phase: 'alpha',
    highlights: [
      'A new “needs attention” card now leads the home dashboard for signed-in users, distilling your tracked bills into three reads: how many are at risk, how many have a hearing in the next 7 days, and the single most urgent bill with the reason it’s flagged. “At risk” is a real model now, not a low score — a bill counts only if it’s still alive and losing its path to passage: held in the Rules Committee, stalled with no action for three weeks or more, or facing a statutory cutoff within a week before it has cleared committee.',
      'The portfolio trajectory gauge now shows how your watchlist moved over the past week. The placeholder under the dial is replaced by a real signed change — the average trajectory of your tracked bills versus seven days ago — rising in green or falling in red.',
      'Between sessions, when scores are frozen, the new card and the weekly change stay honest: the card steps aside and the gauge reads as frozen rather than inventing movement. Hearings count only inside the next seven days, so the card reflects the week actually ahead.',
    ],
  },
  {
    version: '5.26.0',
    date: '2026-06-06',
    phase: 'alpha',
    highlights: [
      'The day’s four biggest score moves now lead the home dashboard. A new diverging chart ranks the bills that gained or lost the most predicted trajectory since the last sync — gains sweep right in green, losses left in red — so the sharpest changes read at a glance instead of as a list to scan.',
      'A momentum tile reports how many of those bills advanced since the prior update, paired with a trend line, for a single read on whether your tracked set is gaining or losing ground.',
      'Three compact “issue heat” bars replace the old category list, ranking the strongest policy areas by average trajectory and coloring each by its signal tier — High, Moderate, Low, or Very Low. Between sessions, when scores are frozen, the movers and momentum tiles now say so plainly rather than showing an empty chart.',
    ],
  },
  {
    version: '5.25.0',
    date: '2026-06-06',
    phase: 'alpha',
    highlights: [
      'The home now opens with your portfolio at a glance. Signed-in users who track bills see a new trajectory gauge — a single 0–99 dial that averages the predicted trajectory of every bill on your watchlist — with a tier bar beneath it that splits those bills into High, Moderate, Low, and Very Low bands, so the shape of your portfolio reads in one look.',
      'A session clock now sits in the header. It shows how far the Legislature is into its current session (Day X of 105 in a long session, 60 in a short one) and, when a policy or fiscal cutoff is within reach, a countdown chip that turns red inside the final week; between sessions it reads as interim.',
      'The header identity was rebuilt around the Vector | WA arc mark and wordmark. This is the first step of a larger home redesign — the existing trajectory, category, and totals sections stay in place below the new gauge while the rest of the dashboard is rebuilt.',
    ],
  },
  {
    version: '5.24.0',
    date: '2026-06-05',
    phase: 'alpha',
    highlights: [
      'Fine print is now easier to read. The model’s limitation notes, the “What this model doesn’t use” disclosure, and the political-dynamics caveats on the methodology page were rendered in a light grey that was hard to read in daylight; they now use a higher-contrast tone that clears accessibility guidance for small text.',
      'The “Moderate” signal tier no longer reads like a coin-flip. Where the tier label appears, it now carries its real historical rate — roughly 1.8% of Moderate bills became law — so a mid-band score is understood as technically alive but a long shot, not a 50/50 chance.',
      'AI-written legislator bios now carry the same calm, consistent disclosure as bill summaries. The louder “AI Generated” badge on member profiles is now a neutral “AI Summary” label with a source link and a single “Report a discrepancy” option, matching the bill pages — honest about how the text is produced without implying a review step that does not happen.',
      'Two small interface clean-ups. The watchlist now separates sorting (By Score, Recently Added, A–Z) from filtering (Didn’t Pass / At Risk) into their own labeled rows; and the install page hides the step-by-step phone instructions once the app is already installed, with a link to show them again for a new device.',
      'A finished bill no longer repeats its status. On bills that are signed into law, a redundant “Signed into law” line was removed so the outcome shows once and the key details sit higher on the screen.',
    ],
  },
  {
    version: '5.23.0',
    date: '2026-06-04',
    phase: 'alpha',
    highlights: [
      'The committee calendar now reads correctly between sessions. During the interim the Legislature holds committee work sessions that carry no bills, which previously left a run of “0 bills” cards that looked like a broken feed; the calendar and each committee page now lead with an interim note that explains the schedule is dark and points to the date the next session convenes.',
      'Member profiles now lead with what a legislator can actually move. The “Where their bills end up” outcome funnel — the share of their bills that clear committee, pass the floor, and become law — now sits near the top of the profile, just under the bio and committee seats, while the past-election record is condensed to a single compact line below.',
      'A persistent reminder now appears whenever you are viewing a past biennium. Switching to a historical session — for example 2023-2024 — tints the bottom navigation and labels it “Viewing 2023-24 archive,” so a finished bill from a prior cycle is harder to mistake for a live one; tapping the label returns you to the current session.',
    ],
  },  {
    version: '5.22.0',
    date: '2026-06-04',
    phase: 'alpha',
    highlights: [
      'The score breakdown now shows its own math. The Score Breakdown tab on a bill lists five component bars that add up to a 0–100 base, but never showed how that base becomes the final score; a new footer spells it out — base total × the X-factor multiplier, then capped at 99 (100 is reserved for bills signed into law) — so the tab reconciles with the score shown at the top of the bill.',
      'Downloaded bill briefs no longer cut off the affected-parties line. On both the single-bill brief and the watchlist brief, the “Affects:” line under the title used to truncate with an ellipsis after one line; it now wraps to as many as three lines so the full description prints, while bill-title rows still truncate to stay aligned.',
    ],
  },
  {
    version: '5.21.0',
    date: '2026-06-03',
    phase: 'alpha',
    highlights: [
      'Watchlist bills on the home dashboard now show the correct chamber. A House bill you were tracking — for example HB 1073 — was being labeled “SB 1073” on the home cards because the bill’s chamber wasn’t being read there; the prefix now resolves correctly on every card that shows a bill number.',
      'The member directory heatmap now answers three questions instead of one. A new lens switch colors every legislator by Power (who controls a bill’s fate — leadership, committee chairs, and seats on the gatekeeper committees like Rules and the budget committees), Movability (who holds a competitive seat and is most open to constituent pressure, read from their last election margin), or Effectiveness (the existing track-record composite). Each lens carries its own plain-English legend.',
      'The member list’s headline number is now labeled. The bold figure beside each legislator is their average bill trajectory score; it now carries an “Avg Score” heading and a one-tap explanation, so it is no longer an unlabeled number.',
    ],
  },
  {
    version: '5.20.0',
    date: '2026-06-03',
    phase: 'alpha',
    highlights: [
      'Bill summaries now render cleanly regardless of how they were generated. About a third of the catalog used "#"-style markdown headings that previously showed as raw "# BILL BRIEF" and "## EXECUTIVE SUMMARY" lines on the page; one shared parser now formats both heading styles the same way and drops the redundant title line, on both the public bill page and the team briefing view.',
      'Corrected two summaries that named a place that does not exist. A military child care bill referenced a fictional "Fairchild Space and Missile Center" (it is Fairchild Air Force Base, near Spokane), and a paid-military-leave bill had been described with the wrong bill’s text. Both were regenerated against the official WA Legislature record under the proper-noun accuracy guardrail.',
    ],
  },
  {
    version: '5.19.0',
    date: '2026-06-02',
    phase: 'alpha',
    highlights: [
      'The AI-summary note is now one clear line instead of repeated labels. Each plain-English summary reads "AI-drafted from the bill’s official text, linked to the WA Legislature record above," with a single "Report a discrepancy" link if anything looks off — so the source and the way to flag it are obvious without the heavy disclaimer stacking.',
      'High-density screens hold up under the longest bill titles and large-text settings. The home category rows, the "where the bills end up" funnel, and the activity cards now trim over-long labels cleanly instead of wrapping or colliding at the phone width.',
    ],
  },
  {
    version: '5.18.0',
    date: '2026-06-02',
    phase: 'alpha',
    highlights: [
      'Building a Radar term is now point-and-click. Type a word to require it, wrap an "exact phrase" in quotes, or prefix a minus to exclude — each becomes a labeled chip, and a live preview shows exactly what Radar will match. A "Use raw query" toggle stays for anyone who wants full boolean (OR, grouping). The underlying search is unchanged, so existing terms keep matching exactly as before.',
      'Radar terms now group by name. Several queries saved under one name — say five phrasings of a single issue — collapse into one card you can expand, instead of five look-alike rows, and you can add another phrasing straight from the card.',
      'One issue, one alert. When a bill matches two phrasings of the same Radar term, the email lists it once instead of repeating it — while the match feed still shows every phrasing that caught it.',
    ],
  },
  {
    version: '5.17.0',
    date: '2026-06-02',
    phase: 'alpha',
    highlights: [
      'You can now send a brief straight from your phone. The bill and member PDF buttons are relabeled "Share PDF" and open the iOS/Android share sheet, so a one-page brief can be texted or AirDropped to a client or staffer on the spot. On desktop the same button reads "Export PDF" and downloads the file as before.',
      'The Trajectory tab is cleaner. The small unlabeled bar graphic — which had no scale and repeated what the Score Breakdown tab already shows with labeled bars — is gone, leaving the score and its change to anchor the card.',
    ],
  },
  {
    version: '5.16.0',
    date: '2026-06-02',
    phase: 'alpha',
    highlights: [
      'Your watchlist outcome counts now add up. The summary strip adds a "Passed Chamber" card alongside "Signed into law" and "Dead," so the three outcomes reconcile to the number of bills you track — carry-over bills no longer disappear from the math.',
      'Outcome states are now easy to tell apart at a glance. Law, passed-chamber, and dead are shown as distinct color-coded badges — a green check for signed into law, a teal arrow for passed chamber, a stone cross for dead — instead of two near-identical gold tones.',
      'The home dashboard no longer shows the "Signed into Law" total twice. The duplicate slot now carries a more useful biennium stat: the number of bipartisan bills.',
    ],
  },
  {
    version: '5.15.0',
    date: '2026-06-01',
    phase: 'alpha',
    highlights: [
      'The trajectory score now shows clean arithmetic. When a score is capped at 99 or rounded, the bill page no longer prints an equation that appears not to add up — it shows the final score with a "capped at 99" or "≈ rounded" note, and the full base × momentum math stays in the score info panel.',
      'AI summaries no longer invent or rename Washington places. A new guardrail blocks fabricated installation and agency names — for example, the one bill that read "Spokane Air Force Base" now correctly references Fairchild AFB.',
      'Floor-vote breakdowns read cleanly when party data is incomplete. A roll call with no party-matched votes no longer shows a bare "48?"; partial data is now labeled "N unmapped" with a short explanation, matching the roll-call history view.',
    ],
  },
  {
    version: '5.14.0',
    date: '2026-06-01',
    phase: 'alpha',
    highlights: [
      'Radar now reads the actual bill text. When a bill you watch is substituted or amended, Radar compares the new version against the previous one and tells you exactly what language was added — and quotes it, both in the alert email and in your Radar feed.',
      'New "Full bill text" match option: point a term at the complete bill rather than just the title and summary, so it catches language buried deep in the bill that a summary would never surface.',
      'New-language matches arrive in the same Radar email in their own section, tagged "New language" in the feed, so they stay distinct from new-bill and change alerts.',
      'This completes Radar — it now watches for brand-new bills, flags when a watched bill materially changes, and surfaces the specific new wording.',
    ],
  },
  {
    version: '5.13.0',
    date: '2026-06-01',
    phase: 'alpha',
    highlights: [
      'Vector now archives the full text of every current-session bill, capturing the latest official version each time a bill is substituted, amended into a new draft, or enacted.',
      'This runs quietly in the background once a day and builds up over about two weeks, with no change to your alerts or Radar matches yet.',
      'It lays the groundwork for an upcoming update that will show you the exact language that changed in a bill, not just that it changed.',
    ],
  },
  {
    version: '5.12.0',
    date: '2026-06-01',
    phase: 'alpha',
    highlights: [
      'Radar now watches bills you already know about, not just brand-new ones. When a bill that matches one of your terms gets a substitute, picks up an amendment, or has its summary rewritten, Radar catches the change on the next sync and flags it.',
      'These material-change alerts arrive in the same Radar email, in their own section, and show up in your Radar feed tagged "Language changed" so you can tell them apart from new-bill matches at a glance.',
      'Change alerts tell you the language moved and point you to the latest version — quoting the new text itself arrives in a later update.',
    ],
  },
  {
    version: '5.11.0',
    date: '2026-05-31',
    phase: 'alpha',
    highlights: [
      'Radar now has its own screen. A new Radar tab lets you create and manage watch terms — name a term, point it at an issue, a client, or a place, and choose whether matches arrive by email right away or just collect in the feed.',
      'Each term can be matched against bill titles only or titles plus summaries, assigned to a client, and switched on or off without deleting it.',
      'When a brand-new bill matches a term, it lands in your Radar feed, where one tap adds it to your watchlist and another opens the full bill.',
      'Search gained a "Save as Radar term" button, so any keyword search you run can become a standing watch for future bills in one step.',
      'A Radar alerts switch in Settings turns the term-match emails on or off on its own, separate from your per-bill alerts.',
    ],
  },
  {
    version: '5.10.0',
    date: '2026-05-31',
    phase: 'alpha',
    highlights: [
      'Radar — a new way to catch brand-new bills the day they are introduced — is now running inside the alert pipeline. When a freshly filed bill matches one of your saved watch terms (an issue, a client, or a place), Vector | WA detects it on the next sync and folds it into your alert email, grouped by term.',
      'This release ships the detection engine and email delivery behind Radar; the screen for creating and managing your own terms arrives in the next update.',
    ],
  },
  {
    version: '5.9.0',
    date: '2026-05-30',
    phase: 'alpha',
    highlights: [
      'Every bill now has a one-tap link to its official page on leg.wa.gov, right beside the AI summary — read the real legal text in a tap, instead of relying on the machine-written summary alone.',
      'Bill pages now show the date of the bill’s last action, so you can see at a glance how current the status is.',
      'The methodology page now states coverage and freshness plainly: every bill is tracked (not a sample), the model is calibrated on 8,062 historical bills, and data syncs from the Legislature daily.',
    ],
  },
  {
    version: '5.8.3',
    date: '2026-05-30',
    phase: 'alpha',
    highlights: [
      'Members page is significantly faster: the legislator stats list now loads about 3x quicker after a database tuning pass, and a member’s voting record loads with fewer round-trips.',
    ],
  },
  {
    version: '5.8.1',
    date: '2026-05-30',
    phase: 'alpha',
    highlights: [
      'Bill detail: the score’s “X factor” chips are now tappable — tap any factor to read what it means and how it moves the score, instead of the explanation being hidden behind a desktop-only hover.',
      'Finished the input-zoom fix on the remaining search and note fields (members search, watchlist notes), so no form field zooms the screen on iPhone.',
    ],
  },
  {
    version: '5.8.0',
    date: '2026-05-30',
    phase: 'alpha',
    highlights: [
      'Accessibility pass: form fields no longer trigger an iOS zoom-in when tapped, bottom-navigation labels are more legible, and tap targets across the app now meet the 44px touch minimum.',
      'Motion now fully respects your device’s “reduce motion” setting — the pulsing score and status animations stop when you’ve asked your phone to minimize movement.',
      'Score colors (Sage / Teal / Amber / Stone) are now defined in one place, keeping the look consistent everywhere a score appears.',
      'Screen readers now announce a score with context (“Trajectory score 65 of 99”) instead of a bare number.',
    ],
  },
  {
    version: '5.7.1',
    date: '2026-05-29',
    phase: 'alpha',
    highlights: [
      'Repeat visits now load near-instantly: the app caches its own code and images on your device after the first visit instead of re-downloading them every time.',
      'Faster behind-the-scenes data: added database indexes so the home dashboard’s bill and outcome queries return in milliseconds instead of seconds.',
      'Trimmed the amount of code the app ships to your browser, and moved the servers closer to the data for lower latency.',
    ],
  },
  {
    version: '5.7.0',
    date: '2026-05-29',
    phase: 'alpha',
    highlights: [
      'The home dashboard now paints instantly with a structured loading state instead of a single full-screen spinner — you see the brand bar, session timeline, and card layout right away while the data fills in.',
      'Cut the initial home load from three back-to-back database round-trips to one: the bill list, watchlist, totals, and session-outcome counts now load together rather than in sequence.',
      'Sign-in status is read locally on first paint instead of waiting on a network check, so the dashboard starts loading its data sooner.',
      'Removed a stack of redundant per-session lookups that ran on every home visit, and moved the score-change indicators off the critical path so they fill in just after the page appears.',
      'Switched the three brand typefaces (Playfair Display, Karla, DM Mono) to self-hosted, preloaded fonts — faster first text render and no layout shift on load.',
    ],
  },
  {
    version: '5.6.1',
    date: '2026-05-29',
    phase: 'alpha',
    highlights: [
      'Bill detail trust fixes (T156): three lobbyist-identified credibility issues addressed. "No vote yet" on Floor Margin now shows "—" for signed, passed-chamber, and dead bills — the session is over and the absence of stored margin data is a gap, not evidence a vote never happened.',
      'Negative X-factor chips (e.g. "Minority Only −10%") are now suppressed on bills that became law. They were scoring penalties applied during session and are retroactively misleading on signed legislation — a bill that passed 97-0 should not display a minority-sponsorship penalty badge. DEAD and PASSED CHAMBER bills retain all factors since they help explain why a bill stalled.',
      'AI summary section redesigned for trust: badge renamed from "AI-GENERATED" (alarming) to "AI SUMMARY" (neutral); disclaimer moved above the summary text instead of buried 300 words below the fold; reviewed summaries show "REVIEWED" badge in green. The EDIT button is now gated on a separate canEditBillSummary capability rather than canEditNotes, since summary edits update the global bills table for all users.',
    ],
  },
  {
    version: '5.6.0',
    date: '2026-05-28',
    phase: 'alpha',
    highlights: [
      'Methodology page redesigned for senior lobbyist / validity lens (T155): section order rebuilt so credibility evidence ("Why This Matters") appears before the data tables rather than after. The proof now follows the hook.',
      'TL;DR card upgraded: 84% HIGH-tier pass rate now appears as a 36px Playfair Display headline stat, not buried in a sentence. Intro gains two sentences on Washington-specific session mechanics — 60-day calendar, committee chair gating power, and the Rules Committee kill switch.',
      'Two calibration sections merged into one: combined 3-biennium engine truth is primary, most-recent-biennium check rendered as a sub-section below. Removed the "Engine Truth" jargon label. "How honest is this?" disclosure restructured with the key sentence pulled out as a visible callout.',
      'X Factors grid changed from 2-column to single-column stack — the 2-col layout was breaking on 480px mobile with long label text. Political Dynamics signals each gain an "In practice:" callout and a new "What this model doesn\'t use" section explains absent signals (JLOB, whip counts, campaign finance). Signal Tiers section removed — redundant with calibration data that already defines tiers inline. Brass left-border accent added to all section labels. CTA button added at page bottom.',
    ],
  },
  {
    version: '5.5.9',
    date: '2026-05-28',
    phase: 'alpha',
    highlights: [
      'Watchlist PDF full redesign (T154): 19 fixes across visual language, intelligence quality, and format. Box chrome entirely removed — card shells, score boxes, status pills, and session bar replaced with text-row memo grammar consistent with the bill brief.',
      'Executive Summary rebuilt to name specific bills: stage changes since last brief, urgent hearings within 7 days, cutoff pressure, and portfolio health signal. Previously the section contained two dead code blocks and never referenced a bill by name.',
      'Portfolio Overview table gains a NEXT column (upcoming hearings within 30 days), trend column (+N pts since last run), and correct outcome color coding. PASSED CHAMBER rows now render in Brass-Light instead of matching LAW (Brass) — the two outcomes are now visually distinct.',
      'Bill cards on pages 2+ use a new drawBillLabel separator (bill number left, trajectory tier right, full-width rule) instead of rounded rectangles. Paper size corrected to US Letter; margin tightened to 16mm to match the bill brief.',
    ],
  },
  {
    version: '5.5.8',
    date: '2026-05-27',
    phase: 'alpha',
    highlights: [
      'Bill brief PDF formatting pass (T153): 14 fixes across typography, spacing, and edge cases. Bill title is now the dominant typographic element (12pt) — the trajectory tier word reduced to 11pt, differentiated by color rather than size.',
      'Empty-state handling added to all conditional sections — bills with no AI summary, no signals, or no floor votes now show a clean fallback line instead of a blank void. Single-signal bills no longer have their signal suppressed.',
      'SPONSOR / COMMITTEE column labels added so first-time readers know which column is which. Affects line now appends an ellipsis when truncated. "Day N of session" removed from header (not actionable — cutoff countdown remains).',
      'Raw score annotation ("Score 74") removed from status block — the tier word alone is the signal. Stage History separator changed from > to · consistent with the rest of the document.',
    ],
  },
  {
    version: '5.5.7',
    date: '2026-05-27',
    phase: 'alpha',
    highlights: [
      'Bill brief PDF rebuilt as a memo-style briefing document (T152): all bordered card boxes removed — the visual language is now a printed brief, not a mobile UI. The only section dividers are brass ALL-CAPS labels with a rule line.',
      'Status and score merged into a single block: tier word (HIGH / MODERATE / LIMITED / VERY LOW) leads at 13pt in tier color with the raw score as inline annotation. Recommendation write-in field removed.',
      'Fiscal note upgraded from a single word to a full intelligence block: impact level, state vs. local scope, strategic implication (e.g. "Priority legislation — double-referred to fiscal committees. 45% historical passage rate"), and upgrade history with date.',
      'Key Signals section converted from chip boxes to text rows with directional triangle indicators and right-aligned delta percentages. Sponsor / Committee section converted to two-column text — no boxes.',
    ],
  },
  {
    version: '5.5.6',
    date: '2026-05-27',
    phase: 'alpha',
    highlights: [
      'Bill brief PDF C-suite refinements (T151): "Who is Affected" now appears as a brass callout directly under the bill title — no longer buried in the body. A blank RECOMMENDATION field gives lobbyists a write-in action line.',
      'Score one-liner now leads with the probability statement ("84% historical pass rate") instead of qualitative hedging. Tier labels translated to plain English: Majority Leadership / Senior Member / Rank-and-file.',
      'Hearing date removed from the status pill (was duplicated in the Committee card). Committee card now shows a plain-language countdown: "Hearing in 3 days" or "Heard · [date]". Bill number typeset in Helvetica, not Courier.',
      '"TOP X-FACTORS" renamed to "KEY SIGNALS". "PRIME SPONSOR" renamed to "SPONSOR". AI-GENERATED label moved to the footer — no longer cluttering the body.',
    ],
  },
  {
    version: '5.5.5',
    date: '2026-05-27',
    phase: 'alpha',
    highlights: [
      'Bill brief PDF fully rebuilt (T150): one-page US letter, lobbyist-first layout. Four noise sections removed — bill timeline, political dynamics one-liner, recent amendments list, and "What to Watch" — replaced by a signal-ranked hierarchy.',
      'AI summary now shows only the Executive Summary (3 lines max) and Who is Affected (1 line) instead of rendering the full multi-section briefing memo. Wall-of-text problem resolved.',
      'Score display upgraded to a filled circle matching the member PDF gold standard (T147–T148). Tier label, one-liner context, and TRAJECTORY SCORE label all anchored to the right of the circle.',
      'Sponsor and Committee cards tightened from 22mm to 16mm; X-Factor chips rebalanced to 3 chips in a single row. Most bills now fit comfortably in ~140–190mm, well within a single page.',
      'All jsPDF font-before-wrapText discipline applied throughout (T148 pattern). Logo reduced to 14mm matching member PDF. loadSvgWithFillSwap no longer duplicated — uses the shared helper from pdf-shared.js.',
    ],
  },
  {
    version: '5.5.4',
    date: '2026-05-26',
    phase: 'alpha',
    highlights: [
      'Member brief PDF privacy fix: family information no longer appears in the Background section. Family members are private individuals — the PDF now matches the member card which has always excluded this field.',
    ],
  },
  {
    version: '5.5.3',
    date: '2026-05-26',
    phase: 'alpha',
    highlights: [
      'Member brief PDF audit (T148): fixed font-metric bug where bill titles were measured at the wrong font size before wrapping — titles now stay inside their column and no longer bleed into score circles.',
      'High-tier category line removed from Legislative Focus; bio summary capped at 1 line (was 2); priority chips capped at 4 (was 6). Combined savings of ~12mm keep most member profiles on a single page.',
      'Bill sub-row spacing tightened (1mm each × 5 bills) without losing stage/outcome/hearing-date context.',
      'Font-before-wrapText fix applied throughout: background lines and bio text now split at the correct rendered size.',
    ],
  },
  {
    version: '5.5.2',
    date: '2026-05-26',
    phase: 'alpha',
    highlights: [
      'Member brief PDF precision pass: bill title column width increased to guarantee a clean gap before the score circle — no more titles running into score numbers.',
      'Priority chips redrawn with top-anchored positioning; they now sit cleanly below the section rule line instead of overlapping it.',
      'Page-break safety net tightened (threshold lowered by 10mm) so the footer separator no longer cuts into the last stats footnote on busy member profiles.',
      'All committee abbreviations removed: "Cmte" → "Committee Passes", "V.CHAIR" → "VICE CHAIR", funnel labels written out in full.',
    ],
  },
  {
    version: '5.5.1',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Member brief PDF layout fixes: bill titles capped at one line, committee list capped at 5 seats with "+N more" indicator — resolves overflow for busy senators.',
      'Bio summary trimmed to 2 lines and bill row spacing tightened; a page-break safety net added to prevent content clipping on members with full profiles.',
    ],
  },
  {
    version: '5.5',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Member brief PDF fully rebuilt for C-suite and lobbyist sharing: logo smaller, "CONFIDENTIAL BRIEFING" removed, Vector branding reduced to header-only.',
      'Priority chips corrected for print — previous dark fill was designed for the dark UI and printed as blobs; now uses light surface fill with brass border.',
      'Bill rows now show stage, outcome (SIGNED / DEAD), and upcoming hearing dates within 60 days — the single most time-sensitive fact before a meeting.',
      'Electoral margin, party cohesion %, and attendance rate added — all computed from data already loaded, no new queries.',
      'Committee roles (CHAIR / V.CHAIR) now shown from real seat data; stage funnel and AI attribution tag added; "Session" stat replaced with Years Served.',
    ],
  },
  {
    version: '5.4',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Bill detail page deep audit and reorganization (T146). Layout reordered, duplicate content removed, labels corrected, accessibility improved.',
      'Stage Pipeline and Key Info Grid (committee, sponsor, hearing, cutoff, fiscal) now appear immediately below the score block — before the sparkline. "Where is this bill?" is answered in the first scroll, not the last.',
      'Trajectory tab labels corrected. "Momentum Index" (which was displaying the final score, not the momentum component) renamed to "Current Score". "Committee Density" (which was showing five signal component bars) renamed to "Score Components" with an accurate caption.',
      'Duplicate score formula removed from the Trajectory tab. The BASE × X Factor = Final formula is already shown in the main score block above the sparkline — repeating it in the tab added noise without adding information.',
      'Tab names clarified: "Signals" → "Score Breakdown", "Signal Strength" → "Pass Rates". The previous names were nearly identical and gave no indication of what each tab contained.',
      'X Factor top-summary strip now only appears when a bill has 7 or more X factors — previously it showed on every bill, duplicating every factor that also appeared in the full chip list below.',
      'iOS auto-zoom fixed on all three inputs and textareas (tag, notes, summary edit). Font size raised from 13px to 16px to prevent Safari\'s viewport zoom on focus.',
      'Sparkline draw animation now respects prefers-reduced-motion — the chart appears instantly for users with reduced motion enabled.',
    ],
  },
  {
    version: '5.3',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Search page deep audit and full rewrite (T145). Seven bugs fixed, UI rebuilt from scratch for lobbyist usability.',
      '"This Week" sort now works correctly. It was previously identical to "Recent" during interim period because the 7-day date clamp was skipped. The clamp now always applies — if nothing moved in the last 7 days, the page says so honestly.',
      '"Hearing Scheduled" filter renamed to "Had Hearing". The has_public_hearing field is a historical record of hearings that occurred during session — not a live schedule. The old label implied future events that no longer exist.',
      'Category counts removed. They were calculated from a PostgREST query capped at 1000 rows out of ~3400 bills, so every number was wrong. The counts are gone; category names remain.',
      'Category chips now scroll horizontally in a single line instead of wrapping to 5+ rows. The filter controls are now a compact 3-row header regardless of how many categories exist.',
      '"Load more" pagination fixed. It was re-fetching page 0 every time due to a stale closure on the page state variable. A ref now tracks the current page so new data is fetched correctly.',
      'Loading flash on initial page load fixed. The empty state briefly appeared before the first data fetch completed. Loading now starts as true to prevent the flicker.',
      'Empty state messages are now context-aware: "This Week" returns "No bills had new activity in the last 7 days" rather than the generic search hint.',
    ],
  },
  {
    version: '5.2',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Search page lobbyist UX upgrade (T144). Bill cards now show the prime sponsor with party color (blue / red) and the committee — two pieces of context lobbyists need at a glance without opening the bill.',
      'Inline watch toggle added to every bill card. Tap the bookmark icon to add or remove a bill from your watchlist directly from search results — no need to open the bill detail page.',
      '"Hearing Scheduled" and "This Week" quick-filter chips added below the dropdowns. One tap to surface only bills with a public hearing, or only bills that moved in the last 7 days.',
      'Category chips now show live bill counts — e.g. "Environment (312)" — so you can see where the legislative volume is before filtering.',
      'Bill titles now wrap to two lines instead of truncating. Short titles were fine at one line; longer titles now fully visible without opening the bill.',
      'WATCHING badge gained a brass pill background for legibility — previously the text label read as metadata rather than status.',
      'Bills with minority-only sponsors now show a "Minority Only" label, surfacing partisan alignment that matters to coalition-tracking work.',
      'Default view now shows an eyebrow: "Top-scoring bills this session · sorted by trajectory" — clarifies what you\'re looking at when no filters are active.',
    ],
  },
  {
    version: '5.1',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Search page UI quality pass (T143). Tapping the search field on iPhone no longer zooms the viewport — the input was 14px, below iOS Safari\'s 16px auto-zoom threshold. Now fixed.',
      'Outcome and category filter chips grew from 22px to a comfortable tap height. Each chip is now at least 34px — previously easy to miss on a phone.',
      'Filter chip state is now communicated to screen readers via aria-pressed. Toggle state was previously invisible to assistive technology.',
      'Search and bulk-tag inputs gained visible focus rings. Removing the browser outline without a replacement violates WCAG 2.4.7; brass border highlight now appears on focus.',
      'aria-label added to search and bulk-tag inputs. Placeholder text is not an accessible label.',
      'Bill card stagger animation (up to 50 cards) now respects prefers-reduced-motion.',
      'Empty state text contrast improved — was ~2:1 ratio against the dark background, now uses a readable mid-grey.',
    ],
  },
  {
    version: '5.0',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Home page UI quality pass (T142). Touch targets on the refresh button, navigation links, and the leg.wa.gov external link all meet the 44px minimum — previously as small as 20px on mobile.',
      '"View all", "All bills", and "All outcomes" converted from buttons to links — correct semantics for navigation, and now tappable across the full label area.',
      'Category intelligence cards are now keyboard-accessible: Enter and Space activate them. Previously click-only.',
      'Animations (timeline pulse dot, bill card fade-in stagger) now respect prefers-reduced-motion.',
      'Momentum velocity chip now uses SVG icons (Lucide TrendingUp/TrendingDown/Minus) instead of a Unicode triangle that rendered inconsistently across Android and iOS.',
      'Header horizontal padding aligned to 16px to match the sticky bar and content column — eliminates a 4px left-edge drift visible on narrow phones.',
    ],
  },
  {
    version: '4.9',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Watchlist swipe action panel now correctly appears when a card is swiped. Root cause: the card\'s GPU compositing layer always rendered above the static panel regardless of CSS z-index. Fix: the card and panel now animate in lockstep — as the card slides left, the panel slides in from the right in perfect sync. No z-index, no compositing conflict.',
    ],
  },
  {
    version: '4.8',
    date: '2026-05-25',
    phase: 'alpha',
    highlights: [
      'Watchlist swipe rebuilt from scratch. Root cause of previous failures: React synthetic touch handlers are always passive, making preventDefault() silently ignored by the browser. Fix: CSS touch-action: pan-y tells the browser to own vertical scroll and route horizontal movement to JS — no conflict possible.',
      'Swipe now uses the Pointer Events API with setPointerCapture, which works identically on mobile and desktop with a single code path.',
      'Swiped card gets a brass selection ring so it\'s clear which bill is active.',
    ],
  },
  {
    version: '4.7',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Watchlist swipe actions replaced with a three-dot (⋮) menu button on each bill card. Tap ⋮ to reveal "Add to Report" and "Remove" — no gestures required, works the same on mobile and desktop.',
      'Swipe gesture removed from watchlist cards. Multiple rounds of fixes confirmed the swipe paradigm conflicts with mobile scroll and desktop click-to-navigate; the action menu is a cleaner and more reliable solution.',
    ],
  },
  {
    version: '4.6',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Swipe affordance moved to the left edge of watchlist cards: a thin brass bar replaces the right-edge chevrons that were hidden behind the bookmark, pencil, and external-link icons. Left edge has no icon conflict and visually points in the swipe direction.',
      'Desktop swipe drag fixed: the browser\'s native text-selection drag no longer interrupts mid-gesture. Cursor now correctly shows "grabbing" while dragging.',
    ],
  },
  {
    version: '4.5',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Republican Senate member bios fixed: all 19 senators now have accurate bio profiles. The previous scraper pointed to a React-only site (src.wa.gov) that returned no readable content; updated to use the correct WA Senate Republican Caucus subdomain pages (src.wastateleg.org).',
      'Bio enrichment re-run for all members without summaries, covering the 19 affected Republican senators and any other members with stale or missing bio data.',
      'Monthly bio sync workflow now uses the corrected URL pattern, so future enrichment runs will stay current.',
    ],
  },
  {
    version: '4.4',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Swipe snap-back fixed: tapping Highlight or Remove now animates the card closed before the state update fires. Previously the action panel stayed visible because React re-renders and card unmounts were racing the 200ms CSS transition.',
      'Desktop swipe support added: bill cards on the watchlist now respond to click-and-drag in addition to touch — drag left to reveal the action panel, release to snap open or close.',
      'Swipe affordance indicator added: a faint brass double-chevron (‹‹) sits on the right edge of each watchlist card so it is clear the cards are swipeable.',
    ],
  },
  {
    version: '4.3',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Member detail page restructured: bio and legislative focus now appear first — the most decision-relevant context for a lobbyist — followed by committees, intelligence signals, and contact.',
      'Contact card redesigned with full-width tap targets (44px minimum height) and each method on its own row — phone and email are now distinct, tappable rows instead of inline text fragments.',
      'Bio summary text bumped from 11px to 13px and italic removed — profile text now reads at comfortable body scale, consistent with bill titles elsewhere in the app.',
      '"Member Background" eyebrow renamed to "Profile" — shorter and more accurate.',
      'Header chip row tightened: redundant "N bills sponsored" chip removed (visible in the Sponsored Bills tab), Print Card pushed to the trailing edge with auto margin.',
      'Bio loading state added: a skeleton loader now fills the profile card slot while the async bio fetch is in flight, replacing an invisible empty gap.',
    ],
  },
  {
    version: '4.2',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Swipe actions fixed: tapping Highlight or Remove now snaps the action panel closed immediately instead of leaving it visible behind the updated card.',
      'Tag and sort chips on the watchlist header now wrap to a second line on narrow viewports — consistent with the Search and Committees fix shipped in v4.1.',
      'Cal Feed button converted from a styled anchor to a proper button element — fixes a VoiceOver/TalkBack announcement issue where the element was read as a "link" with no destination.',
      '"What\'s Changed" dismiss button tap zone expanded to 44×44px — was a 16×16px character with minimal padding.',
      '"N selected for report" strip gains a top border separator so it reads as a distinct action row rather than trailing copy.',
    ],
  },
  {
    version: '4.1',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Filter chips on Search and Committees now wrap onto a second line instead of scrolling horizontally — all filters stay visible on any viewport width without swiping.',
      'Committees chip tap targets raised to 28px minimum height via inline-flex alignment — meets the same 44×44px standard applied to nav and legend buttons in v4.0.',
    ],
  },
  {
    version: '4.0',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'UI cleanup pass: 14 visual and UX fixes across home, watchlist, and members pages in one PR.',
      'Member detail sticky hero now correctly shields the full 0–52px region on scroll — notched iPhones no longer show content sliding behind the hamburger button.',
      'Home stat strip bottom padding corrected — the session stats were partially clipped by the fixed bottom nav on taller content loads. "High Signal" (count of top-12 fetched bills) replaced with "Top Score" — a more accurate session signal.',
      'Phone and email icons on member cards now use consistent SVG icons; font-size floor enforced on two remaining 8px badges.',
      'DM Sans removed from the Google Fonts request — the fallback was never reached, saving ~30KB per page load.',
      'Accessibility pass: bottom nav tabs now announce the active page to screen readers (aria-current). Members heatmap legend button and list chevron tap zones expanded to 44×44px — meets Apple HIG and WCAG 2.5.5 minimum.',
      'Hearings page: removed a stale typeof window guard around isInterimPeriod() — the guard was causing a hydration flash on first load since the function is pure date math with no browser dependency.',
      'Members heatmap popover positioning switched from window.innerWidth to calc(50vw − 160px) — eliminates a server-side rendering mismatch and centers the popover correctly on all mobile viewports.',
      'Score history sparkline now responds to tap on mobile — tapping a bar shows the tooltip, tapping again (or anywhere outside) dismisses it. Previously hover-only and invisible on touch screens.',
      'Votes tab on bill detail now shows a clear empty state when no roll-call votes have been recorded, instead of silently rendering nothing.',
      'Committees calendar loading state upgraded from plain text to the standard VectorLoader spinner — consistent with the rest of the app.',
      'Search results list fades to 50% opacity while a new fetch is in flight, giving instant feedback during the debounce window.',
      'Senate accent color tokenized as --senate-accent (#c87941) — all Senate chamber indicators now share a single source of truth instead of scattered #ffa84d hardcodes.',
      'Search empty state is now context-aware: cold state explains what to search; zero-results state gives targeted retry guidance.',
      'Hearings empty state splits on session vs interim — active session shows committee schedule timing guidance, interim shows the next session open date.',
      'Watchlist empty state improved: sharper headline, inline explanation of the + Watch gesture, and "Search Bills" CTA replaced the generic "Browse Bills" label.',
    ],
  },
  {
    version: '3.9',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Bill detail page typography pass: 15 sub-minimum font sizes eliminated — the densest fix count of any page audited. The Trajectory tab formula bar, Momentum Index and Committee Density cards, stage pipeline labels, sparkline x-axis, and score history eyebrow all now meet the 9px floor.',
      'AI badge labels (AI · EDITED, AI-GENERATED), the confidence label duplicate chip, and the X-factor "Top contributors" eyebrow all brought up to 9px.',
      'Italic dropped from the floor vote verdict chip and the score history "No score change" row — consistent with the same fix applied to search and members pages.',
    ],
  },
  {
    version: '3.8',
    date: '2026-05-24',
    phase: 'alpha',
    highlights: [
      'Members page typography pass: six sub-minimum font sizes eliminated across the heatmap popover, Top 5 callout, committee list, and member list cards — nothing now renders below 9px.',
      'HIGH-tier activity disclaimer no longer italicised at minimum font size — consistent with the same fix applied to the search calibration citation.',
    ],
  },
  {
    version: '3.7',
    date: '2026-05-23',
    phase: 'alpha',
    highlights: [
      'Search result cards no longer show the score twice — the redundant right-side number is removed, consistent with the watchlist and home page fixes.',
      '"Watch All" button now shows the count of displayed bills (e.g. "+ Watch 50+") so the scope is clear before tapping.',
      'Calibration citation on search results is now readable — was rendered at 10px italic in the faintest color token; now 11px in standard muted text.',
      'Search scope hint ("Searches title, bill number, and AI summary") is now always visible below the input instead of appearing only after typing 3 characters.',
    ],
  },
  {
    version: '3.6',
    date: '2026-05-23',
    phase: 'alpha',
    highlights: [
      'Home page bill cards no longer show the score twice — the redundant right-side number was removed from both the watchlist preview and the Top Trajectory list. The score badge carries it.',
      '"Your Watchlist" heading and "View all →" link are now in the same row instead of appearing as two separate elements.',
      'High Score stat card now dims correctly when the count is zero instead of glowing teal on a zero value.',
      'Session Timeline date labels enlarged from 8px to 9px for readability on mobile.',
      'Category Intelligence section now correctly labels itself during an active session instead of always reading "Interim Intelligence."',
    ],
  },
  {
    version: '3.5',
    date: '2026-05-23',
    phase: 'alpha',
    highlights: [
      'Watchlist "What\'s Changed" panel now shows bill titles alongside bill numbers — no more mental lookup when 20+ bills are tracked.',
      'Redundant score number removed from bill cards — the score badge already carries this; the right column now shows only action icons.',
      'Filter empty state corrected: activating At Risk or a tag filter with no matching bills now shows a clear "No bills match this filter" message instead of the misleading "No bills tracked yet" CTA.',
      '"What\'s Changed" header reformatted — "Since your last visit" is now a distinct DM Mono metadata label below the heading instead of inline body text mixed with the display font.',
      'Minor polish: quick-note pencil icon raised to 70% opacity at rest (was 50%), legacy note field labeled with a NOTE eyebrow, FOR REPORT text enlarged to 9px, --brass CSS fallback literals removed.',
    ],
  },
  {
    version: '3.4',
    date: '2026-05-23',
    phase: 'alpha',
    highlights: [
      'Score formula on bill detail now always shows the large brass number — previously it disappeared on bills without a momentum multiplier.',
      'Bill title no longer appears twice on the bill detail page — the duplicate below the AI summary was removed.',
      'Visual tone corrections: undefined CSS color token patched, score block gradient anchored to design tokens, refresh button more visible at rest.',
    ],
  },
  {
    version: '3.3',
    date: '2026-05-21',
    phase: 'alpha',
    highlights: [
      'Member bio panel reordered for lobbyist use — legislative priorities and background (education, career, family) now appear at the top of the Overview tab, right after contact info, instead of buried below analytics cards (Threads 114–115).',
      'Baseball card PDF redesigned with a congressional card layout — legislative focus section moves immediately after the photo/identity block, and top bills + committee assignments appear side by side in a two-column format (Thread 115).',
      'Committee chip strip on member detail page relabeled "Bill Referral Committees" with a clarifying note — the data shows which committees received this member\'s sponsored bills, not which committees the member sits on as a seat holder (Thread 115).',
    ],
  },
  {
    version: '3.2',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Member baseball card: tap "Print Card" on any legislator to generate a PDF briefing with photo, contact info, committee assignments, and Vector | WA intelligence metrics (Thread 112).',
      'Designed for pre-meeting preparation — professional enough to leave on a desk (Thread 112).',
    ],
  },
  {
    version: '3.1',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Member list now shows legislator photos with a blue or red party-color border instead of initials — instant face recognition without clicking through (Thread 111).',
      'Opening a member panel shows a larger portrait photo so you can put a face to the briefing before your meeting (Thread 111).',
    ],
  },
  {
    version: '3.0',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Member detail panel now shows direct phone and email for every legislator — pulled from the WA Legislature roster API (Thread 110).',
      'Phone and email are stored in the database and will refresh automatically on each nightly sync going forward (Thread 110).',
    ],
  },
  {
    version: '2.9',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Highlighted bills on the watchlist now glow with a subtle brass background and ring so it is immediately obvious which bills are selected for your PDF report (Thread 109).',
      'The "Subscribe" button in the watchlist header is now labeled "Cal Feed" — it subscribes your Apple or Google Calendar to a live feed of hearing dates for your tracked bills (Thread 109).',
    ],
  },
  {
    version: '2.8',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Committee detail bill query limit raised from 300 to 500 — defensive cap for any future session with a larger docket (Thread 108).',
      'Bill count subtitle on committee detail pages now reads "X bills by score" so it is clear the list is sorted by trajectory score, not arbitrary order (Thread 108).',
    ],
  },
  {
    version: '2.7',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Bill chips in the YOUR BILLS meetings section now navigate directly to the bill detail page — one tap from a scheduled hearing to the full bill (Thread 107).',
      'Each bill chip now shows the trajectory score alongside the bill number (e.g. "HB 1271 · 74") so you can assess priority without leaving the calendar (Thread 107).',
    ],
  },
  {
    version: '2.6',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Watchlist remove action now includes a user-id guard on the database delete — defense-in-depth against any future RLS misconfiguration (Thread 106).',
      'Bottom padding on the watchlist corrected from 20px to 110px — the last bill card no longer hides behind the nav bar (Thread 106).',
      'Duplicate billIds computation in the PDF export handler consolidated into a single declaration (Thread 106).',
    ],
  },
  {
    version: '2.5',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Committee detail pages now surface your tracked bills at the top of the bill list under a "YOUR TRACKED BILLS" header — no more scanning 80 bills to find your 3 (Thread 105).',
      'The bill count chip on committee detail pages shows how many of your tracked bills are in that committee at a glance (Thread 105).',
    ],
  },
  {
    version: '2.4',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Tapping a hearing badge on the watchlist now navigates directly to the specific committee page — not just the full calendar — so you land on the exact committee that has your bill scheduled (Thread 104).',
      'Watchlist load now fires a single batched query for all upcoming hearings across every tracked bill, replacing up to 25 individual queries — faster page load, fewer round-trips to the database (Thread 104).',
    ],
  },
  {
    version: '2.3',
    date: '2026-05-18',
    phase: 'alpha',
    highlights: [
      'Committees calendar now opens with a pinned "YOUR BILLS" section for logged-in users — showing only the upcoming meetings where your tracked bills appear on the agenda, with bill number chips (HB 1234, SB 5678) listed directly on each card (Thread 103).',
      'Every meeting card in the full calendar below now displays a brass "N of yours" pip when any of your watched bills are on that agenda — so you can spot relevant hearings at a glance without reading every committee name (Thread 103).',
      'Both features are anon-safe and interim-safe: if you have no tracked bills, or there are no upcoming meetings, the page renders exactly as before (Thread 103).',
    ],
  },
  {
    version: '2.2',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Swipe left on any watchlist bill card to reveal two quick actions: Highlight (brass) marks the bill for your next report, Remove deletes it from your watchlist in one tap — no more navigating to the bill detail page (Thread 102).',
      'When one or more bills are highlighted, the export button switches to "Export selected (N)" and the brief covers only those bills — sharper, faster reports for lobbyist workflows (Thread 102).',
      'Highlighted cards get a brass left-border accent and a "FOR REPORT" label in the top corner. Opening a second card snaps the previous one closed. Highlight state resets on refresh, keeping the list clean between sessions (Thread 102).',
    ],
  },
  {
    version: '2.1',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Watchlist header now shows three KPI cards — Tracked, High Score, and At Risk — in the same card format used on the home dashboard, so your portfolio summary is immediately readable without scanning the bill list (Thread 96).',
      'During the interim period the KPI cards shift to Tracked, Passed, and Dead — the same biennium-aware pattern the home page uses (Thread 96).',
    ],
  },
  {
    version: '2.0',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Home dashboard now has two clearly labeled zones — "YOUR WATCHLIST" for your personal tracked bills and "SESSION INTELLIGENCE · 2025-26" for legislature-wide data — so the difference between your portfolio and the whole session is immediately obvious (Thread 95).',
      'A thin rule divides the personal zone from the global zone, giving the home page a cleaner reading hierarchy without changing any of the underlying data (Thread 95).',
    ],
  },
  {
    version: '1.9',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Bill detail score formula now shows the result (e.g. "86") at 32px in brass — visually dominant over the formula prefix — so the conclusion is immediately readable without scanning the calculation (Thread 91).',
      'Momentum multiplier on the formula line (e.g. "1.29") now shows a tappable info chip explaining it is a momentum factor — how fast the bill moved relative to its stage (Thread 91).',
    ],
  },
  {
    version: '1.8',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Bottom navigation label corrected — "Committees" now displays in full during the interim period between sessions, replacing the abbreviated "Cmtes" that appeared since launch (Thread 89).',
    ],
  },
  {
    version: '1.7',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Anonymous users redirected to sign-in from /watchlist now see a clear explanation — "Sign in to access your watchlist" — instead of arriving at a blank login screen with no context (Thread 88).',
    ],
  },
  {
    version: '1.6',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Home page bill count now shows the session year — "Bills (2025-26)" instead of the generic "Bills Scored," so it is clear the number is session-specific and not the full cross-biennium archive (Thread 87).',
      'Category score averages on the home page now read "avg score 59" instead of the raw "avg 59," connecting the number to the 0–99 scoring system (Thread 87).',
      'Side drawer role chip updated from "REGISTERED" to "EARLY ACCESS" for signed-in users during the closed beta period (Thread 87).',
      'Roadmap timeline complete — the "~3,400 bills tracked" milestone now shows its date (Jan 2026) instead of "live," so every item on the timeline has a consistent date chip (Thread 87).',
    ],
  },
  {
    version: '1.5',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Switching the session in the drawer now updates Members, Committees, Hearings, and Search instantly — no hard reload needed (Thread 86).',
    ],
  },
  {
    version: '1.4',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      '10 pages now show accurate browser tab titles — Search, Members, Committees, Hearings, Roadmap, Changelog, Install, Sign In, Watchlist, and Settings all display "Page — Vector | WA" instead of the bare site name (Thread 85).',
    ],
  },
  {
    version: '1.3',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Consistent loading screens — every data page now shows the brass arrow loader instead of plain "Loading..." text, bringing members, search, and other surfaces in line with the watchlist (Thread 84).',
      'Global session picker — the session / biennium selector moved from individual pages into the side drawer, so one tap switches the whole app to 2025-26 or any historical biennium at once (Thread 84).',
      'Historical data banner — an amber strip appears automatically whenever you are viewing a past biennium, with a one-tap shortcut back to the current session (Thread 84).',
      'Career View on /members — a dedicated toggle aggregates all biennia at once for legislator-level career analysis, separate from the global biennium context (Thread 84).',
    ],
  },
  {
    version: '1.2',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Search visibility — added sitemap, robots.txt, and structured data (Organization + Legislation schema) so Google can discover and index Vector | WA before the August 2027 public launch (Thread 82).',
      'All sharing links now resolve to vectorwa.com — fixed a metadata configuration bug that caused Open Graph URLs to point at an internal Vercel preview domain instead of the canonical site (Thread 82).',
      'Per-page titles now follow the "Page — Vector | WA" format for cleaner browser tabs and search result snippets (Thread 82).',
    ],
  },
  {
    version: '1.1',
    date: '2026-05-11',
    phase: 'alpha',
    highlights: [
      'Admin "Grant access" button on the waitlist page — closed-beta applicants can now be invited directly without leaving the app (Thread 78).',
      'Historical legislator accuracy — the 2021-22 session picker on /members now correctly splits the roster into House and Senate, with party affiliation restored for returning legislators (Thread 79).',
      'PDF briefs (watchlist multi-bill and Print Brief) finalized to Brand Guide v1.2 — real Vector | WA logo replaces the hand-drawn placeholder in the watchlist brief; legacy parchment-warm surface colors standardized; wrong days-until-next-session counts removed from both briefs (Thread 80).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-10',
    phase: 'alpha',
    highlights: [
      'OTP login replaces magic-link flow — fixes iOS PWA authentication where Safari\'s WKWebView cookie split was silently breaking sign-in for installed-app users (Thread 76).',
      'Closed beta waitlist form on /login — applicants acknowledge 4 beta-stage expectations before submitting; admin UI gains a Closed Beta tab with acked/un-acked sorting (Thread 73).',
      '/roadmap page launched with 8 shipped milestones and 6 upcoming features; linked from footer, side drawer, and the login page (Thread 72).',
      'Loading spinners added to the members list and home page during initial data fetch — both were flashing an empty shell before data arrived (Thread 75).',
      'Footer freshness label color and font style corrected to match the Brand Guide v1.2 muted-text spec (Thread 77).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-07',
    phase: 'alpha',
    highlights: [
      'Members and committees page counts now accurate for all session years — server-side SQL views replace client-side reduce loops that were silently truncating at 1,000 rows; 2025-26 shows 147 legislators and all 65 committees (Threads 69–70).',
      'Methodology calibration corrected to 84% accuracy across 2,134 bills — the previous page displayed a contradictory 78.4% / 189-bill figure; denominator, tier color coding, and statistical disclosure language all updated (Thread 67).',
      '/how-it-works renamed to /install with a 308 permanent redirect from the old path; hero CTA repointed to /about as the acquisition surface (Thread 71).',
      'Post-close trajectory copy for bills that passed chamber but did not become law now reads correctly during the interim period instead of repeating active-session language (Thread 41 follow-up).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-03',
    phase: 'alpha',
    highlights: [
      'Platform-aware PWA install prompt on /install — Android and desktop Chrome get a native install button, iOS users get share-sheet instructions, and already-installed state shows a confirmation pill (Thread 61).',
      'Login page gains Methodology and About links below the sign-in card so anonymous visitors can explore the platform before committing to sign up (Thread 65).',
      'Anonymous routes for /methodology, /about, /install, and /changelog fixed — they were incorrectly gated behind the public-layer flag and silently bouncing visitors back to /login (Thread 65 follow-up).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-02',
    phase: 'alpha',
    highlights: [
      'Last-action-date sync bug corrected — 23 archived bills were being stamped with the current sync timestamp instead of NULL when no action history was available from the API; those bills no longer float to the top of Most Recent Action sort (Thread 57).',
      'Side drawer polish — Admin link fixed (was 404ing), reference links for Disclaimers, About, and Methodology added for signed-in users, Settings gear moved to drawer footer in a dedicated bottom block (Thread 58).',
      '/changelog page launched and accessible to all visitors; version label added to the drawer header in DM Mono caption; version + phase helpers added to app/lib/version.js for future phase-gate use (Threads 59–60).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-01',
    phase: 'alpha',
    highlights: [
      'LinkedIn-style side drawer added — viewer-aware body (public/registered/team), biennium-aware subtitle, hamburger button, and solid backdrop; watchlist count badge via supabase head query; window CustomEvents decouple Nav and drawer (Thread 55).',
      'Sticky header density fix — narrow-viewport hamburger clamp added to keep header within the 480px column on iPhone (Thread 37).',
      'Pre-launch housekeeping — corrections@vectorwa.com live, CSS party-color vars, search/watchlist emoji entities fixed, datasheet refresh, square logo, PWA install explainer (Thread 36).',
    ],
  },
]
