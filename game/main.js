// Golden Hour Ring Run — the game.
//
// A seaplane, a ring course over a golden-hour archipelago, and a runway
// to come home to. Fly the rings in order (each one scores, a clean
// streak multiplies), then put the plane down gently on the home strip
// for a landing bonus. One canvas, no libraries, no assets: the world
// is projected and drawn with plain Canvas 2D every frame.
//
// Controls: Arrow keys steer (or move the mouse), W/S work the
// throttle, C swaps cockpit and chase views, P pauses, M mutes,
// R restarts, Enter starts. Staging for screenshots: ?seed=N picks the
// course and ?shot=start|play|end jumps straight to a screen.

import { buildWorld, groundHeight, makeRng } from './world.js';
import { SoundEngine } from './audio.js';

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const CY = H / 2;
const FOCAL = 620; // projection focal length, in pixels
const TAU = Math.PI * 2;

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7) || 7;
const shot = params.get('shot') ?? '';

const world = buildWorld(seed);
const sound = new SoundEngine();

// ---------------------------------------------------------------- input
const keys = new Set();
let mouseX = 0; // -1..1 across the canvas
let mouseY = 0; // -1..1 down the canvas
let mouseSeen = false;

addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  if (e.key === 'Enter') startFlight();
  if (e.key.toLowerCase() === 'c' && state.mode === 'flying') {
    view = view === 'cockpit' ? 'chase' : 'cockpit';
  }
  if (e.key.toLowerCase() === 'p' && state.mode === 'flying') state.paused = !state.paused;
  if (e.key.toLowerCase() === 'm') {
    muted = !muted;
    sound.setMuted(muted);
  }
  if (e.key.toLowerCase() === 'r') resetFlight();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
  mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
  mouseSeen = true;
});
canvas.addEventListener('click', () => {
  if (state.mode === 'title') startFlight();
});

// ---------------------------------------------------------------- state
let view = 'cockpit';
let muted = false;
const state = {
  mode: 'title', // title | flying | crashed | landed
  paused: false,
  time: 0, // seconds the clock has run this flight
  elapsed: 0, // seconds since leaving the ground
  score: 0,
  ringScore: 0,
  streak: 0,
  bestStreak: 0,
  nextRing: 0,
  toast: '',
  toastUntil: 0,
  crashReason: '',
  landingGrade: '',
  landingBonus: 0,
  timeBonus: 0,
};

const plane = {
  x: 0, y: 0, z: 0,
  heading: 0, pitch: 0, roll: 0,
  speed: 0, throttle: 0,
  vz: 0, stalled: false, onGround: true,
  propAngle: 0,
};

// Chase camera, smoothed toward its perch behind the plane.
const cam = { x: 0, y: -800, z: 120, heading: 0, pitch: -0.08, roll: 0 };

function resetFlight() {
  const s = world.start;
  plane.x = s.x;
  plane.y = s.y;
  plane.z = world.runway.z + 1.1;
  plane.heading = s.heading;
  plane.pitch = 0;
  plane.roll = 0;
  plane.speed = 0;
  plane.throttle = 0;
  plane.vz = 0;
  plane.stalled = false;
  plane.onGround = true;
  plane.propAngle = 0;
  state.mode = 'flying';
  state.paused = false;
  state.time = 0;
  state.elapsed = 0;
  state.score = 0;
  state.ringScore = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.nextRing = 0;
  state.toast = '';
  state.landingGrade = '';
  state.landingBonus = 0;
  state.timeBonus = 0;
  view = 'cockpit';
  particles.length = 0;
  snapCamera();
}

function startFlight() {
  sound.start();
  if (state.mode === 'title' || state.mode === 'crashed' || state.mode === 'landed') resetFlight();
}

function snapCamera() {
  const back = chaseOffset();
  cam.x = plane.x + back.x;
  cam.y = plane.y + back.y;
  cam.z = plane.z + back.z;
  cam.heading = plane.heading;
  cam.pitch = plane.pitch * 0.7;
  cam.roll = plane.roll * 0.55;
}

function chaseOffset() {
  const fx = Math.sin(plane.heading);
  const fy = Math.cos(plane.heading);
  return { x: -fx * 14, y: -fy * 14, z: 4.6 };
}

// ------------------------------------------------------------ flight model
const STALL_SPEED = 17;
const GEAR = 1.1; // fuselage reference point rides this far above the floats

function onRunway(x, y) {
  const r = world.runway;
  return Math.abs(x - r.x) <= r.width / 2 && Math.abs(y - r.y) <= r.length / 2;
}

function updateFlight(dt) {
  // --- controls: arrows first, mouse when no arrow is held
  let pitchIn = 0;
  let rollIn = 0;
  if (keys.has('arrowup')) pitchIn += 1;
  if (keys.has('arrowdown')) pitchIn -= 1;
  if (keys.has('arrowleft')) rollIn -= 1;
  if (keys.has('arrowright')) rollIn += 1;
  if (pitchIn === 0 && rollIn === 0 && mouseSeen && !plane.onGround) {
    pitchIn = -mouseY * 1.4;
    rollIn = mouseX * 1.4;
  }
  if (keys.has('w')) plane.throttle = Math.min(1, plane.throttle + dt * 0.55);
  if (keys.has('s')) plane.throttle = Math.max(0, plane.throttle - dt * 0.55);

  // --- attitude: bank eases toward the stick, pitch follows gently
  const targetRoll = Math.max(-1.05, Math.min(1.05, rollIn * 1.05));
  plane.roll += (targetRoll - plane.roll) * Math.min(1, dt * 5);
  if (!plane.onGround) {
    const targetPitch = Math.max(-0.5, Math.min(0.52, pitchIn * 0.5));
    plane.pitch += (targetPitch - plane.pitch) * Math.min(1, dt * 3.2);
    // A banked wing turns the nose; faster flight answers more slowly.
    const turnAuthority = Math.max(0.45, Math.min(1.35, 30 / Math.max(plane.speed, 12)));
    plane.heading += Math.sin(plane.roll) * 1.05 * turnAuthority * dt;
  } else {
    plane.pitch += (0 - plane.pitch) * Math.min(1, dt * 6);
    plane.roll += (0 - plane.roll) * Math.min(1, dt * 6);
  }
  plane.heading = (plane.heading + TAU) % TAU;

  // --- speed: thrust against drag, gravity trading height for speed
  const thrust = plane.throttle * 15.5;
  const drag = 0.0058 * plane.speed * plane.speed + 0.35;
  let accel = thrust - drag - Math.sin(plane.pitch) * 21 * (plane.onGround ? 0 : 1);
  if (plane.onGround) accel -= 0.9; // rolling resistance on the strip
  plane.speed = Math.max(0, plane.speed + accel * dt);

  // --- stall: too slow and the wing gives up; the nose drops, the
  // sink builds, the beeper complains until speed returns.
  plane.stalled = !plane.onGround && plane.speed < STALL_SPEED;
  if (plane.stalled) {
    plane.pitch -= dt * 0.55;
    plane.pitch = Math.max(plane.pitch, -0.62);
  }
  sound.setStall(plane.stalled && state.mode === 'flying');

  // --- move
  const cosP = Math.cos(plane.pitch);
  const vx = Math.sin(plane.heading) * cosP * plane.speed;
  const vy = Math.cos(plane.heading) * cosP * plane.speed;
  let climb = plane.speed * Math.sin(plane.pitch);
  if (plane.stalled) climb -= (STALL_SPEED - plane.speed) * 1.15;
  // A whisper of evening turbulence so the air feels alive.
  const gust = Math.sin(state.time * 0.6) * 0.35 + Math.sin(state.time * 1.7) * 0.15;
  plane.x += vx * dt;
  plane.y += vy * dt;
  plane.vz = climb;
  plane.propAngle += dt * (6 + plane.throttle * 46 + plane.speed * 0.12);

  const ground = groundHeight(world, plane.x, plane.y);
  const floorZ = ground + GEAR;

  if (plane.onGround) {
    plane.z = world.runway.z + GEAR;
    plane.vz = 0;
    // Rotation: enough speed and a pull on the stick lifts her off.
    if (plane.speed > 23.5 && pitchIn > 0.25) {
      plane.onGround = false;
      plane.pitch = 0.16;
      plane.z += 0.3;
      toast('Airborne — chase the gold ring!');
    }
    if (plane.y > world.runway.y + world.runway.length / 2 + 30 && plane.speed < 23) {
      endCrash('You ran out of runway. Full throttle (W), then pull up (↑).', false);
    }
  } else {
    plane.z += (climb + gust * (plane.speed < 26 ? 1 : 0.3)) * dt;
    state.elapsed += dt;

    if (plane.z <= floorZ) {
      // Touchdown, one way or another.
      const sink = -plane.vz;
      if (onRunway(plane.x, plane.y) && ground === world.runway.z) {
        const align = Math.min(Math.abs(plane.heading), Math.abs(plane.heading - Math.PI), TAU - Math.abs(plane.heading));
        if (sink <= 3.4 && plane.speed <= 36 && align < 0.42) {
          plane.onGround = true;
          plane.z = floorZ;
          plane.throttle = Math.min(plane.throttle, 0.15);
          if (state.nextRing >= world.rings.length) finishLanding(sink);
        } else {
          endCrash('A hard arrival on the strip — come in slower and gentler.', true);
        }
      } else if (ground > 0.4) {
        endCrash('You met an island the sudden way. Mind the terrain.', true);
      } else {
        endCrash('Down in the sea. The fish send their regards.', false);
      }
    }
    if (plane.z > 320) plane.z = 320; // a soft ceiling keeps the course in reach
  }

  // Rolling to a stop after a completed landing is handled by the
  // landed screen; rolling after an early touchdown just parks.
  if (plane.onGround && state.nextRing >= world.rings.length && state.mode === 'flying' && plane.speed < 5 && state.elapsed > 0) {
    finishLanding(0.8);
  }

  updateRings();
  sound.setEngine(plane.onGround ? plane.throttle * 0.7 : plane.throttle, Math.min(1, plane.speed / 55));
  sound.setWind(plane.onGround ? 0 : Math.min(1, plane.speed / 55));
}

// ------------------------------------------------------------- ring logic
let prevRingSide = null;

function updateRings() {
  const ring = world.rings[state.nextRing];
  if (!ring) {
    prevRingSide = null;
    return;
  }
  const nx = Math.sin(ring.heading);
  const ny = Math.cos(ring.heading);
  const rx = plane.x - ring.x;
  const ry = plane.y - ring.y;
  const side = rx * nx + ry * ny; // signed distance along the course direction
  if (prevRingSide !== null && prevRingSide < 0 && side >= 0 && !plane.onGround) {
    // Crossed the ring's plane this frame: how far from its centre?
    const px = rx - nx * side;
    const py = ry - ny * side;
    const pz = plane.z - ring.z;
    const radial = Math.sqrt(px * px + py * py + pz * pz);
    if (radial <= ring.r) {
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      const mult = Math.min(3, 1 + 0.25 * (state.streak - 1));
      const gained = Math.round(100 * mult);
      state.ringScore += gained;
      state.score += gained;
      state.nextRing += 1;
      prevRingSide = null;
      sound.chime(state.streak);
      spawnBurst(ring.x, ring.y, ring.z, `+${gained}`);
      toast(state.nextRing >= world.rings.length
        ? 'Course complete — bring her home to the strip!'
        : `Ring ${state.nextRing} of ${world.rings.length} — +${gained}`);
      return;
    }
    if (radial <= ring.r * 1.7) {
      state.streak = 0;
      sound.nearMiss();
      toast('Rim! No score — line up the next one.');
      state.nextRing += 1;
      prevRingSide = null;
      return;
    }
    // Missed wide: fall through and let the write-off below take it
    // once the plane is well past the ring's plane.
  } else if (side > 110 && !plane.onGround && prevRingSide !== null) {
    // Well past the ring without threading it: write it off so the
    // course can move on, at the cost of the streak.
    state.streak = 0;
    state.nextRing += 1;
    prevRingSide = null;
    toast('Ring missed — streak lost. Next ring lit.');
    return;
  }
  prevRingSide = side;
}

function finishLanding(sink) {
  if (state.mode !== 'flying') return;
  state.mode = 'landed';
  if (sink <= 1.2) {
    state.landingGrade = 'Silky';
    state.landingBonus = 300;
  } else if (sink <= 2.2) {
    state.landingGrade = 'Smooth';
    state.landingBonus = 200;
  } else {
    state.landingGrade = 'Firm but fine';
    state.landingBonus = 100;
  }
  state.timeBonus = Math.max(0, Math.round((330 - state.elapsed) * 1.5));
  state.score += state.landingBonus + state.timeBonus;
  spawnConfetti();
  sound.quiet();
  sound.fanfare();
}

function endCrash(reason, hard) {
  if (state.mode !== 'flying') return;
  state.mode = 'crashed';
  state.crashReason = reason;
  sound.quiet();
  if (hard) sound.thud(); else sound.splash();
}

function toast(text) {
  state.toast = text;
  state.toastUntil = state.time + 3.2;
}

// ------------------------------------------------------------- particles
// One small pool for every transient effect: gold sparks and a rising
// score popup when a ring is threaded, confetti over the strip after a
// landing, wingtip streamers in a hard bank. All world-space, so they
// stay put while the camera moves, and all spawned from a fixed-seed
// generator so a staged view is the same every run.
const particles = [];
const fxRng = makeRng(987654321);

function spawnBurst(x, y, z, text) {
  for (let i = 0; i < 26; i++) {
    const a = fxRng() * TAU;
    const b = (fxRng() - 0.5) * Math.PI;
    const sp = 6 + fxRng() * 13;
    particles.push({
      kind: 'spark', x, y, z,
      vx: Math.cos(a) * Math.cos(b) * sp,
      vy: Math.sin(a) * Math.cos(b) * sp,
      vz: Math.sin(b) * sp + 3,
      age: 0, life: 0.7 + fxRng() * 0.5,
      size: 1.6 + fxRng() * 2.2,
    });
  }
  if (text) {
    particles.push({ kind: 'text', x, y, z, vx: 0, vy: 0, vz: 5.5, age: 0, life: 1.25, size: 21, text });
  }
}

function spawnConfetti() {
  const cols = ['#ffd76a', '#ff8a6a', '#8fe08a', '#a8d8ff', '#fff2cf'];
  for (let i = 0; i < 46; i++) {
    particles.push({
      kind: 'confetti',
      x: plane.x + (fxRng() - 0.5) * 60,
      y: plane.y + (fxRng() - 0.5) * 60,
      z: plane.z + 12 + fxRng() * 26,
      vx: (fxRng() - 0.5) * 6, vy: (fxRng() - 0.5) * 6, vz: -2 - fxRng() * 3,
      age: 0, life: 2.6 + fxRng() * 1.4,
      size: 2 + fxRng() * 2.6,
      color: cols[i % cols.length],
      spin: fxRng() * TAU,
    });
  }
}

// A pair of soft white puffs at the wingtips, laid while the wing is
// loaded in a bank — they linger a moment and dissolve.
function spawnTrail() {
  const rx = Math.cos(plane.heading);
  const ry = -Math.sin(plane.heading);
  for (const sgn of [-1, 1]) {
    particles.push({
      kind: 'puff',
      x: plane.x + rx * 6.5 * sgn, y: plane.y + ry * 6.5 * sgn, z: plane.z + 0.4,
      vx: 0, vy: 0, vz: 0.4,
      age: 0, life: 0.55, size: 1.1,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }
    if (p.kind === 'spark') p.vz -= 6.5 * dt;
    if (p.kind === 'confetti') {
      p.vz = Math.max(p.vz, -3.2);
      p.spin += dt * 7;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
  }
  if (particles.length > 340) particles.splice(0, particles.length - 340);
}

function drawParticles(c) {
  for (const p of particles) {
    const q = project(c, p.x, p.y, p.z);
    if (!q) continue;
    const fade = 1 - p.age / p.life;
    if (p.kind === 'spark') {
      const r = Math.max(1, Math.min(6, (p.size * FOCAL) / q.d * 0.5));
      ctx.fillStyle = `rgba(255,205,90,${0.85 * fade})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'puff') {
      const r = Math.max(1, Math.min(16, ((1 + (p.age / p.life) * 3) * FOCAL) / q.d * 0.5));
      ctx.fillStyle = `rgba(255,252,246,${0.26 * fade})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'confetti') {
      const s = Math.max(2, Math.min(9, (p.size * FOCAL) / q.d * 0.5));
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(p.spin);
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (p.kind === 'text') {
      ctx.font = 'bold 22px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(20,16,8,${0.55 * fade})`;
      ctx.fillText(p.text, q.x + 1.5, q.y + 1.5);
      ctx.fillStyle = `rgba(255,222,130,${fade})`;
      ctx.fillText(p.text, q.x, q.y);
    }
  }
}

// --------------------------------------------------------------- renderer
// Camera basis, rebuilt each frame: F forward, R right, U up.
const camBasis = { fx: 0, fy: 1, fz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 0, uz: 1 };

function setBasis(c) {
  const cosP = Math.cos(c.pitch);
  const fx = Math.sin(c.heading) * cosP;
  const fy = Math.cos(c.heading) * cosP;
  const fz = Math.sin(c.pitch);
  let rx = Math.cos(c.heading);
  let ry = -Math.sin(c.heading);
  let rz = 0;
  // U = R x F
  let ux = ry * fz - rz * fy;
  let uy = rz * fx - rx * fz;
  let uz = rx * fy - ry * fx;
  // Roll the right/up pair around the forward axis.
  const cr = Math.cos(c.roll);
  const sr = Math.sin(c.roll);
  const rrx = rx * cr + ux * sr;
  const rry = ry * cr + uy * sr;
  const rrz = rz * cr + uz * sr;
  const uux = ux * cr - rx * sr;
  const uuy = uy * cr - ry * sr;
  const uuz = uz * cr - rz * sr;
  Object.assign(camBasis, { fx, fy, fz, rx: rrx, ry: rry, rz: rrz, ux: uux, uy: uuy, uz: uuz });
}

function project(c, x, y, z) {
  const dx = x - c.x;
  const dy = y - c.y;
  const dz = z - c.z;
  const depth = dx * camBasis.fx + dy * camBasis.fy + dz * camBasis.fz;
  if (depth < 2) return null;
  const sx = dx * camBasis.rx + dy * camBasis.ry + dz * camBasis.rz;
  const sy = dx * camBasis.ux + dy * camBasis.uy + dz * camBasis.uz;
  return { x: CX + (sx / depth) * FOCAL, y: CY - (sy / depth) * FOCAL, d: depth };
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSkyAndSea(c) {
  // Sky: a layered golden-hour gradient, fixed to the screen — deep
  // blue up top, through peach and amber to the warm band at the sea.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#274a7d');
  sky.addColorStop(0.3, '#5d8ab5');
  sky.addColorStop(0.52, '#a8c3d4');
  sky.addColorStop(0.66, '#f2c184');
  sky.addColorStop(0.8, '#f7cf8e');
  sky.addColorStop(0.92, '#f0a06a');
  sky.addColorStop(1, '#e8906a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // High cirrus: three long, faint streaks sliding almost
  // imperceptibly across the upper sky.
  ctx.fillStyle = 'rgba(255,246,235,0.07)';
  for (let i = 0; i < 3; i++) {
    const cy = 52 + i * 64;
    const cx = ((state.time * (2 + i) + i * 470) % (W + 520)) - 260;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 300 - i * 50, 7 + i * 2, 0, 0, TAU);
    ctx.fill();
  }

  // The sun, low in the west-northwest — projected like any other far
  // point so it swings across the sky as you turn.
  const sunDir = { x: -0.62, y: 0.55, z: 0.22 };
  const sp = project(c, c.x + sunDir.x * 5000, c.y + sunDir.y * 5000, c.z + sunDir.z * 5000);

  // Sea: everything below the horizon line, which pitches and rolls
  // with the plane. Drawn as a rotated half-plane around screen centre.
  const horizonY = CY + Math.tan(c.pitch) * FOCAL;
  ctx.save();
  ctx.translate(CX, horizonY);
  ctx.rotate(-c.roll * 0.9);
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#eda763');
  sea.addColorStop(0.1, '#6d9ab5');
  sea.addColorStop(0.45, '#2f688f');
  sea.addColorStop(1, '#163d5c');
  ctx.fillStyle = sea;
  ctx.fillRect(-W, 0, W * 2, H * 1.6);
  ctx.restore();

  // Sun glow and disc, drawn over sky and sea alike: a wide warm halo,
  // a bright core and a thin rim of light.
  if (sp) {
    const glow = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 260);
    glow.addColorStop(0, 'rgba(255,238,190,0.95)');
    glow.addColorStop(0.12, 'rgba(255,214,130,0.6)');
    glow.addColorStop(0.45, 'rgba(255,180,100,0.18)');
    glow.addColorStop(1, 'rgba(255,180,100,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 260, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 27, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,200,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 34, 0, TAU);
    ctx.stroke();
  }

  // The sun's reflection path: a widening column of light on the water
  // under the sun, brightest at the horizon and breaking up downward.
  if (sp && sp.y > horizonY - 130 && horizonY < H) {
    const top = Math.max(horizonY, 0);
    const grad = ctx.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, 'rgba(255,205,120,0.28)');
    grad.addColorStop(0.5, 'rgba(255,190,110,0.1)');
    grad.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sp.x - 26, top);
    ctx.lineTo(sp.x + 26, top);
    ctx.lineTo(sp.x + 130, H);
    ctx.lineTo(sp.x - 130, H);
    ctx.closePath();
    ctx.fill();
  }

  // Sparkle on the water: short dashes that shimmer as time passes,
  // seeded per dash so they twinkle instead of crawling. Every third
  // dash clusters along the sun's reflection path.
  ctx.strokeStyle = 'rgba(255,222,165,0.55)';
  ctx.lineWidth = 2;
  const bandTop = Math.max(0, horizonY + 6);
  for (let i = 0; i < 84; i++) {
    const hx = Math.sin(i * 127.1) * 0.5 + 0.5;
    const hy = Math.sin(i * 311.7) * 0.5 + 0.5;
    const tw = 0.5 + 0.5 * Math.sin(state.time * 2.4 + i * 2.3);
    if (tw < 0.42) continue;
    const y = bandTop + hy * hy * (H - bandTop) * 0.85;
    let x = hx * W + Math.sin(state.time * 0.7 + i) * 6;
    if (sp && i % 3 === 0) {
      const spread = 30 + hy * 150;
      x = sp.x + Math.sin(i * 57.3) * spread + Math.sin(state.time * 1.3 + i) * 5;
    }
    ctx.globalAlpha = 0.14 + tw * 0.32;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + hy * 22, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawClouds(c) {
  const sorted = [...world.clouds].sort((a, b) => distTo(c, b) - distTo(c, a));
  for (const cl of sorted) {
    // A slow drift eastward, wrapped across the sky so a cloud leaving
    // one side re-enters on the other, far from the course.
    const wx = ((cl.x + state.time * cl.drift + 2600) % 5200) - 2600;
    const p = project(c, wx, cl.y, cl.z);
    if (!p || p.d > 4400) continue;
    const s = (cl.s / p.d) * FOCAL;
    if (s < 6) continue;
    // Warm-lit tops over peach-shadowed bellies; each cloud's tint
    // leans it a little toward rose or toward pearl.
    const top = cl.tint > 0.5 ? 'rgba(255,250,242,0.85)' : 'rgba(255,244,230,0.8)';
    const belly = cl.tint > 0.5 ? 'rgba(244,196,160,0.55)' : 'rgba(238,205,180,0.5)';
    for (const lobe of cl.lobes) {
      ctx.fillStyle = belly;
      ctx.beginPath();
      ctx.ellipse(p.x + lobe.ox * s, p.y + (lobe.oy + 0.1) * s * 0.4, s * lobe.os, s * lobe.os * 0.34, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.ellipse(p.x + lobe.ox * s, p.y + (lobe.oy - 0.04) * s * 0.4, s * lobe.os * 0.92, s * lobe.os * 0.3, 0, 0, TAU);
      ctx.fill();
    }
  }
}

function distTo(c, p) {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function discPoints(c, cx, cy, z, r, n = 16) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const p = project(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    if (!p) return null;
    pts.push(p);
  }
  return pts;
}

function fillPoly(pts, style) {
  if (!pts || pts.length < 3) return;
  // project() answers null for a point behind the camera, and a polygon
  // with a hole in it is skipped whole rather than drawn torn.
  if (pts.some((p) => !p)) return;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

// Distant silhouettes: hazy blue-grey humps on the horizon, drawn
// before the real islands so they sit behind everything, softened by
// the evening air between here and there.
function drawFarIslands(c) {
  for (const isl of world.farIslands) {
    fillPoly(discPoints(c, isl.x, isl.y, 1.2, isl.r, 18), 'rgba(122,150,182,0.3)');
    fillPoly(discPoints(c, isl.x, isl.y, isl.peak * 0.4, isl.r * 0.55, 18), 'rgba(100,130,168,0.32)');
  }
}

function drawIslands(c) {
  const sorted = [...world.islands].sort((a, b) => distTo(c, b) - distTo(c, a));
  for (const isl of sorted) {
    if (distTo(c, isl) > 4600) continue;
    // Three stacked layers per blob: wet sand, grass, high ground.
    for (const b of isl.blobs) {
      const bx = isl.x + b.dx;
      const by = isl.y + b.dy;
      fillPoly(discPoints(c, bx, by, 0.35, b.r * 1.07), 'rgba(242,248,248,0.33)');
      fillPoly(discPoints(c, bx, by, 0.7, b.r), '#dfc491');
      fillPoly(discPoints(c, bx, by, 1.6, b.r * 0.86), '#5f9e57');
      if (isl.peak > 5) fillPoly(discPoints(c, bx, by, 1.6 + isl.peak * 0.5, b.r * 0.52), '#487f47');
    }
    // Palms: a bent trunk and a star of fronds, sized by distance.
    for (const palm of isl.palms) {
      const base = project(c, palm.x, palm.y, groundHeight(world, palm.x, palm.y));
      if (!base || base.d > 1500) continue;
      const s = (FOCAL / base.d) * palm.s * 7;
      ctx.strokeStyle = 'rgba(46,74,38,0.9)';
      ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(base.x + s * 0.16, base.y - s * 0.6, base.x + s * 0.3, base.y - s);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(38,96,44,0.95)';
      for (let f = 0; f < 5; f++) {
        const a = -0.3 - f * 0.55;
        ctx.beginPath();
        ctx.moveTo(base.x + s * 0.3, base.y - s);
        ctx.quadraticCurveTo(
          base.x + s * 0.3 + Math.cos(a) * s * 0.5,
          base.y - s + Math.sin(a) * s * 0.4 - s * 0.12,
          base.x + s * 0.3 + Math.cos(a) * s * 0.85,
          base.y - s + Math.sin(a) * s * 0.6 + s * 0.22,
        );
        ctx.stroke();
      }
    }
  }
}

function drawRunway(c) {
  const r = world.runway;
  const hw = r.width / 2;
  const hl = r.length / 2;
  const corners = [
    [r.x - hw, r.y - hl], [r.x + hw, r.y - hl], [r.x + hw, r.y + hl], [r.x - hw, r.y + hl],
  ].map(([x, y]) => project(c, x, y, r.z + 0.06));
  if (corners.every(Boolean)) {
    fillPoly(corners, '#5b5f6b');
    // Centreline dashes and threshold bars.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    const a = project(c, r.x, r.y - hl + 8, r.z + 0.08);
    const b = project(c, r.x, r.y + hl - 8, r.z + 0.08);
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

function drawRings(c) {
  world.rings.forEach((ring, i) => {
    const done = i < state.nextRing;
    const isNext = i === state.nextRing;
    const centre = project(c, ring.x, ring.y, ring.z);
    if (!centre || centre.d > 3800) return;
    const ax = Math.cos(ring.heading);
    const ay = -Math.sin(ring.heading);
    const pts = [];
    for (let k = 0; k <= 28; k++) {
      const a = (k / 28) * TAU;
      const p = project(
        c,
        ring.x + ax * Math.cos(a) * ring.r,
        ring.y + ay * Math.cos(a) * ring.r,
        ring.z + Math.sin(a) * ring.r,
      );
      if (!p) return;
      pts.push(p);
    }
    // The next ring gets a beacon: a soft pillar of light from the sea
    // up to the ring, with a pool of light where it meets the water,
    // so the way on is visible from anywhere on the course.
    if (isNext) {
      const base = project(c, ring.x, ring.y, 0.5);
      const top = project(c, ring.x, ring.y, ring.z);
      if (base && top) {
        const hwTop = (ring.r * 0.42 * FOCAL) / Math.max(top.d, 1);
        const hwBase = (ring.r * 0.42 * FOCAL) / Math.max(base.d, 1);
        const grad = ctx.createLinearGradient(0, base.y, 0, top.y);
        grad.addColorStop(0, 'rgba(255,200,90,0.16)');
        grad.addColorStop(1, 'rgba(255,200,90,0.03)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(base.x - hwBase, base.y);
        ctx.lineTo(base.x + hwBase, base.y);
        ctx.lineTo(top.x + hwTop, top.y);
        ctx.lineTo(top.x - hwTop, top.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,210,110,0.13)';
        ctx.beginPath();
        ctx.ellipse(base.x, base.y, hwBase * 1.5, hwBase * 0.4, 0, 0, TAU);
        ctx.fill();
      }
    }
    const pulse = isNext ? 0.72 + 0.28 * Math.sin(state.time * 4) : 1;
    ctx.lineWidth = isNext ? 5 : 3;
    ctx.strokeStyle = done
      ? 'rgba(120,220,140,0.4)'
      : isNext
        ? `rgba(255,196,64,${0.95 * pulse})`
        : 'rgba(170,220,235,0.55)';
    ctx.shadowColor = isNext ? 'rgba(255,180,50,0.9)' : 'transparent';
    ctx.shadowBlur = isNext ? 16 : 0;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (isNext) {
      // A wide, faint halo pass around the next ring so it glows
      // against the sky even at a distance.
      ctx.lineWidth = 11;
      ctx.strokeStyle = `rgba(255,170,60,${0.13 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();
    }
    if (isNext && centre.d > 60) {
      ctx.fillStyle = 'rgba(255,214,110,0.95)';
      ctx.font = 'bold 15px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(`RING ${i + 1}`, centre.x, centre.y - ring.r * (FOCAL / centre.d) - 10);
      // A bobbing chevron above the ring, pointing the way in.
      const bobY = Math.sin(state.time * 3.2) * 4;
      const cyTop = centre.y - ring.r * (FOCAL / centre.d) - 36 + bobY;
      ctx.strokeStyle = 'rgba(255,214,110,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centre.x - 9, cyTop);
      ctx.lineTo(centre.x, cyTop + 8);
      ctx.lineTo(centre.x + 9, cyTop);
      ctx.stroke();
    }
  });
}

function drawPlaneShadow(c) {
  const g = groundHeight(world, plane.x, plane.y);
  const p = project(c, plane.x, plane.y, g + 0.4);
  if (!p) return;
  const alt = Math.max(0, plane.z - g);
  const s = (FOCAL / p.d) * 9 * Math.max(0.25, 1 - alt / 160);
  ctx.fillStyle = `rgba(10,20,30,${Math.max(0.05, 0.4 - alt / 300)})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, s * 1.7, s * 0.55, -plane.heading + cam.heading, 0, TAU);
  ctx.fill();
}

// The seaplane from behind, drawn around screen centre in chase view:
// broad wing, twin floats, a tail held high, and the propeller a
// shimmering disc at the far end of the fuselage.
function drawChasePlane() {
  // Parked on the water she rides the swell — a slower, deeper bob and
  // a hint of roll; airborne she just breathes a little.
  const bob = plane.onGround ? Math.sin(state.time * 1.5) * 3 : Math.sin(state.time * 2.1) * 2.2;
  ctx.save();
  ctx.translate(CX, CY + 88 + bob);
  ctx.rotate(plane.roll * 0.85 + (plane.onGround ? Math.sin(state.time * 1.1) * 0.02 : 0));
  const s = 1.0;
  ctx.lineJoin = 'round';

  // Floats and their struts.
  ctx.fillStyle = '#e8e4da';
  for (const fx of [-34, 34]) {
    rr(fx - 7 * s, 30 * s, 14 * s, 34 * s, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,74,43,0.5)';
    ctx.lineWidth = 1.5;
    rr(fx - 7 * s, 30 * s, 14 * s, 34 * s, 6);
    ctx.stroke();
    ctx.strokeStyle = '#7a4a2b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, 30 * s);
    ctx.lineTo(fx * 0.45, 6 * s);
    ctx.stroke();
  }
  // Wing, shoulder-mounted and broad.
  const wingGrad = ctx.createLinearGradient(-118, 0, 118, 0);
  wingGrad.addColorStop(0, '#c94f38');
  wingGrad.addColorStop(0.5, '#e4674a');
  wingGrad.addColorStop(1, '#c94f38');
  ctx.fillStyle = wingGrad;
  rr(-118 * s, -16 * s, 236 * s, 17 * s, 8);
  ctx.fill();
  // Wing struts, two per side, from the fuselage shoulder out to the
  // wing — the rigging that makes her a proper seaplane.
  ctx.strokeStyle = '#8a4a30';
  ctx.lineWidth = 3;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sgn * 10, 8);
    ctx.lineTo(sgn * 56, -12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sgn * 10, 8);
    ctx.lineTo(sgn * 84, -12);
    ctx.stroke();
  }
  // Navigation lights: port red, starboard green, glowing at the tips.
  for (const [lx, col] of [[-116, '#ff4a3c'], [116, '#3ce06a']]) {
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(lx, -9, 3.4, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // Fuselage, tail toward the viewer (wider, lower) and nose away,
  // shaded from sunlit cream on top to a warm shadow at the belly.
  const bodyGrad = ctx.createLinearGradient(0, -34, 0, 34);
  bodyGrad.addColorStop(0, '#f7f1de');
  bodyGrad.addColorStop(0.55, '#efe6cf');
  bodyGrad.addColorStop(1, '#cdbb96');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-13 * s, 26 * s);
  ctx.quadraticCurveTo(-16 * s, -6 * s, -6 * s, -34 * s);
  ctx.lineTo(6 * s, -34 * s);
  ctx.quadraticCurveTo(16 * s, -6 * s, 13 * s, 26 * s);
  ctx.quadraticCurveTo(0, 34 * s, -13 * s, 26 * s);
  ctx.fill();
  ctx.fillStyle = '#31556e';
  ctx.beginPath(); // canopy
  ctx.ellipse(0, -14 * s, 7.5 * s, 13 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // a streak of sky on the glass
  ctx.beginPath();
  ctx.ellipse(-2.4 * s, -19 * s, 2.4 * s, 6.5 * s, 0.25, 0, TAU);
  ctx.fill();
  // Tailplane and fin, close to the camera.
  ctx.fillStyle = '#c94f38';
  rr(-40 * s, 18 * s, 80 * s, 10 * s, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4 * s, 24 * s);
  ctx.lineTo(0, 2 * s);
  ctx.lineTo(4 * s, 24 * s);
  ctx.closePath();
  ctx.fill();
  // Propeller disc at the nose, spinning with throttle.
  ctx.save();
  ctx.translate(0, -38 * s);
  ctx.fillStyle = `rgba(230,230,220,${0.1 + plane.throttle * 0.16})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, 30 * s, 7 * s, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.75)';
  ctx.lineWidth = 3.4;
  const pa = plane.propAngle;
  ctx.beginPath();
  ctx.moveTo(Math.cos(pa) * -30 * s, Math.sin(pa) * -6 * s);
  ctx.lineTo(Math.cos(pa) * 30 * s, Math.sin(pa) * 6 * s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,50,40,0.35)';
  ctx.beginPath();
  ctx.moveTo(Math.cos(pa + Math.PI / 2) * -30 * s, Math.sin(pa + Math.PI / 2) * -6 * s);
  ctx.lineTo(Math.cos(pa + Math.PI / 2) * 30 * s, Math.sin(pa + Math.PI / 2) * 6 * s);
  ctx.stroke();
  ctx.fillStyle = '#7a4a2b'; // spinner cone at the hub
  ctx.beginPath();
  ctx.arc(0, 0, 4.4 * s, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// ------------------------------------------------------------- cockpit
function dial(cx, cy, r, frac, label, text, warn = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = '#141a26';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = warn ? '#ff5a48' : '#8fa8c8';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,232,255,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 7), cy + Math.sin(a) * (r - 7));
    ctx.lineTo(cx + Math.cos(a) * (r - 2.5), cy + Math.sin(a) * (r - 2.5));
    ctx.stroke();
  }
  const a = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
  ctx.stroke();
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.arc(cx, cy, 3.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#cfe0f4';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r + 14);
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy + r * 0.52);
  ctx.restore();
}

function drawCockpit() {
  // Panel: a dark dash across the bottom of the screen with a coaming
  // curve, two side posts, and the instruments set into it.
  ctx.fillStyle = 'rgba(16,20,30,0.92)';
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, H - 128);
  ctx.quadraticCurveTo(CX, H - 188, W, H - 128);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,140,180,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H - 128);
  ctx.quadraticCurveTo(CX, H - 188, W, H - 128);
  ctx.stroke();
  // Side posts.
  ctx.fillStyle = 'rgba(16,20,30,0.9)';
  ctx.fillRect(0, 0, 26, H - 140);
  ctx.fillRect(W - 26, 0, 26, H - 140);

  const gy = H - 66;
  // Artificial horizon.
  const hx = 300;
  const hr = 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, gy, hr, 0, TAU);
  ctx.clip();
  ctx.translate(hx, gy);
  ctx.rotate(-plane.roll);
  ctx.translate(0, plane.pitch * 90);
  ctx.fillStyle = '#79a8d8';
  ctx.fillRect(-hr - 30, -hr - 90, (hr + 30) * 2, hr + 90);
  ctx.fillStyle = '#8a6b42';
  ctx.fillRect(-hr - 30, 0, (hr + 30) * 2, hr + 90);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.4;
  for (const off of [-24, -12, 12, 24]) {
    ctx.beginPath();
    ctx.moveTo(off % 24 === 0 ? -16 : -9, off);
    ctx.lineTo(off % 24 === 0 ? 16 : 9, off);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(hx, gy, hr, 0, TAU);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#8fa8c8';
  ctx.stroke();
  // Fixed aircraft symbol over the horizon.
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(hx - 30, gy);
  ctx.lineTo(hx - 9, gy);
  ctx.lineTo(hx - 9, gy + 7);
  ctx.moveTo(hx + 30, gy);
  ctx.lineTo(hx + 9, gy);
  ctx.lineTo(hx + 9, gy + 7);
  ctx.stroke();
  ctx.fillStyle = '#cfe0f4';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', hx, gy + hr + 14);

  const knots = Math.round(plane.speed * 1.944);
  const feet = Math.max(0, Math.round((plane.z - GEAR) * 3.281));
  dial(520, gy, 52, plane.speed / 62, 'AIRSPEED', `${knots} kt`, plane.stalled);
  dial(740, gy, 52, (plane.z - GEAR) / 200, 'ALTITUDE', `${feet} ft`);
  // Vertical speed as a slim bar gauge.
  const vx = 940;
  ctx.fillStyle = '#141a26';
  rr(vx - 17, gy - 52, 34, 104, 6);
  ctx.fill();
  ctx.strokeStyle = '#8fa8c8';
  ctx.lineWidth = 2;
  rr(vx - 17, gy - 52, 34, 104, 6);
  ctx.stroke();
  const vsi = Math.max(-1, Math.min(1, plane.vz / 14));
  ctx.fillStyle = vsi >= 0 ? '#8fe08a' : '#ff9a5a';
  const bh = Math.abs(vsi) * 48;
  ctx.fillRect(vx - 11, vsi >= 0 ? gy - bh : gy, 22, bh);
  ctx.fillStyle = '#cfe0f4';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillText('VERT SPD', vx, gy + 66);
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${plane.vz >= 0 ? '+' : ''}${Math.round(plane.vz * 196.85 / 10) * 10}`, vx, gy - 62);
  // Throttle quadrant readout.
  ctx.fillStyle = '#cfe0f4';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillText('THROTTLE', 1085, gy + 66);
  ctx.fillStyle = '#2a3348';
  rr(1040, gy - 52, 90, 16, 7);
  ctx.fill();
  ctx.fillStyle = '#ffd76a';
  if (plane.throttle > 0.02) {
    rr(1040, gy - 52, 90 * plane.throttle, 16, 7);
    ctx.fill();
  }
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${Math.round(plane.throttle * 100)}%`, 1085, gy - 46 + 34);
}

// ------------------------------------------------------------------ HUD
function drawHUD() {
  ctx.textAlign = 'left';
  ctx.font = 'bold 21px Georgia, serif';
  ctx.fillStyle = 'rgba(10,16,26,0.45)';
  rr(18, 16, 252, 122, 10);
  ctx.fill();
  ctx.fillStyle = '#ffe9b0';
  ctx.fillText(`Score  ${state.score}`, 34, 48);
  ctx.font = '16px Georgia, serif';
  ctx.fillStyle = '#dfeaf6';
  ctx.fillText(`Rings  ${Math.min(state.nextRing, world.rings.length)} / ${world.rings.length}`, 34, 76);
  const mult = Math.min(3, 1 + 0.25 * Math.max(0, state.streak - 1));
  ctx.fillText(state.streak > 1 ? `Streak ×${mult.toFixed(2)} (${state.streak})` : 'Streak —', 34, 100);

  // Ring progress strip: one dot per ring — solid gold when flown, a
  // pulsing halo on the next one, a dim hollow for the rest.
  for (let i = 0; i < world.rings.length; i++) {
    const dx = 42 + i * 21;
    const dy = 121;
    if (i < state.nextRing) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(dx, dy, 5, 0, TAU);
      ctx.fill();
    } else if (i === state.nextRing) {
      const pr = 5 + Math.sin(state.time * 4) * 1.3;
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(dx, dy, pr + 2.5, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ffeec4';
      ctx.beginPath();
      ctx.arc(dx, dy, 3.4, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(220,232,255,0.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(dx, dy, 4.4, 0, TAU);
      ctx.stroke();
    }
  }

  // A little flame beside the panel while a streak is alive, flickering
  // with the run — the hotter the streak, the taller it dances.
  if (state.streak >= 2) {
    const fl = 1 + Math.sin(state.time * 11) * 0.12;
    ctx.save();
    ctx.translate(244, 96);
    ctx.scale(fl, fl * (1 + Math.min(0.35, state.streak * 0.05)));
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.quadraticCurveTo(7, -2, 5, 4);
    ctx.quadraticCurveTo(3.5, 10, 0, 10);
    ctx.quadraticCurveTo(-3.5, 10, -5, 4);
    ctx.quadraticCurveTo(-7, -2, 0, -11);
    ctx.fill();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.quadraticCurveTo(3.6, 1.5, 2.4, 5.4);
    ctx.quadraticCurveTo(1.2, 8.4, 0, 8.4);
    ctx.quadraticCurveTo(-2.4, 7, -2.2, 4.4);
    ctx.quadraticCurveTo(-2, 0.5, 0, -3);
    ctx.fill();
    ctx.restore();
  }

  // Clock and heading, top right / top centre.
  ctx.textAlign = 'right';
  ctx.font = 'bold 21px Georgia, serif';
  ctx.fillStyle = '#ffe9b0';
  const mm = String(Math.floor(state.elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(state.elapsed % 60)).padStart(2, '0');
  ctx.fillText(`${mm}:${ss}`, W - 30, 46);
  ctx.textAlign = 'center';
  const hdg = ((Math.round(plane.heading * 180 / Math.PI) % 360) + 360) % 360;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  ctx.font = 'bold 19px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(10,16,26,0.45)';
  rr(CX - 92, 16, 184, 40, 9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(`${cardinals[Math.round(hdg / 45) % 8]} ${String(hdg).padStart(3, '0')}°`, CX, 44);

  // Guide arrow to the next ring (or the runway when the course is done).
  let tx;
  let ty;
  let tz;
  let label;
  if (state.nextRing < world.rings.length) {
    const r = world.rings[state.nextRing];
    tx = r.x; ty = r.y; tz = r.z; label = `ring ${state.nextRing + 1}`;
  } else {
    tx = world.runway.x; ty = world.runway.y + 60; tz = world.runway.z + 6; label = 'runway';
  }
  const dx = tx - plane.x;
  const dy = ty - plane.y;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
  let rel = Math.atan2(dx, dy) - plane.heading;
  while (rel > Math.PI) rel -= TAU;
  while (rel < -Math.PI) rel += TAU;
  ctx.save();
  ctx.translate(CX, 96);
  ctx.rotate(Math.max(-1.2, Math.min(1.2, rel)));
  ctx.fillStyle = Math.abs(rel) < 0.2 ? '#ffd76a' : 'rgba(255,240,200,0.75)';
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(8, 8);
  ctx.lineTo(0, 3);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = '14px Georgia, serif';
  ctx.fillStyle = '#ffeec4';
  ctx.fillText(`${label} · ${dist} m`, CX, 128);

  // Crosshair in cockpit view.
  if (view === 'cockpit') {
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(CX, CY - 30, 11, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX - 20, CY - 30);
    ctx.lineTo(CX - 14, CY - 30);
    ctx.moveTo(CX + 14, CY - 30);
    ctx.lineTo(CX + 20, CY - 30);
    ctx.stroke();
  }

  if (plane.stalled && state.mode === 'flying' && Math.sin(state.time * 9) > -0.2) {
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillStyle = '#ff6a55';
    ctx.fillText('STALL', CX, 168);
    ctx.font = '16px Georgia, serif';
    ctx.fillStyle = '#ffe2d8';
    ctx.fillText('nose down (↓) and add throttle (W)', CX, 192);
  }

  if (state.toast && state.time < state.toastUntil) {
    ctx.font = 'bold 22px Georgia, serif';
    const w = ctx.measureText(state.toast).width + 44;
    ctx.fillStyle = 'rgba(10,16,26,0.55)';
    rr(CX - w / 2, H - 218, w, 42, 10);
    ctx.fill();
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText(state.toast, CX, H - 189);
  }
}

// Speed lines: past about 38 m/s the air itself starts to show —
// short streaks rushing outward past the edges of the view, faster
// and thicker the harder she is pushed.
function drawSpeedLines() {
  if (state.mode !== 'flying' || plane.onGround) return;
  const over = (plane.speed - 38) / 24;
  if (over <= 0) return;
  const alpha = Math.min(0.5, over * 0.55);
  ctx.strokeStyle = 'rgba(255,250,240,1)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const ang = i * 2.399 + Math.sin(i * 12.9) * 0.4; // golden-angle spread
    const phase = (state.time * 1.6 + i * 0.618) % 1;
    const r0 = 190 + phase * 330;
    const len = 26 + phase * 46;
    const x0 = CX + Math.cos(ang) * r0;
    const y0 = CY - 30 + Math.sin(ang) * r0 * 0.62;
    ctx.globalAlpha = alpha * (1 - phase * 0.6);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len * 0.62);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --------------------------------------------------------------- screens
function panel(w, h) {
  ctx.fillStyle = 'rgba(12,16,28,0.78)';
  rr(CX - w / 2, CY - h / 2, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,130,0.5)';
  ctx.lineWidth = 1.6;
  rr(CX - w / 2, CY - h / 2, w, h, 16);
  ctx.stroke();
}

function drawTitle() {
  ctx.textAlign = 'center';
  // Twinkling motes of light around the title, as if the evening air
  // itself were celebrating.
  for (let i = 0; i < 7; i++) {
    const sx = CX + Math.sin(i * 91.7) * 330;
    const sy = 96 + (Math.sin(i * 47.3) * 0.5 + 0.5) * 90;
    const tw = 0.5 + 0.5 * Math.sin(state.time * 2.2 + i * 1.7);
    ctx.fillStyle = `rgba(255,240,200,${0.25 + tw * 0.55})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.6 + tw * 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.font = 'bold 64px Georgia, serif';
  const tg = ctx.createLinearGradient(0, 108, 0, 172);
  tg.addColorStop(0, '#fff8e2');
  tg.addColorStop(0.55, '#ffe9b0');
  tg.addColorStop(1, '#f7b955');
  ctx.fillStyle = tg;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  ctx.fillText('Golden Hour Ring Run', CX, 168);
  ctx.shadowBlur = 0;
  ctx.font = 'italic 21px Georgia, serif';
  ctx.fillStyle = '#ffe4ae';
  ctx.fillText('a seaplane, ten gold rings, and one strip of runway to come home to', CX, 206);
  ctx.strokeStyle = 'rgba(255,215,130,0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX - 210, 224);
  ctx.lineTo(CX + 210, 224);
  ctx.stroke();
  panel(620, 252);
  ctx.font = '18px Georgia, serif';
  ctx.fillStyle = '#e8eefc';
  const lines = [
    'Take off north, thread the glowing rings in order,',
    'then land gently on the home runway for a bonus.',
    '',
    '↑ ↓ pitch · ← → bank · W/S throttle · mouse steers too',
    'C cockpit / chase view · P pause · M mute · R restart',
    '',
  ];
  lines.forEach((ln, i) => ctx.fillText(ln, CX, CY - 88 + i * 27));
  ctx.font = 'bold 22px Georgia, serif';
  ctx.fillStyle = '#ffd76a';
  const blink = Math.sin(state.time * 3) > -0.4;
  if (blink) ctx.fillText('Press ENTER or click to fly', CX, CY + 96);
}

function drawEndScreen() {
  ctx.textAlign = 'center';
  panel(600, 330);
  if (state.mode === 'landed') {
    // A drift of gold sparkles around the panel — she made it home.
    for (let i = 0; i < 9; i++) {
      const sx = CX + Math.sin(i * 77.3) * 270;
      const sy = CY - 130 + (Math.sin(i * 39.1) * 0.5 + 0.5) * 240;
      const tw = 0.5 + 0.5 * Math.sin(state.time * 2.6 + i * 2.1);
      ctx.fillStyle = `rgba(255,230,150,${0.2 + tw * 0.5})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5 + tw * 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.font = 'bold 40px Georgia, serif';
    ctx.fillStyle = '#b8f0ae';
    ctx.fillText('Down and home.', CX, CY - 118);
    ctx.font = '19px Georgia, serif';
    ctx.fillStyle = '#e8eefc';
    const rows = [
      [`Rings`, `${state.ringScore}`],
      [`Landing — ${state.landingGrade.toLowerCase()}`, `${state.landingBonus}`],
      [`Time bonus`, `${state.timeBonus}`],
      [`Best streak`, `×${Math.min(3, 1 + 0.25 * Math.max(0, state.bestStreak - 1)).toFixed(2)} (${state.bestStreak})`],
    ];
    rows.forEach(([k, v], i) => {
      ctx.textAlign = 'left';
      ctx.fillText(k, CX - 220, CY - 62 + i * 32);
      ctx.textAlign = 'right';
      ctx.fillText(v, CX + 220, CY - 62 + i * 32);
      ctx.textAlign = 'center';
    });
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(`Total  ${state.score}`, CX, CY + 92);
  } else {
    ctx.font = 'bold 40px Georgia, serif';
    ctx.fillStyle = '#ff9a7a';
    ctx.fillText('Flight over', CX, CY - 100);
    ctx.font = '19px Georgia, serif';
    ctx.fillStyle = '#e8eefc';
    wrapText(state.crashReason, CX, CY - 52, 500, 27);
    ctx.fillText(`Rings flown: ${Math.min(state.nextRing, world.rings.length)} of ${world.rings.length}`, CX, CY + 30);
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(`Score  ${state.score}`, CX, CY + 78);
  }
  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillStyle = '#ffe9b0';
  ctx.fillText('Press R to fly again', CX, CY + 138);
}

function wrapText(text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawPaused() {
  ctx.fillStyle = 'rgba(8,10,18,0.5)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillStyle = '#fff2cf';
  ctx.fillText('Paused', CX, CY - 10);
  ctx.font = '19px Georgia, serif';
  ctx.fillStyle = '#dfeaf6';
  ctx.fillText('P to resume', CX, CY + 28);
}

// ----------------------------------------------------------------- loop
let lastTs = 0;

function frame(ts) {
  const now = ts / 1000;
  let dt = Math.min(0.05, now - (lastTs || now));
  lastTs = now;
  state.time += dt;

  if (state.mode === 'flying' && !state.paused) updateFlight(dt);
  else if (state.mode === 'title') plane.propAngle += dt * 2;

  if (!state.paused) {
    updateParticles(dt);
    if (state.mode === 'flying' && !plane.onGround && plane.speed > 26 && Math.abs(plane.roll) > 0.28) {
      spawnTrail();
    }
  }

  // Camera choice.
  let c;
  if (state.mode === 'title') {
    const a = state.time * 0.05;
    c = { x: Math.sin(a) * 760, y: Math.cos(a) * 760, z: 130, heading: a + Math.PI, pitch: -0.13, roll: 0 };
    // Face the island centre: heading is measured from north, and the
    // camera sits at angle a around the centre, so it looks along a+π.
    c.heading = Math.atan2(-c.x, -c.y);
  } else if (view === 'cockpit' && state.mode === 'flying') {
    c = {
      x: plane.x + Math.sin(plane.heading) * 1.5,
      y: plane.y + Math.cos(plane.heading) * 1.5,
      z: plane.z + 1.35,
      heading: plane.heading,
      pitch: plane.pitch,
      roll: plane.roll,
    };
    cam.x = c.x; cam.y = c.y; cam.z = c.z;
    cam.heading = c.heading; cam.pitch = c.pitch; cam.roll = c.roll;
  } else {
    const off = chaseOffset();
    const k = 1 - Math.exp(-dt * 5.5);
    cam.x += (plane.x + off.x - cam.x) * k;
    cam.y += (plane.y + off.y - cam.y) * k;
    cam.z += (plane.z + off.z - cam.z) * k;
    cam.heading = plane.heading;
    cam.pitch += (plane.pitch * 0.7 - cam.pitch) * k;
    cam.roll += (plane.roll * 0.55 - cam.roll) * k;
    c = cam;
  }

  setBasis(c);
  drawSkyAndSea(c);
  drawClouds(c);
  drawFarIslands(c);
  drawIslands(c);
  drawRunway(c);
  drawRings(c);
  drawParticles(c);
  drawSpeedLines();
  if (state.mode !== 'title') drawPlaneShadow(c);

  if (state.mode === 'title') {
    drawTitle();
  } else {
    if (view === 'chase') drawChasePlane();
    if (view === 'cockpit' && state.mode === 'flying') drawCockpit();
    drawHUD();
    if (state.mode === 'crashed' || state.mode === 'landed') drawEndScreen();
    if (state.paused) drawPaused();
  }

  requestAnimationFrame(frame);
}

// ------------------------------------------------------- staged entries
// ?shot=play: mid-course, chase view, two rings already flown.
function stagePlay() {
  resetFlight();
  const ring = world.rings[2];
  const fx = Math.sin(ring.heading);
  const fy = Math.cos(ring.heading);
  plane.x = ring.x - fx * 150;
  plane.y = ring.y - fy * 150;
  plane.z = ring.z + 3;
  plane.heading = ring.heading;
  plane.pitch = 0.02;
  plane.speed = 37;
  plane.throttle = 0.68;
  plane.onGround = false;
  state.nextRing = 2;
  state.ringScore = 475;
  state.score = 475;
  state.streak = 2;
  state.bestStreak = 2;
  state.elapsed = 52;
  view = 'chase';
  prevRingSide = -140;
  snapCamera();
}

// ?shot=end: parked on the strip after a clean, complete flight.
function stageEnd() {
  resetFlight();
  state.nextRing = world.rings.length;
  state.ringScore = 2350;
  state.score = state.ringScore;
  state.bestStreak = 7;
  state.streak = 7;
  state.elapsed = 183;
  plane.x = world.runway.x;
  plane.y = world.runway.y + 30;
  plane.z = world.runway.z + GEAR;
  plane.speed = 0;
  plane.throttle = 0;
  plane.onGround = true;
  view = 'chase';
  finishLanding(0.9);
  snapCamera();
}

if (shot === 'play') stagePlay();
else if (shot === 'end') stageEnd();
else state.mode = 'title';

requestAnimationFrame(frame);
