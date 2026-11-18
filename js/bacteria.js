import * as THREE from 'three';

// Real gram-negative pathogens, styled as anxious little "germ" characters —
// wet/organic skin, worried expressions, and (where biologically apt)
// flagella or pili. Each has a distinct silhouette so it reads at a glance
// while popping out of a hole.
const SPECIES = [
  { name: 'Escherichia coli', color: 0x6f9a3c, dark: 0x3d5a1f, build: buildEColi },
  { name: 'Klebsiella pneumoniae', color: 0xe8879e, dark: 0xa8506a, build: buildKlebsiella },
  { name: 'Pseudomonas aeruginosa', color: 0xcaa245, dark: 0x8a6c1f, build: buildPseudomonas },
  { name: 'Acinetobacter baumannii', color: 0xe8aab8, dark: 0xb06c80, build: buildAcinetobacter },
  { name: 'Enterobacter cloacae', color: 0xd97a4a, dark: 0x9c4c26, build: buildEnterobacter },
];

export function randomSpecies() {
  return SPECIES[Math.floor(Math.random() * SPECIES.length)];
}

export function buildBacteriaMesh(species) {
  const group = new THREE.Group();
  species.build(group, species);
  group.userData.species = species.name;

  const box = new THREE.Box3().setFromObject(group);
  const topY = box.isEmpty() ? 0.5 : box.max.y + 0.18;
  group.add(makeNameTag(species.name, topY));

  return group;
}

// ---------------------------------------------------------------------------
// Procedural "skin" textures — cheap canvas noise used as a bump map so the
// body reads as organic (nubby / fuzzy / wet) instead of flat-shaded plastic.
// Generated once per kind and reused across every instance of a species.
// ---------------------------------------------------------------------------
const bumpTextureCache = new Map();

function getBumpTexture(kind) {
  if (bumpTextureCache.has(kind)) return bumpTextureCache.get(kind);

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const presets = {
    smooth: { count: 40, minR: 2, maxR: 5, contrast: 0.18 },
    nubby: { count: 110, minR: 3, maxR: 9, contrast: 0.4 },
    fuzzy: { count: 260, minR: 1, maxR: 3, contrast: 0.5 },
  };
  const { count, minR, maxR, contrast } = presets[kind] || presets.smooth;

  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = minR + Math.random() * (maxR - minR);
    const bright = Math.random() > 0.5;
    const shade = bright ? 128 + 127 * contrast : 128 - 127 * contrast;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${shade},${shade},${shade},0.9)`);
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  bumpTextureCache.set(kind, texture);
  return texture;
}

function bodyMaterial(color, { skin = 'smooth', bumpScale = 0.03, roughness = 0.5, clearcoat = 0.5 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.03,
    bumpMap: getBumpTexture(skin),
    bumpScale,
    clearcoat,
    clearcoatRoughness: 0.28,
    sheen: 0.6,
    sheenColor: new THREE.Color(color).multiplyScalar(0.6),
  });
}

// ---------------------------------------------------------------------------
// Face: big worried eyes, angled eyebrows, an anxious little mouth.
// ---------------------------------------------------------------------------
function addEyes(group, radius, forwardOffset, spread = 0.42, opts = {}) {
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.25 });
  const browMat = new THREE.MeshStandardMaterial({ color: opts.browColor ?? 0x2a1f1f, roughness: 0.6 });
  const eyeR = radius * (opts.eyeScale ?? 0.32);
  const baseY = opts.baseY ?? radius * 0.32;

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 12, 12), whiteMat);
    eye.position.set(side * radius * spread, baseY, forwardOffset);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 8, 8), pupilMat);
    pupil.position.set(side * eyeR * 0.15, 0, eyeR * 0.75);
    eye.add(pupil);
    group.add(eye);

    // Worried eyebrow: a thin bent capsule angled up toward the center.
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(eyeR * 0.16, eyeR * 1.1, 3, 6), browMat);
    brow.position.set(side * radius * spread, baseY + eyeR * 1.35, forwardOffset + eyeR * 0.3);
    brow.rotation.z = side * -0.55;
    brow.rotation.x = -0.2;
    group.add(brow);

    if (opts.tears) {
      const tear = new THREE.Mesh(
        new THREE.SphereGeometry(eyeR * 0.3, 6, 6),
        new THREE.MeshPhysicalMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.85, roughness: 0.1, clearcoat: 1 })
      );
      tear.position.set(side * radius * spread, baseY - eyeR * 1.3, forwardOffset + eyeR * 0.5);
      tear.scale.set(0.7, 1.3, 0.7);
      group.add(tear);
    }
  }
}

function addMouth(group, radius, position, { open = 0.5, dark = 0x3a1010 } = {}) {
  const mouthMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22 * open, 10, 10), mouthMat);
  mouth.scale.set(1, 0.8, 0.5);
  mouth.position.copy(position);
  group.add(mouth);
}

function addHandNubs(group, radius, position, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  for (const side of [-1, 1]) {
    const palm = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 8, 8), mat);
    palm.position.set(position.x + side * radius * 0.55, position.y, position.z);
    palm.scale.set(1, 1.1, 0.6);
    group.add(palm);
    for (let f = 0; f < 3; f++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.05, radius * 0.18, 2, 4), mat);
      finger.position.set(
        position.x + side * radius * 0.55 + (f - 1) * radius * 0.14,
        position.y + radius * 0.24,
        position.z
      );
      group.add(finger);
    }
  }
}

// ---------------------------------------------------------------------------
// Flagella / pili
// ---------------------------------------------------------------------------
const flagellumMat = new THREE.MeshStandardMaterial({
  color: 0xf0e7d2,
  roughness: 0.4,
  transparent: true,
  opacity: 0.85,
});

function addFlagellum(group, origin, dir, length, waviness) {
  const segs = 5;
  const points = [];
  const d = dir.clone().normalize();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const wobble = new THREE.Vector3(
      (Math.random() - 0.5) * waviness,
      (Math.random() - 0.5) * waviness,
      (Math.random() - 0.5) * waviness
    ).multiplyScalar(t);
    points.push(origin.clone().add(d.clone().multiplyScalar(length * t)).add(wobble));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 12, 0.012, 5, false);
  group.add(new THREE.Mesh(geo, flagellumMat));
}

function addPeritrichousFlagella(group, count, bodyRadius, length) {
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    const origin = dir.clone().multiplyScalar(bodyRadius * 0.95);
    addFlagellum(group, origin, dir, length * (0.7 + Math.random() * 0.5), length * 0.35);
  }
}

function addPolarFlagella(group, count, origin, mainDir, length) {
  for (let i = 0; i < count; i++) {
    const jitter = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5
    );
    const dir = mainDir.clone().add(jitter).normalize();
    addFlagellum(group, origin.clone(), dir, length * (0.8 + Math.random() * 0.4), length * 0.45);
  }
}

function addPili(group, count, bodyRadius, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, bodyRadius * 0.35, 4), mat);
    spike.position.copy(dir).multiplyScalar(bodyRadius * 0.92);
    spike.lookAt(dir.clone().multiplyScalar(bodyRadius * 2));
    spike.rotateX(Math.PI / 2);
    group.add(spike);
  }
}

function addDroplets(group, bodyRadius, count) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    const drop = new THREE.Mesh(new THREE.SphereGeometry(bodyRadius * (0.05 + Math.random() * 0.05), 6, 6), mat);
    drop.position.copy(dir).multiplyScalar(bodyRadius * 1.01);
    group.add(drop);
  }
}

// ---------------------------------------------------------------------------
// Name tag — small floating billboard label, always facing the camera.
// ---------------------------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeNameTag(name, topY) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fdf3c8';
  roundRect(ctx, 6, 6, 500, 116, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#2b2140';
  ctx.font = 'italic 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('hi, I am', 256, 42);
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText(name, 256, 86);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.scale.set(0.95, 0.24, 1);
  sprite.position.set(0, topY, 0);
  sprite.renderOrder = 999;
  return sprite;
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------
function buildEColi(group, species) {
  const r = 0.19, len = 0.5;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), bodyMaterial(species.color, { skin: 'fuzzy', bumpScale: 0.02, roughness: 0.45 }));
  body.rotation.z = Math.PI / 2;
  body.position.y = r + 0.04;
  group.add(body);

  addPeritrichousFlagella(group, 12, r + 0.06, 0.32);
  addDroplets(group, r + 0.05, 5);
  addEyes(group, r, r * 1.15, 0.6, { baseY: body.position.y + r * 0.35 });
  addMouth(group, r, new THREE.Vector3(0, body.position.y - r * 0.35, r * 1.1), { open: 0.6 });
  group.userData.eyeBaseY = r + 0.04;
}

function buildKlebsiella(group, species) {
  const rBottom = 0.23, rTop = 0.18;
  const mat = bodyMaterial(species.color, { skin: 'nubby', bumpScale: 0.045, roughness: 0.55 });

  const bottom = new THREE.Mesh(new THREE.CapsuleGeometry(rBottom, 0.14, 4, 12), mat);
  bottom.position.y = rBottom + 0.03;
  group.add(bottom);

  const top = new THREE.Mesh(new THREE.CapsuleGeometry(rTop, 0.08, 4, 12), mat);
  top.position.y = bottom.position.y + rBottom + rTop - 0.05;
  group.add(top);

  // Mucoid capsule shell — the real biology: a translucent slime coat.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(rTop * 1.35, 12, 12),
    new THREE.MeshPhysicalMaterial({ color: 0xffe0ea, transparent: true, opacity: 0.28, roughness: 0.15, clearcoat: 1 })
  );
  shell.position.y = top.position.y;
  shell.scale.set(1, 1.25, 1);
  group.add(shell);

  const faceY = top.position.y + rTop * 0.15;
  addEyes(group, rTop, rTop * 1.05, 0.55, { baseY: faceY, eyeScale: 0.4 });
  addMouth(group, rTop, new THREE.Vector3(0, faceY - rTop * 0.55, rTop * 1.15), { open: 1 });
  addHandNubs(group, rTop, new THREE.Vector3(0, faceY - rTop * 0.2, rTop * 0.8), species.dark);
  group.userData.eyeBaseY = faceY;
}

function buildPseudomonas(group, species) {
  const r = 0.19, len = 0.5;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), bodyMaterial(species.color, { skin: 'fuzzy', bumpScale: 0.018, roughness: 0.4 }));
  body.rotation.z = Math.PI / 2;
  body.position.y = r + 0.04;
  group.add(body);

  const tailOrigin = new THREE.Vector3(-(len / 2 + r), r + 0.04, 0);
  addPolarFlagella(group, 4, tailOrigin, new THREE.Vector3(-1, -0.1, 0), 0.55);

  addEyes(group, r, r * 1.1, 0.55, { baseY: body.position.y + r * 0.25 });
  addMouth(group, r, new THREE.Vector3(r * 0.1, body.position.y - r * 0.4, r * 1.05), { open: 0.5 });
  group.userData.eyeBaseY = r + 0.04;
}

function buildAcinetobacter(group, species) {
  const r = 0.3;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.75, r * 0.5, 6, 12), bodyMaterial(species.color, { skin: 'fuzzy', bumpScale: 0.025, roughness: 0.5 }));
  body.rotation.z = Math.PI / 2;
  body.position.y = r * 0.75 + 0.03;
  group.add(body);

  addPili(group, 26, r * 0.8, species.dark);
  addEyes(group, r, r * 0.95, 0.5, { baseY: body.position.y + r * 0.15, eyeScale: 0.36, tears: true });
  addMouth(group, r, new THREE.Vector3(0, body.position.y - r * 0.15, r * 0.85), { open: 0.75 });
  group.userData.eyeBaseY = body.position.y;
}

function buildEnterobacter(group, species) {
  const r = 0.2, len = 0.48;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), bodyMaterial(species.color, { skin: 'smooth', bumpScale: 0.022, roughness: 0.4, clearcoat: 0.65 }));
  body.rotation.z = Math.PI / 2;
  body.position.y = r + 0.04;
  group.add(body);

  addPeritrichousFlagella(group, 9, r + 0.06, 0.3);
  addDroplets(group, r + 0.05, 6);
  addEyes(group, r, r * 1.15, 0.58, { baseY: body.position.y + r * 0.32 });
  addMouth(group, r, new THREE.Vector3(0, body.position.y - r * 0.3, r * 1.1), { open: 0.55 });
  group.userData.eyeBaseY = r + 0.04;
}
