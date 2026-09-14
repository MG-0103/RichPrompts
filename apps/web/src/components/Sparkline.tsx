interface Props {
  values: number[]
  width?: number
  height?: number
  max?: number
}

export function Sparkline({ values, width = 120, height = 28, max = 100 }: Props) {
  if (values.length === 0) return <svg width={width} height={height} />
  if (values.length === 1) {
    const y = height - (values[0] / max) * height
    return (
      <svg width={width} height={height}>
        <circle cx={width / 2} cy={y} r={2.5} fill="#7ac" />
      </svg>
    )
  }
  const step = width / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(' ')
  const last = values[values.length - 1]
  const prev = values[values.length - 2]
  const trendColor = last >= prev ? '#5c5' : '#e77'
  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke="#7ac"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - (last / max) * height}
        r={2.5}
        fill={trendColor}
      />
    </svg>
  )
}
