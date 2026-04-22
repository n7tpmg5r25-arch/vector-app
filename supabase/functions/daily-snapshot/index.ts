import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * VECTOR | WA — Daily Snapshot Safety Net
 *
 * Creates a trajectory_snapshots row for every bill using current DB scores.
 * No WSL API calls — just copies existing data into today's snapshot.
 *
 * Purpose: guarantees the sparkline always has a data point for today,
 * even if the full GitHub Actions sync fails or hasn't run yet.
 *
 * Triggered by pg_cron at 11 PM PT (before the midnight full sync).
 * Idempotent: uses upsert on (bill_id, snapshot_date).
 *
 * ALREADY DEPLOYED to Supabase (Phase 5A, April 2026).
 * This file is for reference only — deploy via Supabase MCP or dashboard.
 */

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date().toISOString().split('T')[0];

    // Determine current session
    const isPost2027 = new Date() >= new Date('2027-01-13');
    const SESSION = isPost2027 ? '2027-2028' : '2025-2026';

    // Fetch all bills with scores (paginated — Supabase default limit is 1000)
    let allBills: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('bills')
        .select('bill_id, session, final_score, trajectory_score, xf_multiplier, stage, pass_probability, confidence_label')
        .eq('session', SESSION)
        .not('final_score', 'is', null)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Bills query failed: ${error.message}`);
      if (!data || data.length === 0) break;
      allBills = allBills.concat(data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (allBills.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No bills found', bills: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build snapshot rows
    const snapshots = allBills.map(bill => ({
      bill_id: bill.bill_id,
      session: bill.session,
      snapshot_date: today,
      score: bill.final_score,
      base_total: bill.trajectory_score || bill.final_score,
      xf_multiplier: bill.xf_multiplier || 1.0,
      stage: bill.stage || 1,
      pass_probability: bill.pass_probability || 0,
      confidence_label: bill.confidence_label || 'VERY LOW',
    }));

    // Upsert in batches of 500
    let written = 0;
    let errors = 0;
    const BATCH = 500;

    for (let i = 0; i < snapshots.length; i += BATCH) {
      const batch = snapshots.slice(i, i + BATCH);
      const { error } = await supabase
        .from('trajectory_snapshots')
        .upsert(batch, { onConflict: 'bill_id,snapshot_date' });

      if (error) {
        console.error(`Batch ${i}-${i+BATCH} failed:`, error.message);
        errors++;
      } else {
        written += batch.length;
      }
    }

    const duration = Date.now() - startTime;

    // Log to sync_log
    await supabase.from('sync_log').insert({
      session: SESSION,
      bills_fetched: allBills.length,
      bills_updated: 0,
      snapshots_written: written,
      errors: errors > 0 ? [{ err: `${errors} batch(es) failed` }] : null,
      duration_ms: duration,
      notes: `daily-snapshot safety net — ${written} snapshots from DB scores`,
    });

    return new Response(JSON.stringify({
      ok: true,
      session: SESSION,
      date: today,
      bills_found: allBills.length,
      snapshots_written: written,
      batch_errors: errors,
      duration_ms: duration,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('daily-snapshot error:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
