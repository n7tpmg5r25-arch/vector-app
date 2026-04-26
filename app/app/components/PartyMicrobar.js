'use client'
/**
 * PartyMicrobar — Vector | WA Thread 18 (2026-04-26)
 *
 * Compact horizontal stacked bar showing one floor vote's partisan split.
 * Companion to VoteSplitBar — same color logic, much smaller footprint.
 * Designed for inline use inside table rows (Roll-call history, 18.6) and
 * 1-line strips (Latest Floor Vote, 18.4).
 *
 * G5 frozen-engine: read-only display.
 */
export default function PartyMicrobar({
  yesD = 0, yesR = 0, yesU = 0,
  noD = 0,  noR = 0,  noU = 0,
  width = 80, height = 10,
}) {
  const totalYes = yesD + yesR + yesU
  const totalNo  = noD  + noR  + noU
  const total    = totalYes + totalNo

  if (total === 0) {
    return (
      <span style={{
        display: 'inline-block', width, height,
        background: 'var(--border)', borderRadius: 2, verticalAlign: 'middle',
      }} aria-hidden="true"/>
    )
  }

  const yesW = (totalYes / total) * width
  const px = n => (n / total) * width

  const yesBlocks = [
    { c: '#4d9aff', n: yesD },
    { c: '#ef4444', n: yesR },
    { c: 'rgba(255,255,255,0.20)', n: yesU },
  ]
  const noBlocks = [
    { c: '#ef4444', n: noR },
    { c: '#4d9aff', n: noD },
    { c: 'rgba(255,255,255,0.20)', n: noU },
  ]

  let yesX = 0
  let noX  = yesW
  const ariaLabel =
    `${totalYes} yea (${yesD} D, ${yesR} R${yesU ? `, ${yesU} unknown` : ''}), ` +
    `${totalNo} nay (${noD} D, ${noR} R${noU ? `, ${noU} unknown` : ''})`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width} height={height}
      preserveAspectRatio="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: 2 }}
      role="img"
      aria-label={ariaLabel}
    >
      <rect x="0"    y="0" width={yesW}         height={height} fill="rgba(74,222,128,0.12)"/>
      <rect x={yesW} y="0" width={width - yesW} height={height} fill="rgba(239,68,68,0.12)"/>
      {yesBlocks.map((b, i) => {
        if (b.n === 0) return null
        const w = px(b.n)
        const r = (
          <rect key={`y-${i}`} x={yesX} y="1" width={w} height={height - 2}
            fill={b.c} opacity="0.92"/>
        )
        yesX += w
        return r
      })}
      {noBlocks.map((b, i) => {
        if (b.n === 0) return null
        const w = px(b.n)
        const r = (
          <rect key={`n-${i}`} x={noX} y="1" width={w} height={height - 2}
            fill={b.c} opacity="0.92"/>
        )
        noX += w
        return r
      })}
      {totalYes > 0 && totalNo > 0 && (
        <line x1={yesW} y1="0" x2={yesW} y2={height}
          stroke="rgba(255,255,255,0.22)" strokeWidth="0.75"/>
      )}
    </svg>
  )
}