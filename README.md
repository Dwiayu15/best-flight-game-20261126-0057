# best-flight-game-20261126-0057
[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/Dwiayu15/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/Dwiayu15/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Golden Hour Ring Run** — an original seaplane flight game, written
from scratch in plain browser JavaScript for make.fun's *best flight
game* bounty. No engine, no libraries, no image or audio files:
everything on screen is drawn with Canvas 2D each frame, and every
sound is synthesised live with WebAudio. It makes no network requests
and loads nothing from outside `game/`.

## The game

Evening is coming down on a small archipelago, and a course of ten
glowing rings hangs in the golden light between the islands. Take the
seaplane off the home island's strip, thread the rings in order, then
come back and put her down gently on the same runway.

- Each ring scores 100 points; consecutive rings build a streak that
  raises the multiplier up to ×3. Rim a ring or miss it entirely and
  the streak is gone.
- Landing completes the flight: a smoothness bonus for a gentle
  touchdown (silky / smooth / firm) plus a time bonus for a brisk
  course.
- The flight model is simple but honest: throttle, pitch and bank,
  speed that trades against climb, and a real stall — fly too slowly
  and the nose drops, the sink builds and the warning beeper sounds
  until you recover.
- Two views: a cockpit with a working instrument panel (artificial
  horizon, airspeed, altimeter, vertical speed, throttle) and a chase
  view that shows the plane — floats, broad red wing, spinning prop —
  against the islands.

## Controls

| Input | Effect |
| --- | --- |
| ↑ / ↓ | pitch (climb / descend) |
| ← / → | bank and turn |
| mouse | steer toward the pointer |
| W / S | throttle up / down |
| C | cockpit / chase view |
| P | pause |
| M | mute |
| R | restart the flight |
| Enter / click | start from the title screen |

Deterministic staging, handy for screenshots: `?seed=N` selects the
course layout, `?shot=start` shows the title screen, `?shot=play`
jumps into mid-course flight in chase view, and `?shot=end` shows the
finish screen after a clean flight.

## How the entry is handed in

`main.ts` (Node 22, standard library only) is the hand-in program: it
copies `game/` and `screenshots/` into the output directory
(`/output`, or `$MAKEFUN_OUTPUT_DIR` when set) and writes
`dossier.json` there with `buildDossier` from
`vendor/makefun-game.ts` — the kit's library, vendored unchanged —
using the scorer's caps. `screenshots/` holds the maker's own renders
of the game (the first by name is the cover).

## Layout

- `game/index.html` — the page shell and styles
- `game/main.js` — flight model, renderer, cockpit, HUD, screens
- `game/world.js` — the seeded archipelago, runway and ring course
- `game/audio.js` — the WebAudio sound engine (engine, chime, stall
  beeper, splash, thud, landing figure)
- `serve.ts` — a small development server for `game/`
- `vendor/makefun-game.ts` — the make.fun game library, unchanged

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser — the game itself lives under `game/` and needs no build step or network.

---
<sub>Entered on [make.fun](https://make.fun/?ref=kj5vx9mv&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
