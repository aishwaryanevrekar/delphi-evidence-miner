import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, safeConfig } from './config.mjs';
import { delphi, explain } from './delphi.mjs';
import { ledger, factKey } from './ledger.mjs';
import { getMarkets, printTriage } from './markets.mjs';
import { candidateToPayload, validateSubmission } from './compose.mjs';
import { researchMarket } from './research.mjs';

function log(...args) {
  console.log('[praa]', ...args);
}

function requireKey() {
  if (!config.apiKey) throw new Error('DELPHI_API_ACCESS_KEY is empty. See .env.example and README.md.');
}

/* ------------------------------ preflight ------------------------------ */

export async function preflight() {
  log('config', JSON.stringify(safeConfig()));
  requireKey();
  let limits, terms;
  try {
    limits = (await delphi.limits()).data;
  } catch (err) {
    throw new Error(explain(err));
  }
  terms = (await delphi.terms()).data;
  const accepted = Boolean(terms?.acceptedAt);
  log('limits', JSON.stringify(limits));
  log('terms', `version=${terms?.version} accepted=${accepted}`);
  if (!accepted) log('action', `Read ${terms?.url} then run: npm run agent -- accept-terms --yes`);
  return { limits, terms, accepted };
}

export async function acceptTerms({ yes = false } = {}) {
  requireKey();
  const { data: terms } = await delphi.terms();
  if (!terms?.version) throw new Error('No terms version returned');
  if (!terms.acceptedAt && !yes) {
    log('STOP: read the terms first, then re-run with --yes');
    log('terms URL:', terms.url);
    return { accepted: false, url: terms.url, version: terms.version };
  }
  if (terms.acceptedAt) {
    log(`terms version ${terms.version} already accepted at ${terms.acceptedAt}`);
    return { accepted: true, version: terms.version };
  }
  const { data } = await delphi.acceptTerms(terms.version);
  log('terms accepted', data?.version, data?.acceptedAt);
  return { accepted: true, version: data?.version };
}

/* ------------------------------- triage -------------------------------- */

export async function triage({ limit = 30 } = {}) {
  const markets = await getMarkets();
  log(`${markets.length} open markets with future evidence cutoffs`);
  console.log(printTriage(markets.slice(0, limit)));
  return markets;
}

/* ------------------------------ research ------------------------------- */

export async function research({ limit = 8 } = {}) {
  const markets = await getMarkets();
  const results = [];
  for (const m of markets.slice(0, limit)) {
    try {
      const r = await researchMarket(m);
      results.push(r);
      log('research', r.kind || 'skip', r.market, r.file || r.skipped);
    } catch (err) {
      results.push({ market: m.address, error: err.message });
      log('research failed', m.address, err.message);
    }
  }
  return results;
}

/* ------------------------------- submit -------------------------------- */

function stagedCandidates() {
  if (!config.apiKey) throw new Error('DELPHI_API_ACCESS_KEY is empty');
  const dir = config.paths.candidates;
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('._')); } catch { return []; }
  const seen = new Set(ledger.all().filter((e) => e.type === 'submit').map((e) => e.idempotencyKey));
  const out = [];
  for (const f of files.sort()) {
    try {
      const c = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      if (c.kind !== 'candidate' || !c.marketAddress) continue;
      if (!c.idempotencyKey) c.idempotencyKey = randomUUID();
      if (seen.has(c.idempotencyKey)) continue;
      out.push({ file: f, candidate: c });
    } catch { /* ignore malformed staged files */ }
  }
  return out;
}

export async function submitCandidate(candidate, { assumeLimitsOk = false } = {}) {
  const market = candidate.marketAddress;
  const payload = candidateToPayload(candidate);
  const check = validateSubmission(payload);
  if (!check.ok) throw new Error(`Invalid submission: ${check.errors.join('; ')}`);

  const key = factKey(candidate.fact || payload.note);
  const used = ledger.factKeysForMarket(market);
  if (used.has(key)) {
    log('skip duplicate fact on market', market, key);
    return { skipped: 'duplicate fact in ledger', market };
  }

  if (!assumeLimitsOk) {
    const { data: limits } = await delphi.limits();
    const remaining = Number(limits?.submissionsLeftThisHour ?? limits?.remainingThisHour ?? limits?.hourlyRemaining ?? 0);
    if (Number.isFinite(remaining) && remaining <= 0) {
      return { skipped: 'hourly limit exhausted', resetAt: limits?.hourEndsAt || limits?.rateLimit?.resetAt };
    }
  }

  let entry;
  try {
    entry = (await delphi.entryState(market)).data;
  } catch (err) {
    throw new Error(`entry-state failed for ${market}: ${explain(err)}`);
  }
  if (!entry?.canSubmit) {
    return { skipped: 'entry-state', reason: entry?.reason || 'unknown', market };
  }
  const remainingOnMarket = Number(entry.remainingOnMarket ?? 3);
  if (remainingOnMarket <= 0) return { skipped: 'cap_reached', market };

  // Read the account's own submissions to catch duplicates across agents/sessions.
  try {
    const mine = await delphi.allSubmissions({ market });
    const notes = mine.map((s) => String(s.note || '').toLowerCase().replace(/\s+/g, ' ').trim());
    if (notes.some((n) => n && n.includes(String(candidate.fact || payload.note).toLowerCase().slice(0, 120)))) {
      return { skipped: 'already submitted this fact (API list)', market };
    }
  } catch { /* listing is a safety net, not a blocker */ }

  ledger.claim(market, candidate.fact || payload.note);
  let response;
  try {
    response = await delphi.submit(payload);
  } catch (err) {
    throw new Error(explain(err));
  }

  const id = response.data?.id;
  ledger.submit({
    market, id, idempotencyKey: payload.idempotencyKey, fact: candidate.fact || payload.note,
    note: payload.note, links: payload.links, files: payload.files, category: candidate.category,
  });
  log('submitted', market, id, 'items=', check.items);

  const receipt = await delphi.waitForSubmission(id);
  const data = receipt.data || {};
  const rows = Array.isArray(data.markets) ? data.markets : [];
  const verdicts = rows.map((r) => r.verdict || r.status);
  const rewards = rows.map((r) => ({
    bounty: r.bounty?.amount || '0',
    state: r.bounty?.state || r.bounty,
    zeroPayReason: r.zeroPayReason || null,
    settlementUpTo: r.settlementUpTo || null,
  }));
  ledger.receipt({ market, id, status: data.status, verdicts, rewards, settlementUpTo: rewards.map((r) => r.settlementUpTo) });
  log('receipt', id, data.status, JSON.stringify(verdicts), JSON.stringify(rewards));

  if (verdicts.includes('manipulation')) {
    log('ALERT: manipulation verdict. Stop submitting and audit note templates.');
  }
  if (verdicts.includes('unverifiable')) {
    log('LEARN: unverifiable -> resend once with the original document attached and key lines in the note.');
  }
  if (verdicts.includes('duplicate')) {
    log('LEARN: duplicate -> fact hash recorded; do not resend.');
  }
  if (receipt.timedOut) {
    log('LEARN: still queued after timeout; re-read later and send feedback if it persists.');
  }
  return { market, id, status: data.status, verdicts, rewards, timedOut: Boolean(receipt.timedOut) };
}

export async function submitStaged({ limit = config.maxSubmissionsPerRun } = {}) {
  requireKey();
  const staged = stagedCandidates();
  log(`${staged.length} staged candidate(s) not yet submitted`);
  const results = [];
  for (const { file, candidate } of staged.slice(0, limit)) {
    try {
      const r = await submitCandidate(candidate);
      results.push({ file, ...r });
      if (r.skipped) log('skip', file, r.skipped, r.reason || '');
    } catch (err) {
      results.push({ file, error: err.message });
      log('FAILED', file, err.message);
      // Report genuine API breakages; quality feedback can win a $250 bounty.
      if (/5\d\d|network|unexpected/i.test(err.message)) {
        try {
          await delphi.feedback({
            area: 'api',
            title: `Submission failed: ${file}`,
            text: `While running the evidence miner, submit of staged candidate ${file} failed: ${err.message.slice(0, 1000)}`,
          });
        } catch { /* best effort */ }
      }
    }
  }
  return results;
}

export async function loop() {
  await preflight();
  await research({ limit: config.maxSubmissionsPerRun * 2 });
  return submitStaged();
}

/* ------------------------- report & feedback --------------------------- */

export function report() {
  const entries = ledger.all();
  const submits = entries.filter((e) => e.type === 'submit');
  const byMarket = {};
  for (const e of submits) byMarket[e.market] = (byMarket[e.market] || 0) + 1;
  const verdicts = ledger.verdictSummary();
  const lines = [
    `submissions: ${submits.length}`,
    `markets: ${Object.keys(byMarket).length}`,
    `per-market: ${JSON.stringify(byMarket)}`,
    `verdicts: ${JSON.stringify(verdicts)}`,
    `qualification: ${submits.length >= 10 && Object.keys(byMarket).length >= 3 ? 'MET' : 'not yet met'}`,
  ];
  console.log(lines.join('\n'));
  return { submits: submits.length, markets: Object.keys(byMarket).length, verdicts };
}

/** Offline walkthrough for README/demo: real market data, no API key, no submissions. */
export async function demo() {
  console.log('$ npm run agent -- demo');
  console.log('[praa] OFFLINE DEMO - no calls to /submissions, nothing is submitted.');
  console.log('');
  console.log('$ npm run agent -- preflight');
  console.log(`[praa] config ${JSON.stringify(safeConfig())}`);
  console.log('[praa] limits   -> GET /limits: 3 submissions left this hour, resets 16:00 UTC');
  console.log('[praa] terms    -> GET /terms: version 1.0, acceptedAt 2026-11-26T09:00:00Z');
  console.log('');
  console.log('$ npm run agent -- triage --limit 5');
  const markets = await getMarkets();
  console.log(`[praa] ${markets.length} open markets with future evidence cutoffs`);
  console.log(printTriage(markets.slice(0, 5)).split('\n').slice(0, 7).join('\n'));
  console.log('');
  console.log('$ npm run agent -- research --limit 8');
  const staged = stagedCandidatesSafe();
  console.log(`[praa] primary records fetched -> ${staged.length} candidate(s) staged in data/candidates/`);
  for (const c of staged.slice(0, 2)) {
    console.log(`  - ${c.marketAddress.slice(0, 10)}  ${c.category}`);
    console.log(`    ${String(c.fact).slice(0, 150)}...`);
  }
  console.log('');
  console.log('$ npm run agent -- submit --limit 2   # requires your API key');
  console.log('[praa] would check: GET /limits -> GET /markets/{addr}/entry-state -> GET /submissions?market=');
  console.log('[praa] would POST multipart: note + links[] + attached document, stable Idempotency-Key');
  console.log('[praa] would poll GET /submissions/{id} with Retry-After, then log verdict + bounty');
  console.log('');
  console.log('$ npm run agent -- report');
  report();
  console.log('');
  console.log('DEMO COMPLETE - zero submissions were made.');
}

function stagedCandidatesSafe() {
  try {
    return readdirSync(config.paths.candidates)
      .filter((f) => f.endsWith('.json') && !f.startsWith('._'))
      .map((f) => JSON.parse(readFileSync(resolve(config.paths.candidates, f), 'utf8')))
      .filter((c) => c.kind === 'candidate');
  } catch { return []; }
}

export async function sendFeedback({ text, area = 'other', title = '' }) {
  requireKey();
  if (!config.wallet) throw new Error('DELPHI_WALLET is empty; feedback is tied to the wallet that created the key.');
  const { data } = await delphi.feedback({ wallet: config.wallet, area, text, title: title || text.slice(0, 100) });
  ledger.feedback({ id: data?.id, area, title: title || text.slice(0, 100) });
  log('feedback sent', data?.id);
  return data;
}
