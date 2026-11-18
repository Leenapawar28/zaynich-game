import * as THREE from 'three';
import { randomSpecies, buildBacteriaMesh } from './bacteria.js';
import { generateMaze, isWalkable, cellToWorld, floorCells, buildMazeMesh } from './maze.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');

const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const comboEl = document.getElementById('combo');
const waveIndicatorEl = document.getElementById('wave-indicator');

const waveBannerEl = document.getElementById('wave-banner');
const waveBannerTitleEl = document.getElementById('wave-banner-title');
const waveBannerTextEl = document.getElementById('wave-banner-text');

const coverageChecklistEl = document.getElementById('coverage-checklist');
const coverageItemsEl = document.getElementById('coverage-items');

const campaignResultsScreen = document.getElementById('campaign-results');
const campaignScoreEl = document.getElementById('campaign-score');
const campaignStatsEl = document.getElementById('campaign-stats');
const campaignRestartBtn = document.getElementById('campaign-restart-btn');

const muteBtn = document.getElementById('mute-btn');

// ---------------------------------------------------------------------------
// Campaign — five stages, each teaching one piece of how ZAYNICH works.
// ---------------------------------------------------------------------------
const WAVES = [
  {
    id: 1,
    duration: 45,
    title: 'The Resistance Crisis',
    banner: "Gram-negative bacteria stack beta-lactamases, porin loss, efflux pumps and PBP mutations — ordinary drugs bounce right off. Only Zidebactam + Cefepime together get through.",
  },
  {
    id: 2,
    duration: 50,
    title: 'Zidebactam — Not a Beta-Lactam',
    banner: "Zidebactam isn't a beta-lactam, so beta-lactamase enzymes can't touch it. It binds PBP2 directly — critical for the bug's shape and structure. Alone, it only wounds a bug.",
  },
  {
    id: 3,
    duration: 55,
    title: 'Cefepime — Speed Wins',
    banner: "Cefepime binds PBP3 faster than most beta-lactamases can break it down. Bugs with a closing ring need BOTH players there before it shuts for a Fast Bind bonus.",
    shielded: true,
  },
  {
    id: 4,
    duration: 50,
    title: 'Dual PBP Inhibition',
    banner: "PBP3 blocked. PBP2 blocked. Together they trigger rapid, synergistic killing — the core of how ZAYNICH works.",
  },
  {
    id: 5,
    duration: 60,
    title: 'Broadest-Ever Coverage',
    banner: "KPC. NDM. VIM. OXA-48. AmpC. Even MBLs, which zidebactam alone can't inhibit. Clear one of each resistant strain together to confirm full coverage.",
    badges: true,
  },
];
const BUGS_PER_WAVE = [10, 12, 14, 14, 16];
const BADGES = ['KPC', 'NDM', 'VIM', 'OXA-48', 'AmpC', 'MBL'];

const CAMPAIGN_STATS = [
  { value: '90%', label: 'Microbiological eradication rate' },
  { value: '+20%', label: 'Superiority margin over meropenem' },
  { value: '88%', label: 'Clinical cure in the sickest of the sick (compassionate use)' },
  { value: '0', label: 'Cases of drug-related nephrotoxicity' },
  { value: '3-log', label: 'Kill depth vs. ~1-log for older-standard therapy' },
  { value: 'Dual PBP', label: 'Barrier to resistance — PBP2 + PBP3, blocked together' },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COMBO_WINDOW_MS = 1400;
const ROOMS_X = 9;
const ROOMS_Y = 7;
const CELL_SIZE = 1.6;
const PLAYER_SPEED = CELL_SIZE * 3.1;
const EAT_RADIUS = 0.62;
const ENGAGE_WINDOW_MS = 4500;
const FAST_BIND_WINDOW_MS = 2400;

const PLAYER_LABELS = { P1: 'ZIDEBACTAM', P2: 'CEFEPIME' };
const PLAYER_COLORS = { P1: 0x4fc3ff, P2: 0xe83be0 };

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120a24);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x8878c8, 0.65));

const keyLight = new THREE.DirectionalLight(0xfff2d6, 1.1);
keyLight.position.set(6, 20, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const purpleGlow = new THREE.PointLight(0xb066ff, 1.2, 40);
purpleGlow.position.set(0, 8, 0);
scene.add(purpleGlow);

// ---------------------------------------------------------------------------
// Maze
// ---------------------------------------------------------------------------
const maze = generateMaze(ROOMS_X, ROOMS_Y);
scene.add(buildMazeMesh(maze, CELL_SIZE));

const floorW = maze.cols * CELL_SIZE;
const floorD = maze.rows * CELL_SIZE;
keyLight.shadow.camera.left = -floorW / 2 - 2;
keyLight.shadow.camera.right = floorW / 2 + 2;
keyLight.shadow.camera.top = floorD / 2 + 2;
keyLight.shadow.camera.bottom = -floorD / 2 - 2;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 50;

camera.position.set(0, floorD * 1.15, floorD * 0.72);
camera.lookAt(0, 0, 0);

const P1_SPAWN = { col: 1, row: 1 };
const P2_SPAWN = { col: (ROOMS_X - 1) * 2 + 1, row: (ROOMS_Y - 1) * 2 + 1 };

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Player avatars — the same labeled scientific-mallet "vial" model used
// throughout this project for Zidebactam/Cefepime, now walking the maze
// instead of swinging.
// ---------------------------------------------------------------------------
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildFloatingLabel(text) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 320;
  canvasEl.height = 96;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = 'rgba(20,10,40,0.78)';
  roundRectPath(ctx, 4, 4, 312, 88, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 48);

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.scale.set(0.72, 0.216, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function buildHandle(color = 0x241a3a) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.85, 10), mat);
  handle.position.y = -0.42;
  return handle;
}

function buildScientificMallet(accentColor, labelText) {
  const group = new THREE.Group();
  group.add(buildHandle());

  const liquidMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.3, emissive: accentColor, emissiveIntensity: 0.25,
  });
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 16), liquidMat);
  liquid.rotation.z = Math.PI / 2;
  group.add(liquid);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8f4ff, transparent: true, opacity: 0.35, roughness: 0.1, clearcoat: 1,
  });
  const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.42, 16), glassMat);
  vial.rotation.z = Math.PI / 2;
  vial.castShadow = true;
  group.add(vial);

  const capMat = new THREE.MeshStandardMaterial({ color: 0xd9d9e8, roughness: 0.25, metalness: 0.4 });
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.035, 16), capMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * 0.21;
    group.add(cap);
  }

  const moleculeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.1,
  });
  const molecule = new THREE.Group();
  molecule.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), moleculeMat));
  for (const [dx, dy, dz] of [[0.09, 0.05, 0], [-0.09, 0.04, 0], [0, 0.07, 0.08], [0, 0.06, -0.08]]) {
    const atom = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), moleculeMat);
    atom.position.set(dx, dy, dz);
    molecule.add(atom);
  }
  molecule.position.y = 0.3;
  group.add(molecule);

  const label = buildFloatingLabel(labelText);
  label.position.set(0, 0.58, 0);
  group.add(label);

  group.traverse((o) => { if (o.material) o.material = o.material.clone(); });
  return group;
}

const DIRS = { up: { dx: 0, dz: -1 }, down: { dx: 0, dz: 1 }, left: { dx: -1, dz: 0 }, right: { dx: 1, dz: 0 } };

function makePlayer(label, spawn) {
  const mesh = buildScientificMallet(PLAYER_COLORS[label], PLAYER_LABELS[label]);
  mesh.position.y = 0.85;
  scene.add(mesh);
  const { x, z } = cellToWorld(spawn.col, spawn.row, maze, CELL_SIZE);
  return { label, mesh, col: spawn.col, row: spawn.row, progress: 0, x, z, dir: null, desiredDir: null };
}

const players = { P1: makePlayer('P1', P1_SPAWN), P2: makePlayer('P2', P2_SPAWN) };

function resetPlayer(player, spawn) {
  const { x, z } = cellToWorld(spawn.col, spawn.row, maze, CELL_SIZE);
  player.col = spawn.col;
  player.row = spawn.row;
  player.progress = 0;
  player.x = x;
  player.z = z;
  player.dir = null;
  player.desiredDir = null;
}

// Tap a direction to lock it in — the classic Pac-Man feel: you don't have
// to hold the key, movement continues until you press another direction or
// a wall blocks the way.
const KEY_MAP = {
  ArrowUp: { player: 'P1', dir: DIRS.up },
  ArrowDown: { player: 'P1', dir: DIRS.down },
  ArrowLeft: { player: 'P1', dir: DIRS.left },
  ArrowRight: { player: 'P1', dir: DIRS.right },
  KeyW: { player: 'P2', dir: DIRS.up },
  KeyS: { player: 'P2', dir: DIRS.down },
  KeyA: { player: 'P2', dir: DIRS.left },
  KeyD: { player: 'P2', dir: DIRS.right },
};
window.addEventListener('keydown', (e) => {
  const mapped = KEY_MAP[e.code];
  if (!mapped) return;
  if (game.state === 'playing') e.preventDefault();
  players[mapped.player].desiredDir = mapped.dir;
});

// Tracks exact fractional progress between cell centers rather than testing
// proximity to a center each frame — a proximity/epsilon check can be
// skipped entirely when a frame's movement step is wider than the epsilon
// window (true here: up to ~0.25 world units per frame vs. a few
// hundredths), which would let a player sail through walls forever without
// ever registering a turn or a stop. Fractional progress can't be skipped:
// any leftover distance after crossing a center carries into the next leg.
function movePlayer(player, dt) {
  let remaining = (PLAYER_SPEED * dt) / CELL_SIZE;
  let iterations = 0;
  while (remaining > 1e-9 && iterations < 8) {
    iterations++;
    if (!player.dir) {
      if (player.desiredDir && isWalkable(maze, player.col + player.desiredDir.dx, player.row + player.desiredDir.dz)) {
        player.dir = player.desiredDir;
        player.progress = 0;
      } else {
        break;
      }
    }

    const spaceLeft = 1 - player.progress;
    const advance = Math.min(remaining, spaceLeft);
    player.progress += advance;
    remaining -= advance;

    if (player.progress >= 1 - 1e-9) {
      player.col += player.dir.dx;
      player.row += player.dir.dz;
      player.progress = 0;
      if (player.desiredDir && isWalkable(maze, player.col + player.desiredDir.dx, player.row + player.desiredDir.dz)) {
        player.dir = player.desiredDir;
      } else if (!isWalkable(maze, player.col + player.dir.dx, player.row + player.dir.dz)) {
        player.dir = null;
      }
    }
  }

  const base = cellToWorld(player.col, player.row, maze, CELL_SIZE);
  if (player.dir && player.progress > 0) {
    player.x = base.x + player.dir.dx * CELL_SIZE * player.progress;
    player.z = base.z + player.dir.dz * CELL_SIZE * player.progress;
  } else {
    player.x = base.x;
    player.z = base.z;
  }
  player.mesh.position.x = player.x;
  player.mesh.position.z = player.z;
}

// ---------------------------------------------------------------------------
// Kill burst + bond beam + floating text feedback
// ---------------------------------------------------------------------------
const activeBursts = [];
const burstShardGeo = new THREE.IcosahedronGeometry(0.06, 0);

function spawnBurst(position, color, intensity = 1) {
  const count = Math.round(12 * THREE.MathUtils.clamp(intensity, 0.6, 1.8));
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true });
    const mesh = new THREE.Mesh(burstShardGeo, mat);
    mesh.position.copy(position);
    const theta = Math.random() * Math.PI * 2;
    const speed = (1.6 + Math.random() * 2.6) * intensity;
    const vel = new THREE.Vector3(
      Math.cos(theta) * speed,
      1.6 + Math.random() * 2.2,
      Math.sin(theta) * speed
    );
    mesh.scale.setScalar(0.5 + Math.random() * 0.8);
    scene.add(mesh);
    activeBursts.push({ mesh, vel, life: 0, maxLife: 0.55 + Math.random() * 0.3 });
  }
}

function spawnResistSpark(x, y, z, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true });
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(burstShardGeo, mat.clone());
    mesh.position.set(x, y, z);
    const theta = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 1.2;
    const vel = new THREE.Vector3(Math.cos(theta) * speed, 1 + Math.random(), Math.sin(theta) * speed);
    mesh.scale.setScalar(0.35 + Math.random() * 0.3);
    scene.add(mesh);
    activeBursts.push({ mesh, vel, life: 0, maxLife: 0.35 });
  }
}

function updateBursts(dt) {
  for (let i = activeBursts.length - 1; i >= 0; i--) {
    const b = activeBursts[i];
    b.life += dt;
    b.vel.y -= 9 * dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.mesh.rotation.x += dt * 6;
    b.mesh.rotation.y += dt * 4;
    const t = b.life / b.maxLife;
    b.mesh.material.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      activeBursts.splice(i, 1);
    }
  }
}

// A brief glowing beam between the two players at the instant of a kill —
// the "combination therapy" visual: they only work by connecting.
const beamGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 8, 1, true);
const activeBonds = [];

function spawnBond(posA, posB) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(beamGeo, mat);
  activeBonds.push({ mesh, life: 0, maxLife: 0.3, a: posA.clone(), b: posB.clone() });
  scene.add(mesh);
}

function updateBonds(dt) {
  for (let i = activeBonds.length - 1; i >= 0; i--) {
    const bond = activeBonds[i];
    bond.life += dt;
    const t = bond.life / bond.maxLife;
    const mid = bond.a.clone().lerp(bond.b, 0.5);
    const dist = bond.a.distanceTo(bond.b);
    bond.mesh.position.copy(mid);
    bond.mesh.scale.set(1, dist, 1);
    bond.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      bond.b.clone().sub(bond.a).normalize()
    );
    bond.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
    if (t >= 1) {
      scene.remove(bond.mesh);
      bond.mesh.material.dispose();
      activeBonds.splice(i, 1);
    }
  }
}

function makeTextSprite(text, color) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 420;
  canvasEl.height = 110;
  const ctx = canvasEl.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = 46;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const maxWidth = canvasEl.width - 24;
  while (fontSize > 22 && ctx.measureText(text).width > maxWidth) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(10,4,20,0.9)';
  ctx.strokeText(text, 210, 55);
  ctx.fillStyle = color;
  ctx.fillText(text, 210, 55);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.scale.set(1.4, 0.37, 1);
  sprite.renderOrder = 999;
  return sprite;
}

const activeFloatingTexts = [];
function flashFloatingText(x, y, z, text, color, maxLife = 0.9) {
  const sprite = makeTextSprite(text, color);
  sprite.position.set(x, y, z);
  scene.add(sprite);
  activeFloatingTexts.push({ sprite, life: 0, maxLife });
}

const RESISTANT_MESSAGES = ['RESISTANT!', 'BACTERIA WINS!', 'NO EFFECT!', 'BUG SURVIVES!', 'DRUG FAILS!'];
function flashResistText(x, y, z) {
  const msg = RESISTANT_MESSAGES[Math.floor(Math.random() * RESISTANT_MESSAGES.length)];
  flashFloatingText(x, y, z, msg, '#ff6b6b');
}

function updateFloatingTexts(dt) {
  for (let i = activeFloatingTexts.length - 1; i >= 0; i--) {
    const f = activeFloatingTexts[i];
    f.life += dt;
    const t = f.life / f.maxLife;
    f.sprite.position.y += dt * 0.6;
    f.sprite.material.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      scene.remove(f.sprite);
      f.sprite.material.map.dispose();
      f.sprite.material.dispose();
      activeFloatingTexts.splice(i, 1);
    }
  }
}

function buildShieldRing() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffe27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 8, 24), mat);
  ring.rotation.x = Math.PI / 2;
  return ring;
}

// ---------------------------------------------------------------------------
// Audio (procedural, mutable)
// ---------------------------------------------------------------------------
let audioCtx = null;
let muted = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', gain = 0.15) {
  if (muted) return;
  try {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    /* audio unavailable — game still playable */
  }
}

function playNoiseBurst(duration, startFreq, endFreq, gain) {
  if (muted) return;
  try {
    const ctx = ensureAudio();
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(startFreq, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    noise.connect(filter).connect(g).connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + duration);
  } catch {
    /* audio unavailable — game still playable */
  }
}

function playHitSound(combo) {
  const freq = 320 + Math.min(combo, 8) * 40;
  playTone(freq, 0.14, 'square', 0.12);
  playTone(freq * 1.5, 0.1, 'sine', 0.06);
}

function playBurstSound(combo) {
  playNoiseBurst(0.22, 900, 120, 0.22);
  playHitSound(combo);
}

function playPartialSound() {
  playTone(150, 0.1, 'triangle', 0.08);
}

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  state: 'start', // 'start' | 'playing' | 'gameover'
  score: 0,
  best: Number(localStorage.getItem('zaynichBugBusterBest') || 0),
  combo: 0,
  lastHitTime: 0,
  wave: 0,
  waveTimeLeft: 0,
};

let bugs = [];
let bugsRemaining = 0;
const coverageConfirmed = new Set();

function shuffledBadges() {
  const arr = [...BADGES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function resetCoverageChecklist() {
  coverageConfirmed.clear();
  coverageItemsEl.innerHTML = '';
  for (const name of BADGES) {
    const div = document.createElement('div');
    div.className = 'coverage-item';
    div.textContent = name;
    div.dataset.badge = name;
    coverageItemsEl.appendChild(div);
  }
}

function confirmCoverage(name, pos) {
  if (coverageConfirmed.has(name)) return;
  coverageConfirmed.add(name);
  const item = coverageItemsEl.querySelector(`[data-badge="${name}"]`);
  if (item) item.classList.add('confirmed');
  flashFloatingText(pos.x, pos.y + 0.75, pos.z, `COVERAGE: ${name}`, '#8fffb0', 1.1);
}

// ---------------------------------------------------------------------------
// Bugs — placed through the maze; only get eradicated when BOTH players
// reach the same one within the engagement window.
// ---------------------------------------------------------------------------
function pickBugCells(count, excludeCells) {
  const all = floorCells(maze).filter(
    (c) => !excludeCells.some((e) => e.col === c.col && e.row === c.row)
  );
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

function spawnWaveBugs() {
  for (const b of bugs) {
    scene.remove(b.mesh);
    disposeObject(b.mesh);
  }
  bugs = [];

  const wave = WAVES[game.wave - 1];
  const count = BUGS_PER_WAVE[game.wave - 1];
  const cells = pickBugCells(count, [P1_SPAWN, P2_SPAWN]);
  const badgeQueue = wave.badges ? shuffledBadges() : [];

  for (const cell of cells) {
    const species = randomSpecies();
    const mesh = buildBacteriaMesh(species);
    mesh.scale.setScalar(0.6);
    const { x, z } = cellToWorld(cell.col, cell.row, maze, CELL_SIZE);
    mesh.position.set(x, 0, z);
    scene.add(mesh);

    const bug = {
      mesh, species, x, z, col: cell.col, row: cell.row,
      engagedBy: new Set(), firstEngagedAt: 0, dead: false,
      shielded: false, shieldUntil: 0, ringMesh: null, badge: null,
    };

    if (wave.shielded) {
      bug.shielded = true;
      bug.shieldUntil = performance.now() + FAST_BIND_WINDOW_MS;
      bug.ringMesh = buildShieldRing();
      mesh.add(bug.ringMesh);
    }
    if (wave.badges && badgeQueue.length) {
      bug.badge = badgeQueue.shift();
      const tag = buildFloatingLabel(bug.badge);
      tag.scale.set(0.5, 0.15, 1);
      tag.position.set(0, 0.85, 0);
      mesh.add(tag);
    }

    bugs.push(bug);
  }
  bugsRemaining = bugs.length;
}

function onBugSoloEngaged(bug, player) {
  spawnResistSpark(bug.x, 0.5, bug.z, 0xdbe8ff);
  playPartialSound();
  if (game.state === 'playing' && game.wave === 2) {
    const hint = player.label === 'P1' ? 'PBP2 bound — need Cefepime too!' : 'PBP3 bound — need Zidebactam too!';
    flashFloatingText(bug.x, 1.1, bug.z, hint, '#7fe6ff');
  }
}

function killBug(bug, now) {
  bug.dead = true;
  game.combo = now - game.lastHitTime < COMBO_WINDOW_MS ? game.combo + 1 : 1;
  game.lastHitTime = now;
  let points = 10 + Math.min(game.combo - 1, 8) * 4;

  const fastBind = bug.shielded && now <= bug.shieldUntil;
  if (fastBind) {
    points += 25;
    flashFloatingText(bug.x, 1.2, bug.z, 'FAST BIND!', '#ffe27a');
  }
  if (bug.badge) confirmCoverage(bug.badge, { x: bug.x, y: 1.1, z: bug.z });
  game.score += points;

  spawnBurst(new THREE.Vector3(bug.x, 0.5, bug.z), bug.species.color);
  spawnBond(
    new THREE.Vector3(players.P1.x, 0.85, players.P1.z),
    new THREE.Vector3(players.P2.x, 0.85, players.P2.z)
  );
  scene.remove(bug.mesh);
  disposeObject(bug.mesh);

  playBurstSound(game.combo);
  flashCombo(points, game.combo);
  updateHUD();
  bugsRemaining--;
}

function updateBugs(now, dt) {
  for (const bug of bugs) {
    if (bug.dead) continue;

    if (bug.shielded) {
      bug.ringMesh.rotation.z += dt * 3;
      if (now > bug.shieldUntil && bug.engagedBy.size < 2) {
        bug.mesh.remove(bug.ringMesh);
        bug.ringMesh.geometry.dispose();
        bug.ringMesh.material.dispose();
        bug.ringMesh = null;
        bug.shielded = false;
      }
    }

    for (const player of Object.values(players)) {
      if (bug.engagedBy.has(player.label)) continue;
      const dist = Math.hypot(player.x - bug.x, player.z - bug.z);
      if (dist < EAT_RADIUS) {
        if (bug.engagedBy.size === 0) bug.firstEngagedAt = now;
        bug.engagedBy.add(player.label);
        onBugSoloEngaged(bug, player);
      }
    }

    if (bug.engagedBy.size >= 2) {
      killBug(bug, now);
      continue;
    }
    if (bug.engagedBy.size === 1) {
      const windowMs = bug.shielded ? FAST_BIND_WINDOW_MS : ENGAGE_WINDOW_MS;
      if (now - bug.firstEngagedAt > windowMs) {
        flashResistText(bug.x, 1.1, bug.z);
        bug.engagedBy.clear();
        if (game.state === 'playing') game.combo = 0;
      }
    }
  }
}

let comboFlashTimeout = null;
function flashCombo(points, combo) {
  comboEl.textContent = combo > 1 ? `+${points}  x${combo} COMBO!` : `+${points}`;
  comboEl.classList.remove('pop');
  void comboEl.offsetWidth;
  comboEl.classList.add('pop');
  clearTimeout(comboFlashTimeout);
  comboFlashTimeout = setTimeout(() => {
    comboEl.textContent = '';
  }, 900);
}

function updateHUD() {
  scoreEl.textContent = `Score: ${game.score}`;
  timeEl.textContent = `${Math.ceil(game.waveTimeLeft)}s`;
  waveIndicatorEl.textContent = `Stage ${game.wave}/${WAVES.length}`;
}

function showWaveBanner(wave) {
  waveBannerTitleEl.textContent = `Stage ${wave.id}: ${wave.title}`;
  waveBannerTextEl.textContent = wave.banner;
  waveBannerEl.classList.add('hidden');
  void waveBannerEl.offsetWidth;
  waveBannerEl.classList.remove('hidden');
}

function advanceWave() {
  game.wave += 1;
  const wave = WAVES[game.wave - 1];
  game.waveTimeLeft = wave.duration;
  if (wave.badges) {
    resetCoverageChecklist();
    coverageChecklistEl.classList.remove('hidden');
  } else {
    coverageChecklistEl.classList.add('hidden');
  }
  spawnWaveBugs();
  showWaveBanner(wave);
}

function updateWave(dt) {
  game.waveTimeLeft -= dt;
  const cleared = bugsRemaining <= 0;
  if (cleared || game.waveTimeLeft <= 0) {
    if (game.wave >= WAVES.length) {
      game.waveTimeLeft = 0;
      endCampaign();
      return;
    }
    advanceWave();
  }
  updateHUD();
}

function startGame() {
  game.state = 'playing';
  game.score = 0;
  game.combo = 0;
  game.wave = 1;
  game.waveTimeLeft = WAVES[0].duration;
  resetPlayer(players.P1, P1_SPAWN);
  resetPlayer(players.P2, P2_SPAWN);
  coverageChecklistEl.classList.add('hidden');
  spawnWaveBugs();
  hud.classList.remove('hidden');
  campaignResultsScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
  updateHUD();
  showWaveBanner(WAVES[0]);
  playTone(440, 0.12, 'sine', 0.1);
}

function endCampaign() {
  game.state = 'gameover';
  if (game.score > game.best) {
    game.best = game.score;
    localStorage.setItem('zaynichBugBusterBest', String(game.best));
  }
  campaignScoreEl.textContent = `Final score: ${game.score}  •  Best: ${game.best}`;
  campaignStatsEl.innerHTML = '';
  for (const stat of CAMPAIGN_STATS) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = stat.value;
    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = stat.label;
    card.append(value, label);
    campaignStatsEl.appendChild(card);
  }
  campaignResultsScreen.classList.remove('hidden');
  hud.classList.add('hidden');
  waveBannerEl.classList.add('hidden');
  coverageChecklistEl.classList.add('hidden');
  playTone(180, 0.4, 'sawtooth', 0.1);
}

startBtn.addEventListener('click', startGame);
campaignRestartBtn.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);

function update(dt) {
  if (game.state === 'playing') {
    updateWave(dt);
    movePlayer(players.P1, dt);
    movePlayer(players.P2, dt);
    updateBugs(performance.now(), dt);
  }
  updateBursts(dt);
  updateBonds(dt);
  updateFloatingTexts(dt);
}

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
});
