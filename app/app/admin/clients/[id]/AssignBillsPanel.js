/**
 * AssignBillsPanel — placeholder for Thread 2 PR (a).
 *
 * The real bill-picker (multi-select checkbox list over the owner's
 * tracked_bills, batch UPDATE via service_role) ships in PR (b)
 * `client-admin-ui-invite-assign`. This stub keeps the detail page
 * layout stable when PR (a) is merged alone.
 */
export default function AssignBillsPanel() {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Assign bills</div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        Batch bill-picker ships in the next PR (<code>client-admin-ui-invite-assign</code>).
        For now, <code>UPDATE tracked_bills SET client_id = &#39;…&#39;</code> via SQL.
      </p>
    </div>
  )
}
