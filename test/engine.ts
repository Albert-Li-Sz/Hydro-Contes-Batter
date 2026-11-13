// Execute the real published CJS engine with the exact extension used for the
// browser bundle. This also catches changes to upstream's buildRank contract.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { applyAwardEligibility } from '../lib/award-policy.mjs';
import { patchBoardEngine } from '../lib/patch-engine.mjs';

const require = createRequire(import.meta.url);
const enginePath = require.resolve('@xcpcio/core');
const source = patchBoardEngine(readFileSync(enginePath, 'utf8')).replace(/^import[^\n]+\n/, '');
const cjs = { exports: {} };
new Function('require', 'module', 'exports', '__hydroApplyAwardEligibility', source)(
    createRequire(enginePath), cjs, cjs.exports, applyAwardEligibility,
);
export const { createContest, createSubmissions, createTeams, MedalType, Rank } = cjs.exports as typeof import('@xcpcio/core');
