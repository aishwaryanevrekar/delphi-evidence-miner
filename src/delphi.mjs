import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';
import { request, pollUntil, ApiError } from './http.mjs';

const TERMINAL = new Set(['judged', 'rejected', 'failed', 'unmatched']);

export const delphi = {
  async limits() {
    return request('/limits');
  },

  async terms() {
    return request('/terms');
  },

  /** Only call after the human has read the terms URL and explicitly approved. */
  async acceptTerms(version) {
    if (!version) throw new Error('A terms version from GET /v1/terms is required');
    return request('/terms/acceptance', { method: 'POST', body: { termsVersion: version } });
  },

  async entryState(market) {
    return request(`/markets/${encodeURIComponent(market)}/entry-state`);
  },

  /**
   * Multipart submission. `files` items: { name, content (string|Uint8Array), mime }.
   * The field name for links is literally `links[]` - `links` is silently ignored by the API.
   */
  async submit({ marketAddress, note, links = [], files = [], idempotencyKey = randomUUID() }) {
    const form = new FormData();
    if (marketAddress) form.append('marketAddress', marketAddress);
    if (note) form.append('note', note);
    for (const link of links) if (link) form.append('links[]', String(link).trim());
    for (const file of files) {
      const bytes = typeof file.content === 'string'
        ? new TextEncoder().encode(file.content)
        : file.content;
      form.append('files', new Blob([bytes], { type: file.mime || 'text/plain' }), file.name || 'evidence.txt');
    }
    return request('/submissions', { method: 'POST', body: form, idempotencyKey });
  },

  async submission(id) {
    return request(`/submissions/${encodeURIComponent(id)}`);
  },

  async waitForSubmission(id, opts = {}) {
    return pollUntil(
      (data) => Boolean(data && TERMINAL.has(data.status)),
      () => this.submission(id),
      opts,
    );
  },

  async listSubmissions({ market, agentId, cursor, limit = 100 } = {}) {
    const q = new URLSearchParams();
    if (market) q.set('market', market);
    if (agentId) q.set('agentId', agentId);
    if (cursor) q.set('cursor', cursor);
    if (limit) q.set('limit', String(limit));
    const suffix = q.toString() ? `?${q}` : '';
    return request(`/submissions${suffix}`);
  },

  /** Collect all pages of the caller's submissions (optionally for one market). */
  async allSubmissions({ market, agentId } = {}) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 50; page++) {
      const { data } = await this.listSubmissions({ market, agentId, cursor, limit: 100 });
      const items = Array.isArray(data?.submissions) ? data.submissions : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      out.push(...items);
      cursor = data?.nextCursor || null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  },

  async retrySubmission(id) {
    return request(`/submissions/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  },

  async feedback(payload) {
    const body = { topic: 'agent-competition-evidence-mining', ...payload };
    if (!body.wallet) body.wallet = config.wallet;
    return request(config.feedbackUrl, {
      method: 'POST',
      auth: false,
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body,
    });
  },

  async listFeedback() {
    return request(`${config.feedbackUrl}?mine=1`, {
      auth: false,
      headers: { 'x-api-key': config.apiKey },
    });
  },
};

/** Translate common API failures into an actionable instruction for the operator. */
export function explain(error) {
  if (!(error instanceof ApiError)) return `Unexpected error: ${error?.message || error}`;
  switch (error.code) {
    case 'unauthorized':
      return '401: the DELPHI_API_ACCESS_KEY is missing, is a Testnet key, or was created with a different sign-in than the Delphi account. Create a Mainnet key at https://api-access.delphi.fyi while signed in the same way as Delphi.';
    case 'not_found':
      return '404: no evidence access. Check that DoraHacks registration uses the wallet on the Delphi profile, and that account/account creation was >1 hour ago. Before 25 Nov 17:00 UTC the API is closed.';
    case 'terms_not_accepted':
      return `403: terms not accepted. Read ${error.terms?.url || 'the terms URL'} and then run: npm run agent -- accept-terms --yes`;
    case 'forbidden':
      return '403: request is from a sanctioned region. Stop.';
    case 'cap_reached':
      return '429: all 3 submissions used on this market. Move to another market.';
    case 'rate_limited':
      return `429 ${error.limit || 'rate_limited'}: wait ${error.retryAfterSeconds || 'the reset time'} seconds.`;
    case 'idempotency_conflict':
      return '409: same Idempotency-Key with a different body. Generate a new key for a new submission.';
    case 'market_not_found':
      return '404: market address is wrong. Copy it verbatim from markets.json.';
    case 'termsVersion':
      return '400: terms version is stale. Re-read GET /v1/terms and accept the current version.';
    default:
      return `${error.status || ''} ${error.code}: ${error.message}${error.requestId ? ` (request ${error.requestId})` : ''}`;
  }
}
