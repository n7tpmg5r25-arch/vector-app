#!/usr/bin/env node
/*
 * Vector | WA — pre-commit secret scanner (zero dependencies, Node core only).
 * Blocks a commit if the staged changes look like they contain a credential or
 * a .env file. This is a safety net so a secret never gets committed by accident.
 *
 * If something is wrongly blocked AND you are certain it is not a secret, you can
 * override for one commit with:   git commit --no-verify
 */
'use strict';
const { execSync } = require('child_process');

function git(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ''; }
}

// 1) Never allow a real .env file to be committed (templates are fine).
const names = git('git diff --cached --name-only --diff-filter=ACM')
  .split('\n').map(s => s.trim()).filter(Boolean);
const envHits = names.filter(n => /(^|\/)\.env(\.|$)/.test(n) && !/\.(example|sample|template)$/i.test(n));

// 2) Scan ADDED lines for known credential formats.
const PATTERNS = [
  ['Supabase / JWT key',          /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase secret key',         /sb_secret_[A-Za-z0-9]{20,}/],
  ['Anthropic API key',           /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key',              /sk-[A-Za-z0-9]{32,}/],
  ['Resend API key',              /\bre_[A-Za-z0-9]{20,}/],
  ['AWS access key id',           /AKIA[0-9A-Z]{16}/],
  ['GitHub token',                /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['Google API key',              /AIza[0-9A-Za-z_-]{35}/],
  ['Slack token',                 /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Private key block',           /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Generic secret assignment',   /(?:secret|token|passwd|password|api[_-]?key|service[_-]?key|client[_-]?secret)['"\s]*[:=]['"\s]*[A-Za-z0-9/+_-]{20,}/i],
];

// Lines that match any of these are treated as safe: env references, public
// publishable keys, and obvious placeholders.
const ALLOW = /(process\.env\.|import\.meta\.env|NEXT_PUBLIC_|sb_publishable_|REPLACE_ME|example\.com|your[_-]|<your|placeholder|xxxxx|redacted|dummy|changeme|\.example)/i;

const diff = git('git diff --cached --unified=0 --no-color');
const findings = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) { file = line.slice(6); continue; }      // "+++ b/<path>"
  if (file.startsWith('.githooks/')) continue;                          // never scan the scanner
  if (!line.startsWith('+') || line.startsWith('+++')) continue;        // added lines only
  const text = line.slice(1);
  if (ALLOW.test(text)) continue;
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) { findings.push({ file, label, snippet: text.trim().slice(0, 90) }); break; }
  }
}

if (envHits.length === 0 && findings.length === 0) process.exit(0);

console.error('\n\x1b[31m\x1b[1m  COMMIT BLOCKED — a possible secret was found in your staged changes\x1b[0m');
for (const f of envHits) console.error(`   - env file staged: ${f}   (.env files must never be committed)`);
for (const f of findings) console.error(`   - ${f.label}  ->  ${f.file}\n        ${f.snippet}`);
console.error('\n  Fix: remove the secret and use an environment variable / GitHub Secret instead.');
console.error('  False positive and you are SURE? Override once with:  git commit --no-verify\n');
process.exit(1);
