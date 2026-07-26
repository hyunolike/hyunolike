// scripts/generate-recent-posts.mjs
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FEED_URL = process.env.FEED_URL || 'https://hyunolike.tistory.com/rss';
const parsedMaxPosts = Number.parseInt(process.env.MAX_POSTS || '5', 10);
const MAX_POSTS = Number.isInteger(parsedMaxPosts) && parsedMaxPosts > 0 ? parsedMaxPosts : 5;
const OUT_FILE = process.env.OUT_FILE || 'recent-posts.svg';

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

function isXmlLegalCodePoint(code) {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

export function decodeEntities(str) {
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) || !isXmlLegalCodePoint(code) ? match : String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, entity)
      ? ENTITY_MAP[entity]
      : match;
  });
}

function unwrapCdata(str) {
  const m = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : str;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, '');
}

function cleanText(raw) {
  if (raw == null) return '';
  return decodeEntities(stripTags(unwrapCdata(raw.trim()))).trim();
}

function matchTag(block, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractLink(block) {
  const textLink = matchTag(block, 'link');
  if (textLink && textLink.trim() && !textLink.includes('<')) {
    return cleanText(textLink);
  }
  const hrefMatch = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch) return hrefMatch[1];
  return textLink ? cleanText(textLink) : '';
}

export function parseFeed(xml) {
  let blocks = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  if (blocks.length === 0) {
    const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRe.exec(xml)) !== null) {
      blocks.push(match[1]);
    }
  }

  const items = [];
  for (const block of blocks) {
    const title = cleanText(matchTag(block, 'title'));
    if (!title) continue;
    const link = extractLink(block);
    const dateRaw =
      matchTag(block, 'pubDate') || matchTag(block, 'published') || matchTag(block, 'updated');
    items.push({ title, link, date: cleanText(dateRaw) });
  }
  return items;
}

export function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d).replace(/-/g, '.');
}

function charWidth(ch) {
  return ch.codePointAt(0) > 0x7f ? 1.0 : 0.55;
}

export function truncateTitle(title, maxWidth = 42) {
  const chars = Array.from(title);
  let width = 0;
  let result = '';
  for (const ch of chars) {
    const w = charWidth(ch);
    if (width + w > maxWidth) {
      return result + '…';
    }
    width += w;
    result += ch;
  }
  return result;
}

export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const WIDTH = 780;
const PADDING_X = 24;
const HEADER_HEIGHT = 52;
const ROW_HEIGHT = 34;
const FOOTER_PADDING = 18;
const MAX_TITLE_WIDTH = 42;
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

export function buildSvg(items) {
  const rows = items
    .map((item, i) => {
      const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4;
      const title = escapeXml(truncateTitle(item.title, MAX_TITLE_WIDTH));
      const date = escapeXml(item.date);
      return `
    <text class="marker" x="${PADDING_X}" y="${y}">▶</text>
    <text class="title" x="${PADDING_X + 20}" y="${y}">${title}</text>
    <text class="date" x="${WIDTH - PADDING_X}" y="${y}" text-anchor="end">${date}</text>`;
    })
    .join('');

  const height = HEADER_HEIGHT + items.length * ROW_HEIGHT + FOOTER_PADDING;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <style>
    .card { fill: #0d1117; stroke: #30363d; }
    .heading { font: 600 16px ${FONT_STACK}; fill: #e6edf3; }
    .divider { stroke: #30363d; }
    .marker { font: 400 13px ${FONT_STACK}; fill: #58a6ff; }
    .title { font: 400 14px ${FONT_STACK}; fill: #e6edf3; }
    .date { font: 400 12px ${FONT_STACK}; fill: #8b949e; }
    @media (prefers-color-scheme: light) {
      .card { fill: #ffffff; stroke: #d0d7de; }
      .heading { fill: #1f2328; }
      .divider { stroke: #d0d7de; }
      .marker { fill: #0969da; }
      .title { fill: #1f2328; }
      .date { fill: #57606a; }
    }
  </style>
  <rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12"/>
  <text class="heading" x="${PADDING_X}" y="30">📝 최근 블로그 글</text>
  <line class="divider" x1="${PADDING_X}" y1="42" x2="${WIDTH - PADDING_X}" y2="42"/>${rows}
</svg>`;
}

async function main() {
  const res = await fetch(FEED_URL);
  if (!res.ok) {
    console.error(`Failed to fetch feed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const xml = await res.text();
  const items = parseFeed(xml);
  if (items.length === 0) {
    console.error('No items found in feed.');
    process.exit(1);
  }
  const posts = items.slice(0, MAX_POSTS).map((item) => ({
    ...item,
    date: formatDate(item.date),
  }));
  const svg = buildSvg(posts);
  writeFileSync(OUT_FILE, svg + '\n', 'utf-8');
  console.log(`Wrote ${OUT_FILE} with ${posts.length} posts.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
