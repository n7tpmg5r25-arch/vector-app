/**
 * Admin gate — shared across /admin/* pages and /api/admin/* routes.
 *
 * Why this exists:
 *   The /admin/waitlist page (shipped Brand P2b, 2026-04-16) inlined a
 *   hardcoded ADMIN_USER_IDS array. Thread 2 (Client Portal Admin UI,
 *   2026-04-23) adds /admin/clients + a couple of /api/admin/* routes.
 *   Rather than copy the array a third and fourth time, centralize it.
 *
 * Who is admin today:
 *   Colin only. Per memory `project_security_audit_2026_04_14` + the old
 *   waitlist page header: there's no is_admin column, and there's exactly
 *   one admin. When that changes (2028+ observer year, maybe collaborator
 *   onboarding), promote to an admins table or user_metadata flag.
 *
 * NOT the portal client-tier gate:
 *   `role === 'client'` lives in `viewer-capabilities.js` via
 *   user.app_metadata.role. That's a tenant-viewer gate, not an admin gate.
 *   Don't cross-wire them.
 *
 * See also:
 *   - PHASE_13_CLIENT_PORTAL_PLAN.md §5.3 (writes gated by ADMIN_USER_IDS env)
 *   - app/lib/viewer-capabilities.js (portal-side client tier detection)
 */

// Colin — Vector | WA / Shorepine Government Relations owner account.
// UID pulled from memory `project_security_audit_2026_04_14`.
export const ADMIN_USER_IDS = [
  'b0903525-5605-42f8-8c68-4b1dc6f40cd7',
]

/**
 * True when the given Supabase user object is a Vector admin (Colin today).
 * Safe to call with null / undefined / anon session.
 *
 * @param {object|null} user - Supabase auth user
 * @returns {boolean}
 */
export function isAdmin(user) {
  if (!user || !user.id) return false
  return ADMIN_USER_IDS.includes(user.id)
}
