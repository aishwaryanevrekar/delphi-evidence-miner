#!/usr/bin/env node
import { config, safeConfig } from '../src/config.mjs';
import {
  preflight, acceptTerms, triage, research, submitStaged, loop, report, sendFeedback,
} from '../src/orchestrator.mjs';

const [, , cmd = 'help', ...args] = process.argv;
const flag = (name, fallback = false) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const num = (name, fallback) => Number(flag(name, fallback));

const HELP = `Delphi evidence miner (Primary-Record Arithmetic Agent)

Usage:
  node bin/agent.mjs preflight              Check config, limits, terms
  node bin/agent.mjs accept-terms --yes     Accept terms AFTER reading the URL
  node bin/agent.mjs triage [--limit 30]    Rank open markets by expected value
  node bin/agent.mjs research [--limit 8]   Fetch primary records -> data/{candidates,briefs}
  node bin/agent.mjs submit [--limit 3]     Submit staged candidates and read receipts
  node bin/agent.mjs loop                   preflight + research + submit
  node bin/agent.mjs report                 Local ledger summary
  node bin/agent.mjs feedback --text "..." [--area docs] [--title "..."]

Config: copy .env.example to .env. The key is never printed.
Safe config: ${JSON.stringify(safeConfig())}
`;

async function main() {
  switch (cmd) {
    case 'preflight': await preflight(); break;
    case 'accept-terms': await acceptTerms({ yes: flag('yes') === true }); break;
    case 'triage': await triage({ limit: num('limit', 30) }); break;
    case 'research': await research({ limit: num('limit', 8) }); break;
    case 'submit': await submitStaged({ limit: num('limit', config.maxSubmissionsPerRun) }); break;
    case 'loop': await loop(); break;
    case 'report': report(); break;
    case 'feedback':
      await sendFeedback({
        text: String(flag('text', '')),
        area: String(flag('area', 'other')),
        title: String(flag('title', '')),
      });
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[praa] ERROR:', err?.message || err);
  process.exitCode = 1;
});
