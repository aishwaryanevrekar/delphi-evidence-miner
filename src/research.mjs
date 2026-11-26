import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.mjs';
import { ledger, factKey } from './ledger.mjs';

const UA = 'Mozilla/5.0 (compatible; DelphiEvidenceMiner/1.0; +https://competition.delphi.fyi)';

async function fetchText(url, timeout = 20_000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: controller.signal });
    const raw = await res.text();
    return { ok: res.ok, status: res.status, raw, url, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, status: 0, raw: '', url, fetchedAt: new Date().toISOString(), error: err.message };
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(raw) {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function semverParts(tag) {
  const m = String(tag).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Cadence work product: how late is the next release relative to its own history? */
function cadence(dates) {
  const ds = dates.map((d) => Date.parse(d)).filter(Number.isFinite).slice(0, 9);
  if (ds.length < 3) return null;
  const gaps = ds.slice(0, -1).map((d, i) => (ds[i] - ds[i + 1]) / 86_400_000).filter((g) => g > 0);
  const gap = median(gaps);
  if (gap === null) return null;
  const daysSince = (Date.now() - ds[0]) / 86_400_000;
  const expected = new Date(ds[0] + gap * 86_400_000).toISOString().slice(0, 10);
  return {
    gapDays: Number(gap.toFixed(1)),
    daysSinceLast: Number(daysSince.toFixed(1)),
    overdueDays: Number((daysSince - gap).toFixed(1)),
    expectedDate: expected,
    sample: ds.length,
  };
}

function save(kind, market, obj) {
  const dir = resolve(config.paths[kind === 'brief' ? 'briefs' : 'candidates']);
  mkdirSync(dir, { recursive: true });
  const name = `${market.address}-${kind}-${Date.now()}.json`;
  writeFileSync(resolve(dir, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  return resolve(dir, name);
}

function base(m, extra) {
  return {
    id: `${m.address.slice(0, 10)}-${factKey(extra.fact || m.question)}`,
    marketAddress: m.address,
    question: m.question,
    category: m.category,
    odds: m.odds,
    evidenceCutoffAt: m.evidenceCutoffAt,
    resolutionCriteria: m.resolutionCriteria,
    dataSources: m.dataSources,
    kind: 'candidate',
    ...extra,
  };
}

function brief(m, extra = {}) {
  return {
    kind: 'brief',
    marketAddress: m.address,
    question: m.question,
    category: m.category,
    odds: m.odds,
    evidenceCutoffAt: m.evidenceCutoffAt,
    resolutionCriteria: m.resolutionCriteria,
    dataSources: m.dataSources,
    generatedAt: new Date().toISOString(),
    instructions: [
      'Read the resolution criteria literally; identify the exact quantity and the publication window.',
      'Fetch the primary record listed in dataSources. Capture the publication timestamp.',
      'Compute the required next reading to cross the threshold, and the historical base rate.',
      'Write ONE claim: fact+date, source+when, relevance to the criterion+direction, and the working.',
      'Put key lines in the note. Attach the original document as TXT/CSV/PDF when the judge may not fetch it.',
      'Save the finished candidate as data/candidates/<market>-<key>.json using the candidate schema in README.md.',
    ],
    ...extra,
  };
}

/* ------------------------- structured adapters ------------------------- */

async function wikipedia(m) {
  const url = m.dataSources[0];
  const r = await fetchText(url);
  if (!r.ok) return save('brief', m, brief(m, { fetchError: r.error || r.status, sourceExcerpt: r.raw.slice(0, 2000) }));
  let j;
  try { j = JSON.parse(r.raw); } catch { return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) })); }
  const articles = Number(j?.query?.statistics?.articles);
  if (!Number.isFinite(articles)) return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) }));

  const threshold = 7_275_500;
  const checkAt = Date.parse('2026-12-10T12:00:00Z');
  const now = Date.now();
  const gap = threshold - articles;
  const days = Math.max(0.1, (checkAt - now) / 86_400_000);
  const neededPerDay = gap / days;
  const state = gap <= 0 ? 'already at or above the threshold' : 'below the threshold';

  return save('candidate', m, base(m, {
    fact: `English Wikipedia's siteinfo API reports ${articles.toLocaleString('en-US')} articles at ${r.fetchedAt}; the market threshold is ${threshold.toLocaleString('en-US')}, so the count is ${state} (gap ${gap.toLocaleString('en-US')}).`,
    date: r.fetchedAt,
    sourceName: 'English Wikipedia siteinfo API (query.statistics.articles)',
    publishedAt: r.fetchedAt,
    link: url,
    relevance: 'The market resolves on the articles field of this exact API when queried at 2026-12-10T12:00:00Z. This is the primary record itself, not a secondary report.',
    working: `threshold - current = ${threshold} - ${articles} = ${gap}. Days to the 10 Dec 12:00 UTC check = ${days.toFixed(2)}. Net additions required to cross = ${gap.toLocaleString('en-US')} / ${days.toFixed(2)} = ${neededPerDay.toFixed(0)} articles per day.`,
    links: [url],
    files: [{ name: 'wikipedia-siteinfo.txt', content: JSON.stringify(j, null, 2).slice(0, 20_000), mime: 'text/plain' }],
    confidence: 'high',
  }));
}

async function githubReleases(m) {
  const url = m.dataSources[1] || 'https://api.github.com/repos/oven-sh/bun/releases?per_page=20';
  const r = await fetchText(url);
  if (!r.ok) return save('brief', m, brief(m, { fetchError: r.error || r.status }));
  let list;
  try { list = JSON.parse(r.raw); } catch { return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) })); }
  if (!Array.isArray(list)) return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) }));
  const tags = list
    .map((x) => ({ tag: x.tag_name, published: x.published_at, parts: semverParts(x.tag_name) }))
    .filter((x) => x.tag?.startsWith('bun-v') && x.parts);
  if (!tags.length) return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) }));
  tags.sort((a, b) => cmpSemver(b.parts, a.parts));
  const top = tags[0];
  const qualifying = cmpSemver(top.parts, [1, 4, 6]) >= 0;
  const afterWindow = Date.parse(top.published) > Date.parse('2026-11-28T00:00:00Z');
  const cad = cadence(tags.map((x) => x.published));
  const cadenceFact = cad
    ? ` Across ${cad.sample} recent releases the median gap is ${cad.gapDays} days; ${cad.daysSinceLast} days had elapsed since ${top.published} at read time, putting the next release around ${cad.expectedDate} on that cadence.`
    : '';

  return save('candidate', m, base(m, {
    fact: `The oven-sh/bun GitHub releases API shows the highest tag as ${top.tag} (published ${top.published}), read at ${r.fetchedAt}. Against the market's minimum bun-v1.4.6 and window opening 2026-11-28T00:00Z: version qualifies=${qualifying}, published after window=${afterWindow}.${cadenceFact}`,
    date: r.fetchedAt,
    sourceName: 'GitHub Releases API, oven-sh/bun',
    publishedAt: r.fetchedAt,
    link: 'https://github.com/oven-sh/bun/releases',
    relevance: 'Resolution uses the release tag and published_at field from this repository within 2026-11-28T00:00Z to 2026-12-11T00:00Z. This is the authoritative machine-readable record; the cadence arithmetic is derived from its own release history.',
    working: `Compared ${tags.length} tags by semantic version; highest = ${top.tag} = ${top.parts.join('.')}; minimum qualifying = 1.4.6; comparison result = ${qualifying ? '>= minimum' : '< minimum'}; published_at ${top.published} vs window start 2026-11-28T00:00Z = ${afterWindow ? 'after' : 'before'}.${cad ? ` Cadence: median of ${cad.sample - 1} gaps = ${cad.gapDays} days; days since last = ${cad.daysSinceLast}; overdue = ${cad.overdueDays}.` : ''}`,
    links: ['https://github.com/oven-sh/bun/releases', url],
    files: [{ name: 'bun-releases.txt', content: JSON.stringify(list.slice(0, 10), null, 2).slice(0, 20_000), mime: 'text/plain' }],
    confidence: 'high',
  }));
}

async function goReleases(m) {
  const url = m.dataSources[0];
  const r = await fetchText(url);
  if (!r.ok) return save('brief', m, brief(m, { fetchError: r.error || r.status }));
  const text = htmlToText(r.raw);
  const versions = [...new Set((text.match(/go1\.27\.\d+/g) || []))];
  const patches = versions.map((v) => Number(v.split('.').pop())).filter(Number.isFinite);
  const top = patches.length ? Math.max(...patches) : null;
  const hasTarget = patches.includes(5);
  const dated = [...text.matchAll(/go1\.27\.(\d+)\s*\(released\s+(\d{4}-\d{2}-\d{2})\)/g)]
    .map((x) => ({ patch: Number(x[1]), date: x[2] }))
    .sort((a, b) => b.patch - a.patch);
  const cad = cadence(dated.map((x) => x.date));
  const cadenceFact = cad && dated.length
    ? ` The dated entries give a median gap of ${cad.gapDays} days across ${cad.sample} releases; the newest listed (go1.27.${dated[0].patch}, ${dated[0].date}) was ${cad.daysSinceLast} days old at read time, putting the next patch around ${cad.expectedDate} on that cadence.`
    : '';

  return save('candidate', m, base(m, {
    fact: `The Go Release History page at ${r.fetchedAt} lists Go 1.27 patch versions ${versions.sort().join(', ') || '(none found)'}; the highest listed patch is ${top === null ? 'not detected' : `go1.27.${top}`}, and go1.27.5 is ${hasTarget ? 'listed' : 'not listed'}.${cadenceFact}`,
    date: r.fetchedAt,
    sourceName: 'Go Release History, go.dev/doc/devel/release',
    publishedAt: r.fetchedAt,
    link: url,
    relevance: 'The market resolves on whether an entry for Go 1.27.5 with a release date appears on this exact page by 2026-12-08T23:59Z. This is the source of record; the cadence arithmetic is derived from the dated entries on the same page.',
    working: `Parsed the page text for /go1\\.27\\.\\d+/; found ${versions.length} distinct versions and ${dated.length} dated entries; compared the highest patch ${top} with the required patch 5.${cad ? ` Cadence: median gap ${cad.gapDays} days; days since last ${cad.daysSinceLast}; overdue ${cad.overdueDays}.` : ''}`,
    links: [url],
    files: [{ name: 'go-release-history.txt', content: text.slice(0, 20_000), mime: 'text/plain' }],
    confidence: top === null ? 'medium' : 'high',
  }));
}

async function nodeReleases(m) {
  const url = m.dataSources[0];
  const r = await fetchText(url);
  if (!r.ok) return save('brief', m, brief(m, { fetchError: r.error || r.status }));
  let list;
  try { list = JSON.parse(r.raw); } catch { return save('brief', m, brief(m, { sourceExcerpt: r.raw.slice(0, 2000) })); }
  const v26 = list
    .filter((x) => /^v26\.\d+\.\d+$/.test(x.version || ''))
    .map((x) => ({ version: x.version, date: x.date, parts: semverParts(x.version) }))
    .filter((x) => x.parts);
  v26.sort((a, b) => cmpSemver(b.parts, a.parts));
  const top = v26[0];
  const cad = cadence(v26.map((x) => x.date));
  const cadenceFact = top && cad
    ? ` The median gap between recent v26 releases is ${cad.gapDays} days; ${cad.daysSinceLast} days had elapsed since ${top.version} (${top.date}) at read time, putting the next v26 release around ${cad.expectedDate} on that cadence.`
    : '';

  return save('candidate', m, base(m, {
    fact: `nodejs.org/dist/index.json at ${r.fetchedAt} lists ${v26.length} v26.x.x releases; the highest is ${top ? `${top.version} dated ${top.date}` : 'none found'}. The market's minimum is v26.14.0 with date on or before 2026-12-11.${cadenceFact}`,
    date: r.fetchedAt,
    sourceName: 'Node.js distribution index (nodejs.org/dist/index.json)',
    publishedAt: r.fetchedAt,
    link: url,
    relevance: 'Resolution checks this exact JSON feed for a v26.14.0-or-later version with a date on or before 2026-12-11, present by 2026-12-12T07:59:59Z. The cadence arithmetic is computed from the feed itself, not from commentary.',
    working: `Filtered ${list.length} entries to /^v26\\.\\d+\\.\\d+$/ (${v26.length} matches), sorted by semantic version, highest=${top?.version || 'none'}, then compared with v26.14.0.${cad ? ` Cadence: median gap ${cad.gapDays} days over ${cad.sample} releases; days since last ${cad.daysSinceLast}; overdue ${cad.overdueDays}.` : ''}`,
    links: [url],
    files: [{ name: 'node-dist-index.txt', content: JSON.stringify(v26.slice(0, 20), null, 2).slice(0, 20_000), mime: 'text/plain' }],
    confidence: top ? 'high' : 'medium',
  }));
}

/* --------------------------- generic paths --------------------------- */

async function primaryExcerpt(m) {
  const excerpts = [];
  for (const url of (m.dataSources || []).slice(0, 4)) {
    const r = await fetchText(url);
    excerpts.push({ url, ok: r.ok, status: r.status, fetchedAt: r.fetchedAt, text: htmlToText(r.raw).slice(0, 4000) });
  }
  return excerpts;
}

async function statisticsAdapter(m) {
  const excerpts = await primaryExcerpt(m);
  const ok = excerpts.filter((e) => e.ok && e.text);
  return save('brief', m, brief(m, {
    whyThisAdapter: 'Official statistics reward calculation, not headlines. The forecaster reads news well and computes poorly.',
    excerpts,
    hits: ok.length,
    calculationTarget: {
      question: m.question,
      resolutionCriteria: m.resolutionCriteria,
      tasks: [
        'Extract the latest published value and its exact publication timestamp from the primary table.',
        'Compute the next reading required to cross the threshold stated in the resolution criteria.',
        'Compute the base rate: how often the required move happened in the last N releases.',
        'Attach the underlying table as CSV/TXT and show inputs, formula and result in the note.',
      ],
    },
  }));
}

async function genericAdapter(m) {
  const excerpts = await primaryExcerpt(m);
  return save('brief', m, brief(m, {
    whyThisAdapter: m.category === 'votes_government' || m.category === 'local_language'
      ? 'Prefer local-language / official records; paste key lines in the note and attach a screenshot or document when the judge may not fetch the page.'
      : 'Find dated primary-record state, not widely reported news.',
    excerpts,
    hits: excerpts.filter((e) => e.ok && e.text).length,
  }));
}

const BY_ADDRESS = {
  '0x7a17b76f7f1cda20e8bc5a88166c4732e6db39f5': wikipedia,
  '0x921e39354e4bfc18251ad1b1c80eec1a3940ab82': githubReleases,
  '0xf640443d15af94932e1a7294c15312f0ad9e1136': goReleases,
  '0x3c8a98eb4ebca3156af93bf85c76bb3ac13ab4b0': nodeReleases,
};

export async function researchMarket(m) {
  if (ledger.factKeysForMarket(m.address).size >= 3) return { market: m.address, skipped: 'three facts already used' };
  const adapter = BY_ADDRESS[m.address]
    || (m.category === 'official_statistics' ? statisticsAdapter : genericAdapter);
  const file = await adapter(m);
  return { market: m.address, category: m.category, kind: file.includes('brief') ? 'brief' : 'candidate', file };
}
