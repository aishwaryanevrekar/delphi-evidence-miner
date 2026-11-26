import { config } from './config.mjs';

export class ApiError extends Error {
  constructor({ status, code, message, retryable, retryAfterSeconds, field, limit, requestId, terms }) {
    super(message || `HTTP ${status} ${code || ''}`.trim());
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
    this.retryAfterSeconds = retryAfterSeconds ?? 0;
    this.field = field ?? null;
    this.limit = limit ?? null;
    this.requestId = requestId ?? null;
    this.terms = terms ?? null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelay(headers, body, attempt) {
  const ra = Number(headers.get('retry-after'));
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 15 * 60 * 1000);
  if (body?.retryAfterSeconds) return Math.min(body.retryAfterSeconds * 1000, 15 * 60 * 1000);
  return Math.min(1000 * 2 ** attempt, 60_000);
}

/**
 * Raw request. Always sends agent headers. `body` may be a FormData, a JS object
 * (sent as JSON), a string, or undefined. The API key is never logged.
 */
export async function request(path, {
  method = 'GET',
  body,
  headers = {},
  auth = true,
  idempotencyKey,
  retries = 2,
  signal,
} = {}) {
  const url = path.startsWith('http') ? path : `${config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const h = new Headers();
  if (auth) h.set('Authorization', `Bearer ${config.apiKey}`);
  h.set('X-Agent-Id', config.agentId);
  h.set('X-Agent-Harness', config.agentHarness);
  h.set('X-Agent-Model', config.agentModel);
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && v !== null) h.set(k, String(v));
  if (idempotencyKey) h.set('Idempotency-Key', idempotencyKey);

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined && body !== null) {
    h.set('Content-Type', 'application/json');
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: payload, signal });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new ApiError({
        status: 0,
        code: 'network_error',
        message: `Network failure: ${err?.message || err}`,
        retryable: true,
        requestId: null,
      });
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    const requestId = res.headers.get('x-request-id') || data?.requestId || null;
    const retryAfterSeconds = Number(res.headers.get('retry-after')) || data?.retryAfterSeconds || 0;
    const rateLimit = {
      limit: res.headers.get('ratelimit-limit'),
      remaining: res.headers.get('ratelimit-remaining'),
      reset: res.headers.get('ratelimit-reset'),
    };
    const meta = { requestId, retryAfterSeconds, rateLimit, warnings: res.headers.get('x-delphi-warnings') };

    if (res.ok) return { ok: true, status: res.status, data, meta, headers: res.headers };

    const e = data?.error || {};
    const apiError = new ApiError({
      status: res.status,
      code: e.code || `http_${res.status}`,
      message: e.message || text?.slice(0, 300) || `HTTP ${res.status}`,
      retryable: Boolean(e.retryable),
      retryAfterSeconds: Number(e.retryAfterSeconds) || retryAfterSeconds,
      field: e.field,
      limit: e.limit,
      requestId,
      terms: e.terms,
    });

    const retryableStatus = res.status === 429 || res.status === 500 || res.status === 503;
    if (attempt < retries && (apiError.retryable || retryableStatus) && apiError.code !== 'hourly' && apiError.code !== 'cap_reached') {
      await sleep(retryDelay(res.headers, data, attempt));
      continue;
    }
    throw apiError;
  }
  throw lastErr || new ApiError({ status: 0, code: 'network_error', message: 'request failed' });
}

/** Patient read: wait for a queued receipt, honouring Retry-After, capped by POLL_TIMEOUT_MS. */
export async function pollUntil(predicate, fetcher, { timeoutMs = config.pollTimeoutMs, signal } = {}) {
  const started = Date.now();
  for (;;) {
    const result = await fetcher();
    if (predicate(result.data, result)) return result;
    if (Date.now() - started >= timeoutMs) return { ...result, timedOut: true };
    const wait = Math.min(Math.max((result.meta?.retryAfterSeconds || 30) * 1000, 30_000), 120_000);
    if (signal?.aborted) throw signal.reason || new Error('aborted');
    await sleep(wait);
  }
}
