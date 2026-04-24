/**
 * InvitePanel — placeholder for Thread 2 PR (a).
 *
 * The real invite form (Supabase admin API magic-link flow) ships in
 * PR (b) `client-admin-ui-invite-assign`. This stub keeps the detail
 * page layout stable when PR (a) is merged alone.
 */
export default function InvitePanel() {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Invite a user</div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        Magic-link invite ships in the next PR (<code>client-admin-ui-invite-assign</code>).
        For now, insert into <code>client_users</code> via SQL.
      </p>
    </div>
  )
}
