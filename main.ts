// Hand-in program for the flight game "Golden Hour Ring Run".
//
// The playable game lives in the game/ folder next to this file as plain
// static files (open game/index.html in a browser, no build step, nothing
// fetched from the network). This program is only the courier: it copies
// game/ — and screenshots/, when the maker has put renders there — into
// the output directory and then writes a dossier.json summary of the
// entry with the vendored make.fun library, exactly the summary the
// scorer rebuilds and compares against.
//
// Run it the way the grader does, or point MAKEFUN_OUTPUT_DIR somewhere
// scratch first to see what would be handed in:
//   mkdir -p /tmp/out && MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// This file's own folder is the root of the entry.
const entryRoot = dirname(fileURLToPath(import.meta.url));

// The grader mounts the hand-in at /output; locally the environment
// variable stands in for it.
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });

// The game itself, copied wholesale so the handed-in tree is the tree
// that was play-tested.
cpSync(join(entryRoot, 'game'), join(outDir, 'game'), { recursive: true });

// Screenshots are optional at this stage (the scorer wants 3 or 4 in the
// final entry): copy whatever the maker left beside the game.
const shotsHere = join(entryRoot, 'screenshots');
if (existsSync(shotsHere)) {
  cpSync(shotsHere, join(outDir, 'screenshots'), { recursive: true });
}

// The dossier, with the scorer's caps passed through untouched: the byte
// cap shapes the summary's text, the rest make this program refuse an
// entry the scorer would refuse anyway (too many or too heavy
// screenshots, an oversized game tree, an over-long game path).
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
