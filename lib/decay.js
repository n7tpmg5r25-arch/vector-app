const LAMBDA_SESSION  = 0.20;
const LAMBDA_SNAPSHOT = 0.02;

function sessionWeight(sessionEndYear, currentYear = new Date().getFullYear()) {
  const ageYears = Math.max(0, currentYear - sessionEndYear);
  return Math.exp(-LAMBDA_SESSION * ageYears);
}

function snapshotWeight(snapshotDate, referenceDate = new Date()) {
  const snap = new Date(snapshotDate);
  const ageDays = Math.max(0, (referenceDate - snap) / (1000 * 60 * 60 * 24));
  return Math.exp(-LAMBDA_SNAPSHOT * ageDays);
}

function momentumTrend(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return { slope: 0, direction: 'stalled', delta: 0 };
  }
  const weighted = snapshots.map(s => ({
    score: s.score,
    date:  s.snapshot_date,
    weight: snapshotWeight(s.snapshot_date),
  }));
  const midpoint = Math.floor(weighted.length / 2);
  const older  = weighted.slice(0, midpoint);
  const recent = weighted.slice(midpoint);
  const avg = pts => {
    let sw = 0, tw = 0;
    pts.forEach(p => { sw += p.score * p.weight; tw += p.weight; });
    return tw > 0 ? sw / tw : 0;
  };
  const delta = avg(recent) - avg(older);
  const direction = delta >= 5 ? 'rising' : delta <= -5 ? 'declining' : 'stalled';
  return { slope: delta, direction, delta: Math.round(delta) };
}

module.exports = {
  sessionWeight,
  snapshotWeight,
  momentumTrend,
  LAMBDA_SESSION,
  LAMBDA_SNAPSHOT,
};
