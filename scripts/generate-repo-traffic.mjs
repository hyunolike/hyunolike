import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const EXCLUDED_REPOSITORIES = new Set(['hyunolike']);
const DEFAULT_CHARACTER_IMAGE_PATH = 'img/20210201112030.jpg';

function toNonNegativeInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeDailyEntry(entry) {
  return {
    date: String(entry?.date || ''),
    views: toNonNegativeInteger(entry?.views),
    uniqueVisitors: toNonNegativeInteger(entry?.uniqueVisitors),
    clones: toNonNegativeInteger(entry?.clones),
    uniqueCloners: toNonNegativeInteger(entry?.uniqueCloners),
  };
}

function normalizeRepositoryHistory(repoHistory) {
  const daily = Array.isArray(repoHistory?.daily) ? repoHistory.daily : [];
  return {
    daily: daily
      .map(normalizeDailyEntry)
      .filter((entry) => entry.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function normalizeHistory(raw) {
  const repositories = {};
  const rawRepos = raw?.repositories && typeof raw.repositories === 'object' ? raw.repositories : {};

  for (const [name, repoHistory] of Object.entries(rawRepos)) {
    if (!name) continue;
    repositories[name] = normalizeRepositoryHistory(repoHistory);
  }

  return { repositories };
}

function normalizeSnapshotRepo(repo) {
  return {
    name: String(repo?.name || '').trim(),
    views: toNonNegativeInteger(repo?.views),
    uniqueVisitors: toNonNegativeInteger(repo?.uniqueVisitors),
    clones: toNonNegativeInteger(repo?.clones),
    uniqueCloners: toNonNegativeInteger(repo?.uniqueCloners),
    recentViews: repo?.recentViews == null ? undefined : toNonNegativeInteger(repo.recentViews),
    recentUniqueVisitors:
      repo?.recentUniqueVisitors == null ? undefined : toNonNegativeInteger(repo.recentUniqueVisitors),
  };
}

export function mergeSnapshot(history, snapshot) {
  const next = normalizeHistory(history);
  const date = String(snapshot?.date || '').trim();
  const repos = Array.isArray(snapshot?.repositories) ? snapshot.repositories : [];

  if (!date) return next;

  for (const repo of repos.map(normalizeSnapshotRepo).filter((item) => item.name && isIncludedRepository(item.name))) {
    const existing = next.repositories[repo.name] || { daily: [] };
    const withoutSameDate = existing.daily.filter((entry) => entry.date !== date);
    next.repositories[repo.name] = {
      daily: [
        ...withoutSameDate,
        {
          date,
          views: repo.views,
          uniqueVisitors: repo.uniqueVisitors,
          clones: repo.clones,
          uniqueCloners: repo.uniqueCloners,
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  return next;
}

function sumEntries(entries, key) {
  return entries.reduce((sum, entry) => sum + toNonNegativeInteger(entry[key]), 0);
}

function formatSeoulDate(date = new Date()) {
  return SEOUL_DATE_FORMATTER.format(date).replace(/-/g, '.');
}

function todaySeoulIso() {
  return SEOUL_DATE_FORMATTER.format(new Date());
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

function truncateRepoName(name, maxLength = 22) {
  const chars = Array.from(String(name));
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}...` : chars.join('');
}

export function isIncludedRepository(name) {
  return !EXCLUDED_REPOSITORIES.has(String(name || '').trim().toLowerCase());
}

function mimeTypeForImagePath(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function loadCharacterImageDataUri(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  const mimeType = mimeTypeForImagePath(filePath);
  const base64 = readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

export function calculateMetrics(history, snapshot) {
  const normalized = normalizeHistory(history);
  const repos = Object.entries(normalized.repositories)
    .filter(([name]) => isIncludedRepository(name))
    .map(([name, repoHistory]) => ({
      name,
      views: sumEntries(repoHistory.daily, 'views'),
      uniqueVisitors: sumEntries(repoHistory.daily, 'uniqueVisitors'),
      clones: sumEntries(repoHistory.daily, 'clones'),
      uniqueCloners: sumEntries(repoHistory.daily, 'uniqueCloners'),
    }));
  const recentRepos = (Array.isArray(snapshot?.repositories) ? snapshot.repositories : [])
    .map(normalizeSnapshotRepo)
    .filter((repo) => repo.name && isIncludedRepository(repo.name))
    .map((repo) => ({
      ...repo,
      views: repo.recentViews ?? repo.views,
      uniqueVisitors: repo.recentUniqueVisitors ?? repo.uniqueVisitors,
    }))
    .sort((a, b) => b.views - a.views || b.uniqueVisitors - a.uniqueVisitors || a.name.localeCompare(b.name));

  const emptyRepo = { name: 'no-traffic-yet', views: 0, uniqueVisitors: 0, clones: 0, uniqueCloners: 0 };
  const totalUniqueVisitors = repos.reduce((sum, repo) => sum + repo.uniqueVisitors, 0);

  return {
    date: formatSeoulDate(),
    totalViews: repos.reduce((sum, repo) => sum + repo.views, 0),
    totalUniqueVisitors,
    totalClones: repos.reduce((sum, repo) => sum + repo.clones, 0),
    level: Math.max(1, Math.floor(totalUniqueVisitors / 10)),
    topRepo: recentRepos[0] || emptyRepo,
    recentRepos: recentRepos.slice(0, 3),
  };
}

export function buildFallbackSnapshot() {
  return {
    date: SEOUL_DATE_FORMATTER.format(new Date()),
    repositories: [
      { name: 'moyeorak-web', views: 42, uniqueVisitors: 17, clones: 8, uniqueCloners: 4 },
      { name: 'spring-template', views: 24, uniqueVisitors: 9, clones: 5, uniqueCloners: 2 },
      { name: 'blog-source', views: 16, uniqueVisitors: 7, clones: 2, uniqueCloners: 1 },
    ],
  };
}

export function buildSnapshotFromTrafficResults(date, results) {
  function findDailyValue(response, listKey, key) {
    const rows = Array.isArray(response?.[listKey]) ? response[listKey] : [];
    const exact = rows.find((row) => String(row?.timestamp || '').startsWith(date));
    const latest = rows.at(-1);
    const row = exact || latest;
    return row ? toNonNegativeInteger(row[key]) : undefined;
  }

  return {
    date,
    repositories: results
      .filter((result) => result?.name)
      .filter((result) => isIncludedRepository(result.name))
      .map((result) => ({
        name: String(result.name),
        views: findDailyValue(result.views, 'views', 'count') ?? toNonNegativeInteger(result.views?.count),
        uniqueVisitors: findDailyValue(result.views, 'views', 'uniques') ?? toNonNegativeInteger(result.views?.uniques),
        clones: findDailyValue(result.clones, 'clones', 'count') ?? toNonNegativeInteger(result.clones?.count),
        uniqueCloners: findDailyValue(result.clones, 'clones', 'uniques') ?? toNonNegativeInteger(result.clones?.uniques),
        ...(Array.isArray(result.views?.views)
          ? {
              recentViews: toNonNegativeInteger(result.views?.count),
              recentUniqueVisitors: toNonNegativeInteger(result.views?.uniques),
            }
          : {}),
      })),
  };
}

async function githubJson(path, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  });

  if (!res.ok) {
    const error = new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

async function listOwnerRepositories({ owner, token, maxRepositories, fetchImpl = fetch }) {
  const repositories = [];
  let page = 1;

  while (repositories.length < maxRepositories) {
    const batch = await githubJson(
      `/users/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=pushed&type=owner`,
      token,
      fetchImpl,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const repo of batch) {
      if (repo?.fork || repo?.archived) continue;
      if (!isIncludedRepository(repo.name)) continue;
      repositories.push(String(repo.name));
      if (repositories.length >= maxRepositories) break;
    }
    page += 1;
  }

  return repositories;
}

async function fetchRepoTraffic({ owner, repo, token, fetchImpl = fetch }) {
  try {
    const [views, clones] = await Promise.all([
      githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/traffic/views`, token, fetchImpl),
      githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/traffic/clones`, token, fetchImpl),
    ]);
    return { name: repo, views, clones };
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      console.warn(`Skipping ${owner}/${repo}: traffic data unavailable (${error.status})`);
      return null;
    }
    throw error;
  }
}

export async function collectTrafficSnapshot({
  owner = process.env.GITHUB_OWNER || 'hyunolike',
  token = process.env.TRAFFIC_API_TOKEN || process.env.GITHUB_TOKEN,
  maxRepositories = Number.parseInt(process.env.MAX_REPOSITORIES || '30', 10),
  fetchImpl = fetch,
} = {}) {
  if (!token) {
    throw new Error('TRAFFIC_API_TOKEN or GITHUB_TOKEN is required when --collect is used.');
  }

  const repositoryLimit = Number.isInteger(maxRepositories) && maxRepositories > 0 ? maxRepositories : 30;
  const repos = await listOwnerRepositories({ owner, token, maxRepositories: repositoryLimit, fetchImpl });
  const results = [];

  for (const repo of repos) {
    const result = await fetchRepoTraffic({ owner, repo, token, fetchImpl });
    if (result) results.push(result);
  }

  return buildSnapshotFromTrafficResults(new Date().toISOString().slice(0, 10), results);
}

function buildCharacterVisual(characterImageDataUri) {
  if (characterImageDataUri) {
    return `
  <g class="character-image-wrap" aria-label="Debugging meme image">
    <desc>Debugging meme image</desc>
    <rect class="character-frame" x="74" y="100" width="168" height="122" rx="10"/>
    <clipPath id="character-image-clip">
      <rect x="80" y="106" width="156" height="110" rx="7"/>
    </clipPath>
    <image class="character-image" x="80" y="106" width="156" height="110" href="${escapeXml(characterImageDataUri)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#character-image-clip)"/>
  </g>`;
  }

  return `
  <g class="character" aria-label="Pixel developer dog with MacBook and employee badge">
    <desc>Pixel developer dog with MacBook and employee badge</desc>
    <rect class="spark" x="70" y="112" width="8" height="8" rx="2"/>
    <rect class="spark" x="228" y="128" width="7" height="7" rx="2"/>
    <rect class="spark" x="218" y="218" width="6" height="6" rx="2"/>
    <rect class="pixel-shadow" x="88" y="254" width="136" height="14" rx="2"/>

    <rect class="pixel-outline" x="100" y="146" width="30" height="58"/>
    <rect class="pixel-outline" x="190" y="146" width="30" height="58"/>
    <rect class="fur-shadow" x="104" y="150" width="24" height="50"/>
    <rect class="fur-shadow" x="192" y="150" width="24" height="50"/>

    <rect class="pixel-outline" x="112" y="112" width="96" height="104"/>
    <rect class="fur-main" x="120" y="112" width="80" height="8"/>
    <rect class="fur-main" x="116" y="116" width="88" height="96"/>
    <rect class="fur-light" x="128" y="138" width="64" height="62"/>
    <rect class="fur-cream" x="140" y="154" width="40" height="34"/>

    <rect class="pixel-outline" x="96" y="118" width="32" height="54"/>
    <rect class="pixel-outline" x="192" y="118" width="32" height="54"/>
    <rect class="fur-shadow" x="100" y="122" width="24" height="46"/>
    <rect class="fur-shadow" x="196" y="122" width="24" height="46"/>
    <rect class="fur-main" x="108" y="122" width="16" height="18"/>
    <rect class="fur-main" x="196" y="122" width="16" height="18"/>

    <rect class="pixel-dark" x="136" y="140" width="12" height="12"/>
    <rect class="pixel-dark" x="172" y="140" width="12" height="12"/>
    <rect class="fur-cream" x="150" y="150" width="20" height="16"/>
    <rect class="pixel-dark" x="156" y="154" width="8" height="8"/>
    <rect class="fur-shadow" x="144" y="174" width="32" height="8"/>
    <rect class="fur-main" x="128" y="124" width="16" height="8"/>
    <rect class="fur-main" x="176" y="124" width="16" height="8"/>
    <rect class="fur-cream" x="130" y="158" width="6" height="6"/>
    <rect class="fur-cream" x="184" y="158" width="6" height="6"/>

    <rect class="pixel-outline" x="112" y="184" width="96" height="56"/>
    <rect class="macbook-dark" x="116" y="188" width="88" height="48"/>
    <rect class="macbook" x="124" y="184" width="72" height="44"/>
    <rect class="screen-glow" x="132" y="192" width="56" height="24"/>
    <rect class="macbook-light" x="132" y="192" width="56" height="24" opacity="0.34"/>
    <rect class="pixel-dark" x="154" y="202" width="16" height="4"/>
    <line class="badge-line" x1="122" y1="190" x2="103" y2="208"/>
    <g class="badge-swing">
      <rect class="pixel-outline" x="82" y="204" width="36" height="28"/>
      <rect class="badge" x="86" y="208" width="28" height="20"/>
      <rect class="fur-cream" x="92" y="212" width="8" height="8"/>
      <rect class="macbook-light" x="103" y="214" width="7" height="3"/>
      <rect class="macbook-light" x="103" y="220" width="7" height="3"/>
    </g>
  </g>`;
}

export function buildSvg(metrics, options = {}) {
  const topRepo = metrics?.topRepo || { name: 'no-traffic-yet', views: 0, uniqueVisitors: 0, clones: 0 };
  const recentRepos = Array.isArray(metrics?.recentRepos) ? metrics.recentRepos.slice(0, 3) : [];
  const characterVisual = buildCharacterVisual(options.characterImageDataUri || '');
  const rows = recentRepos
    .map((repo, index) => {
      const y = 220 + index * 32;
      const width = Math.max(16, Math.min(144, Math.round((toNonNegativeInteger(repo.views) / Math.max(1, toNonNegativeInteger(topRepo.views))) * 144)));
      return `
    <text class="rank" x="322" y="${y}">${index + 1}</text>
    <text class="repo" x="348" y="${y}">${escapeXml(truncateRepoName(repo.name))}</text>
    <rect class="bar-bg" x="536" y="${y - 11}" width="144" height="8" rx="4"/>
    <rect class="bar" x="536" y="${y - 11}" width="${width}" height="8" rx="4"/>
    <text class="repo-count" x="724" y="${y}">${formatNumber(repo.views)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="322" viewBox="0 0 780 322" role="img" aria-labelledby="title desc">
  <title id="title">Repository Visitors</title>
  <desc id="desc">Long-term GitHub repository traffic summary for hyunolike.</desc>
  <style>
    .card { fill: #0d1117; stroke: #30363d; }
    .heading { font: 700 18px ${FONT_STACK}; fill: #e6edf3; }
    .subtle { font: 400 12px ${FONT_STACK}; fill: #8b949e; }
    .level { font: 800 22px ${FONT_STACK}; fill: #f0f6fc; }
    .metric-label { font: 500 13px ${FONT_STACK}; fill: #8b949e; }
    .metric-value { font: 800 18px ${FONT_STACK}; fill: #e6edf3; }
    .repo-title { font: 700 14px ${FONT_STACK}; fill: #e6edf3; }
    .rank { font: 800 13px ${FONT_STACK}; fill: #58a6ff; }
    .repo { font: 500 13px ${FONT_STACK}; fill: #c9d1d9; }
    .repo-count { font: 700 13px ${FONT_STACK}; fill: #e6edf3; text-anchor: end; }
    .divider { stroke: #30363d; }
    .bar-bg { fill: #21262d; }
    .bar { fill: #58a6ff; }
    .pixel-dark { fill: #1f2328; }
    .pixel-outline { fill: #0b0f14; }
    .pixel-shadow { fill: #8a5a16; }
    .fur-main { fill: #d8953a; }
    .fur-light { fill: #ffd889; }
    .fur-cream { fill: #fff0c4; }
    .fur-shadow { fill: #a76a22; }
    .macbook { fill: #c9d1d9; }
    .macbook-dark { fill: #6e7681; }
    .macbook-light { fill: #e6edf3; }
    .badge { fill: #58a6ff; }
    .badge-line { stroke: #58a6ff; stroke-width: 3; stroke-linecap: round; }
    .screen-glow { fill: #79c0ff; opacity: 0.42; }
    .spark { fill: #3fb950; opacity: 0.85; }
    .character-frame { fill: #161b22; stroke: #30363d; stroke-width: 2; }
    .character-image { image-rendering: auto; }
    .character {
      transform-origin: 162px 170px;
      animation: float 2.8s ease-in-out infinite;
    }
    .spark {
      animation: blink 1.6s ease-in-out infinite alternate;
    }
    .badge-swing {
      transform-origin: 126px 210px;
      animation: swing 2.8s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
    @keyframes blink {
      from { opacity: 0.25; }
      to { opacity: 0.9; }
    }
    @keyframes swing {
      0%, 100% { transform: rotate(-3deg); }
      50% { transform: rotate(4deg); }
    }
    @media (prefers-color-scheme: light) {
      .card { fill: #ffffff; stroke: #d0d7de; }
      .heading, .level, .metric-value, .repo-title, .repo-count { fill: #1f2328; }
      .subtle, .metric-label { fill: #57606a; }
      .repo { fill: #24292f; }
      .divider { stroke: #d0d7de; }
      .bar-bg { fill: #d8dee4; }
      .bar { fill: #0969da; }
      .rank { fill: #0969da; }
      .badge { fill: #0969da; }
      .badge-line { stroke: #0969da; }
      .macbook { fill: #8c959f; }
      .macbook-dark { fill: #57606a; }
      .macbook-light { fill: #f6f8fa; }
      .character-frame { fill: #f6f8fa; stroke: #d0d7de; }
    }
  </style>
  <rect class="card" x="0.5" y="0.5" width="779" height="321" rx="12"/>
  <text class="heading" x="28" y="36">Repository Visitors</text>
  <text class="subtle" x="28" y="56">Long-term traffic, generated daily</text>
  <text class="subtle" x="752" y="36" text-anchor="end">Updated ${escapeXml(metrics?.date || formatSeoulDate())}</text>
  <line class="divider" x1="28" y1="76" x2="752" y2="76"/>

${characterVisual}

  <text class="level" x="96" y="266">Lv. ${formatNumber(metrics?.level || 1)} Visitor</text>
  <text class="subtle" x="96" y="292">Top repo: ${escapeXml(truncateRepoName(topRepo.name, 20))}</text>

  <text class="metric-label" x="318" y="112">Total Views</text>
  <text class="metric-value" x="496" y="112" text-anchor="end">${formatNumber(metrics?.totalViews)}</text>
  <text class="metric-label" x="548" y="112">Unique Visitors</text>
  <text class="metric-value" x="728" y="112" text-anchor="end">${formatNumber(metrics?.totalUniqueVisitors)}</text>

  <text class="metric-label" x="318" y="148">Total Clones</text>
  <text class="metric-value" x="496" y="148" text-anchor="end">${formatNumber(metrics?.totalClones)}</text>
  <text class="metric-label" x="548" y="148">Recent Top Views</text>
  <text class="metric-value" x="728" y="148" text-anchor="end">${formatNumber(topRepo.views)}</text>

  <line class="divider" x1="318" y1="172" x2="728" y2="172"/>
  <text class="repo-title" x="318" y="194">Most Viewed Repositories - Last 14 Days</text>${rows}
</svg>`;
}

function readJsonFile(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function parseArgs(argv) {
  const args = { out: 'repo-traffic.svg', history: '', snapshot: '', collect: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] || args.out;
    if (arg === '--history') args.history = argv[++i] || args.history;
    if (arg === '--snapshot') args.snapshot = argv[++i] || args.snapshot;
    if (arg === '--collect') args.collect = true;
  }
  return args;
}

function writeTextFile(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf-8');
}

async function runLocalCli() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = args.collect ? await collectTrafficSnapshot() : readJsonFile(args.snapshot, buildFallbackSnapshot());
  const currentHistory = normalizeHistory(readJsonFile(args.history, {}));
  const history = mergeSnapshot(currentHistory, snapshot);
  const metrics = calculateMetrics(history, snapshot);
  const characterImagePath = process.env.CHARACTER_IMAGE_PATH || DEFAULT_CHARACTER_IMAGE_PATH;
  const svg = buildSvg(metrics, { characterImageDataUri: loadCharacterImageDataUri(characterImagePath) });
  writeTextFile(args.out, `${svg}\n`);
  if (args.history) {
    writeTextFile(args.history, `${JSON.stringify(history, null, 2)}\n`);
  }
  console.log(`Wrote ${args.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
