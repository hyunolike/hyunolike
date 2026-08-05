import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySeries, buildTrendSvg } from './generate-visitor-trend.mjs';

function historyOf(repositories) {
  return { repositories };
}

test('buildDailySeries sums every repository for the same date', () => {
  const series = buildDailySeries(
    historyOf({
      alpha: { daily: [{ date: '2026-08-01', views: 10, uniqueVisitors: 4 }] },
      beta: { daily: [{ date: '2026-08-01', views: 7, uniqueVisitors: 3 }] },
    }),
  );

  assert.deepEqual(series, [{ date: '2026-08-01', views: 17, uniqueVisitors: 7 }]);
});

test('buildDailySeries drops entries older than the window', () => {
  const series = buildDailySeries(
    historyOf({
      alpha: {
        daily: [
          { date: '2026-07-01', views: 99, uniqueVisitors: 50 },
          { date: '2026-07-30', views: 5, uniqueVisitors: 2 },
          { date: '2026-08-01', views: 6, uniqueVisitors: 3 },
        ],
      },
    }),
    { days: 3 },
  );

  assert.deepEqual(
    series.map((entry) => entry.date),
    ['2026-07-30', '2026-07-31', '2026-08-01'],
  );
});

test('buildDailySeries does not fabricate days before the first recorded date', () => {
  const series = buildDailySeries(
    historyOf({
      alpha: { daily: [{ date: '2026-08-03', views: 4, uniqueVisitors: 2 }] },
    }),
    { days: 30 },
  );

  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2026-08-03');
});

test('buildDailySeries fills gaps inside the window with zeros', () => {
  const series = buildDailySeries(
    historyOf({
      alpha: {
        daily: [
          { date: '2026-08-01', views: 4, uniqueVisitors: 2 },
          { date: '2026-08-03', views: 6, uniqueVisitors: 3 },
        ],
      },
    }),
  );

  assert.deepEqual(series, [
    { date: '2026-08-01', views: 4, uniqueVisitors: 2 },
    { date: '2026-08-02', views: 0, uniqueVisitors: 0 },
    { date: '2026-08-03', views: 6, uniqueVisitors: 3 },
  ]);
});

test('buildDailySeries ignores the profile repository excluded from traffic cards', () => {
  const series = buildDailySeries(
    historyOf({
      hyunolike: { daily: [{ date: '2026-08-01', views: 500, uniqueVisitors: 200 }] },
      alpha: { daily: [{ date: '2026-08-01', views: 3, uniqueVisitors: 1 }] },
    }),
  );

  assert.deepEqual(series, [{ date: '2026-08-01', views: 3, uniqueVisitors: 1 }]);
});

test('buildTrendSvg renders a placeholder when there is no data yet', () => {
  const svg = buildTrendSvg([], { date: '2026.08.05' });

  assert.match(svg, /<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /Collecting data/);
});

test('buildTrendSvg plots both series with the peak value labelled', () => {
  const svg = buildTrendSvg(
    [
      { date: '2026-08-01', views: 4, uniqueVisitors: 2 },
      { date: '2026-08-02', views: 12, uniqueVisitors: 5 },
    ],
    { date: '2026.08.05' },
  );

  assert.match(svg, /class="line-views"/);
  assert.match(svg, /class="line-uniques"/);
  assert.match(svg, /08\.01/);
  assert.match(svg, /08\.02/);
  assert.match(svg, />12</);
});

test('buildTrendSvg is deterministic for identical input', () => {
  const series = [
    { date: '2026-08-01', views: 4, uniqueVisitors: 2 },
    { date: '2026-08-02', views: 12, uniqueVisitors: 5 },
  ];

  assert.equal(buildTrendSvg(series, { date: '2026.08.05' }), buildTrendSvg(series, { date: '2026.08.05' }));
});
