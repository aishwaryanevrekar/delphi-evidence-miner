import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.mjs';

const path = config.paths.ledger;

function append(entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  return entry;
}

export function factKey(text) {
  return createHash('sha256')
    .update(String(text).toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 16);
}

export const ledger = {
  /** Mark a fact as being researched, so parallel agents do not duplicate work. */
  claim(market, fact) {
    return append({ type: 'claim', market, factKey: factKey(fact), fact });
  },

  submit({ market, id, idempotencyKey, fact, note, links, files, category }) {
    return append({
      type: 'submit',
      market,
      id,
      idempotencyKey,
      factKey: factKey(fact || note),
      fact,
      note,
      links,
      files: (files || []).map((f) => f.name),
      category,
    });
  },

  receipt({ market, id, status, verdicts, rewards, settlementUpTo }) {
    return append({ type: 'receipt', market, id, status, verdicts, rewards, settlementUpTo });
  },

  feedback({ id, area, title }) {
    return append({ type: 'feedback', id, area, title });
  },

  all() {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  },

  factKeysForMarket(market) {
    const keys = new Set();
    for (const e of this.all()) {
      if (e.market !== market || !e.factKey) continue;
      if (e.type === 'submit' || (e.type === 'claim' && !this._submittedKeys().has(e.factKey))) keys.add(e.factKey);
    }
    return keys;
  },

  _submittedKeys() {
    return new Set(this.all().filter((e) => e.type === 'submit' && e.factKey).map((e) => e.factKey));
  },

  submittedCountForMarket(market) {
    return this.all().filter((e) => e.type === 'submit' && e.market === market).length;
  },

  verdictSummary() {
    const counts = {};
    for (const e of this.all()) {
      if (e.type !== 'receipt') continue;
      for (const v of e.verdicts || []) counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  },
};
