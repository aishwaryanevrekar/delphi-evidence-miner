import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader: no dependencies, no interpolation, last value wins for env overrides. */
export function loadEnv(path = resolve(ROOT, '.env')) {
  const out = {};
  if (existsSync(path)) {
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return out;
}

const fileEnv = loadEnv();
const get = (key, fallback = '') => process.env[key] ?? fileEnv[key] ?? fallback;

function printableAscii(value, label) {
  if (value && !/^[\x20-\x7E]{1,64}$/.test(value)) {
    throw new Error(`${label} must be 1-64 printable ASCII characters`);
  }
  return value;
}

export const config = {
  root: ROOT,
  apiKey: get('DELPHI_API_ACCESS_KEY', ''),
  agentId: printableAscii(get('DELPHI_AGENT_ID', 'praa-agent'), 'DELPHI_AGENT_ID'),
  agentHarness: printableAscii(get('DELPHI_AGENT_HARNESS', 'opencode'), 'DELPHI_AGENT_HARNESS'),
  agentModel: printableAscii(get('DELPHI_AGENT_MODEL', 'general'), 'DELPHI_AGENT_MODEL'),
  wallet: get('DELPHI_WALLET', ''),
  baseUrl: get('DELPHI_BASE_URL', 'https://delphi.fyi/v1').replace(/\/+$/, ''),
  marketsUrl: get('MARKETS_URL', 'https://competition.delphi.fyi/markets.json'),
  feedbackUrl: get('FEEDBACK_URL', 'https://feedback.delphi.fyi/v1/feedback'),
  autoAcceptTerms: get('AUTO_ACCEPT_TERMS', 'false') === 'true',
  maxSubmissionsPerRun: Math.max(1, Number(get('MAX_SUBMISSIONS_PER_RUN', '3')) || 3),
  pollTimeoutMs: Math.max(60000, Number(get('POLL_TIMEOUT_MS', '1800000')) || 1800000),
  paths: {
    candidates: resolve(ROOT, 'data/candidates'),
    briefs: resolve(ROOT, 'data/briefs'),
    ledger: resolve(ROOT, 'data/evidence-log.jsonl'),
  },
};

/** The key is intentionally excluded. Safe to print. */
export function safeConfig() {
  return {
    baseUrl: config.baseUrl,
    marketsUrl: config.marketsUrl,
    agentId: config.agentId,
    agentHarness: config.agentHarness,
    agentModel: config.agentModel,
    walletConfigured: Boolean(config.wallet),
    apiKeyConfigured: Boolean(config.apiKey),
  };
}
