const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'doc', 'docx', 'csv']);
const MAX_NOTE = 8000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Build a note in the order the judge is taught to read:
 * fact+date, source+when, relevance to the resolution criteria, then the working.
 * It never addresses the judge and never states a verdict.
 */
export function composeNote(c) {
  const parts = [];
  const fact = String(c.fact || '').trim();
  const date = c.date ? ` Date: ${String(c.date).trim()}.` : '';
  parts.push(`FACT: ${fact}${date}`);

  if (c.sourceName || c.publishedAt) {
    const src = [c.sourceName, c.publishedAt ? `published ${c.publishedAt}` : ''].filter(Boolean).join(', ');
    parts.push(`SOURCE: ${src}. Original record: ${c.link || '(see attached document)'}`);
  } else if (c.link) {
    parts.push(`SOURCE: ${c.link}`);
  }

  if (c.relevance) parts.push(`RELEVANCE: ${String(c.relevance).trim()}`);
  if (c.working) parts.push(`WORKING: ${String(c.working).trim()}`);
  if (c.readabilityNote) parts.push(`READABILITY: ${String(c.readabilityNote).trim()}`);
  return parts.join('\n\n');
}

export function validateSubmission({ note, links = [], files = [] }) {
  const errors = [];
  const items = (note ? 1 : 0) + links.length + files.length;
  if (items < 1) errors.push('at least one of note, links, files is required');
  if (items > 3) errors.push(`at most 3 items allowed; got ${items} (note + each link + each file)`);
  if (!note && !links.length && !files.length) errors.push('empty submission');
  if (note && [...note].length > MAX_NOTE) errors.push(`note is ${[...note].length} chars, max ${MAX_NOTE}`);
  let bytes = 0;
  for (const f of files) {
    const ext = String(f.name || '').split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.has(ext)) errors.push(`file type .${ext} not allowed (${f.name})`);
    const size = typeof f.content === 'string' ? Buffer.byteLength(f.content, 'utf8') : f.content?.byteLength || 0;
    bytes += size;
  }
  if (bytes > MAX_FILE_BYTES) errors.push(`files total ${bytes} bytes, max ${MAX_FILE_BYTES}`);
  for (const link of links) {
    if (/\s/.test(String(link))) errors.push(`link contains whitespace: ${link}`);
  }
  if (/^\s*(yes|no)\s*$/i.test(String(note || '').trim())) errors.push('note must not be a bare verdict');
  return { ok: errors.length === 0, errors, items, bytes };
}

/** Turn a staged candidate JSON into an API-ready payload. */
export function candidateToPayload(c) {
  const note = c.note || composeNote(c);
  const links = c.links || (c.link ? [c.link] : []);
  const files = c.files || [];
  return { marketAddress: c.marketAddress, note, links, files, idempotencyKey: c.idempotencyKey };
}
