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

import { buildWorld, groundHeight } from './world.js';
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
      sound.chime();
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
