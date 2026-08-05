import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FONT_STACK, isIncludedRepository, normalizeHistory } from './generate-repo-traffic.mjs';

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

const WIDTH = 780;
const HEIGHT = 260;
const PLOT_LEFT = 60;
const PLOT_RIGHT = 748;
const PLOT_TOP = 96;
const PLOT_BOTTOM = 206;

/** Fixed so identical traffic data always renders byte-identical SVG. */
const ROUGH_SEED = 20260805;
const ROUGH_AMPLITUDE = 2.6;
/** Long spans are split so the wobble stays visible instead of averaging out. */
const MAX_SEGMENT_LENGTH = 90;

function toNonNegativeInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function toDayNumber(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

function fromDayNumber(dayNumber) {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Collapses per-repository daily traffic into one summed series.
 *
 * The window ends at the most recent recorded date rather than "today" so a
 * late collection run never appends a fake zero, and starts no earlier than the
 * first recorded date so the pre-collection past is not drawn as zero traffic.
 * Gaps inside the window are real zeros and are filled as such.
 */
export function buildDailySeries(history, { days = DEFAULT_WINDOW_DAYS } = {}) {
  const normalized = normalizeHistory(history);
  const totals = new Map();

  for (const [name, repoHistory] of Object.entries(normalized.repositories)) {
    if (!isIncludedRepository(name)) continue;
    for (const entry of repoHistory.daily) {
      const bucket = totals.get(entry.date) || { views: 0, uniqueVisitors: 0 };
      bucket.views += entry.views;
      bucket.uniqueVisitors += entry.uniqueVisitors;
      totals.set(entry.date, bucket);
    }
  }

  if (totals.size === 0) return [];

  const dayNumbers = [...totals.keys()].map(toDayNumber).filter(Number.isFinite);
  if (dayNumbers.length === 0) return [];

  const lastDay = Math.max(...dayNumbers);
  const windowSize = Number.isInteger(days) && days > 0 ? days : DEFAULT_WINDOW_DAYS;
  const firstDay = Math.max(Math.min(...dayNumbers), lastDay - (windowSize - 1));

  const series = [];
  for (let day = firstDay; day <= lastDay; day += 1) {
    const date = fromDayNumber(day);
    const bucket = totals.get(date);
    series.push({
      date,
      views: toNonNegativeInteger(bucket?.views),
      uniqueVisitors: toNonNegativeInteger(bucket?.uniqueVisitors),
    });
  }

  return series;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function jitter(random, amplitude = ROUGH_AMPLITUDE) {
  return (random() - 0.5) * 2 * amplitude;
}

function subdivide(points) {
  const dense = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / MAX_SEGMENT_LENGTH));
    for (let step = 1; step <= steps; step += 1) {
      dense.push({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      });
    }
  }
  return dense;
}

/**
 * One hand-drawn stroke. Vertices are nudged once so the path stays connected,
 * and each span is bowed through a jittered quadratic control point. Two passes
 * over the same points give the doubled-up look of a sketched line.
 */
function roughPass(dense, random, amplitude) {
  const wobbled = dense.map((point) => ({
    x: point.x + jitter(random, amplitude),
    y: point.y + jitter(random, amplitude),
  }));

  let d = `M${round(wobbled[0].x)} ${round(wobbled[0].y)}`;
  for (let i = 1; i < wobbled.length; i += 1) {
    const from = wobbled[i - 1];
    const to = wobbled[i];
    const cx = round((from.x + to.x) / 2 + jitter(random, amplitude * 1.4));
    const cy = round((from.y + to.y) / 2 + jitter(random, amplitude * 1.4));
    d += ` Q${cx} ${cy} ${round(to.x)} ${round(to.y)}`;
  }
  return d;
}

export function roughPolyline(points, random, amplitude = ROUGH_AMPLITUDE) {
  const dense = subdivide(points);
  return [roughPass(dense, random, amplitude), roughPass(dense, random, amplitude)];
}

export function roughLine(x1, y1, x2, y2, random, amplitude = ROUGH_AMPLITUDE) {
  return roughPolyline([{ x: x1, y: y1 }, { x: x2, y: y2 }], random, amplitude);
}

export function roughRect(x, y, width, height, random, amplitude = ROUGH_AMPLITUDE) {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
  return roughPolyline(corners, random, amplitude);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(toNonNegativeInteger(value));
}

function formatSeoulDate(date = new Date()) {
  return SEOUL_DATE_FORMATTER.format(date).replace(/-/g, '.');
}

function formatAxisDate(isoDate) {
  return isoDate.slice(5).replace('-', '.');
}

function svgStyle() {
  return `
    .card { fill: #0d1117; stroke: #30363d; }
    .heading { font: 700 18px ${FONT_STACK}; fill: #e6edf3; }
    .subtle { font: 400 12px ${FONT_STACK}; fill: #8b949e; }
    .axis-label { font: 500 11px ${FONT_STACK}; fill: #8b949e; }
    .peak-label { font: 700 12px ${FONT_STACK}; fill: #e6edf3; }
    .legend-label { font: 500 12px ${FONT_STACK}; fill: #c9d1d9; }
    .empty { font: 600 15px ${FONT_STACK}; fill: #8b949e; }
    .axis { fill: none; stroke: #8b949e; stroke-width: 1.6; stroke-linecap: round; }
    .grid { fill: none; stroke: #30363d; stroke-width: 1.2; stroke-linecap: round; }
    .line-views { fill: none; stroke: #4dabf7; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .line-uniques { fill: none; stroke: #69db7c; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .dot-views { fill: #4dabf7; }
    .dot-uniques { fill: #69db7c; }
    @media (prefers-color-scheme: light) {
      .card { fill: #ffffff; stroke: #d0d7de; }
      .heading, .peak-label { fill: #1f2328; }
      .subtle, .axis-label { fill: #57606a; }
      .legend-label { fill: #24292f; }
      .empty { fill: #57606a; }
      .axis { stroke: #1e1e1e; }
      .grid { stroke: #d0d7de; }
      .line-views { stroke: #1971c2; }
      .line-uniques { stroke: #2f9e44; }
      .dot-views { fill: #1971c2; }
      .dot-uniques { fill: #2f9e44; }
    }`;
}

function svgHeader(updatedDate) {
  return `  <rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12"/>
  <text class="heading" x="28" y="36">Visitor Trend</text>
  <text class="subtle" x="28" y="56">Daily traffic across all repositories</text>
  <text class="subtle" x="${WIDTH - 28}" y="36" text-anchor="end">Updated ${escapeXml(updatedDate)}</text>`;
}

function buildPlaceholderSvg(updatedDate) {
  const random = createRandom(ROUGH_SEED);
  const box = roughRect(PLOT_LEFT, PLOT_TOP, PLOT_RIGHT - PLOT_LEFT, PLOT_BOTTOM - PLOT_TOP, random, 2)
    .map((d) => `  <path class="grid" d="${d}"/>`)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Visitor Trend</title>
  <desc id="desc">Daily GitHub repository traffic trend for hyunolike.</desc>
  <style>${svgStyle()}
  </style>
${svgHeader(updatedDate)}
${box}
  <text class="empty" x="${WIDTH / 2}" y="${(PLOT_TOP + PLOT_BOTTOM) / 2 + 5}" text-anchor="middle">Collecting data...</text>
</svg>`;
}

function buildLegend(random) {
  const items = [
    { className: 'line-views', label: 'Views', x: 520 },
    { className: 'line-uniques', label: 'Unique visitors', x: 610 },
  ];

  return items
    .map(({ className, label, x }) => {
      const strokes = roughLine(x, 62, x + 22, 62, random, 1)
        .map((d) => `  <path class="${className}" d="${d}"/>`)
        .join('\n');
      return `${strokes}\n  <text class="legend-label" x="${x + 28}" y="66">${escapeXml(label)}</text>`;
    })
    .join('\n');
}

export function buildTrendSvg(series, options = {}) {
  const updatedDate = options.date || formatSeoulDate();
  if (!Array.isArray(series) || series.length === 0) return buildPlaceholderSvg(updatedDate);

  const random = createRandom(ROUGH_SEED);
  const maxValue = Math.max(1, ...series.map((entry) => Math.max(entry.views, entry.uniqueVisitors)));

  const scaleX = (index) =>
    series.length === 1
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT + (index / (series.length - 1)) * (PLOT_RIGHT - PLOT_LEFT);
  const scaleY = (value) => PLOT_BOTTOM - (value / maxValue) * (PLOT_BOTTOM - PLOT_TOP);

  const pointsFor = (key) => series.map((entry, index) => ({ x: scaleX(index), y: scaleY(entry[key]) }));

  const axis = [
    ...roughLine(PLOT_LEFT, PLOT_BOTTOM, PLOT_RIGHT, PLOT_BOTTOM, random),
    ...roughLine(PLOT_LEFT, PLOT_TOP, PLOT_LEFT, PLOT_BOTTOM, random),
  ]
    .map((d) => `  <path class="axis" d="${d}"/>`)
    .join('\n');

  const topGrid = roughLine(PLOT_LEFT, PLOT_TOP, PLOT_RIGHT, PLOT_TOP, random)
    .map((d) => `  <path class="grid" d="${d}"/>`)
    .join('\n');

  const lines = [
    { key: 'uniqueVisitors', className: 'line-uniques' },
    { key: 'views', className: 'line-views' },
  ]
    .map(({ key, className }) =>
      (series.length === 1
        ? roughLine(scaleX(0) - 12, scaleY(series[0][key]), scaleX(0) + 12, scaleY(series[0][key]), random)
        : roughPolyline(pointsFor(key), random)
      )
        .map((d) => `  <path class="${className}" d="${d}"/>`)
        .join('\n'),
    )
    .join('\n');

  const peakIndex = series.reduce((best, entry, index) => (entry.views > series[best].views ? index : best), 0);
  const peak = series[peakIndex];
  const peakX = scaleX(peakIndex);
  const peakY = scaleY(peak.views);
  const peakAnchor = peakX > PLOT_RIGHT - 60 ? 'end' : 'middle';
  const peakMarker = `  <circle class="dot-views" cx="${round(peakX)}" cy="${round(peakY)}" r="3.5"/>
  <text class="peak-label" x="${round(peakX)}" y="${round(Math.max(PLOT_TOP - 6, peakY - 12))}" text-anchor="${peakAnchor}">${formatNumber(peak.views)}</text>`;

  const labelIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  const xLabels = labelIndexes
    .map((index) => {
      const anchor = index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle';
      return `  <text class="axis-label" x="${round(scaleX(index))}" y="${PLOT_BOTTOM + 22}" text-anchor="${anchor}">${escapeXml(formatAxisDate(series[index].date))}</text>`;
    })
    .join('\n');

  const yLabels = `  <text class="axis-label" x="${PLOT_LEFT - 10}" y="${PLOT_TOP + 4}" text-anchor="end">${formatNumber(maxValue)}</text>
  <text class="axis-label" x="${PLOT_LEFT - 10}" y="${PLOT_BOTTOM + 4}" text-anchor="end">0</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Visitor Trend</title>
  <desc id="desc">Daily GitHub repository traffic trend for hyunolike over the last ${series.length} recorded days.</desc>
  <style>${svgStyle()}
  </style>
${svgHeader(updatedDate)}
${buildLegend(random)}
${topGrid}
${axis}
${lines}
${peakMarker}
${xLabels}
${yLabels}
</svg>`;
}

export function buildFallbackSeries(days = 14, today = new Date()) {
  const random = createRandom(ROUGH_SEED);
  const lastDay = Math.floor(today.getTime() / MS_PER_DAY);
  return Array.from({ length: days }, (_, index) => {
    const views = 4 + Math.round(random() * 22);
    return {
      date: fromDayNumber(lastDay - (days - 1) + index),
      views,
      uniqueVisitors: Math.max(1, Math.round(views * (0.35 + random() * 0.2))),
    };
  });
}

function readJsonFile(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn(`Could not read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function parseArgs(argv) {
  const args = { out: 'visitor-trend.svg', history: '', days: DEFAULT_WINDOW_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] || args.out;
    if (arg === '--history') args.history = argv[++i] || args.history;
    if (arg === '--days') args.days = Number.parseInt(argv[++i], 10) || args.days;
  }
  return args;
}

function writeTextFile(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf-8');
}

function runLocalCli() {
  const args = parseArgs(process.argv.slice(2));
  const series = args.history
    ? buildDailySeries(readJsonFile(args.history, {}), { days: args.days })
    : buildFallbackSeries();
  writeTextFile(args.out, `${buildTrendSvg(series)}\n`);
  console.log(`Wrote ${args.out} (${series.length} day${series.length === 1 ? '' : 's'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalCli();
}
