import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshotFromTrafficResults,
  buildSvg,
  calculateMetrics,
  mergeSnapshot,
  normalizeHistory,
} from './generate-repo-traffic.mjs';

test('mergeSnapshot stores one date entry per repository and replaces same-day data', () => {
  const history = normalizeHistory({});
  const first = mergeSnapshot(history, {
    date: '2026-07-26',
    repositories: [
      { name: 'alpha', views: 10, uniqueVisitors: 4, clones: 3, uniqueCloners: 2 },
    ],
  });
  const second = mergeSnapshot(first, {
    date: '2026-07-26',
    repositories: [
      { name: 'alpha', views: 12, uniqueVisitors: 5, clones: 4, uniqueCloners: 2 },
    ],
  });

  assert.equal(second.repositories.alpha.daily.length, 1);
  assert.deepEqual(second.repositories.alpha.daily[0], {
    date: '2026-07-26',
    views: 12,
    uniqueVisitors: 5,
    clones: 4,
    uniqueCloners: 2,
  });
});

test('calculateMetrics totals history and ranks recent repositories', () => {
  const history = mergeSnapshot(
    mergeSnapshot(normalizeHistory({}), {
      date: '2026-07-25',
      repositories: [
        { name: 'alpha', views: 20, uniqueVisitors: 8, clones: 4, uniqueCloners: 2 },
        { name: 'beta', views: 5, uniqueVisitors: 3, clones: 1, uniqueCloners: 1 },
      ],
    }),
    {
      date: '2026-07-26',
      repositories: [
        { name: 'alpha', views: 30, uniqueVisitors: 10, clones: 5, uniqueCloners: 3 },
        { name: 'beta', views: 40, uniqueVisitors: 12, clones: 2, uniqueCloners: 1 },
      ],
    },
  );

  const metrics = calculateMetrics(history, {
    date: '2026-07-26',
    repositories: [
      { name: 'alpha', views: 30, uniqueVisitors: 10, clones: 5, uniqueCloners: 3 },
      { name: 'beta', views: 40, uniqueVisitors: 12, clones: 2, uniqueCloners: 1 },
    ],
  });

  assert.equal(metrics.totalViews, 95);
  assert.equal(metrics.totalUniqueVisitors, 33);
  assert.equal(metrics.totalClones, 12);
  assert.equal(metrics.topRepo.name, 'beta');
  assert.deepEqual(metrics.recentRepos.map((repo) => repo.name), ['beta', 'alpha']);
});

test('calculateMetrics excludes the hyunolike profile repository from totals and rankings', () => {
  const history = mergeSnapshot(normalizeHistory({}), {
    date: '2026-07-26',
    repositories: [
      { name: 'hyunolike', views: 999, uniqueVisitors: 300, clones: 100, uniqueCloners: 50 },
      { name: 'project-api', views: 12, uniqueVisitors: 4, clones: 3, uniqueCloners: 1 },
    ],
  });

  const metrics = calculateMetrics(history, {
    date: '2026-07-26',
    repositories: [
      { name: 'hyunolike', views: 999, uniqueVisitors: 300, clones: 100, uniqueCloners: 50 },
      { name: 'project-api', views: 12, uniqueVisitors: 4, clones: 3, uniqueCloners: 1 },
    ],
  });

  assert.equal(metrics.totalViews, 12);
  assert.equal(metrics.totalUniqueVisitors, 4);
  assert.equal(metrics.totalClones, 3);
  assert.equal(metrics.topRepo.name, 'project-api');
  assert.deepEqual(metrics.recentRepos.map((repo) => repo.name), ['project-api']);
});

test('mergeSnapshot does not store the hyunolike profile repository', () => {
  const history = mergeSnapshot(normalizeHistory({}), {
    date: '2026-07-26',
    repositories: [
      { name: 'hyunolike', views: 56, uniqueVisitors: 21, clones: 3, uniqueCloners: 2 },
    ],
  });

  assert.deepEqual(history.repositories, {});
});

test('buildSvg renders public metrics without raw history', () => {
  const svg = buildSvg({
    date: '2026.07.26',
    totalViews: 1234,
    totalUniqueVisitors: 456,
    totalClones: 78,
    level: 45,
    topRepo: { name: 'moyeorak-web', views: 320, uniqueVisitors: 88, clones: 18 },
    recentRepos: [
      { name: 'moyeorak-web', views: 320, uniqueVisitors: 88, clones: 18 },
      { name: 'spring-template', views: 91, uniqueVisitors: 27, clones: 7 },
      { name: 'blog-source', views: 44, uniqueVisitors: 12, clones: 3 },
    ],
  });

  assert.match(svg, /<svg/);
  assert.match(svg, /Repository Visitors/);
  assert.match(svg, /Pixel developer dog with MacBook and employee badge/);
  assert.match(svg, /Lv\. 45 Visitor/);
  assert.match(svg, /Recent Top Views/);
  assert.match(svg, /moyeorak-web/);
  assert.doesNotMatch(svg, /traffic-history/);
});

test('buildSvg can render the meme image in the character slot', () => {
  const svg = buildSvg(
    {
      date: '2026.07.26',
      totalViews: 82,
      totalUniqueVisitors: 33,
      totalClones: 15,
      level: 3,
      topRepo: { name: 'moyeorak-web', views: 42, uniqueVisitors: 17, clones: 8 },
      recentRepos: [{ name: 'moyeorak-web', views: 42, uniqueVisitors: 17, clones: 8 }],
    },
    { characterImageDataUri: 'data:image/png;base64,abc123' },
  );

  assert.match(svg, /Debugging meme image/);
  assert.match(svg, /href="data:image\/png;base64,abc123"/);
  assert.doesNotMatch(svg, /Pixel developer dog with MacBook and employee badge/);
});

test('buildSvg keeps image mode sections vertically balanced', () => {
  const svg = buildSvg(
    {
      date: '2026.07.26',
      totalViews: 82,
      totalUniqueVisitors: 33,
      totalClones: 15,
      level: 3,
      topRepo: { name: 'moyeorak-web', views: 42, uniqueVisitors: 17, clones: 8 },
      recentRepos: [
        { name: 'moyeorak-web', views: 42, uniqueVisitors: 17, clones: 8 },
        { name: 'spring-template', views: 24, uniqueVisitors: 9, clones: 5 },
        { name: 'blog-source', views: 16, uniqueVisitors: 7, clones: 2 },
      ],
    },
    { characterImageDataUri: 'data:image/png;base64,abc123' },
  );

  assert.match(svg, /height="322"/);
  assert.match(svg, /width="779" height="321"/);
  assert.match(svg, /<text class="level" x="96" y="266">/);
  assert.match(svg, /<text class="subtle" x="96" y="292">Top repo:/);
  assert.match(svg, /<text class="repo-title" x="318" y="194">/);
  assert.match(svg, /<text class="rank" x="322" y="220">1<\/text>/);
});

test('buildSnapshotFromTrafficResults converts GitHub traffic responses into daily snapshot rows', () => {
  const snapshot = buildSnapshotFromTrafficResults('2026-07-26', [
    {
      name: 'hyunolike',
      views: { count: 99, uniques: 30 },
      clones: { count: 9, uniques: 3 },
    },
    {
      name: 'alpha',
      views: {
        count: 120,
        uniques: 50,
        views: [
          { timestamp: '2026-07-25T00:00:00Z', count: 8, uniques: 3 },
          { timestamp: '2026-07-26T00:00:00Z', count: 12, uniques: 5 },
        ],
      },
      clones: {
        count: 40,
        uniques: 20,
        clones: [
          { timestamp: '2026-07-25T00:00:00Z', count: 2, uniques: 1 },
          { timestamp: '2026-07-26T00:00:00Z', count: 4, uniques: 2 },
        ],
      },
    },
    {
      name: 'beta',
      views: { count: 3, uniques: 1 },
      clones: null,
    },
  ]);

  assert.deepEqual(snapshot, {
    date: '2026-07-26',
    repositories: [
      {
        name: 'alpha',
        views: 12,
        uniqueVisitors: 5,
        clones: 4,
        uniqueCloners: 2,
        recentViews: 120,
        recentUniqueVisitors: 50,
      },
      { name: 'beta', views: 3, uniqueVisitors: 1, clones: 0, uniqueCloners: 0 },
    ],
  });
});
