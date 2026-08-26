// Vector | WA - /welcome landing page (LANDING-1, 2026-06-20).
//
// The public front door: a desktop-ready, phone-responsive surface that says
// plainly what Vector does and links into the app. This is the ONE deliberate
// exception to the mobile-only rule (CLAUDE.md) - it touches nothing else;
// all other routes stay mobile-first. Reachable by anon via proxy.js
// isAlwaysPublic('/welcome').
//
// Static server component. The body markup is injected verbatim
// (dangerouslySetInnerHTML) - it is fully static, first-party content with no
// user input. Styles live in route-scoped welcome.css (imported by layout.js),
// scoped under .vwl so nothing leaks into the app shell.
//
// COPY-1 (2026-08-26): rewritten to plain, factual copy. Removed the
// marketing hero flourish, the decorative floating brief/alert cards, the
// per-feature tag chips, and the "Every bill. Every legislator. One place."
// band. Stat figures verified against the database on the same date
// (3,411 current-session bills, 147 legislator bios, 113 committees).
// COPY-2 (2026-08-26): second pass - headings reduced to plain nouns
// (PDF briefs / Bill pages / Watchlist / Radar), duplicate eyebrow labels
// dropped above them, adjectives and stat-strip descriptors trimmed.
// COPY-3 (2026-08-26): body copy cut to one or two short factual
// sentences per section. Section headings: "Built for mobile use",
// "Additional features".

export const metadata = {
  title: 'Bill tracking for the Washington State Legislature',
  description: 'Every bill and legislator in the Washington State Legislature. Summaries, watchlists, PDF briefs, and email alerts when bill text changes. Free.',
  alternates: { canonical: '/welcome' },
  openGraph: {
    title: 'Vector | WA - bill tracking for the Washington State Legislature',
    description: 'Every bill and legislator in the Washington State Legislature. Summaries, watchlists, PDF briefs, and email alerts when bill text changes. Free.',
    url: '/welcome',
    siteName: 'Vector | WA',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vector | WA - bill tracking for the Washington State Legislature',
    description: 'Every bill and legislator in the Washington State Legislature. Summaries, watchlists, PDF briefs, and email alerts when bill text changes. Free.',
    images: ['/og-image.png'],
  },
}

const MARKUP = `<div class="dev-bar">&#9679;&nbsp; Alpha &middot; in active development. Features and data may change.</div>

<header class="nav">
  <div class="wrap nav-inner">
    <a href="/" aria-label="Vector | WA home"><svg class="logo-svg" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="580 315 895 500" aria-label="Vector | WA">\n        <path fill="#b8975a" d="M 1214.12 325.42 C 1219.88 324.877 1227.59 323.031 1230.09 329.676 C 1227.33 333.964 1205.46 336.612 1198.85 338.167 C 1175.52 343.556 1152.74 351.102 1130.8 360.706 C 1044.54 397.79 974.959 465.332 935.319 550.445 C 930.149 561.532 925.126 573.471 921.069 584.983 C 917.996 593.7 915.946 603.706 912.535 612.218 L 912.178 613.095 L 839.971 613.126 L 823.772 613.254 C 845.671 558.825 865.776 518.502 904.799 473.349 C 984.172 381.507 1094.89 334.434 1214.12 325.42 z"/>\n        <path fill="#b8975a" d="M 1196.25 660.766 C 1199.91 660.654 1200.96 660.703 1204.58 661.244 C 1207.41 664.713 1206 787.849 1205.99 801.961 C 1201.74 801.991 1199.59 802.563 1196.52 800.514 C 1195.37 789.684 1196.14 764.288 1196.17 752.628 L 1196.25 660.766 z"/>\n        <path fill="#ebeae4" d="M 1361.66 686.881 C 1365.32 686.754 1369.02 686.364 1372.51 687.367 L 1373.49 689.209 L 1371.82 693.871 C 1362.25 722.391 1352.01 750.687 1342.56 779.167 L 1330.56 779.133 C 1323.59 761.272 1316.48 738.918 1310.06 720.419 C 1303.07 738.481 1296.09 760.501 1289.5 779.099 L 1277.57 779.079 C 1267.1 748.611 1258.05 717.112 1247.01 686.991 L 1260.6 687.026 C 1266.85 709.238 1276.05 740.681 1283.86 762.051 C 1287.51 752.356 1302.26 699.672 1308.74 696.488 C 1310.05 695.844 1310.72 696.353 1312.04 696.769 C 1317.99 702.553 1332.27 750.555 1336.12 762.244 C 1344.89 741.207 1353.49 709.773 1361.66 686.881 z"/>\n        <path fill="#ebeae4" d="M 697.3 687.014 L 758.197 686.992 L 758.2 701.956 L 715.133 701.912 L 715.077 725.394 C 727.959 725.896 742.442 725.4 755.44 725.23 L 755.38 740.02 L 715.425 740.02 C 714.849 744.366 715.158 759.048 715.15 764.159 L 758.25 764.065 L 758.29 779.037 C 738.082 778.81 717.447 779.036 697.203 779.044 L 697.3 687.014 z"/>\n        <path fill="#ebeae4" d="M 818.437 685.259 C 841.24 684.205 853.549 692.081 860.278 713.87 C 854.338 715.048 848.405 716.265 842.481 717.522 C 835.381 696.848 813.599 694.068 803.318 714.124 C 797.564 725.347 799.741 739.281 803.16 751.001 C 808.177 768.2 834.894 770.485 840.502 754.648 C 841.304 752.175 841.363 751.97 842.823 749.848 C 847.932 747.961 855.034 748.87 860.885 748.99 C 858.465 766.763 850.035 776.727 831.731 780.108 C 784.462 788.838 769.127 732.988 790.493 700.378 C 796.584 691.083 807.532 686.92 818.437 685.259 z"/>\n        <path fill="#ebeae4" d="M 591.297 687.093 L 610.527 687.007 C 618.565 709.951 626.157 733.768 633.785 756.892 C 641.716 735.267 649.874 709.136 656.958 687.013 L 675.754 687.045 L 669.653 703.252 L 642.278 779.054 L 624.935 778.971 C 615.181 750.346 602.437 714.89 591.297 687.093 z"/>\n        <path fill="#ebeae4" d="M 875.341 687.016 L 949.902 687.023 L 949.931 702.023 L 921.864 701.931 L 921.883 749.75 L 921.891 778.978 L 903.879 778.958 L 903.868 702.005 L 875.195 701.958 L 875.341 687.016 z"/>\n        <path fill="#ebeae4" fill-rule="evenodd" d="M 1001.03 685.231 C 1046.41 683.033 1060.69 726.608 1041.71 762.891 C 1036.48 772.901 1023.95 778.276 1013.1 780.341 C 967.498 786.52 950.872 736.049 971.921 701.898 C 978.296 691.555 989.483 687.341 1001.03 685.231 z M 1000.03 701.183 C 1034.16 698.301 1039.01 735.86 1022.66 758.693 C 1020.74 761.376 1015.97 763.441 1012.91 764.769 C 1008.87 765.045 1002.51 765.604 998.904 764 C 974.405 753.114 975.676 711.84 1000.03 701.183 z"/>\n        <path fill="#ebeae4" fill-rule="evenodd" d="M 1074.75 687.017 C 1098.51 686.85 1144.21 680.237 1144.42 714.194 C 1144.52 730.609 1137.82 736.378 1124.15 742.852 L 1147.72 779.011 L 1130.75 779.023 L 1127.53 778.908 C 1123.39 776.731 1109.14 749.845 1105.75 744.108 L 1092.7 744.298 L 1092.75 778.998 L 1074.85 779.01 L 1074.75 687.017 z M 1092.58 701.605 C 1108.35 701.501 1138.78 701.074 1122.88 726.882 C 1114.23 732.956 1103.27 731.379 1092.67 731.194 C 1092.53 721.332 1092.5 711.468 1092.58 701.605 z"/>\n        <path fill="#ebeae4" fill-rule="evenodd" d="M 1412.24 686.995 L 1427.29 687.057 C 1433.98 710.775 1450.3 755.904 1458.93 779.052 L 1445.95 778.988 C 1443.21 771.488 1440.64 763.596 1438.06 756.016 L 1425.88 756.09 L 1399.95 756.292 L 1392.03 779.059 L 1379.53 778.938 L 1412.24 686.995 z M 1419.22 701.676 C 1423.32 709.796 1431.82 736.458 1435.42 746.61 L 1419.09 746.77 L 1403.24 746.701 C 1408.8 732.488 1414.13 716.198 1419.22 701.676 z"/>\n      </svg></a>
    <nav class="nav-links">
      <a href="#what">What it does</a>
      <a href="#phone">Mobile</a>
      <a href="/methodology">Methodology</a>
      <a href="/changelog">Changelog</a>
    </nav>
    <a href="/login" class="btn btn-primary">Request access</a>
  </div>
</header>

<div class="wrap">
  <section class="hero">
    <div>
      <span class="eyebrow">Washington State Legislature</span>
      <h1>Bill tracking</h1>
      <p class="sub">Every bill and legislator in the Washington State Legislature. Summaries, watchlists, PDF briefs, and text-change alerts. Free and open source.</p>
      <div class="cta-row">
        <a href="/login" class="btn btn-primary btn-lg">Request access</a>
        <a href="#what" class="btn btn-ghost btn-lg">What it does</a>
      </div>
      <div class="trustline">
        <span>Free</span><span class="dot"></span>
        <span>MIT licensed</span><span class="dot"></span>
        <span>Data from the Legislature</span>
      </div>
    </div>

    <div class="hero-visual">
      <div class="device">
        <div class="screen">
          <img class="screenshot" src="/welcome-members.webp" width="600" height="869" fetchpriority="high" alt="Vector | WA members list on a phone" />
        </div>
      </div>
    </div>
  </section>
</div>

<div class="wrap">
  <div class="stats">
    <div class="stat"><div class="n">3,400+</div><div class="l">Bills this session</div></div>
    <div class="stat"><div class="n">147</div><div class="l">Legislators</div></div>
    <div class="stat"><div class="n">113</div><div class="l">Committees</div></div>
    <div class="stat"><div class="n">Free</div><div class="l">No ads, no subscription</div></div>
  </div>
</div>

<div class="wrap" id="what">
  <section style="padding-bottom:20px">
    <div class="sec-head">
      <h2>What it does</h2>
    </div>
  </section>

  <div class="feature">
    <div class="ftext">
      <h3>PDF briefs</h3>
      <p>Export any bill or legislator as a one-page PDF.</p>
    </div>
    <div class="fvis">
      <div class="briefs"><figure class="doc-page"><img src="/welcome-pdf-billpage.webp" width="1265" height="1639" alt="Bill brief PDF" loading="lazy" /></figure><figure class="doc-page"><img src="/welcome-pdf-member.webp" width="1265" height="1639" alt="Member brief PDF" loading="lazy" /></figure></div>
    </div>
  </div>

  <div class="feature rev">
    <div class="ftext">
      <h3>Bill pages</h3>
      <p>Summary, stage, sponsor, committee, fiscal note, and roll-call votes. Updated through the day.</p>
    </div>
    <div class="fvis">
      <figure class="shot-phone"><img src="/welcome-bill.webp" width="980" height="1390" alt="A bill page on a phone" loading="lazy" /></figure>
    </div>
  </div>

  <div class="feature">
    <div class="ftext">
      <h3>Watchlist</h3>
      <p>Save bills to a list. Status changes and hearings show up in one place.</p>
    </div>
    <div class="fvis">
      <figure class="shot-phone"><img src="/welcome-watchlist.webp" width="980" height="1400" alt="A watchlist on a phone" loading="lazy" /></figure>
    </div>
  </div>

  <div class="feature rev">
    <div class="ftext">
      <h3>Radar</h3>
      <p>Add terms to follow. Get an email when a new or amended bill matches, with the text quoted.</p>
    </div>
    <div class="fvis">
      <div class="mail">
        <div class="mh"><span class="mk">Radar alert</span><span style="font-size:13px;color:var(--text-mid)">Example</span></div>
        <div class="msub">Your term &ldquo;behavioral health&rdquo; matched 2 bills</div>
        <div class="mmatch">
          <span class="mterm">behavioral health</span>
          <div style="flex:1">
            <div style="font-size:13.5px;color:var(--cream)"><b>SB 5266</b> &mdash; Workforce expansion <span class="badge-new">New bill</span></div>
            <div class="mquote">&ldquo;&hellip;a loan repayment program for behavioral health professionals serving rural communities&hellip;&rdquo;</div>
          </div>
        </div>
        <div class="mmatch">
          <span class="mterm">behavioral health</span>
          <div style="flex:1">
            <div style="font-size:13.5px;color:var(--cream)"><b>HB 1432</b> &mdash; Medicaid rates <span class="badge-new" style="color:var(--brass-light);border-color:rgba(212,180,122,.4)">Updated</span></div>
            <div class="mquote">&ldquo;&hellip;amended to include community behavioral health agencies in the rate rebasing&hellip;&rdquo;</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<section class="band" id="phone">
  <div class="wrap band-in">
    <div>
      <h3>Built for mobile use</h3>
      <p>Designed for a phone screen. Add it to your home screen from the browser. No app to download.</p>
    </div>
    <div class="phones">
      <figure class="shot-phone"><img src="/welcome-home.webp" width="688" height="1504" alt="Vector | WA on a phone home screen" loading="lazy" /></figure>
    </div>
  </div>
</section>

<div class="wrap">
  <section>
    <div class="sec-head" style="margin-bottom:30px">
      <h2>Additional features</h2>
    </div>
    <div class="also">
      <div class="acard"><h4>Summaries</h4><p>Every bill in plain English, linked to the official text.</p></div>
      <div class="acard"><h4>Committees and hearings</h4><p>Which committee is hearing what, and when.</p></div>
      <div class="acard"><h4>News</h4><p>Legislative reporting from Washington newsrooms.</p></div>
      <div class="acard"><h4>Trajectory score</h4><p>A 0&ndash;99 estimate of how far a bill is likely to get, calibrated on past sessions.</p><a href="/methodology">How it&rsquo;s calculated &rarr;</a></div>
    </div>
    <p class="src-note">Bill and legislator data comes from the Washington State Legislature. Summaries and the trajectory score are AI-assisted and can be wrong &mdash; check anything important against the official record.</p>
  </section>
</div>

<section class="final">
  <div class="wrap">
    <h2>Request access</h2>
    <p>Vector is in alpha. Access is granted by hand for now. It will be free and open to everyone at public launch.</p>
    <div class="cta-row">
      <a href="/login" class="btn btn-primary btn-lg">Request access</a>
    </div>
  </div>
</section>

<footer class="lp-footer">
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-brand"><svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="815 320 420 300" aria-label="Vector | WA mark">\n          <path fill="#b8975a" d="M 1214.12 325.42 C 1219.88 324.877 1227.59 323.031 1230.09 329.676 C 1227.33 333.964 1205.46 336.612 1198.85 338.167 C 1175.52 343.556 1152.74 351.102 1130.8 360.706 C 1044.54 397.79 974.959 465.332 935.319 550.445 C 930.149 561.532 925.126 573.471 921.069 584.983 C 917.996 593.7 915.946 603.706 912.535 612.218 L 912.178 613.095 L 839.971 613.126 L 823.772 613.254 C 845.671 558.825 865.776 518.502 904.799 473.349 C 984.172 381.507 1094.89 334.434 1214.12 325.42 z"/>\n        </svg>
        <div class="bl">Bill tracking for the Washington State Legislature</div>
      </div>
      <div class="foot-links">
        <a href="/install">How it works</a>
        <a href="/methodology">Methodology</a>
        <a href="/changelog">Changelog</a>
        <a href="/roadmap">Roadmap</a>
        <a href="/disclaimers">Disclaimers</a>
      </div>
      <span class="pill">Alpha</span>
    </div>
    <div class="foot-bot">
      <span>&copy; 2026 Vector | WA &middot; MIT licensed &middot; Data from the Washington State Legislature</span>
      <span>Independent project. Not affiliated with the Washington State Legislature.</span>
    </div>
  </div>
</footer>`

export default function WelcomePage() {
  return <div className="vwl" data-welcome dangerouslySetInnerHTML={{ __html: MARKUP }} />
}
