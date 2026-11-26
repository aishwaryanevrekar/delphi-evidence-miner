# Primary-Record Arithmetic Agent (PRAA)

A zero-dependency Node.js agent for the **Delphi Agent Arena: Evidence Mining** competition. It implements the strategy in [`PLAN.md`](PLAN.md): arithmetic on official data + fresh primary-record state + local-language sources, with strict anti-duplicate discipline.

> It never prints your API key, never tells the judge what verdict to give, and never submits both sides of a market.

## 1. Setup (one time, ~15 min)

1. Sign in to Delphi on **Mainnet** at https://app.delphi.fyi and copy the wallet from your profile.
2. Register on [DoraHacks](https://dorahacks.io/hackathon/delphi-agent-competition2/detail) with **that same wallet** and your leaderboard name. Access syncs hourly.
3. Create a **Mainnet** API key at https://api-access.delphi.fyi (signed in the same way as Delphi). Copy the wallet shown as "Issued to wallet".
4. Copy the environment template and fill it in:

   ```bash
   cp .env.example .env
   # edit .env -> DELPHI_API_ACCESS_KEY, DELPHI_WALLET, agent name
   ```

5. Check access and read the terms:

   ```bash
   npm run agent -- preflight
   ```

   If `terms accepted=false`, open the printed URL, read it, then:

   ```bash
   npm run agent -- accept-terms --yes
   ```

Requires Node **18+** (`fetch`, `FormData`, `Blob` are built in). No `npm install` needed.

## 2. Daily loop

```bash
npm run agent -- triage                 # rank open markets
npm run agent -- research --limit 8     # fetch primary records -> data/briefs + data/candidates
# review/fill candidates in data/candidates (see schema below)
npm run agent -- submit --limit 3       # submit + read receipts
npm run agent -- report                 # qualification progress
```

Or do all three in one go with `npm run agent -- loop`.

## 3. Candidate schema

A file in `data/candidates/` named `<market>-<key>.json`:

```json
{
  "kind": "candidate",
  "id": "local-id",
  "marketAddress": "0x...",
  "category": "official_statistics",
  "fact": "The statistics office's table published 2026-11-26 reports X; crossing the market threshold of Y requires the next print to be at least Z.",
  "date": "2026-11-26",
  "sourceName": "Official statistics office, monthly table",
  "publishedAt": "2026-11-26T08:00:00Z",
  "link": "https://original-record.example/table.csv",
  "relevance": "The market resolves on the first print of this series at or above Y; this is the required value.",
  "working": "Y - current = ...; last 15 releases crossed this at most N times.",
  "links": ["https://original-record.example/table.csv"],
  "files": [{ "name": "source-table.csv", "content": "...,...", "mime": "text/csv" }],
  "idempotencyKey": "stable-unique-key"
}
```

Rules enforced by `src/compose.mjs`:

- ≤ **3 items total** (note + each link + each file).
- Note ≤ **8,000** chars; files ≤ **10 MB** total; allowed: png/jpg/jpeg/webp/pdf/txt/doc/docx/csv.
- Link field is sent as `links[]` (a field named `links` is silently ignored by the API).
- One claim per submission; no bare Yes/No note.

## 4. What the adapters produce

| Adapter | Markets | Output |
|---|---|---|
| `wikipedia` | English Wikipedia article count | Candidate: current count from siteinfo API, gap to threshold, required daily additions, attached JSON-as-TXT |
| `githubReleases` | bun release tag | Candidate: highest tag from GitHub API, semver vs 1.4.6, published_at vs window |
| `goReleases` | Go 1.27.5 | Candidate: patch versions parsed from the release history page |
| `nodeReleases` | Node v26.14.0 | Candidate: highest v26.x from dist/index.json + semver comparison |
| `statisticsAdapter` | CPI/PPI/GDP/NFP/unemployment | Brief with primary-source excerpts and the calculation tasks (required value + base rate) |
| `genericAdapter` | votes, local-language, standards, controls | Brief with source excerpts and instructions for local-language/primary-record research |

Briefs land in `data/briefs/` for an LLM or human to finish into candidates. The agent never fabricates a fact when a fetch fails — it emits a brief with the error instead.

## 5. Discipline checklist (from `PLAN.md`)

- Check `entry-state` and `limits` **before** research and submission.
- Read `GET /v1/submissions?market=` + the local ledger to avoid duplicates.
- 3 **different facts** per market maximum; never 3 attempts at one fact.
- Keep one direction per market (settlement value is netted).
- On `unverifiable`: resend once with the document attached and key text in the note.
- On `manipulation`: stop and audit templates.
- On broken APIs/docs/UX: `npm run agent -- feedback --text "..." --area docs` (5 × $250 bounties).

## 6. API contract used (all under `https://delphi.fyi/v1`)

`GET /limits`, `GET /terms`, `POST /terms/acceptance`, `GET /markets/{address}/entry-state`, `POST /submissions` (multipart), `GET /submissions/{id}`, `GET /submissions`, `POST /submissions/{id}/retry`, plus `https://feedback.delphi.fyi/v1/feedback`. Full reference: https://docs.delphi.fyi/tools/sdk/evidence and https://delphi.fyi/v1/openapi.json.

## 7. Files

```
PLAN.md                 strategy, idea generation, combined winner, execution phases
bin/agent.mjs           CLI
src/config.mjs          env + headers (key never printed)
src/http.mjs            fetch wrapper, Retry-After, request id, errors
src/delphi.mjs          8 evidence routes + feedback
src/ledger.mjs          append-only JSONL: claims, submits, receipts, feedback
src/markets.mjs         market fetch + EV ranking
src/compose.mjs         note builder + limit validation
src/research.mjs        primary-record adapters
src/orchestrator.mjs    preflight, triage, research, submit, loop, report, feedback
data/                   candidates/, briefs/, evidence-log.jsonl
```

Never commit `.env`.
