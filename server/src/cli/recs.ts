/* Recommendation ranking versions: evaluate, save, activate, roll back.
   node dist-server/cli/recs.js evaluate [params.json]       — compare a candidate with the baseline (prints JSON)
   node dist-server/cli/recs.js save <version> [params.json] — store the candidate with its metrics (inactive)
   node dist-server/cli/recs.js activate <version|builtin>   — make it the live ranking (builtin = no row active)
   node dist-server/cli/recs.js list                         — versions, metrics, which one is active
   Only events of listeners who consented to «training» are read. */
import { readFileSync } from 'node:fs';
import { prisma } from '../database/client.js';
import { DEFAULT_PARAMS, type RankingParams } from '../services/wave/profile.js';
import { evaluateRanking, saveVersion, activateVersion } from '../services/recsEvaluation.js';

const [command, arg, file] = process.argv.slice(2);
const params = (path?: string): RankingParams => path ? { ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(path, 'utf8')) } : DEFAULT_PARAMS;
try {
  if (command === 'evaluate') console.log(JSON.stringify(await evaluateRanking(params(arg)), null, 2));
  else if (command === 'save' && arg) { const p = params(file); const report = await evaluateRanking(p); await saveVersion(arg, p, report); console.log(JSON.stringify({ saved: arg, report }, null, 2)); }
  else if (command === 'activate' && arg) { await activateVersion(arg === 'builtin' ? null : arg); console.log(`active: ${arg}`); }
  else if (command === 'list') console.log(JSON.stringify(await prisma.recommendationModel.findMany({ orderBy: { createdAt: 'desc' }, select: { version: true, active: true, createdAt: true, metrics: true } }), null, 2));
  else { console.error('usage: recs.js evaluate [params.json] | save <version> [params.json] | activate <version|builtin> | list'); process.exitCode = 2; }
} finally { await prisma.$disconnect(); }
