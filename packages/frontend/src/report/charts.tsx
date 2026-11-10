// SVG charts for the report's clustered bar and distribution (combo) visuals. Each panel has a
// single y-scale; the distribution pages put their cumulative/LTV lines in a second panel that
// shares the x-axis instead of a dual-axis overlay.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Tip { x: number; y: number; body: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-20 min-w-32 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-200 py-100 text-200 text-popover-foreground shadow-md"
      style={{ left: tip.x, top: tip.y - 8 }}>
      {tip.body}
    </div>
  );
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const ticks = (max: number, n = 4) => [...Array(n + 1).keys()].map((i) => (max * i) / n);

export interface BarDatum { label: string; value: number }

/** Horizontal clustered bar chart, largest first, with data labels and dotted gridlines. */
export function BarChart({ data, format, axisFormat, empty = 'No data for the current filters.' }: {
  data: BarDatum[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  if (!data.length) return <p className="py-800 text-center text-300 text-muted-foreground">{empty}</p>;
  const rows = [...data].sort((a, b) => b.value - a.value);
  const labelW = Math.min(150, Math.max(60, Math.max(...rows.map((r) => r.label.length)) * 7 + 8));
  const valueW = 64, rowH = 26, top = 4, axisH = 22;
  const plotW = Math.max(40, width - labelW - valueW);
  const max = niceMax(Math.max(...rows.map((r) => r.value), 0));
  const h = top + rows.length * rowH + axisH;
  const x = (v: number) => labelW + (Math.max(0, v) / max) * plotW;
  const fmtAxis = axisFormat ?? format;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      <svg width={width} height={h} role="img" aria-label={rows.map((r) => `${r.label} ${format(r.value)}`).join(', ')} className="overflow-visible">
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={h - axisH} className="stroke-gridline" strokeDasharray="2 3" />
            <text x={x(t)} y={h - 6} textAnchor="middle" className="fill-muted-foreground text-100">{fmtAxis(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH;
          const w = Math.max(0, x(r.value) - labelW);
          return (
            <g key={r.label}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ x: e.clientX - box.left, y: e.clientY - box.top, body: <><strong>{r.label}</strong><br />{format(r.value)}</> });
              }}>
              <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 8} y={y + rowH / 2} dominantBaseline="central" textAnchor="end" className="fill-foreground text-200">{r.label}</text>
              {w > 0 && <path d={roundedBar(labelW, y + 5, w, rowH - 10)} className="fill-series-1" />}
              <text x={labelW + w + 6} y={y + rowH / 2} dominantBaseline="central" className="fill-muted-foreground text-100 tabular-nums">{format(r.value)}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Bar anchored at the left baseline with a 4px rounded data end. */
function roundedBar(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
/** Column anchored at the bottom baseline with a 4px rounded top. */
function roundedColumn(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Series {
  name: string;
  values: (number | null)[];
  format: (v: number) => string;
  /** Tailwind fill/stroke class suffix, e.g. 'series-1'. */
  color: 'series-1' | 'series-2' | 'series-3' | 'series-4';
  dashed?: boolean;
}

// Literal class names so Tailwind generates them.
const COLOR = {
  'series-1': { fill: 'fill-series-1', stroke: 'stroke-series-1', bg: 'bg-series-1' },
  'series-2': { fill: 'fill-series-2', stroke: 'stroke-series-2', bg: 'bg-series-2' },
  'series-3': { fill: 'fill-series-3', stroke: 'stroke-series-3', bg: 'bg-series-3' },
  'series-4': { fill: 'fill-series-4', stroke: 'stroke-series-4', bg: 'bg-series-4' },
} as const;

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-400 gap-y-100 text-200 text-muted-foreground">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-100">
          <span className={cn('inline-block h-200 w-300 rounded-sm', COLOR[s.color].bg, s.dashed && 'h-100')} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Distribution chart: clustered columns per bin (top panel) and, optionally, line series in a
 * second panel sharing the bins (e.g. cumulative %).
 */
export function DistributionChart({ labels, columns, lines, height = 360 }: {
  labels: string[];
  columns: Series[];
  lines?: Series[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const left = 52, right = 12, colTop = 18, axisH = 34;
  const lineH = lines?.length ? Math.round(height * 0.32) : 0;
  const colH = height - lineH - axisH - colTop - (lineH ? 18 : 0);
  const plotW = width - left - right;
  const band = plotW / labels.length;
  const colMax = niceMax(Math.max(0, ...columns.flatMap((s) => s.values.map((v) => v ?? 0))));
  const lineMax = lines?.length ? niceMax(Math.max(0, ...lines.flatMap((s) => s.values.map((v) => v ?? 0)))) : 1;
  const yCol = (v: number) => colTop + colH - (Math.max(0, v) / colMax) * colH;
  const lineTop = colTop + colH + 18;
  const yLine = (v: number) => lineTop + lineH - (Math.max(0, v) / lineMax) * lineH;
  const groupW = band * 0.7, colW = groupW / columns.length;
  const cx = (i: number) => left + band * i + band / 2;
  const everyNth = Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 56)));
  const all = [...columns, ...(lines ?? [])];

  const hover = (i: number, e: React.MouseEvent<SVGGElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    setTip({
      x: Math.min(Math.max(e.clientX - box.left, 80), width - 80), y: e.clientY - box.top,
      body: (
        <>
          <strong>{labels[i]}</strong>
          {all.map((s) => <div key={s.name}>{s.name}: {s.values[i] == null ? '–' : s.format(s.values[i]!)}</div>)}
        </>
      ),
    });
  };

  return (
    <div ref={ref} className="relative flex flex-col gap-200" onMouseLeave={() => setTip(null)}>
      <Legend series={all} />
      <svg width={width} height={height} role="img" className="overflow-visible"
        aria-label={labels.map((l, i) => `${l}: ${all.map((s) => `${s.name} ${s.values[i] == null ? 'none' : s.format(s.values[i]!)}`).join(', ')}`).join('; ')}>
        {ticks(colMax).map((t) => (
          <g key={`c${t}`}>
            <line x1={left} x2={width - right} y1={yCol(t)} y2={yCol(t)} className="stroke-gridline" strokeDasharray="2 3" />
            <text x={left - 6} y={yCol(t)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground text-100">{columns[0]?.format(t)}</text>
          </g>
        ))}
        {lines?.length ? ticks(lineMax, 2).map((t) => (
          <g key={`l${t}`}>
            <line x1={left} x2={width - right} y1={yLine(t)} y2={yLine(t)} className="stroke-gridline" strokeDasharray="2 3" />
            <text x={left - 6} y={yLine(t)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground text-100">{lines[0].format(t)}</text>
          </g>
        )) : null}
        {labels.map((l, i) => (
          <g key={l} onMouseMove={(e) => hover(i, e)}>
            <rect x={left + band * i} y={0} width={band} height={height} fill="transparent" />
            {columns.map((s, k) => {
              const v = s.values[i] ?? 0;
              const x0 = cx(i) - groupW / 2 + k * colW + 1;
              const y = yCol(v);
              return (
                <g key={s.name}>
                  {v > 0 && <path d={roundedColumn(x0, y, Math.max(1, colW - 2), colTop + colH - y)} className={COLOR[s.color].fill} />}
                  {v > 0 && colW >= 14 && (
                    <text x={x0 + (colW - 2) / 2} y={y - 4} textAnchor="middle" className="fill-muted-foreground text-100 tabular-nums">{s.format(v)}</text>
                  )}
                </g>
              );
            })}
            {i % everyNth === 0 && (
              <text x={cx(i)} y={height - axisH + 16} textAnchor="middle" className="fill-foreground text-100">{l}</text>
            )}
          </g>
        ))}
        {lines?.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : [cx(i), yLine(v)] as const)).filter(Boolean) as [number, number][];
          const last = pts[pts.length - 1];
          const lastVal = [...s.values].reverse().find((v) => v != null);
          return (
            <g key={s.name} className="pointer-events-none">
              <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} className={COLOR[s.color].stroke} />
              {!s.dashed && pts.map(([px, py], j) => <circle key={j} cx={px} cy={py} r={4} strokeWidth={2} className={cn('fill-card', COLOR[s.color].stroke)} />)}
              {last && lastVal != null && !s.dashed && (
                <text x={last[0]} y={last[1] - 8} textAnchor="end" className="fill-muted-foreground text-100 tabular-nums">{s.format(lastVal)}</text>
              )}
            </g>
          );
        })}
        <line x1={left} x2={width - right} y1={colTop + colH} y2={colTop + colH} className="stroke-border" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
