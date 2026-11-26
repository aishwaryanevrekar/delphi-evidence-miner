import { config } from './config.mjs';

/** Expected-value triage. We deliberately do not reward odds near 0 or 1. */
export function rankMarket(m, now = Date.now()) {
  const yes = Number(m.odds?.yes);
  const cutoff = Date.parse(m.evidenceCutoffAt);
  const closes = Date.parse(m.closesAt);

  if (m.status !== 'open' || m.settled !== null || !Number.isFinite(cutoff) || cutoff <= now) {
    return { ...m, evScore: -Infinity, skipReason: m.status !== 'open' ? 'not_open' : 'cutoff_passed' };
  }
  if (!Number.isFinite(yes)) return { ...m, evScore: -Infinity, skipReason: 'no_odds' };

  // Centered odds: maximum at 50%, zero at 0/100.
  const balance = Math.max(0, 1 - Math.abs(yes - 0.5) / 0.5);
  const inBand = yes >= 0.2 && yes <= 0.8 ? 1 : 0.25;
  const hoursToCutoff = (cutoff - now) / 3_600_000;
  const runway = Math.min(1, hoursToCutoff / 48); // prefer >48h of runway
  const tooSoon = hoursToCutoff < 6 ? 0.3 : 1;
  const sourceCount = Array.isArray(m.dataSources) ? m.dataSources.length : 0;
  const sourceScore = Math.min(1, sourceCount / 2);
  const tier = m.marketTier === 'A' ? 1 : 0.8;
  const categoryBoost = ['official_statistics', 'releases_standards', 'niche_communities'].includes(m.category) ? 1.15 : 1;

  const evScore = Number((balance * inBand * (0.5 + 0.5 * runway) * tooSoon * sourceScore * tier * categoryBoost).toFixed(4));
  return { ...m, evScore, hoursToCutoff: Math.round(hoursToCutoff), skipReason: null };
}

export async function getMarkets({ includeClosed = false } = {}) {
  const res = await fetch(config.marketsUrl);
  if (!res.ok) throw new Error(`Markets list HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('Markets list is not an array');
  const ranked = raw.map((m) => rankMarket(m));
  return includeClosed ? ranked : ranked.filter((m) => Number.isFinite(m.evScore));
}

export function printTriage(markets) {
  const lines = markets.map((m) => {
    const odds = `${(Number(m.odds?.yes) * 100).toFixed(1)}%`;
    return `${m.evScore.toFixed(3)} | ${m.category.padEnd(20)} | ${odds.padStart(6)} | ${String(m.hoursToCutoff).padStart(4)}h | ${m.address} | ${m.question}`;
  });
  return ['SCORE | CATEGORY             |  YES  | RUNWAY | MARKET | QUESTION', '-'.repeat(120), ...lines].join('\n');
}
