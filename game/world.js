// The world of Golden Hour Ring Run: a small archipelago in a warm sea,
// a home island with a runway strip, and a course of rings threaded
// between the islands. Everything is placed by a seeded random number
// generator, so a given ?seed= always builds the same course, the same
// clouds and the same palm trees — which is what makes staged
// screenshots (?shot=) come out identical every run.
//
// Units are metres and seconds. The ground plane is x east / y north,
// altitude is z up. Headings are radians measured from north, turning
// clockwise (toward east), the way a compass reads.

// A small, fast, seedable generator (mulberry32). One instance per world
// keeps every placement decision in a fixed order.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

// One island: a cluster of overlapping discs reads as an irregular
// coastline once drawn in layers, and a disc is cheap to test against
// when the flight model asks for the ground height.
function makeIsland(rng, x, y, radius, peak) {
  const blobs = [{ dx: 0, dy: 0, r: radius }];
  const extra = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < extra; i++) {
    const ang = rng() * TAU;
    const dist = radius * (0.35 + rng() * 0.4);
    blobs.push({
      dx: Math.cos(ang) * dist,
      dy: Math.sin(ang) * dist,
      r: radius * (0.45 + rng() * 0.35),
    });
  }
  const palms = [];
  const palmCount = 10 + Math.floor(rng() * 8);
  for (let i = 0; i < palmCount; i++) {
    const ang = rng() * TAU;
    const dist = radius * Math.sqrt(rng()) * 0.78;
    palms.push({ x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist, s: 0.8 + rng() * 0.5 });
  }
  return { x, y, r: radius, peak, blobs, palms };
}

// Ground height at a point: the sea is 0, an island rises in two soft
// steps toward its peak. The flight model uses this for crashes and the
// renderer uses the same numbers to shade the island layers, so what
// you see is what you hit. The one flat place is the runway plateau:
// inside the strip (with a small shoulder) the ground is the strip's
// own height, so taking off and landing run on level ground.
export function groundHeight(world, x, y) {
  const r = world.runway;
  if (r && Math.abs(x - r.x) <= r.width / 2 + 10 && Math.abs(y - r.y) <= r.length / 2 + 10) {
    return r.z;
  }
  let h = 0;
  for (const isl of world.islands) {
    for (const b of isl.blobs) {
      const dx = x - (isl.x + b.dx);
      const dy = y - (isl.y + b.dy);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < b.r) {
        const t = 1 - d / b.r; // 0 at the waterline, 1 at the disc centre
        const here = 1.2 + t * t * isl.peak;
        if (here > h) h = here;
      }
    }
  }
  return h;
}

// Build the whole world from a seed.
export function buildWorld(seed) {
  const rng = makeRng(seed);

  // The home island sits at the origin; its runway runs north.
  const home = makeIsland(rng, 0, 0, 430, 14);
  const islands = [home];

  // Five neighbours on a loose ring around home, far enough apart that
  // the course can weave between them.
  const bearings = [0.4, 1.5, 2.6, 3.7, 4.9];
  for (let i = 0; i < bearings.length; i++) {
    const ang = bearings[i] + (rng() - 0.5) * 0.5;
    const dist = 1150 + rng() * 650;
    const radius = 200 + rng() * 170;
    islands.push(makeIsland(rng, Math.sin(ang) * dist, Math.cos(ang) * dist, radius, 10 + rng() * 22));
  }

  // The runway: a flat strip on the home island, heading north, long
  // enough to land on at approach speed with room to spare. Its z is
  // the plateau height groundHeight reports for the strip.
  const runway = { x: 0, y: 40, heading: 0, length: 340, width: 38, z: 4.4 };

  // The ring course. Walk a path that leaves the runway heading north,
  // bends around the archipelago and comes home; drop a ring every few
  // hundred metres. Altitudes stay well above the island peaks and well
  // below the clouds.
  const rings = [];
  let px = 0;
  let py = 260;
  let heading = 0;
  const ringCount = 10;
  for (let i = 0; i < ringCount; i++) {
    const step = 300 + rng() * 90;
    px += Math.sin(heading) * step;
    py += Math.cos(heading) * step;
    const alt = 62 + rng() * 55 + Math.sin(i * 1.3) * 12;
    rings.push({ x: px, y: py, z: alt, r: 21, heading });
    // Bend the path: out along the east side, around the top, home
    // down the west side — a loose circuit, never a hairpin.
    const t = i / (ringCount - 1);
    heading = Math.sin(t * Math.PI * 1.15) * 1.9 * (t < 0.85 ? 1 : 0.4) + (t > 0.8 ? Math.PI * 0.85 : 0);
    if (i === ringCount - 2) heading = Math.PI; // second to last: turn for home
    if (i === ringCount - 1) heading = Math.PI;
  }
  // Pull the last two rings onto the approach line so the course hands
  // the pilot to the runway instead of dropping them beside it.
  rings[ringCount - 1] = { x: 0, y: 620, z: 58, r: 21, heading: Math.PI };
  rings[ringCount - 2] = { x: -160, y: 1050, z: 74, r: 21, heading: Math.PI * 0.92 };

  // Clouds: flat puffs scattered high, purely scenery, but placed by
  // the same seed so a staged view always has the same sky.
  const clouds = [];
  for (let i = 0; i < 30; i++) {
    clouds.push({
      x: (rng() - 0.5) * 5200,
      y: (rng() - 0.5) * 5200,
      z: 150 + rng() * 90,
      s: 50 + rng() * 80,
    });
  }

  return {
    seed,
    islands,
    runway,
    rings,
    clouds,
    // Take-off roll starts at the south end of the strip, facing north.
    start: { x: 0, y: -110, z: 2.2, heading: 0 },
  };
}
