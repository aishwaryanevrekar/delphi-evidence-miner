# Winning Plan — Delphi Agent Arena: Evidence Mining

**Competition:** 25 Nov 2026 17:00 UTC → 11 Dec 2026 17:00 UTC
**Reward model:** judgment bounty (fixed within minutes) + settlement bounty (at resolution), both paid in USDC.e.
**Prize pool:** $7,250 (1st $3,000 / 2nd $2,000 / 3rd $1,000) **on top of** evidence rewards.
**Qualification floor:** ≥10 judged submissions across ≥3 competition markets.

> Sources: [DoraHacks rules](https://dorahacks.io/hackathon/delphi-agent-competition2/detail), [skill.md](https://competition.delphi.fyi/skill.md), [competition.md](https://github.com/gensyn-ai/gensyn-delphi-skills/blob/main/reference/competition.md), [evidence.md](https://github.com/gensyn-ai/gensyn-delphi-skills/blob/main/reference/evidence.md), [evidence-api.md](https://github.com/gensyn-ai/gensyn-delphi-skills/blob/main/reference/evidence-api.md), [live market list](https://competition.delphi.fyi/markets.json).

---

## 0. The mechanics that decide the winner

| Mechanic | Consequence for strategy |
|---|---|
| Judgment pot = **20 USDC.e per market**; one submission can take **at most half of what remains** | The 1st strong submission is worth up to 10 USDC.e; the 3rd gets scraps. **Be early with your best fact, not fast with a weak one.** |
| Bounty grows with forecast movement; **direction does not matter** for judgment | We need facts that *move* the forecast, not facts that merely agree with it. |
| Settlement value is **netted per person per market** | Never argue both Yes and No on one market. Pick a direction per market and keep it. |
| Repeats earn **zero**; a judged duplicate returns the slot (≤10/account/24h) | Build a local claim ledger; read `GET /v1/submissions?market=` before every submission. |
| Low accepted rate → **Restricted tier** (1 submission/market, lower daily cap) | Precision beats volume. A rejected submission still burns a slot. |
| `below_minimum` payout still **counts for settlement** | A true, relevant, well-argued fact is never a total loss. |
| Judge fetches each cited URL **once, basic fetch**; X/Reddit/paywalls/logins fail | Put the key lines **in the note** and **attach the original document** (TXT/CSV/PDF/PNG). |
| Judge reads **at most 3 items**; note ≤8,000 chars; files ≤10 MB, PDF ≤20 pages | One claim per submission; lead with the number and the working. |
| "Forecaster reads news well, **computes poorly**" | **Arithmetic on primary data is the single biggest edge.** |
| "Machine-readable records change hours/days before articles" | Primary-record state reads are the second biggest edge. |
| "Racing is a bad strategy" | Do not poll public feeds and submit the same change as 500 agents. Produce *work product*. |

---

## 1. Idea generation

| # | Idea | Edge | Risk | Score /10 |
|---|---|---|---|---|
| A | **Headline scraper race** — poll news for each market, submit first mention | Speed | Everyone does this; duplicates; Restricted tier; near-zero bounty | 3 |
| B | **Threshold-arithmetic engine** — fetch primary statistical series, compute the exact next-print value required to cross the threshold, plus historical base rate; show inputs + working | Strong: forecaster computes poorly; work product cannot be raced | Needs careful data handling | **9.5** |
| C | **Fresh primary-record monitor** — read standards trackers, release registries, parliament dockets, leaderboard APIs directly; extract state changes with timestamps | Strong: machine-readable state before news coverage | Public endpoints can be fetched by others too | **9** |
| D | **Local-language / region-gated miner** — official gazettes, regional press, committee reports in native language; paste key text + screenshot | Strong: forecaster's English news lens misses it | Harder to source; judge must be able to verify (attach document) | **8** |
| E | **Cross-source connection engine** — link a dated fact from source A to a market whose listed sources are from domain B | Medium-strong: "connection nobody made" is explicitly rewarded | Requires judgment; can look irrelevant | 7 |
| F | **Feedback bounty sweep** — 5 × $250 for the most useful bug reports / UX notes | Guaranteed-ish side income ($1,250 max), no slot cost | Needs genuinely useful, specific reports | **7.5** |

---

## 2. Combine and choose

**Rejected:** A (commodity, self-defeating), pure E (too subjective at scale).

**Combined winner — "Primary-Record Arithmetic Agent" (PRAA):**

> **B as the core engine + C as the state-adapter layer + D as the source-diversity layer + F as a parallel side channel.**

Doctrine: **work product over speed.** For every market we ask:

1. Can I compute something the forecaster cannot (required value, base rate, threshold distance)?
2. Can I read a primary record whose state changed *after* the forecaster's snapshot (~market creation, 24 Nov 2026)?
3. Can I bring a source the forecaster's English-language lens misses?

If none of the three is true, **skip the market**. A skipped market costs nothing; a weak submission costs a slot and a strike.

**Why this wins:** the reward function pays for *information delta*, penalizes duplication, and caps per-market payouts. Arithmetic and primary-record extraction are high-delta, non-commoditized, verifiable information. They also generate settlement-aligned evidence because they are grounded in the resolution criteria rather than in opinion.

---

## 3. Execution plan (phases)

### Phase 0 — One-time setup (human, ~15 min)
1. Create/sign in to Delphi on **Mainnet**; copy the wallet shown on the profile.
2. Register on DoraHacks with **that same wallet** and the leaderboard name. Access syncs hourly; allow up to 1 hour.
3. Create a **Mainnet** API key at `https://api-access.delphi.fyi` (signed in the same way as Delphi); set `DELPHI_API_ACCESS_KEY` in `.env`.
4. Read the terms at the URL returned by `GET /v1/terms`; only after saying yes, accept them (`npm run agent -- accept-terms --yes`).
5. Verify: `GET /v1/limits` must not return 401/404.

### Phase 1 — Triage (automated, every cycle)
- Fetch `https://competition.delphi.fyi/markets.json`.
- Score each open market: odds 20–80%, days to evidence cutoff, source readability, category fit, pot remaining from `entry-state`.
- Check `entry-state` **before** any research; skip `not_open`, `closed`, `cap_reached`, `rate_limited`.
- Check `GET /v1/limits` before every batch; never loop on 429.

### Phase 2 — Evidence production
- **Statistics markets** (CPI, PPI, GDP, NFP, unemployment, inflation): fetch the primary table/release, compute the *required next reading* to cross the market threshold and the historical base rate. Attach the source table as CSV/TXT. This is adapter `statistics`.
- **Structured markets** (Wikipedia count, GitHub/Go/Node releases, IETF ballot, Kaggle leaderboard, chess standings): fetch the machine-readable record, extract dated state, compute the delta or the distance to the threshold. Adapter `structured`.
- **Votes / local-language markets**: build a research brief (question, resolution criteria, primary sources, what to look for, required note structure) for the LLM/human researcher; ingest the finished candidate. Adapter `brief`.
- Always: one claim, date + number first, original link, "why it matters for this criterion", working shown.

### Phase 3 — Submission discipline
- Max **3 different facts** per market, never 3 attempts at the same fact.
- Read `listSubmissions({market})` + local ledger before submitting; skip any fact already used.
- Compose ≤3 items: note + link + attached document. Prefer note + TXT/CSV attachment + one primary URL.
- Stable `Idempotency-Key` per candidate; retry with the **same key** after a timeout.
- Never address the judge, never state a verdict, never hedge both sides.

### Phase 4 — Receipt learning loop
- Poll with `Retry-After`; stop after 30 minutes and re-check later.
- `unverifiable` → resend once with the document attached and key text in the note.
- `below_minimum` → do not resend; try a different fact or market.
- `duplicate` → record the fact hash in the ledger; move on.
- `manipulation` → stop the agent and audit the note templates.
- Track bounty, `settlementUpTo`, and verdicts in `data/evidence-log.jsonl`.

### Phase 5 — Parallel feedback channel
- Every API failure, confusing verdict, docs mismatch, or broken primary source becomes a specific feedback entry (area, title, 1–4000 chars, `submissionId`/`marketId` when relevant) via `feedback.delphi.fyi`.
- Max 20 entries/key/day. Quality over quantity.

### Phase 6 — Endgame
- Respect each market's `evidenceCutoffAt` (24 h before close unless stated). Stop research on closed markets; no last-minute waste.
- Keep the strongest direction per market into settlement; do not "balance" books.
- After close, reconciliation is automatic; standings finalize after all markets settle + integrity review (winners 16 Dec).

---

## 4. Architecture in this folder

```
bin/agent.mjs          CLI: preflight, triage, research, candidates, submit, loop, report, feedback
src/config.mjs         .env loading, agent headers, constants (no secrets printed)
src/http.mjs           fetch wrapper: auth, agent headers, Retry-After, request id, error normalization
src/delphi.mjs         all 8 evidence routes + feedback endpoint
src/ledger.mjs         append-only JSONL of claims, submissions and verified receipts
src/markets.mjs        market fetch + expected-value ranking
src/compose.mjs        note builder + hard validation of all size/item limits
src/research.mjs       adapters: statistics / structured / brief
src/orchestrator.mjs   full cycle with limit checks, dedupe, and receipt learning
data/candidates/       staged, human-reviewable evidence payloads
data/briefs/           research briefs for LLM/human completion
data/evidence-log.jsonl
```

Zero runtime dependencies (Node ≥18 has `fetch`, `FormData`, `Blob`). The official SDK is optional; direct REST keeps every field visible and avoids install friction. All source files and the API contract are documented in `README.md`.

---

## 5. Success metrics

- ≥10 judged submissions across ≥3 markets by 5 Dec (qualification).
- ≥60% accepted verdict rate (avoid Restricted tier).
- ≥3 "calculation" submissions where the working is shown and a document is attached.
- At least 3 genuinely useful feedback entries.
- Never more than 3 items in a submission, never both sides of one market, never a fabricated fact.
