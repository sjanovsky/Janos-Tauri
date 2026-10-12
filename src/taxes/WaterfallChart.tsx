import { useState } from "react";
import { abbreviateCurrency, wholeCurrencyFormatter } from "../spending/lib/format";
import type { WaterfallBar, WaterfallSegment } from "./lib/taxes";

const WIDTH = 760;
const HEIGHT = 250;
const PAD = { top: 26, right: 10, bottom: 38, left: 10 };

interface Hover {
  bar: WaterfallBar;
  segment: WaterfallSegment;
  /** Pointer position relative to the chart container. */
  x: number;
  y: number;
}

// Split a label into at most two lines so it fits under a narrow bar.
function wrapLabel(label: string): string[] {
  const words = label.split(" ");
  if (words.length < 2) {
    return [label];
  }
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

interface WaterfallChartProps {
  bars: WaterfallBar[];
  title: string;
}

// A stacked waterfall in plain SVG. Every bar is built from segments (pay vs. other income, each
// deduction, each bracket, ...) that highlight and explain themselves on hover. Bars float between
// their start and end; the domain extends below zero so a refund hangs under the baseline.
function WaterfallChart({ bars, title }: WaterfallChartProps) {
  const [hover, setHover] = useState<Hover | null>(null);

  const spans = bars.map((bar) => ({ low: Math.min(bar.start, bar.end), high: Math.max(bar.start, bar.end) }));
  const domainMin = Math.min(0, ...spans.map((span) => span.low));
  const domainMax = Math.max(1, ...spans.map((span) => span.high));
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (value: number) => PAD.top + plotH - ((value - domainMin) / (domainMax - domainMin)) * plotH;

  const slot = (WIDTH - PAD.left - PAD.right) / bars.length;
  const barW = Math.min(96, slot * 0.66);

  return (
    <div className="taxes-waterfall-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="taxes-waterfall"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} stroke="#c3c2b7" />
        {bars.map((bar, index) => {
          const x = PAD.left + slot * index + (slot - barW) / 2;
          const nextBar = bars[index + 1];
          const { low, high } = spans[index];
          const lines = wrapLabel(bar.label);

          // Segments stack upward from the bar's lower edge.
          let cursor = low;
          const rects = bar.segments.map((segment) => {
            const segLow = cursor;
            cursor += segment.value;
            const top = y(segLow + segment.value);
            return { segment, top, height: Math.max(1.5, y(segLow) - top) };
          });

          const valueText = `${bar.shown < 0 ? "−" : ""}${abbreviateCurrency(Math.abs(bar.shown))}`;
          // A bar hanging below the baseline (a refund) puts its value under the bar instead.
          const hangsBelow = bar.start === 0 && bar.end < 0;
          const valueY = hangsBelow ? y(low) + 15 : y(high) - 8;

          return (
            <g key={bar.key}>
              {nextBar && (
                <line
                  x1={x + barW}
                  x2={x + slot}
                  y1={y(bar.end)}
                  y2={y(bar.end)}
                  stroke="#9ca3af"
                  strokeDasharray="3 3"
                />
              )}
              {rects.map(({ segment, top, height }) => {
                const active = hover?.segment.key === segment.key && hover.bar.key === bar.key;
                return (
                  <g
                    key={segment.key}
                    onMouseMove={(event) => {
                      const box = event.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect();
                      setHover({ bar, segment, x: event.clientX - box.left, y: event.clientY - box.top });
                    }}
                  >
                    <rect
                      x={x}
                      y={top}
                      width={barW}
                      height={height}
                      fill={segment.color}
                      stroke="#ffffff"
                      strokeWidth={1}
                      opacity={hover && !active ? 0.55 : 1}
                    />
                  </g>
                );
              })}
              <text
                x={x + barW / 2}
                y={valueY}
                textAnchor="middle"
                className="taxes-waterfall__value"
              >
                {valueText}
              </text>
              {lines.map((line, lineIndex) => (
                <text
                  key={lineIndex}
                  x={x + barW / 2}
                  y={HEIGHT - PAD.bottom + 20 + lineIndex * 14}
                  textAnchor="middle"
                  className="taxes-waterfall__label"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          className="taxes-tooltip"
          style={{ left: hover.x, top: hover.y }}
          role="tooltip"
        >
          <div className="taxes-tooltip__bar">{hover.bar.label}</div>
          <div className="taxes-tooltip__row">
            <span className="taxes-tooltip__swatch" style={{ background: hover.segment.color }} />
            <span>{hover.segment.label}</span>
            <strong>{wholeCurrencyFormatter.format(hover.segment.value)}</strong>
          </div>
          {hover.segment.detail && <div className="taxes-tooltip__detail">{hover.segment.detail}</div>}
        </div>
      )}
    </div>
  );
}

export default WaterfallChart;
