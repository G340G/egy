import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

// ---- v3.2 shared state: declared before any zone is built ----
const lowFx = new URLSearchParams(location.search).has('lowfx');
const candles = [], rituals = [], tools = new Set(), seenMissions = new Set(), chapterCardsShown = new Set();
let HEAD_TEX = null, JUMP_URL = null, PAINT_TEX = {}, atmo = { zone: null, nodes: [], timers: [], gain: null }, zoomPulse2 = 0;
const CHOICE_EFFECTS = {
  ines:['good:map','bad:jumpscare'],
  'father remo':['bad:closer','good:health'],
  'don remo':['bad:closer','good:health'],
  'the widow':['bad:trip','good:key'],
  'la vedova':['bad:trip','good:key'],
  ottavio: ['bad:trip', 'good:health'],
  sergio: ['good:key', 'bad:closer'],
  dario: ['good:health', 'bad:jumpscare'],
  anna: ['good:map', 'bad:closer']
};
const camDir2 = new THREE.Vector3();
let bokeh = null, zoomPulse = 0, presence = 0, presenceWarned = false, nearFlag = false, beatTimer = 0;
let stalker = null, stalkerZone = null, digEntry = null, digProgress = 0, digDone = false, candlesLit = 0;
let narrationTimer = null, rightMouse = false;
let darkroomHunt={active:false,elapsed:0,reappear:0,lastFlash:0,warning:0};
const relics = new Set(), eggs = [];
const storyRef = {}, rigs = [], emitters = [];
let storyScene = null, pendingCar = false, chaseState = null, industryT = 0, SOFT_TEX = null;
const RELIC_COUNT = 9;
// Bacon-style grade: umber shadows, desaturation, radial smear and vignette.
const BaconShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grade: { value: 0.6 }, smear: { value: 0.05 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time; uniform float grade; uniform float smear;
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 uv = vUv + c * smear * r * r;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 umber = mix(vec3(l), col, 0.45) * vec3(1.06, 0.9, 0.74);
      vec3 shadow = vec3(0.20, 0.03, 0.03);
      col = mix(col, umber, grade * 0.65);
      col = mix(col, shadow, (1.0 - l) * grade * 0.30);
      float vig = smoothstep(0.92, 0.22, r);
      col *= mix(1.0, vig, grade * 0.7);
      col *= 0.985 + 0.015 * sin(time * 23.0);
      gl_FragColor = vec4(col, 1.0);
    }`
};

// -----------------------------------------------------------------------------
// EPISTASSI — a self-contained, procedural first-person investigation.
// All environments, textures, props, characters and sound are generated locally.
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const clock = new THREE.Clock();
const collected = new Set();
const journal = [];
const clueCount = 8;
let currentZone = 'road';
let activeTarget = null;
let dialogueOpen = false;
let journalOpen = false;
let gameStarted = false;
let gameEnded = false;
let doorTransitioning = false;
let listeningPending = false;
let flashlightOn = true;
let audio = null;
let muted = false;
let elapsed = 0;
let dread = 0.12;
let glitchPulse = 0;
let toastTimer = null;
let fear = 0.12;
let eventClock = 0, scenePlayed = false, hiddenBreath = false;
// The thirteen are not background decoration: every one has a scripted fate.
const cultRoster = [];
const cultFateQueue = [];
let cultFateActive = null;
let cultFateClock = 0;
let cultFateCooldown = 0;
const storyFlags = new Set();
const windTrees = [];
const cropPlants = [];
const leafSpecks = [];
let dayNightBlend = 0;
let lastDayAnnouncement = '';

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  const fatal = $('fatal');
  fatal.textContent = `WEBGL IS UNAVAILABLE.\nOpen the game in an up-to-date desktop browser with hardware acceleration enabled.\nDetails: ${error.message}`;
  fatal.classList.remove('hidden');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7b9b4);
scene.fog = new THREE.FogExp2(0xaeb2af, 0.018);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 190);
camera.position.set(0, 1.63, 0);
// Pointer lock is a convenience for mouse-look, never a prerequisite for movement.
// Keep the player transform separate from the camera so cinematic camera offsets
// cannot move the actual player or interfere with collision detection.
const playerAnchor = new THREE.Group();
playerAnchor.name = 'PLAYER_POSITION';
scene.add(playerAnchor);
playerAnchor.add(camera);
camera.rotation.order = 'YXZ';
const controls = new PointerLockControls(camera, canvas);

const zones = {};
let zone = null;
const forward = new THREE.Vector3();
const cameraWorld = new THREE.Vector3();
const targetVec = new THREE.Vector3();
const moveVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const wishVec = new THREE.Vector3();
const velocity = new THREE.Vector3();
const keys = new Set();

// A subtle custom post-process: analogue grain, RGB drift and horizontal tearing.
const GlitchShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, strength: { value: 0.12 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time; uniform float strength;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv=vUv;
      float row=floor(uv.y*190.0);
      float tear=step(0.992,hash(vec2(row,floor(time*7.0))))*strength;
      uv.x += (hash(vec2(row,time))-0.5)*tear*0.13;
      float chroma=(hash(vec2(floor(uv.y*90.0),floor(time*3.0)))-0.5)*0.003*strength;
      vec4 r=texture2D(tDiffuse,uv+vec2(chroma,0.0));
      vec4 g=texture2D(tDiffuse,uv);
      vec4 b=texture2D(tDiffuse,uv-vec2(chroma,0.0));
      vec3 col=vec3(r.r,g.g,b.b);
      float grain=(hash(uv*vec2(900.0,650.0)+time*13.0)-0.5)*0.075*strength;
      col += grain;
      float scan=sin(uv.y*920.0)*0.012*strength;
      col -= scan;
      gl_FragColor=vec4(col,1.0);
    }`
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
if (!lowFx) { bokeh = new BokehPass(scene, camera, { focus: 4.5, aperture: 0.00016, maxblur: 0.0045 }); composer.addPass(bokeh); }
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.62, 0.78);
composer.addPass(bloom);
const glitchPass = new ShaderPass(GlitchShader);
composer.addPass(glitchPass);
const baconPass = new ShaderPass(BaconShader);
composer.addPass(baconPass);

// -----------------------------------------------------------------------------
// Procedural materials and geometry
// -----------------------------------------------------------------------------
function noiseTexture(kind = 'plaster', seed = 1, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const base = kind === 'concrete' ? [93, 96, 91] : kind === 'wood' ? [69, 52, 38] : kind === 'rust' ? [82, 49, 37] : [112, 112, 103];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (rand() - 0.5) * (kind === 'wood' ? 52 : 72);
      const streak = kind === 'wood' ? Math.sin(y * 0.11 + rand() * 3) * 12 : 0;
      const stain = (rand() > 0.992 ? -40 : 0) + (rand() > 0.997 ? 34 : 0);
      img.data[i] = Math.max(0, Math.min(255, base[0] + n + streak + stain));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] + n + streak * 0.75 + stain));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] + n + streak * 0.5 + stain));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Layered damp blooms, mineral tide marks and soot: deliberately irregular, never clean tiling.
  for(let k=0;k<95;k++){const x=rand()*size,y=rand()*size,r=2+rand()*30;ctx.beginPath();ctx.fillStyle=`rgba(${kind==='rust'?68:24},${kind==='rust'?34:29},${kind==='rust'?20:24},${.025+rand()*.075})`;ctx.ellipse(x,y,r,r*(.25+rand()),rand()*3.14,0,Math.PI*2);ctx.fill();}
  for(let k=0;k<700;k++){const x=rand()*size,y=rand()*size;ctx.fillStyle=rand()>.5?'rgba(8,9,8,.16)':'rgba(205,198,177,.08)';ctx.fillRect(x,y,1+rand()*2,1+rand()*2);}
  // Fine cracks, plaster scars and wood grain are baked into the albedo.
  if (kind !== 'wood') {
    ctx.globalAlpha = 0.23; ctx.strokeStyle = '#151513'; ctx.lineWidth = 1;
    for (let n = 0; n < 22; n++) {
      let x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rand() - 0.5) * 26; y += 5 + rand() * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#d2b48d';
    for (let i = 0; i < 35; i++) { const y = rand() * size; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(size * .3, y - 8, size * .6, y + 12, size, y + rand() * 6); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function brickTexture(seed = 211, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  x.fillStyle = '#292824'; x.fillRect(0, 0, size, size);
  const brickW = 92, brickH = 37, mortar = 6;
  for (let row = 0; row < Math.ceil(size / (brickH + mortar)); row++) {
    const offset = row % 2 ? -brickW / 2 : 0;
    for (let col = -1; col < Math.ceil(size / brickW) + 1; col++) {
      const xx = col * brickW + offset + mortar / 2, yy = row * (brickH + mortar) + mortar / 2;
      const tone = Math.floor(55 + rand() * 42);
      x.fillStyle = `rgb(${tone+27},${tone+7},${tone-3})`;
      x.fillRect(xx, yy, brickW - mortar, brickH - mortar);
      x.fillStyle = 'rgba(7,8,7,.26)'; x.fillRect(xx, yy + brickH - mortar - 3, brickW - mortar, 3);
      x.fillStyle = 'rgba(202,174,143,.10)'; x.fillRect(xx + 4, yy + 3, brickW - mortar - 8, 2);
      for (let n=0;n<9;n++) { x.fillStyle = rand()>.5?'rgba(8,8,7,.15)':'rgba(220,190,150,.07)'; x.fillRect(xx+rand()*(brickW-mortar),yy+rand()*(brickH-mortar),1+rand()*5,1+rand()*2); }
    }
  }
  for (let i=0;i<600;i++) { x.fillStyle=rand()>.5?'rgba(0,0,0,.12)':'rgba(200,190,170,.06)'; x.fillRect(rand()*size,rand()*size,1+rand()*3,1+rand()*2); }
  const t = new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; t.repeat.set(2.4,1.1); return t;
}
const TEX = {
  concrete: noiseTexture('concrete', 17), plaster: photoTexture('assets/textures/plaster-wall.jpg', 1.2), wood: photoTexture('assets/textures/wood-planks.jpg', 1.1),
  rust: rustTexture(), road: noiseTexture('concrete', 107), brick: brickTexture(), grass: grassTexture(), metal: metalTexture()
};

// Archival photo fragments: Wikimedia Commons files marked public domain / PD-Art.
// The browser loads these at runtime; the images are not copied into the repository.
const PHOTO_ARCHIVE = {
  oldman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/17/Old_man_sitting_portrait.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Old_man_sitting_portrait.jpg',
    credit: 'Charles R. Savage / Harold B. Lee Library collection; public-domain photograph (photographer died 1909).',
    face: [.415,.205,.205,.185], mode: 'dark'
  },
  woman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Portrait_of_a_woman_seated%2C_ca_1900_%28BOYD%2BBRAAS_152%29.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Portrait_of_a_woman_seated,_ca_1900_(BOYD+BRAAS_152).jpg',
    credit: 'George H. Braas, ca. 1900; public domain (photographer died 1914).',
    face: [.365,.105,.285,.205], mode: 'light'
  },
  elder: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Photograph_of_an_unknown_elderly_woman_seated_in_a_chair%2C_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Photograph_of_an_unknown_elderly_woman_seated_in_a_chair,_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    credit: 'Unknown photographer, 8 July 1915; DPLA / Wikimedia Commons, public domain in the United States.',
    face: [.385,.285,.235,.155], mode: 'light'
  },
  roomwoman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Charles_Henry_Currier_01945v.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Charles_Henry_Currier_01945v.jpg',
    credit: 'Charles Henry Currier, ca. 1890–1900; Library of Congress source, public-domain photograph.',
    face: [.495,.385,.095,.155], mode: 'light'
  },
  man: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    credit: 'Library of Congress, LCCN 2006689630; 19th-century portrait, public domain / no known publication restrictions.',
    face: [.415,.265,.185,.16], mode: 'light'
  }
};
const PHOTO_IMAGES = {};
const photoNPCs = [];
const evidenceRefreshers = [];
function makeFaceCanvas(image, spec) {
  const c=document.createElement('canvas'); c.width=256; c.height=320; const ctx=c.getContext('2d');
  const [x,y,w,h]=spec.face; ctx.save(); ctx.filter='grayscale(100%) contrast(1.28) brightness(.86) sepia(12%)';
  ctx.drawImage(image,x*image.width,y*image.height,w*image.width,h*image.height,0,0,256,320); ctx.restore();
  const d=ctx.getImageData(0,0,256,320);
  for(let i=0;i<d.data.length;i+=4){ const l=(d.data[i]+d.data[i+1]+d.data[i+2])/3; const v=Math.max(0,Math.min(1,(l-18)/220)); d.data[i]=Math.min(255,d.data[i]*.88+20); d.data[i+1]=Math.min(255,d.data[i+1]*.83+13); d.data[i+2]=Math.min(255,d.data[i+2]*.78+7); d.data[i+3]=Math.round(255*Math.min(1,v*1.7)); }
  ctx.putImageData(d,0,0); ctx.globalCompositeOperation='destination-in'; ctx.beginPath(); ctx.ellipse(128,160,119,153,0,0,Math.PI*2); ctx.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
}
function refreshPhotoNPC(npc){const key=npc.photoKey,image=PHOTO_IMAGES[key];if(!image)return;const spec=PHOTO_ARCHIVE[key];try{const face=makeFaceCanvas(image,spec);npc.photoFace.material.map?.dispose?.();npc.photoFace.material.map=face;npc.photoFace.material.needsUpdate=true;npc.photoFace.visible=!npc.isFirst;}catch(err){npc.photoFace.visible=false;console.warn('Could not crop archival face:',key,err);}}

function profileForNPC(name,variant){
 const n=(name||'').toLowerCase();
 if(['ines','anna','marta','vanda','ada','mirella','teresa','livia','woman by the canal','the widow'].some(v=>n.includes(v)))return 'woman';
 if(n.includes('father remo')||n.includes('don remo')||n.includes('the first')||n.includes('the first')||n.includes('dario')||n.includes('sergio')||n.includes('pino')||n.includes('franco')||n.includes('walter')||n.includes('gabri')||n.includes('elio'))return 'man';
 if(n.includes('ottavio')||n.includes('the coat')||n.includes('the coat'))return 'oldman';
 return variant===0?'woman':'oldman';
}

Object.entries(PHOTO_ARCHIVE).forEach(([key,spec])=>{
  const img=new Image(); img.crossOrigin='anonymous'; img.decoding='async';
  img.onload=()=>{PHOTO_IMAGES[key]=img; photoNPCs.filter(n=>n.photoKey===key).forEach(refreshPhotoNPC); evidenceRefreshers.forEach(fn=>fn());};
  img.onerror=()=>console.warn('Archival photo could not be loaded:', key, spec.url);
  img.src=spec.url;
} );
function mat(color, rough = .92, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: options.metalness ?? 0.02, map: options.map || null, bumpMap: options.map || null, bumpScale: options.bumpScale ?? 0.075,
    emissive: options.emissive || 0x000000, emissiveIntensity: options.emissiveIntensity || 0, side: options.side || THREE.FrontSide });
}
const M = {
  grass: mat(0x6b7a44, 1, { map: TEX.grass }), ground: mat(0x777b73, 1, { map: TEX.concrete }), asphalt: mat(0x343a38, 1, { map: TEX.road }), wall: mat(0x77756a, 1, { map: TEX.plaster }),
  darkWall: mat(0x5a5b55, 1, { map: TEX.plaster }), wood: mat(0x554332, 1, { map: TEX.wood }), darkWood: mat(0x2b241d, 1, { map: TEX.wood }),
  rust: mat(0x634033, 1, { map: TEX.rust }), brick: mat(0x76513e, 1, { map: TEX.brick }), black: mat(0x101210, 1), metal: mat(0x4a4e4c, .62, { metalness: .5, map: TEX.metal }),
  skin: mat(0x655b51, 1, { map: TEX.plaster, bumpScale: .035 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9aa4a0, roughness: .22, metalness: .15, transparent: true, opacity: .23 }),
  blood: mat(0x3b090b, .5, { emissive: 0x250000, emissiveIntensity: .24 }),
  gold: mat(0x8c7148, .5, { metalness: .62 }),
  warmLight: mat(0x332112, .35, { emissive: 0xffb65c, emissiveIntensity: 2.4 }),
  clue: mat(0x9e8152, .65, { emissive: 0x6e4c27, emissiveIntensity: .48 })
};
function addBox(group, x, y, z, w, h, d, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = options.castShadow !== false; mesh.receiveShadow = options.receiveShadow !== false;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.name) mesh.name = options.name;
  group.add(mesh); return mesh;
}
function addPlane(group, x, y, z, w, h, material, rotation = [-Math.PI / 2, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material); mesh.position.set(x, y, z); mesh.rotation.set(...rotation); mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function addLight(group, color, intensity, distance, x, y, z, options = {}) {
  const light = new THREE.PointLight(color, intensity, distance, options.decay || 2);
  light.position.set(x, y, z); light.castShadow = !!options.shadow; group.add(light); return light;
}
function addFog(group, count, span, color = 0xd6d9d6, seed = 10) {
  const fogGroup = new THREE.Group(); group.add(fogGroup);
  const texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 128;
  const ctx = texCanvas.getContext('2d'); const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,.82)'); grad.addColorStop(.48, 'rgba(255,255,255,.24)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const fogTex = new THREE.CanvasTexture(texCanvas);
  const fogMaterial = new THREE.SpriteMaterial({ map: fogTex, color, transparent: true, opacity: .10, depthWrite: false });
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(fogMaterial);
    sprite.position.set((rand() - .5) * span, .4 + rand() * 4.2, (rand() - .5) * span);
    const sc = 9 + rand() * 24; sprite.scale.set(sc * (1.2 + rand()), sc * .58, 1); sprite.userData.phase = rand() * 6.28; fogGroup.add(sprite);
  }
  return fogGroup;
}
function makeLabelTexture(text, width = 512, height = 128) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; const x = c.getContext('2d');
  x.fillStyle = '#d2c8b3'; x.fillRect(0, 0, width, height); x.fillStyle = 'rgba(35,31,25,.16)';
  for (let i = 0; i < 2500; i++) { x.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 3, 1); }
  x.fillStyle = '#282722'; x.font = '22px monospace'; x.textAlign = 'center'; x.fillText(text, width / 2, height / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeEvidenceCanvas(title, id, imageKey='oldman') {
  const c=document.createElement('canvas'); c.width=512; c.height=352; const ctx=c.getContext('2d');
  const draw=()=>{
    ctx.fillStyle='#b6a98e';ctx.fillRect(0,0,512,352);ctx.fillStyle='#27241e';ctx.fillRect(10,10,492,332);
    ctx.fillStyle='#c9bda2';ctx.fillRect(17,17,478,318);ctx.fillStyle='#24231f';ctx.font='bold 19px monospace';ctx.fillText('ARCHIVIO 14-B   /   ' + id.toUpperCase(),30,45);
    ctx.fillStyle='#39352e';ctx.font='16px serif';ctx.fillText(title.toUpperCase(),30,72);
    const img=PHOTO_IMAGES[imageKey];
    if(img){const ar=img.width/img.height;let sw=img.width,sh=img.height;if(ar>1.55){sw=img.height*1.55; }else if(ar<.64){sh=img.width/.64;} const sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.save();ctx.filter='grayscale(100%) sepia(18%) contrast(1.2)';ctx.drawImage(img,sx,sy,sw,sh,30,88,205,190);ctx.restore();}
    else {ctx.fillStyle='#655b4b';ctx.fillRect(30,88,205,190);ctx.strokeStyle='#27241e';ctx.lineWidth=2;for(let i=0;i<7;i++){ctx.beginPath();ctx.moveTo(34,100+i*25);ctx.lineTo(230,96+i*25);ctx.stroke();}}
    ctx.fillStyle='#3d392f';ctx.font='14px monospace';ctx.fillText('UNDEVELOPED NEGATIVE',256,113);ctx.fillText('TIME: 03:17',256,143);ctx.fillText('DAMAGED EMULSION',256,173);
    ctx.strokeStyle='#29251f';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(256,200+i*12);ctx.lineTo(470-(i%3)*25,200+i*12);ctx.stroke();}
    ctx.fillStyle='rgba(50,35,25,.45)';ctx.font='italic 18px serif';ctx.fillText('do not look for too long',30,312);
    for(let i=0;i<1400;i++){ctx.fillStyle=Math.random()>.5?'rgba(25,20,12,.09)':'rgba(255,255,255,.10)';ctx.fillRect(Math.random()*512,Math.random()*352,1+Math.random()*2,1);}
  };draw();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  evidenceRefreshers.push(()=>{draw();t.needsUpdate=true;});return t;
}
function addClueMesh(group, pos, title, description, id, kind = 'paper', options = {}) {
  const root = new THREE.Group(); root.position.copy(pos); group.add(root); let object;
  const imageKey=({clipping:'oldman',mass:'elder',photo:'man',voicemail:'woman'})[id]||'oldman';
  if (kind === 'paper') {
    object = new THREE.Mesh(new THREE.PlaneGeometry(.62, .43), new THREE.MeshStandardMaterial({ map: makeEvidenceCanvas(title,id,imageKey), side: THREE.DoubleSide, roughness: .96 }));
    object.rotation.x = -Math.PI / 2; object.rotation.z = -.12; object.position.y = .065;
    const curled=addBox(root,.28,.06,.17,.055,.018,.34,M.wood,{rotation:[0,0,.12],castShadow:false});
  } else if (kind === 'metal') {
    object = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .55, 16), M.gold); object.rotation.z = Math.PI / 2; object.position.y = .16;
    const tag=new THREE.Mesh(new THREE.PlaneGeometry(.28,.19),new THREE.MeshBasicMaterial({map:makeEvidenceCanvas(title,id,imageKey),side:THREE.DoubleSide}));tag.position.set(0,.23,.13);root.add(tag);
  } else {
    object = new THREE.Mesh(new THREE.BoxGeometry(.34, .07, .25), M.wood); object.position.y = .06;
    const plate=new THREE.Mesh(new THREE.PlaneGeometry(.36,.25),new THREE.MeshBasicMaterial({map:makeEvidenceCanvas(title,id,imageKey),side:THREE.DoubleSide}));plate.rotation.x=-Math.PI/2;plate.position.y=.105;root.add(plate);
  }
  root.add(object);
  const glow = new THREE.PointLight(0xd5b27b, .23, 2.5); glow.position.y = .5; root.add(glow);
  const entry = { id, type: 'clue', object: root, point: root.position, radius: 3.0, prompt: `[ E ] COLLECT — ${title.toUpperCase()}`, title, description, kind, ...options };
  group.userData.interactables.push(entry); return root;
}
function makeNPC(group,x,z,name,coatColor=0x272725,variant=0){
 const root=new THREE.Group();root.position.set(x,0,z);group.add(root);
 const lower=(name||'').toLowerCase(),profile=profileForNPC(name,variant);
 const female=profile==='woman',elder=profile==='oldman'||profile==='elder',first=lower==='the first'||lower==='the first',isFirst=first;
 const skin=mat([0x88735f,0x9b826d,0x716052,0x8d7a68,0x6b5c51][(name||'').length%5],.96,{map:TEX.plaster,bumpScale:.022});
 const cloth=mat(coatColor,1,{map:TEX.wood,bumpScale:.045}),trim=mat(first?0x1d1b18:(variant===0?0x39352e:0x292b28),1,{map:TEX.wood});
 const hairColor=elder?0x77736b:(female?0x211c19:0x26221e),hair=mat(hairColor,1,{map:TEX.wood,bumpScale:.02});
 const boot=mat(0x211f1b,.95,{map:TEX.wood}),faceShadow=mat(0x211b18,.96);
 const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.285,.66,7,14),cloth);torso.position.set(first?.045:0,1.02,0);torso.scale.set(first?1.12:1,1,.76);torso.rotation.z=first?-.075:0;torso.castShadow=true;root.add(torso);
 const chest=new THREE.Mesh(new THREE.SphereGeometry(.285,14,10),cloth);chest.position.set(first?.05:0,1.40,0);chest.scale.set(1.12,.56,.8);root.add(chest);
 const waist=new THREE.Mesh(new THREE.CylinderGeometry(.19,.235,.38,12),cloth);waist.position.y=.70;root.add(waist);
 const neck=new THREE.Mesh(new THREE.CylinderGeometry(.073,.087,.23,10),skin);neck.position.y=1.64;root.add(neck);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.205,20,16),skin);head.position.set(first?-.055:0,1.91,.012);head.scale.set(first?.76:.84,1.04,.88);head.rotation.z=first?-.16:(Math.random()-.5)*.045;root.add(head);
 const jaw=new THREE.Mesh(new THREE.SphereGeometry(.14,14,10),skin);jaw.position.set(first?-.055:0,1.79,.085);jaw.scale.set(.82,.57,.88);root.add(jaw);
 const nose=new THREE.Mesh(new THREE.ConeGeometry(.042,.10,7),skin);nose.rotation.x=Math.PI/2;nose.position.set(first?-.055:0,1.88,.194);root.add(nose);
 const mouth=new THREE.Mesh(new THREE.BoxGeometry(.075,.012,.012),faceShadow);mouth.position.set(first?-.055:0,1.81,.205);root.add(mouth);
 const eyeMat=mat(0xbab0a0,.74),pupilMat=mat(0x171513,.45),eyes=[],lids=[];
 for(const side of [-1,1]){
  const ex=(first?-.055:0)+side*.073;
  const eye=new THREE.Mesh(new THREE.SphereGeometry(.022,10,8),eyeMat);eye.position.set(ex,1.935,.174);root.add(eye);
  const pupil=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),pupilMat);pupil.position.set(ex,1.934,.193);root.add(pupil);
  const brow=new THREE.Mesh(new THREE.CapsuleGeometry(.012,.065,3,5),hair);brow.position.set(ex,1.972,.174);brow.rotation.z=side*.1;root.add(brow);
  const lid=new THREE.Mesh(new THREE.SphereGeometry(.033,9,7),hair);lid.scale.set(1,.08,.28);lid.position.set(ex,1.955,.178);root.add(lid);eyes.push(eye,pupil);lids.push(lid);
  const ear=new THREE.Mesh(new THREE.SphereGeometry(.052,8,7),skin);ear.scale.set(.48,1,.54);ear.position.set((first?-.055:0)+side*.19,1.90,.005);root.add(ear);
 }
 const cap=new THREE.Mesh(new THREE.SphereGeometry(.205,16,10),hair);cap.position.set(first?-.065:0,2.035,-.018);cap.scale.set(.92,.51,.98);root.add(cap);
 if(female){
  const back=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.40,5,8),hair);back.position.set(0,1.69,-.105);back.scale.set(1.08,1.15,.58);root.add(back);
  for(const side of [-1,1]){const lock=new THREE.Mesh(new THREE.CapsuleGeometry(.043,.34,4,7),hair);lock.position.set(side*.15,1.72,.005);lock.rotation.z=side*.10;root.add(lock);const fringe=new THREE.Mesh(new THREE.SphereGeometry(.09,10,7),hair);fringe.position.set(side*.075,2.00,.12);fringe.scale.set(1,.46,.64);root.add(fringe);}
 }else{
  for(const side of [-1,1]){const sideburn=new THREE.Mesh(new THREE.CapsuleGeometry(.032,.13,3,6),hair);sideburn.position.set(side*.17,1.93,.04);root.add(sideburn);}
  if(elder){const grey=new THREE.Mesh(new THREE.SphereGeometry(.105,9,7),mat(0xaaa397,.98));grey.scale.set(1,.34,.7);grey.position.set(.11,2.04,-.015);root.add(grey);}
 }
 const photoMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.84,side:THREE.DoubleSide,depthWrite:false});
 const photoKey=profile==='woman'?'woman':profile==='oldman'?'oldman':'man';
 const photoFace=new THREE.Mesh(new THREE.PlaneGeometry(.23,.285),photoMat);photoFace.position.set(first?-.055:0,1.91,.205);photoFace.visible=false;root.add(photoFace);
 const mask=new THREE.Mesh(new THREE.BoxGeometry(.25,.06,.025),trim);mask.position.set(first?-.055:0,1.91,.205);mask.visible=false;root.add(mask);
 const leftArm=new THREE.Group();leftArm.position.set(first?-.39:-.31,1.43,0);root.add(leftArm);
 const rightArm=new THREE.Group();rightArm.position.set(first?.42:.31,1.43,0);root.add(rightArm);
 function makeArm(pivot,side){
  const upper=new THREE.Mesh(new THREE.CapsuleGeometry(.074,.34,5,9),cloth);upper.position.y=-.20;upper.rotation.z=side*-.035;pivot.add(upper);
  const elbow=new THREE.Mesh(new THREE.SphereGeometry(.071,8,7),skin);elbow.position.y=-.40;pivot.add(elbow);
  const forearm=new THREE.Group();forearm.position.y=-.40;pivot.add(forearm);
  const sleeve=new THREE.Mesh(new THREE.CapsuleGeometry(.063,.29,5,8),cloth);sleeve.position.y=-.18;forearm.add(sleeve);
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.066,.066,.06,8),trim);cuff.position.y=-.35;forearm.add(cuff);
  const palm=new THREE.Mesh(new THREE.SphereGeometry(.061,9,7),skin);palm.scale.set(.82,1.1,.72);palm.position.set(0,-.405,.025);forearm.add(palm);
  for(let i=0;i<4;i++){const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.012,.07,3,5),skin);finger.position.set((i-1.5)*.025,-.48,.062);finger.rotation.z=(i-1.5)*.10;forearm.add(finger);}
  const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.014,.06,3,5),skin);thumb.position.set(side*.07,-.43,.04);thumb.rotation.z=side*-.55;forearm.add(thumb);return forearm;
 }
 const leftForearm=makeArm(leftArm,-1),rightForearm=makeArm(rightArm,1);
 const legs=[],lowerLegs=[],shoes=[];
 for(const side of [-1,1]){
  const hip=new THREE.Group();hip.position.set(side*.14,.68,0);root.add(hip);
  const thigh=new THREE.Mesh(new THREE.CapsuleGeometry(.093,.34,5,9),trim);thigh.position.y=-.20;hip.add(thigh);
  const knee=new THREE.Mesh(new THREE.SphereGeometry(.07,8,7),trim);knee.position.y=-.40;hip.add(knee);
  const calf=new THREE.Group();calf.position.y=-.40;hip.add(calf);
  const shin=new THREE.Mesh(new THREE.CapsuleGeometry(.066,.31,5,8),trim);shin.position.y=-.19;calf.add(shin);
  const shoe=new THREE.Mesh(new THREE.BoxGeometry(.18,.095,.31),boot);shoe.position.set(0,-.39,.075);calf.add(shoe);
  const sole=new THREE.Mesh(new THREE.BoxGeometry(.19,.025,.32),M.black);sole.position.set(0,-.44,.075);calf.add(sole);
  legs.push(hip);lowerLegs.push(calf);shoes.push(shoe);
 }
 const collar=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.31,3,6),trim);collar.position.set(0,1.56,.025);collar.rotation.z=Math.PI/2;root.add(collar);
 for(let i=0;i<4;i++){const button=new THREE.Mesh(new THREE.SphereGeometry(.017,6,5),M.gold);button.position.set(.035,1.34-i*.19,.235);root.add(button);}
 if(female){const shawl=new THREE.Mesh(new THREE.BoxGeometry(.45,.16,.07),mat(0x5a5146,.98));shawl.position.set(0,1.35,.20);shawl.rotation.z=-.07;root.add(shawl);if(lower.includes('anna')||lower.includes('mirella')){const apron=new THREE.Mesh(new THREE.BoxGeometry(.32,.48,.04),mat(0x4d3830,.99));apron.position.set(0,.94,.225);root.add(apron);}}
 else{const vest=new THREE.Mesh(new THREE.BoxGeometry(.20,.38,.045),trim);vest.position.set(0,1.37,.20);root.add(vest);if(elder){const glasses=mat(0x28251f,.52,{metalness:.35});for(const side of [-1,1]){const lens=new THREE.Mesh(new THREE.TorusGeometry(.048,.008,5,14),glasses);lens.position.set(side*.073,1.94,.192);root.add(lens);}const bridge=new THREE.Mesh(new THREE.BoxGeometry(.07,.01,.01),glasses);bridge.position.set(0,1.94,.19);root.add(bridge);}}
 if(first){
  leftArm.position.y+=.11;leftArm.rotation.z=-.24;rightArm.position.y-=.045;rightArm.rotation.z=.14;rightForearm.rotation.z=-.28;leftForearm.rotation.z=.10;
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.20,10,8),trim);shoulder.position.set(-.35,1.49,.015);shoulder.scale.set(1.15,.58,.78);root.add(shoulder);
  const lapel=new THREE.Mesh(new THREE.BoxGeometry(.11,.65,.06),M.darkWood);lapel.position.set(-.16,1.25,.235);lapel.rotation.z=.32;root.add(lapel);
  const seam=new THREE.Mesh(new THREE.CylinderGeometry(.012,.02,.52,5),M.rust);seam.position.set(.25,.72,.19);seam.rotation.z=-.18;root.add(seam);
  root.rotation.z=-.025;root.scale.set(1.04,1.08,.94);
 }
 const npc={head,id:'npc_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),type:'npc',object:root,point:root.position,radius:3.4,prompt:'[ E ] SPEAK — '+name.toUpperCase(),name,phase:Math.random()*7,coat:cloth,leftArm,rightArm,photoFace,photoKey,leftForearm,rightForearm,legs,lowerLegs,shoes,eyes,lids,blinkTimer:1.8+Math.random()*4,blinkAmount:0,walking:false,cultist:false,fate:'present',profile,isFirst};
 photoNPCs.push(npc);refreshPhotoNPC(npc);group.userData.interactables.push(npc);return npc;
}

function registerCultist(npc, dialogue=null) {
  npc.cultist=true; npc.fate='present'; npc.object.userData.cultist=true;
  if(dialogue) npc.dialogue=dialogue;
  cultRoster.push(npc); return npc;
}
function addCultist(zone, x, z, name, coat=0x34332f, variant=0, line='We are not here to listen. We are here to make room.', choices=['What are you waiting for?','Who called you here?'], replies=['The moment someone stops having a name.','The room was already full before we arrived.']) {
  const npc=makeNPC(zone.group,x,z,name,coat,variant);
  npc.dialogue={line,choices,replies}; return registerCultist(npc);
}
function isProgressCriticalCultist(npc){const name=(npc?.name||'').toLowerCase();return ['ines','ottavio','pino'].includes(name);}
function queueCultFate(source='a trace', preferred=null, mode=null) {
  const npc=preferred || [...cultRoster].reverse().find(n=>n.fate==='present');
  if(!npc || npc.fate!=='present') return null;
  npc.fate='queued';cultFateQueue.push({npc,source,mode:mode||(cultFateQueue.length%3===1?'collapse':'vanish')});
  return npc;
}
function removeQueuedCultist(npc) {
  for(let i=cultFateQueue.length-1;i>=0;i--) if(cultFateQueue[i].npc===npc) cultFateQueue.splice(i,1);
}
function transferCultist(npc, targetZone, x, z) {
  if(!npc || !targetZone) return;
  const oldParent=npc.object.parent; if(oldParent) oldParent.remove(npc.object);
  npc.object.position.set(x,0,z);npc.point=npc.object.position;targetZone.group.add(npc.object);
  const old=Object.values(zones).find(v=>v.interactables.includes(npc)); if(old) old.interactables.splice(old.interactables.indexOf(npc),1);
  npc.object.visible=true;
}
function startCultFate(entry) {
  if(!entry || cultFateActive) return;
  const npc=entry.npc; npc.fate='in-progress';npc.object.visible=true;
  const oldZone=Object.values(zones).find(v=>v.interactables.includes(npc));if(oldZone){const index=oldZone.interactables.indexOf(npc);if(index>=0)oldZone.interactables.splice(index,1);}
  const playerAt=currentPosition().clone();
  controls.getDirection(forward);forward.y=0;forward.normalize();
  const side=new THREE.Vector3(-forward.z,0,forward.x).multiplyScalar((cultRoster.indexOf(npc)%3-1)*.72);
  // Every fate is staged in the player's forward field of view, even when
  // the cultist already belongs to the current room. This avoids off-screen
  // removals when a clue is collected near one of the thirteen.
  const sx=THREE.MathUtils.clamp(playerAt.x+forward.x*5.3+side.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  const sz=THREE.MathUtils.clamp(playerAt.z+forward.z*5.3+side.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  if(npc.object.parent!==zone.group) transferCultist(npc,zone,sx,sz);
  else npc.object.position.set(sx,0,sz);
  npc.point=npc.object.position;
  npc.object.lookAt(playerAt.x,0,playerAt.z);
  const approach=playerAt.clone().addScaledVector(forward,1.45).addScaledVector(side,.18);
  approach.x=THREE.MathUtils.clamp(approach.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  approach.z=THREE.MathUtils.clamp(approach.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  cultFateActive={...entry,phase:0,start:npc.object.position.clone(),target:approach,elapsed:0};
  showToast(entry.mode==='collapse'?`${npc.name.toUpperCase()} HAS STOPPED HOLDING THEMSELVES UP.`:`${npc.name.toUpperCase()} HAS LEFT THEIR PLACE.`);
  if(entry.mode==='collapse') speakVoice(`${npc.name}. There is nothing left to fill.`,npc.name);
  else speakVoice(`${npc.name}: do not remember my face.`,npc.name);
  glitchPulse=Math.max(glitchPulse,.85);audio?.killingAudio();
}
function updateCultSequence(dt,t) {
  if(cultFateActive){
    const a=cultFateActive,n=a.npc;a.elapsed+=dt;
    if(a.mode==='collapse'){
      const k=THREE.MathUtils.clamp(a.elapsed/1.55,0,1);n.object.rotation.x=THREE.MathUtils.lerp(0,1.43,k);n.object.rotation.z=Math.sin(k*2)*.18;n.object.position.y=-.18*k;
      n.object.position.x=a.start.x+Math.sin(k*4)*.08;
      if(k>=1&&a.elapsed>2.4){
        const stain=new THREE.Mesh(new THREE.CircleGeometry(.42,24),new THREE.MeshBasicMaterial({color:0x21090a,transparent:true,opacity:.55}));stain.rotation.x=-Math.PI/2;stain.position.set(n.object.position.x,.012,n.object.position.z);zone.group.add(stain);
        n.object.visible=false;n.fate='dead';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;
         const fallen=(n.name||'').toLowerCase();
         if(fallen==='ines'||(fallen==='ottavio'&&!collected.has('fork'))){
           triggerDeath(fallen==='ines'?'INES HAS BEEN KILLED':'OTTAVIO HAS BEEN KILLED',fallen==='ines'?'The Seating List can no longer be read. The house closes around the missing name. This is the end of the recording.':'The tuning fork can no longer be recovered. The sequence is broken, and the recording ends here.');
           return;
         }
      }
    }else{
      const k=THREE.MathUtils.clamp(a.elapsed/2.9,0,1);n.object.position.lerpVectors(a.start,a.target,k);n.walking=true;
      if(!n.object.userData.fadeMaterialsCloned){n.object.traverse(o=>{if(o.isMesh&&o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});n.object.userData.fadeMaterialsCloned=true;}
      n.object.traverse(o=>{if(o.isMesh&&o.material){const list=Array.isArray(o.material)?o.material:[o.material];list.forEach(m=>{if('opacity'in m){m.transparent=true;m.opacity=1-k*.98;}});}});
      if(k>=1){n.object.visible=false;n.walking=false;n.fate='gone';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;}
    }
  }
  cultFateCooldown=Math.max(0,cultFateCooldown-dt);
  if(!cultFateActive&&cultFateQueue.length&&cultFateCooldown<=0){
    const index=0;
    if(index<cultFateQueue.length){const [next]=cultFateQueue.splice(index,1);startCultFate(next);cultFateCooldown=listeningPending ? 0.48 : 3.8;}
  }
}
function scheduleCultSceneFates(count,source,mode='collapse') {
  const candidates=cultRoster.filter(n=>n.fate==='present'&&!isProgressCriticalCultist(n));
  for(let i=0;i<count&&i<candidates.length;i++) queueCultFate(source,candidates[i],(i%2===0)?mode:'vanish');
}
function addDoor(group,x,z,label,destination,spawn,locked=false,options={}){
  const root=new THREE.Group();root.position.set(x,0,z);root.rotation.y=options.rotationY??0;group.add(root);
  const roman=options.style==='roman',frame=roman?M.wall:M.darkWood,leafMat=locked?M.rust:M.wood;
  addBox(root,0,1.28,-.12,1.48,2.5,.11,M.black,{castShadow:false});
  addBox(root,-.72,1.28,.02,.20,2.56,.40,frame);addBox(root,.72,1.28,.02,.20,2.56,.40,frame);
  addBox(root,0,2.53,.02,1.72,.22,.42,frame);addBox(root,0,.12,.17,1.78,.22,.72,M.wall);
  const pivot=new THREE.Group();pivot.position.set(-.57,0,.12);root.add(pivot);
  const leaf=new THREE.Group();leaf.position.x=.57;pivot.add(leaf);
  const slab=addBox(leaf,0,1.15,.12,1.10,2.16,.095,leafMat);
  for(let i=0;i<6;i++)addBox(leaf,-.46+i*.184,1.15,.177,.168,2.10,.018,i%3===0?M.darkWood:leafMat,{castShadow:false});
  for(const yy of [.43,1.83]){
    addBox(leaf,0,yy,.205,1.06,.11,.045,M.darkWood);
    for(const side of [-1,1]){const rivet=new THREE.Mesh(new THREE.SphereGeometry(.032,8,6),M.rust);rivet.position.set(side*.46,yy,.235);leaf.add(rivet);}
  }
  addBox(leaf,-.02,1.14,.208,.075,1.35,.05,M.darkWood,{rotation:[0,0,-.20]});
  for(const yy of [.52,1.86])addBox(root,-.68,yy,.245,.22,.09,.07,M.rust);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.024,.024,.14,8),M.rust);stem.rotation.x=Math.PI/2;stem.position.set(.42,1.08,.25);leaf.add(stem);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.052,10,8),M.gold);knob.position.set(.42,1.08,.31);leaf.add(knob);
  if(roman){
    const stone=mat(0x89877d,.98,{map:TEX.concrete,bumpScale:.14});
    for(const s of [-1,1]){
      const col=new THREE.Mesh(new THREE.CylinderGeometry(.115,.17,2.75,12),stone);col.position.set(s*.99,1.42,.18);root.add(col);
      addBox(root,s*.99,.12,.18,.42,.22,.48,stone);addBox(root,s*.99,2.8,.18,.46,.24,.50,stone);
      addBox(root,s*.99,2.96,.18,.60,.11,.58,stone);
      const collar=new THREE.Mesh(new THREE.TorusGeometry(.14,.026,6,18),stone);collar.position.set(s*.99,2.65,.18);root.add(collar);
    }
    for(const r of [.82,1.02,1.21]){const arch=new THREE.Mesh(new THREE.TorusGeometry(r,.065,8,36,Math.PI),stone);arch.position.set(0,2.52,.22);root.add(arch);}
    const tymp=new THREE.Mesh(new THREE.CircleGeometry(.73,32,0,Math.PI),stone);tymp.position.set(0,2.52,.15);root.add(tymp);
    for(const s of [-1,1]){const curl=new THREE.Mesh(new THREE.TorusGeometry(.19,.035,6,18,Math.PI*1.45),M.rust);curl.position.set(s*.38,2.64,.20);curl.rotation.z=s*.42;root.add(curl);}
    const rose=new THREE.Mesh(new THREE.TorusGeometry(.12,.035,7,18),M.rust);rose.position.set(0,2.78,.23);root.add(rose);
  }else{
    addBox(root,-.88,1.26,.10,.08,2.52,.28,M.wood);addBox(root,.88,1.26,.10,.08,2.52,.28,M.wood);
    addBox(root,0,2.68,.12,2.05,.18,.66,M.darkWood,{rotation:[-.035,0,0]});
  }
  const entry={id:`door_${destination}`,type:'door',object:root,point:root.position,radius:options.radius??3.3,
    prompt:locked?'[ E ] THRESHOLD LOCKED':`[ E ] ENTER — ${label.toUpperCase()}`, 
    label,destination,spawn,locked,slab,doorPivot:pivot,openAngle:options.openAngle??-1.08};
  group.userData.interactables.push(entry);return entry;
}

function addHouseExterior(group,x,z,w,d,h,seed=1,color=0x85877f,frontDoor=true){
  const g=new THREE.Group();g.position.set(x,0,z);group.add(g);
  const wall=mat(color,1,{map:TEX.plaster,bumpScale:.11}),wood=mat(seed%2?0x514538:0x625342,1,{map:TEX.wood,bumpScale:.13}),roof=mat(seed===5?0x202321:0x292b28,1,{map:TEX.concrete,bumpScale:.1});
  const fz=d/2,dw=frontDoor?1.92:0;
  addBox(g,0,.23,-d/2,w+.3,.46,.60,M.darkWall);addBox(g,-w/2,.23,0,.60,.46,d+.25,M.darkWall);addBox(g,w/2,.23,0,.60,.46,d+.25,M.darkWall);addBox(g,0,.23,d/2,w+.3,.46,.60,M.darkWall);
  addBox(g,0,h/2,-d/2,w,h,.42,wall);addBox(g,-w/2,h/2,0,.42,h,d,wall);addBox(g,w/2,h/2,0,.42,h,d,wall);
  if(frontDoor){
    addWindowedWall(g,'x',fz,-w/2,-dw/2,h,.42,wall,[{at:-w*.30,w:Math.min(1.45,w*.24),h:1.18,y:1.52}]);
    addWindowedWall(g,'x',fz,dw/2,w/2,h,.42,wall,[{at:w*.30,w:Math.min(1.45,w*.24),h:1.18,y:1.52}]);
    addBox(g,0,2.52+(h-2.52)/2,fz,dw,h-2.52,.42,wall);
  }else addBox(g,0,h/2,fz,w,h,.42,wall);
  for(let row=0;row<Math.floor(h/.34);row++){
    const y=.5+row*.34;
    if(y<1.34||y>2.82)addBox(g,0,y,fz+.225,w-.12,.038,.05,wood,{castShadow:false});
    else if(frontDoor){addBox(g,-w*.30,y,fz+.225,w*.38,.038,.05,wood,{castShadow:false});addBox(g,w*.30,y,fz+.225,w*.38,.038,.05,wood,{castShadow:false});}
  }
  for(const s of [-1,1])for(let row=0;row<Math.floor(h/.4);row++)addBox(g,s*(w/2+.225),.54+row*.4,0,.05,.045,d-.26,wood,{castShadow:false});
  for(const wx of [-w*.30,w*.30]){
    const wy=2.1,ww=Math.min(1.45,w*.24),wh=1.18;
    addBox(g,wx,wy,fz+.22,.035,wh-.12,ww-.12,M.glass,{castShadow:false});
    addBox(g,wx-ww/2-.065,wy,fz+.30,.12,wh+.22,.12,wood);addBox(g,wx+ww/2+.065,wy,fz+.30,.12,wh+.22,.12,wood);
    addBox(g,wx,wy-wh/2-.065,fz+.30,ww+.25,.12,.12,wood);addBox(g,wx,wy+wh/2+.065,fz+.30,ww+.25,.12,.12,wood);
    addBox(g,wx,wy,fz+.36,.045,wh-.04,.045,M.darkWood);addBox(g,wx,wy,fz+.36,.045,.045,ww-.05,M.darkWood);
    if(seed%2===0)addBox(g,wx-ww*.52,wy,fz+.4,.10,wh+.03,.07,M.darkWood,{rotation:[0,0,.08],castShadow:false});
  }
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(0,1.42);shape.lineTo(w/2,0);shape.closePath();
  const gable=new THREE.Mesh(new THREE.ShapeGeometry(shape),wall);gable.position.set(0,h,fz+.22);g.add(gable);
  addBox(g,-w*.245,h+.62,0,w*.60,.24,d+.9,roof,{rotation:[0,0,.42]});addBox(g,w*.245,h+.62,0,w*.60,.24,d+.9,roof,{rotation:[0,0,-.42]});
  const ridge=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,d+.95,8),M.darkWood);ridge.rotation.x=Math.PI/2;ridge.position.set(0,h+1.37,0);g.add(ridge);
  for(const s of [-1,1])for(let i=0;i<7;i++){const batten=addBox(g,s*(.58+i*.60),h+.76,0,.045,.045,d+.62,M.darkWood,{castShadow:false});batten.rotation.z=s===-1?.42:-.42;if(seed===4&&i===5)batten.position.y-=.18;}
  if(seed===2){
    const dz=fz+.58;addBox(g,-.55,h+.88,dz,1.65,1.38,.28,wall);
    const ds=new THREE.Shape();ds.moveTo(-.84,0);ds.lineTo(0,.86);ds.lineTo(.84,0);ds.closePath();
    const df=new THREE.Mesh(new THREE.ShapeGeometry(ds),wall);df.position.set(-.55,h+1.55,dz+.16);g.add(df);
    addBox(g,-.55,h+1.25,dz+.26,.76,.90,.05,M.black,{castShadow:false});addBox(g,-.55,h+1.25,dz+.32,.88,1.03,.08,wood);
    addBox(g,-.55,h+1.25,dz+.37,.04,.90,.04,M.darkWood);addBox(g,-.55,h+1.25,dz+.37,.74,.04,.04,M.darkWood);
    for(const s of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.07,.095,2.55,8),wood);post.position.set(s*1.22,1.28,fz+.73);g.add(post);}
    addBox(g,0,2.60,fz+.74,2.88,.18,.24,M.darkWood);addBox(g,0,2.75,fz+.84,3.3,.14,1.22,roof,{rotation:[-.05,0,0]});
    addBox(g,0,.20,fz+.68,2.78,.34,1.2,M.wall);addBox(g,0,.47,fz+.96,2.45,.18,.66,M.darkWall);
  }else if(seed===4){
    addBox(g,-w*.20,1.42,fz+.30,.10,2.65,.12,M.rust,{rotation:[0,0,-.1]});addBox(g,w*.23,2.18,fz+.30,.09,1.42,.12,wood,{rotation:[0,0,.08]});
    addBox(g,-w/2-.28,2.05,-d*.08,.54,3.35,d*.46,wall,{rotation:[0,0,.075]});addBox(g,-w/2-.58,.13,-d*.08,1.02,.26,d*.48,M.darkWall,{rotation:[0,0,.075]});
  }else if(seed===3){
    addBox(g,w/2+.30,1.65,-d*.18,.72,3,d*.58,wall);addBox(g,w/2+.30,3.15,-d*.18,.95,.18,d*.60,roof);
  }else if(seed===5){
    for(let i=0;i<5;i++)addBox(g,-1.12+i*.56,1.95,fz+.30,.075,2.2,.09,M.darkWood,{rotation:[0,0,(i%2?1:-1)*.02]});
    addBox(g,0,3.05,fz+.36,3.1,.12,.12,M.rust);for(const s of [-1,1])addBox(g,s*1.2,1.42,fz+.35,.09,2.25,.10,M.rust);
  }
  const chimney=addBox(g,seed===4?-w*.31:w*.29,h+1.36,-d*.22,.66,2.3,.68,M.brick);chimney.rotation.y=.09;
  for(let i=0;i<4;i++){const slate=addBox(g,(i-1.5)*.58,h+.30,-d*.05+i*.16,.48,.05,.18,M.darkWall,{rotation:[0,0,(i%2?1:-1)*.08]});if(seed===4&&i===2)slate.position.y-=.18;}
  if(seed!==5){addBox(g,w/2+.23,h+.12,.15,.08,.08,d*.78,M.rust);addBox(g,w/2+.31,.45,d*.35,.055,.8,.055,M.rust,{rotation:[0,0,-.08]});}
  return g;
}
function addRomanesqueChurchExterior(group,x,z,w=12,d=15,h=6.8){
  const g=new THREE.Group();g.position.set(x,0,z);group.add(g);
  const stone=mat(0x85847b,.99,{map:TEX.concrete,bumpScale:.18}),pale=mat(0x99968a,.98,{map:TEX.concrete,bumpScale:.12}),roof=mat(0x292b28,1,{map:TEX.concrete}),front=d/2;
  addBox(g,0,h/2,-d/2,w,h,.6,stone);addBox(g,-w/2,h/2,0,.6,h,d,stone);addBox(g,w/2,h/2,0,.6,h,d,stone);
  addWindowedWall(g,'x',front,-w/2,-1.15,h,.6,stone,[{at:-3.7,w:.56,h:1.34,y:3.45}]);
  addWindowedWall(g,'x',front,1.15,w/2,h,.6,stone,[{at:3.7,w:.56,h:1.34,y:3.45}]);addBox(g,0,2.95+(h-2.95)/2,front,2.30,h-2.95,.6,stone);
  addBox(g,-2.65,h+.48,-.1,6.7,.30,d+.5,roof,{rotation:[0,0,.41]});addBox(g,2.65,h+.48,-.1,6.7,.30,d+.5,roof,{rotation:[0,0,-.41]});
  addBox(g,-4.65,4.15,-.1,2.25,.20,d+.35,roof,{rotation:[0,0,.08]});addBox(g,4.65,4.15,-.1,2.25,.20,d+.35,roof,{rotation:[0,0,-.08]});
  const ridge=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,d+.6,8),M.darkWall);ridge.rotation.x=Math.PI/2;ridge.position.set(0,h+1.12,-.1);g.add(ridge);
  const gs=new THREE.Shape();gs.moveTo(-w/2,0);gs.lineTo(0,1.6);gs.lineTo(w/2,0);gs.closePath();const gf=new THREE.Mesh(new THREE.ShapeGeometry(gs),stone);gf.position.set(0,h,front+.3);g.add(gf);
  for(let i=-1;i<=1;i++){
    const apse=new THREE.Mesh(new THREE.CylinderGeometry(1.95,2.18,5.4,20,1,true,0,Math.PI),stone);apse.position.set(i*3.05,2.72,-d/2-.72);g.add(apse);
    const dome=new THREE.Mesh(new THREE.SphereGeometry(2.02,20,10,0,Math.PI*2,0,Math.PI/2),pale);dome.position.set(i*3.05,5.4,-d/2-.72);dome.scale.y=.58;g.add(dome);
    addBox(g,i*3.05,3.1,-d/2-2.82,.12,1.2,.1,M.black,{castShadow:false});
    for(let j=-1;j<=1;j++){const a=(j+1)*Math.PI/3,px=i*3.05+Math.sin(a)*1.92,pz=-d/2-.72-Math.cos(a)*1.92;addBox(g,px,3.1,pz,.11,2,.13,pale);if(j<1){const arc=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,6,16,Math.PI),pale);arc.position.set(px,5.62,pz);arc.rotation.y=a;g.add(arc);}}
  }
  for(const side of [-1,1])for(let i=0;i<10;i++){const xx=side*(w/2-.28),zz=-d/2+1+i*1.42;const arc=new THREE.Mesh(new THREE.TorusGeometry(.34,.055,7,18,Math.PI),pale);arc.position.set(xx,6.25,zz);arc.rotation.y=side*Math.PI/2;g.add(arc);addBox(g,xx,5.88,zz,.12,.62,.12,pale);addBox(g,xx,6.62,zz,.18,.10,.18,pale);}
  addBox(g,-4.25,4.55,5,2.55,9.1,2.65,stone);addBox(g,-4.25,9.3,5,2.9,.4,3,pale);
  for(const s of [-1,1]){addBox(g,-4.25+s*.88,10.18,3.66,.78,1.42,.18,M.black,{castShadow:false});addBox(g,-4.25+s*.88,10.18,6.34,.78,1.42,.18,M.black,{castShadow:false});}
  const cap=new THREE.Mesh(new THREE.ConeGeometry(2,1.7,4),roof);cap.rotation.y=Math.PI/4;cap.position.set(-4.25,11.35,5);g.add(cap);
  addBox(g,-4.25,12.35,5,.07,.72,.07,M.rust);addBox(g,-4.25,12.46,5,.46,.065,.07,M.rust);
  for(let row=0;row<9;row++)for(let col=0;col<8;col++)addBox(g,-w/2+.78+col*1.48+(row%2)*.38,.45+row*.66,front+.315,1.3,.045,.045,row%3===0?pale:stone,{castShadow:false});
}

const TREE_MATERIALS = [mat(0x28352b, 1), mat(0x34402f, 1), mat(0x444434, 1)];
function branchBetween(parent, a, b, radius, material) {
  const A=new THREE.Vector3(...a), B=new THREE.Vector3(...b), d=new THREE.Vector3().subVectors(B,A);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.46,radius,d.length(),7),material);
  mesh.position.copy(A).add(B).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  mesh.castShadow=true; parent.add(mesh); return mesh;
}
function addTree(group, x, z, h = 8, seed = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .38, h * .67, 9), M.darkWood);
  trunk.position.y = h * .335; trunk.castShadow = true; root.add(trunk);
  const crown=new THREE.Group(); crown.position.y=h*.43; root.add(crown);
  const sway=[];
  for(let i=0;i<5;i++){
    const a=i*2.399+seed*.17, len=h*(.18+(i%3)*.035);
    const base=[Math.cos(a)*.08,0,Math.sin(a)*.08];
    const tip=[Math.cos(a)*len*.65,h*(.18+(i%2)*.06),Math.sin(a)*len*.65];
    const limb=branchBetween(crown,base,tip,.09+(i%3)*.018,M.darkWood); sway.push(limb);
    const leafGroup=new THREE.Group();leafGroup.position.set(...tip);crown.add(leafGroup);
    for(let j=0;j<3;j++){
      const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.55+(j%2)*.16,0),TREE_MATERIALS[(i+j)%TREE_MATERIALS.length]);
      leaf.position.set((Math.random()-.5)*1.25,(Math.random()-.5)*.75,(Math.random()-.5)*1.25);
      leaf.scale.set(.9,1.25,.8);leaf.castShadow=false;leafGroup.add(leaf);
    }
    sway.push(leafGroup);
  }
  root.userData.windPhase=seed*.73;root.userData.swayParts=sway;windTrees.push(root);
  return root;
}
function addCropRows(group, cx, cz, rows, length, spacing, kind='maize', seed=1) {
  let state=(seed*2654435761)>>>0; const rand=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  for(let r=0;r<rows;r++){
    for(let i=0;i<length;i++){
      const x=cx+(r-(rows-1)/2)*spacing+(rand()-.5)*.18;
      const z=cz+(i-(length-1)/2)*.72+(rand()-.5)*.22;
      const plant=new THREE.Group();plant.position.set(x,0,z);group.add(plant);
      const h=kind==='maize'?1.85+rand()*.8:.62+rand()*.26;
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(.025,.045,h,5),mat(kind==='maize'?0x555c35:0x55583a,1));stem.position.y=h/2;plant.add(stem);
      const leaves=[];
      const n=kind==='maize'?6:4;
      for(let j=0;j<n;j++){
        const leaf=new THREE.Mesh(new THREE.ConeGeometry(kind==='maize'?.10:.045,kind==='maize'?.92:.48,5),mat(kind==='maize'?(j%2?0x616b3b:0x465333):(j%2?0x77744b:0x5e6540),1));
        const side=j%2?1:-1;leaf.position.set(side*(.16+(j%3)*.045),h*(.32+(j%3)*.13),0);leaf.rotation.z=side*(.66+(j%2)*.15);leaf.rotation.x=(rand()-.5)*.35;plant.add(leaf);leaves.push(leaf);
      }
      if(kind==='maize'&&rand()>.30){const cob=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.36,7),mat(0x9d874b,1));cob.position.set(.08,h*.55,.03);cob.rotation.z=.48;plant.add(cob);}
      plant.userData.windPhase=rand()*6.28;plant.userData.leaves=leaves;plant.userData.windBase=kind==='maize'?.08:.14;
      cropPlants.push(plant);
    }
  }
}

function roundedHousing(w,h,d,r,material,bevel=.025){
  const sh=new THREE.Shape(),x=-w/2,y=-h/2;
  sh.moveTo(x+r,y);sh.lineTo(x+w-r,y);sh.quadraticCurveTo(x+w,y,x+w,y+r);
  sh.lineTo(x+w,y+h-r);sh.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  sh.lineTo(x+r,y+h);sh.quadraticCurveTo(x,y+h,x,y+h-r);
  sh.lineTo(x,y+r);sh.quadraticCurveTo(x,y,x+r,y);
  const geo=new THREE.ExtrudeGeometry(sh,{depth:d,steps:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:8});
  geo.translate(0,0,-d/2);geo.computeVertexNormals();return new THREE.Mesh(geo,material);
}
function tubeBetween(group,a,b,radius,material,segments=8){
  const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),delta=B.clone().sub(A),length=delta.length();
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.86,radius,length,segments),material);
  mesh.position.copy(A).add(B).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());group.add(mesh);return mesh;
}
function buildGasHeater(group,x,y,z,scale=1){
  const root=new THREE.Group();root.position.set(x,y,z);root.scale.setScalar(scale);group.add(root);
  const enamel=mat(0x3b3932,.68,{metalness:.36,map:TEX.metal,bumpScale:.035}),silver=mat(0x85847a,.46,{metalness:.72}),black=mat(0x141614,.8),ceramic=mat(0x5b3828,.82,{emissive:0x481b0c,emissiveIntensity:.3});
  const shell=roundedHousing(1.18,1.42,.48,.14,enamel,.045);shell.position.y=.92;root.add(shell);
  const hood=roundedHousing(1.12,.42,.51,.12,silver,.035);hood.position.set(0,1.70,0);root.add(hood);
  const base=roundedHousing(1.06,.16,.5,.08,mat(0x282722,.72,{metalness:.55}),.025);base.position.y=.14;root.add(base);
  const topVent=new THREE.Group();topVent.position.set(0,1.48,.255);root.add(topVent);
  for(let i=0;i<8;i++){const slat=roundedHousing(.92,.025,.025,.012,black,.006);slat.position.set(0,i*.034,0);topVent.add(slat);}
  for(let p=0;p<3;p++){
    const panel=new THREE.Mesh(new THREE.CylinderGeometry(.14,.18,.69,10),ceramic);panel.rotation.z=Math.PI/2;panel.scale.set(1,.55,1);panel.position.set((p-1)*.29,.77,.02);root.add(panel);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(.22,.58),new THREE.MeshBasicMaterial({color:p===1?0x713d23:0x44261b,transparent:true,opacity:.18,side:THREE.DoubleSide}));face.position.set((p-1)*.29,.77,.246);root.add(face);
  }
  const guard=new THREE.Group();guard.position.set(0,.72,.29);root.add(guard);
  for(let i=0;i<7;i++){const rail=new THREE.Mesh(new THREE.TorusGeometry(.63,.018,5,28,Math.PI),silver);rail.rotation.z=Math.PI/2;rail.rotation.y=Math.PI/2;rail.scale.set(.55,.6,1);rail.position.y=(i-3)*.105;guard.add(rail);}
  for(const side of [-1,1])tubeBetween(root,[side*.49,.39,.29],[side*.49,1.11,.29],.018,silver,7);
  const dial=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.055,18),silver);dial.rotation.x=Math.PI/2;dial.position.set(.39,.29,.28);root.add(dial);
  const dialMark=new THREE.Mesh(new THREE.BoxGeometry(.012,.055,.012),M.black);dialMark.position.set(.39,.29,.316);dialMark.rotation.z=-.42;root.add(dialMark);
  const pilot=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),glow(0xe66a26,.35));pilot.position.set(-.39,.32,.29);root.add(pilot);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.38,.09),new THREE.MeshBasicMaterial({map:makeLabelTexture('RADIANT / LPG',512,128),transparent:true,side:THREE.DoubleSide}));label.position.set(0,1.19,.252);root.add(label);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.19,8),silver);leg.position.set(sx*.43,.06,sz*.17);root.add(leg);
    const wheel=new THREE.Mesh(new THREE.TorusGeometry(.055,.018,6,14),black);wheel.rotation.y=Math.PI/2;wheel.position.set(sx*.43,.045,sz*.17);root.add(wheel);
  }
  const hoseCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.48,.28,-.15),new THREE.Vector3(.69,.2,-.28),new THREE.Vector3(.72,.08,-.55),new THREE.Vector3(.88,.06,-.68)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve,18,.025,7,false),mat(0x27251f,.9,{metalness:.15})));
  const coupling=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.12,10),silver);coupling.rotation.x=Math.PI/2;coupling.position.set(.88,.06,-.67);root.add(coupling);
  root.userData.pilot=pilot;return root;
}
function buildEarplugCase(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const brass=mat(0x8a7048,.42,{metalness:.72}),inside=mat(0x2b2924,.8),wax=mat(0xb77770,.92);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.19,24),brass);body.position.y=.105;root.add(body);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.105,.012,6,24),mat(0xc5a36e,.35,{metalness:.82}));rim.position.y=.20;root.add(rim);
  const lid=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.045,24),brass);lid.position.set(.22,.22,0);lid.rotation.z=-.18;root.add(lid);
  const lip=new THREE.Mesh(new THREE.TorusGeometry(.10,.009,5,24),inside);lip.position.set(.22,.244,0);root.add(lip);
  const chainCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.09,.22,0),new THREE.Vector3(.16,.3,.03),new THREE.Vector3(.24,.25,.02),new THREE.Vector3(.22,.18,0)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(chainCurve,18,.008,5,false),brass));
  for(let i=0;i<2;i++){const plug=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.095,4,8),wax);plug.scale.set(.8,1,.8);plug.position.set((i?-.05:.05),.31+i*.018,.02);plug.rotation.z=(i?-.22:.22);root.add(plug);}
  return root;
}
function buildReelRecorder(group,x,y,z,scale=1){
  const root=new THREE.Group();root.position.set(x,y,z);root.scale.setScalar(scale);group.add(root);
  const cabinet=mat(0x38352e,.62,{map:TEX.wood,bumpScale:.03}),panel=mat(0x6e716d,.38,{metalness:.58}),black=mat(0x171916,.66),steel=mat(0xaaa79b,.32,{metalness:.78}),red=glow(0xc13a28,.75);
  const body=roundedHousing(2.52,.92,.82,.12,cabinet,.04);body.position.y=.53;root.add(body);
  const face=roundedHousing(2.34,.57,.045,.065,panel,.025);face.position.set(0,.65,.432);root.add(face);
  const top=roundedHousing(2.30,.12,.72,.055,cabinet,.025);top.position.set(0,1.03,0);root.add(top);
  const meters=[];
  for(const side of [-1,1]){
    const housing=new THREE.Mesh(new THREE.BoxGeometry(.55,.27,.055),black);housing.position.set(side*.79,.78,.475);root.add(housing);
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.46,.19),new THREE.MeshBasicMaterial({map:makeLabelTexture('VU  -20  -10  0  +3',512,128),color:0xb7b59f,side:THREE.DoubleSide}));screen.position.set(side*.79,.79,.507);root.add(screen);
    const pivot=new THREE.Group();pivot.position.set(side*.79,.72,.519);root.add(pivot);
    const needle=new THREE.Mesh(new THREE.BoxGeometry(.008,.115,.008),mat(0xc65b43,.45,{metalness:.3}));needle.position.y=.05;needle.rotation.z=.08;pivot.add(needle);meters.push(pivot);
  }
  const reels=[];
  for(const side of [-1,1]){
    const spool=new THREE.Group();spool.position.set(side*.69,1.48,.43);root.add(spool);
    const flange=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.075,48),steel);flange.rotation.x=Math.PI/2;spool.add(flange);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.365,.026,7,40),mat(0x464640,.4,{metalness:.75}));spool.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.10,.10,.12,24),black);hub.rotation.x=Math.PI/2;spool.add(hub);
    for(let i=0;i<6;i++){
      const spoke=new THREE.Mesh(new THREE.BoxGeometry(.045,.55,.025),panel);spoke.position.z=.045;spoke.rotation.z=i*Math.PI/3;spool.add(spoke);
      const a=i*Math.PI/3,aperture=new THREE.Mesh(new THREE.CircleGeometry(.035,10),black);aperture.position.set(Math.cos(a)*.245,Math.sin(a)*.245,.065);spool.add(aperture);
    }
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.13,16),steel);cap.rotation.x=Math.PI/2;cap.position.z=.09;spool.add(cap);
    reels.push(spool);rotatingMachines.push({mesh:spool,speed:side<0?.34:-.29});
  }
  for(const px of [-.30,.30]){const guide=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.28,10),steel);guide.position.set(px,1.13,.42);guide.rotation.z=.18;root.add(guide);}
  const headBlock=roundedHousing(.40,.16,.13,.035,black,.012);headBlock.position.set(0,1.17,.42);root.add(headBlock);
  [['STOP',-.82,0x5d5b54],['PLAY',-.42,0x4d5949],['REC',0,0x8b3026],['REW',.42,0x6b6757],['FWD',.82,0x6b6757]].forEach(([label,bx,col])=>{
    const btn=new THREE.Mesh(new THREE.CylinderGeometry(.07,.075,.07,14),mat(col,.4,{metalness:.42}));btn.position.set(bx,.22,.45);root.add(btn);
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.045,.05,.018,14),steel);cap.position.set(bx,.265,.45);root.add(cap);
  });
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.026,8,6),red);lamp.position.set(-.99,.49,.48);root.add(lamp);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.72,.09),new THREE.MeshBasicMaterial({map:makeLabelTexture('STEREO / 19 CM-SEC',512,128),side:THREE.DoubleSide,transparent:true}));label.position.set(0,.48,.478);root.add(label);
  const path=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-.29,1.48,.44),new THREE.Vector3(-.16,1.26,.45),new THREE.Vector3(0,1.25,.45),new THREE.Vector3(.16,1.26,.45),new THREE.Vector3(.29,1.48,.44)]),20,.012,5,false),steel);root.add(path);
  root.userData.reels=reels;root.userData.meters=meters;root.userData.recordLamp=lamp;return root;
}
function buildPaperback(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);root.rotation.set(-.06,.15,-.035);group.add(root);
  const pages=roundedHousing(.36,.48,.055,.025,mat(0xbeb39a,.98),.012);pages.position.z=-.008;root.add(pages);
  const cover=roundedHousing(.38,.50,.018,.028,mat(0x45372c,.92,{map:TEX.wood}),.012);cover.position.z=.04;root.add(cover);
  const spine=roundedHousing(.055,.49,.07,.025,mat(0x29231e,.96),.012);spine.position.x=-.17;root.add(spine);
  for(let i=0;i<15;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(.28,.002,.001),mat(i%4===0?0x91866f:0x776f60,.99));line.position.set(.015,.19-i*.025,.078);root.add(line);}
  const title=new THREE.Mesh(new THREE.PlaneGeometry(.31,.17),new THREE.MeshBasicMaterial({map:makeLabelTexture('NIETZSCHE / ASCETIC IDEAL',512,256),transparent:true,side:THREE.DoubleSide}));title.position.set(.015,.055,.081);root.add(title);
  const corner=new THREE.Mesh(new THREE.TorusGeometry(.032,.006,4,12),M.gold);corner.position.set(.13,-.20,.085);root.add(corner);return root;
}
function buildThermos(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const enamel=mat(0x6c3328,.38,{metalness:.48}),steel=mat(0x9b988a,.32,{metalness:.82}),dark=mat(0x2a2823,.8);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.12,.14,.60,24),enamel);body.position.y=.34;root.add(body);
  const shoulder=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.12,24),enamel);shoulder.position.y=.70;root.add(shoulder);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,.08,20),steel);neck.position.y=.80;root.add(neck);
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.105,.09,.14,20,1,true),steel);cup.position.y=.91;root.add(cup);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.098,.009,6,22),steel);rim.position.y=.98;root.add(rim);
  const band=new THREE.Mesh(new THREE.TorusGeometry(.126,.012,6,24),dark);band.position.y=.21;root.add(band);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.10,.018,7,18,Math.PI),steel);handle.position.set(.15,.56,0);handle.rotation.z=Math.PI/2;root.add(handle);
  const maker=new THREE.Mesh(new THREE.PlaneGeometry(.12,.10),new THREE.MeshBasicMaterial({map:makeLabelTexture('I / 13',256,128),transparent:true,side:THREE.DoubleSide}));maker.position.set(0,.39,.142);root.add(maker);return root;
}
function buildCombineHarvester(group,x,z,scale=1){
  const root=new THREE.Group();root.position.set(x,0,z);root.scale.setScalar(scale);group.add(root);
  const bodyMat=mat(0x594332,.76,{map:TEX.rust,bumpScale:.07}),trim=mat(0x302e27,.72,{metalness:.34}),glass=new THREE.MeshStandardMaterial({color:0x202b2b,roughness:.18,metalness:.08,transparent:true,opacity:.48,side:THREE.DoubleSide}),steel=mat(0x8d897d,.42,{metalness:.7});
  const chassis=roundedHousing(2.05,.78,3.15,.22,bodyMat,.06);chassis.position.y=.9;root.add(chassis);
  const engineHood=roundedHousing(1.7,.56,1.05,.20,bodyMat,.05);engineHood.position.set(0,1.42,-.91);root.add(engineHood);
  const cab=roundedHousing(1.45,1.03,1.23,.16,glass,.04);cab.position.set(0,1.78,.34);root.add(cab);
  const roof=roundedHousing(1.62,.13,1.43,.08,bodyMat,.03);roof.position.set(0,2.34,.34);root.add(roof);
  const exhaust=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.72,10),trim);exhaust.position.set(.62,2.12,-.82);root.add(exhaust);
  const exhaustCap=new THREE.Mesh(new THREE.TorusGeometry(.05,.012,5,16),steel);exhaustCap.position.set(.62,2.48,-.82);exhaustCap.rotation.x=Math.PI/2;root.add(exhaustCap);
  for(const side of [-1,1]){
    const mirrorArm=new THREE.CylinderGeometry(.014,.018,.42,6);const arm=new THREE.Mesh(mirrorArm,steel);arm.position.set(side*.91,1.82,.55);arm.rotation.z=side*.24;root.add(arm);
    const mirror=new THREE.Mesh(new THREE.BoxGeometry(.16,.22,.045),trim);mirror.position.set(side*1.02,1.99,.58);root.add(mirror);
    for(const zz of [-1.12,1.05]){
      const wheel=new THREE.Group();wheel.position.set(side*.99,.53,zz);root.add(wheel);
      const tyre=new THREE.Mesh(new THREE.CylinderGeometry( .37,.37,.24,20),M.black);tyre.rotation.z=Math.PI/2;wheel.add(tyre);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.26,.035,7,24),steel);rim.rotation.y=Math.PI/2;wheel.add(rim);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.26,16),trim);hub.rotation.z=Math.PI/2;wheel.add(hub);
      for(let i=0;i<8;i++){const lug=new THREE.Mesh(new THREE.SphereGeometry(.018,6,5),steel);const a=i*Math.PI/4;lug.position.set(0,Math.cos(a)*.18,Math.sin(a)*.18);wheel.add(lug);}
      (root.userData.wheels||(root.userData.wheels=[])).push(wheel);
    }
  }
  // Header cutter, rotating reel and crop dividers.
  const header=new THREE.Group();header.position.set(0,.52,2.02);root.add(header);root.userData.headerReel=header;
  const beam=roundedHousing(2.75,.22,.25,.07,trim,.02);beam.position.set(0,0,.05);header.add(beam);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,2.55,18),steel);shaft.rotation.z=Math.PI/2;shaft.position.set(0,.34,-.02);header.add(shaft);
  for(let side of [-1,1]){
    const dividerCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*1.18,0,.18),new THREE.Vector3(side*1.38,.34,.48),new THREE.Vector3(side*1.35,.72,.8)]);
    header.add(new THREE.Mesh(new THREE.TubeGeometry(dividerCurve,14,.028,6,false),steel));
  }
  const reel=new THREE.Group();reel.position.set(0,.36,-.02);header.add(reel);root.userData.reel=reel;
  for(let side of [-1,1]){
    const hoop=new THREE.Mesh(new THREE.TorusGeometry(.43,.022,6,32),steel);hoop.position.x=side*1.05;reel.add(hoop);
    for(let i=0;i<10;i++){const a=i*Math.PI/5,bar=tubeBetween(reel,[side*1.05,Math.cos(a)*.39,Math.sin(a)*.39],[side*1.05,Math.cos(a+Math.PI/5)*.39,Math.sin(a+Math.PI/5)*.39],.018,trim,6);bar.rotation.x=0;}
  }
  const cutter=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,2.85,8),steel);cutter.rotation.z=Math.PI/2;cutter.position.set(0,-.14,.19);header.add(cutter);
  for(let i=0;i<25;i++){const tooth=new THREE.Mesh(new THREE.ConeGeometry(.035,.18,5),steel);tooth.position.set(-1.3+i*.108,-.25,.2);tooth.rotation.x=Math.PI;header.add(tooth);}
  for(let side of [-1,1]){
    const light=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),glow(0xb56c31,.55));light.position.set(side*.72,1.1,-1.54);root.add(light);
  }
  root.userData.body=chassis;return root;
}
function buildSoupBowl(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const ceramic=mat(0xb3a991,.34,{metalness:.04}),broth=mat(0x5a3822,.30,{emissive:0x281207,emissiveIntensity:.08});
  const profile=[new THREE.Vector2(.05,0),new THREE.Vector2(.19,.015),new THREE.Vector2(.25,.10),new THREE.Vector2(.27,.16),new THREE.Vector2(.25,.18),new THREE.Vector2(.23,.16)];
  const bowl=new THREE.Mesh(new THREE.LatheGeometry(profile,28),ceramic);root.add(bowl);
  const soup=new THREE.Mesh(new THREE.CircleGeometry(.235,28),broth);soup.rotation.x=-Math.PI/2;soup.position.y=.165;root.add(soup);
  for(let i=0;i<4;i++){const herb=new THREE.Mesh(new THREE.SphereGeometry(.018,6,5),mat(0x687148,.95));herb.position.set((Math.random()-.5)*.28,.17,(Math.random()-.5)*.28);root.add(herb);}
  const spoon=new THREE.Group();spoon.position.set(.23,.18,.06);spoon.rotation.z=-.18;root.add(spoon);
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.012,.018,.34,8),mat(0x8b8c82,.42,{metalness:.6}));handle.position.y=.16;handle.rotation.z=.25;spoon.add(handle);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.052,10,7),mat(0x8b8c82,.42,{metalness:.6}));head.scale.set(.7,.32,1.2);head.position.set(-.043,.32,0);spoon.add(head);
  const saucer=new THREE.Mesh(new THREE.TorusGeometry(.30,.018,5,28),ceramic);saucer.rotation.x=Math.PI/2;saucer.position.y=.005;root.add(saucer);return root;
}
function buildTrowel(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const bladeShape=new THREE.Shape();bladeShape.moveTo(0,0);bladeShape.lineTo(.16,.30);bladeShape.quadraticCurveTo(.20,.39,.15,.46);bladeShape.lineTo(-.15,.46);bladeShape.quadraticCurveTo(-.20,.39,-.16,.30);bladeShape.closePath();
  const bladeGeo=new THREE.ExtrudeGeometry(bladeShape,{depth:.025,bevelEnabled:true,bevelThickness:.012,bevelSize:.01,bevelSegments:2,steps:1});bladeGeo.computeVertexNormals();
  const blade=new THREE.Mesh(bladeGeo,mat(0x73766f,.42,{metalness:.68}));blade.position.y=.13;root.add(blade);
  const tang=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.22,8),mat(0x85877f,.42,{metalness:.68}));tang.position.y=.56;root.add(tang);
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.055,.045,.34,10),mat(0x553b28,.94,{map:TEX.wood}));handle.position.y=.82;root.add(handle);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),M.darkWood);cap.position.y=1.0;root.add(cap);return root;
}
function buildCRT(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const caseMat=mat(0x292720,.72,{map:TEX.wood,bumpScale:.025}),bezelMat=mat(0x5a5142,.65,{metalness:.22});
  const housing=roundedHousing(1.72,1.27,.72,.17,caseMat,.06);housing.position.y=.68;root.add(housing);
  const bezel=roundedHousing(1.37,1.02,.08,.19,bezelMat,.035);bezel.position.set(-.02,.70,.37);root.add(bezel);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.20,.84),new THREE.MeshBasicMaterial({map:makeLabelTexture('THE ROOM IS STILL HERE',512,320),color:0x9ba096,side:THREE.DoubleSide}));screen.position.set(-.02,.70,.423);root.add(screen);
  for(const side of [-1,1]){const dial=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.06,16),bezelMat);dial.rotation.x=Math.PI/2;dial.position.set(side*.64,.22,.38);root.add(dial);}
  for(const side of [-1,1]){const foot=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,.16,8),mat(0x191815,.9));foot.position.set(side*.55,.02,0);root.add(foot);}
  const aerial=new THREE.Group();aerial.position.set(.48,1.34,-.22);root.add(aerial);
  tubeBetween(aerial,[0,0,0],[.24,.52,0],.012,bezelMat,6);tubeBetween(aerial,[0,0,0],[-.2,.42,0],.012,bezelMat,6);
  return root;
}
function addWoodTable(group,x,z,w=2.6,d=1.25,h=.82,seed=1){
  const root=new THREE.Group();root.position.set(x,0,z);group.add(root);
  const top=roundedHousing(w,h*.09,d,.07,seed%2?M.wood:M.darkWood,.025);top.position.y=h;root.add(top);
  const grain=mat(0x6b523a,.98,{map:TEX.wood});
  const n=Math.max(3,Math.round(d/.28));
  for(let i=1;i<n;i++){const zz=-d/2+i*d/n;const path=new THREE.LineCurve3(new THREE.Vector3(-w*.43,h+.047,zz),new THREE.Vector3(w*.43,h+.047,zz));root.add(new THREE.Mesh(new THREE.TubeGeometry(path,1,.004,4,false),grain));}
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.07,.105,h-.06,10),M.darkWood);leg.position.set(sx*(w/2-.16),(h-.06)/2,sz*(d/2-.15));root.add(leg);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(.075,.012,5,12),M.rust);collar.position.set(sx*(w/2-.16),.14,sz*(d/2-.15));root.add(collar);
  }
  for(const side of [-1,1]){
    const apron=roundedHousing(w-.22,.14,.09,.04,M.darkWood,.018);apron.position.set(0,h-.13,side*(d/2-.105));root.add(apron);
    const sideApron=roundedHousing(.10,.14,d-.22,.04,M.darkWood,.018);sideApron.position.set(side*(w/2-.105),h-.13,0);root.add(sideApron);
  }
  root.userData.seed=seed;return root;
}
function addWoodChair(group,x,z,rot=0,scale=1){
  const root=new THREE.Group();root.position.set(x,0,z);root.rotation.y=rot;root.scale.setScalar(scale);group.add(root);
  const seat=roundedHousing(.62,.085,.58,.065,M.wood,.022);seat.position.y=.49;root.add(seat);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.037,.065,.48,9),M.darkWood);leg.position.set(sx*.245,.24,sz*.22);root.add(leg);
    const foot=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),M.darkWood);foot.scale.set(1,.48,1);foot.position.set(sx*.245,.025,sz*.22);root.add(foot);
  }
  for(const sx of [-1,1]){
    tubeBetween(root,[sx*.245,.54,-.235],[sx*.245,1.16,-.235],.04,M.darkWood,8);
    const peg=new THREE.Mesh(new THREE.SphereGeometry(.052,8,6),M.gold);peg.position.set(sx*.245,1.16,-.235);root.add(peg);
  }
  const backCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.29,.82,-.24),new THREE.Vector3(-.31,1.04,-.26),new THREE.Vector3(-.22,1.17,-.26),new THREE.Vector3(0,1.20,-.26),new THREE.Vector3(.22,1.17,-.26),new THREE.Vector3(.31,1.04,-.26),new THREE.Vector3(.29,.82,-.24)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(backCurve,22,.045,8,false),M.darkWood));
  for(let i=-1;i<=1;i++){const slat=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.28,7),M.wood);slat.position.set(i*.13,.93,-.25);root.add(slat);}
  const brace=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.50,7),M.darkWood);brace.rotation.z=Math.PI/2;brace.position.set(0,.22,0);root.add(brace);
  return root;
}
function addBench(group,x,z,rot=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;group.add(g);
  const seat=roundedHousing(1.78,.10,.50,.07,M.wood,.025);seat.position.y=.49;g.add(seat);
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.05,.08,.48,9),M.darkWood);leg.position.set(side*.64,.24,0);g.add(leg);
    tubeBetween(g,[side*.72,.52,-.18],[side*.72,1.25,-.18],.045,M.darkWood,8);
  }
  const railCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.82,.86,-.18),new THREE.Vector3(-.88,1.17,-.18),new THREE.Vector3(-.72,1.27,-.18),new THREE.Vector3(.72,1.27,-.18),new THREE.Vector3(.88,1.17,-.18),new THREE.Vector3(.82,.86,-.18)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve,20,.055,8,false),M.darkWood));
  const brace=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.78,8),M.darkWood);brace.rotation.z=Math.PI/2;brace.position.y=.22;g.add(brace);return g;
}

// -----------------------------------------------------------------------------
// World construction — six spaces, connected by thresholds.
// -----------------------------------------------------------------------------
function newZone(name, fogColor, density, bounds, spawn) {
  const group = new THREE.Group(); group.name = name; group.visible = false; scene.add(group);
  const ambient = new THREE.HemisphereLight(0x9ba4a0, 0x2d3028, .30); group.add(ambient);
  const moon = new THREE.DirectionalLight(0xc5c9c2, .38); moon.position.set(-18, 28, 14); moon.castShadow = false; group.add(moon);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 160, bounds.maxZ - bounds.minZ + 160), ['road', 'forest'].includes(name) ? M.grass : M.ground); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.position.set((bounds.minX + bounds.maxX) / 2, -.025, (bounds.minZ + bounds.maxZ) / 2); group.add(floor);
  const z = { name, group, bounds, spawn: new THREE.Vector3(...spawn), interactables: [], solids: [], fogColor, density, fog: null, mist: null, decor: [], ambient, moon };
  group.userData.interactables = z.interactables;
  zones[name] = z; return z;
}
function solid(z, x, zpos, w, d) { z.solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: zpos - d / 2, maxZ: zpos + d / 2 }); }
// The cult's departures, the Primo and the slaughterhouse carry the threat.
function triggerKillScene() {
  if(scenePlayed || !zones.church) return;
  scenePlayed=true;
  const z=zones.church;
  // Never create replacement extras: Walter and Dario are two of the thirteen.
  const victim=cultRoster.find(n=>n.name==='Walter'&&['present','queued'].includes(n.fate));
  const executioner=cultRoster.find(n=>n.name==='Dario'&&['present','queued'].includes(n.fate));
  if(!victim || !executioner){
    storyFlags.add('empty-choir');
    audio?.mechanicalEvent('bell');
    showToast('THE NAVE IS FULL OF NOTHING BUT THE RECORDING.');
    return;
  }
  removeQueuedCultist(victim);removeQueuedCultist(executioner);
  victim.fate='present';executioner.fate='present';
  transferCultist(victim,z,0,-1.9);transferCultist(executioner,z,2.7,-2.1);
  victim.object.scale.set(1.0,.9,1.0);victim.prompt='';executioner.object.scale.set(1.12,1.1,1.12);executioner.prompt='';
  for(const npc of [victim,executioner]){const ix=z.interactables.findIndex(v=>v.id===npc.id);if(ix>=0)z.interactables.splice(ix,1);}
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.85,32),new THREE.MeshBasicMaterial({color:0x270708,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(0,.015,-1.8);z.group.add(stain);
  const event={id:'cantore_scene',type:'event',object:victim.object,point:victim.object.position,radius:4.8,prompt:'[ E ] REMAIN IN THE NAVE',done:false,run:()=>{
    if(event.done)return;event.done=true;controls.unlock();dialogueOpen=true;
    $('speaker').textContent='RECORDING / 03:17';
    $('subtitle').textContent='Dario tilts his head. The singer stops singing. The bell continues to vibrate, though nobody touches it. A voice from the bell tower speaks a name that is not his.';
    speakVoice('Dario tilts his head. The singer stops singing. The bell continues to vibrate, though nobody touches it.','RECORDING');
    $('subtitle-wrap').classList.add('visible');$('dialogue-options').innerHTML='<button class="dialogue-option" id="event-continue"><b>[↵]</b>Look away.</button>';
    $('event-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      stain.material.opacity=.82;victim.object.rotation.x=1.42;victim.object.position.y=-.45;victim.fate='dead';victim.object.visible=true;
      executioner.object.position.set(3.8,0,-3.7);executioner.object.rotation.y=Math.PI;executioner.fate='present';
      queueCultFate('the nave',executioner,'vanish');scheduleCultSceneFates(1,'the bell','collapse');
      fear=Math.min(1,fear+.28);glitchPulse=1.2;audio?.killSting();controls.lock();showToast('THE SINGER HAS BEEN REMOVED FROM THE RECORDING.');
    };
  }};
  z.interactables.push(event);
}
function triggerAnnaScene(z, annaMarker) {
  const anna=cultRoster.find(n=>n.name==='Anna');
  if(!anna || !annaMarker)return;
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.62,28),new THREE.MeshBasicMaterial({color:0x260607,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(-5.2,.018,1.2);z.group.add(stain);
  const ev={id:'anna_scene',type:'event',object:annaMarker,point:annaMarker.position,radius:3.4,prompt:'[ E ] LOOK AT THE EMPTY CHAIR',done:false,run:()=>{
    if(ev.done)return;ev.done=true;controls.unlock();dialogueOpen=true;
    const annaStillPresent=['present','queued'].includes(anna.fate);
    $('speaker').textContent='ANNA / KITCHEN';
    $('subtitle').textContent=annaStillPresent?'Anna sets the plate before an empty place. “He only eats when nobody is looking.” The kitchen light goes out.':'The plate is still warm. The chair was empty before you entered. Someone continues to chew inside the wall.';
    speakVoice($('subtitle').textContent,'Anna');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='<button class="dialogue-option" id="anna-continue"><b>[↵]</b>Remain still.</button>';
    $('anna-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      if(annaStillPresent){
        removeQueuedCultist(anna);if(anna.object.parent!==z.group)transferCultist(anna,z,-5.2,1.2);
        anna.object.position.set(-5.2,-.35,1.2);anna.object.rotation.x=1.35;anna.object.visible=true;anna.fate='dead';
        stain.material.opacity=.72;z.group.children.filter(c=>c.isPointLight).forEach(l=>l.intensity*=.22);
        fear=Math.min(1,fear+.22);glitchPulse=1;audio?.killSting();scheduleCultSceneFates(1,'the place at the table','vanish');
        showToast('THE PLACE AT THE TABLE HAS BEEN OCCUPIED.');
      }else{
        storyFlags.add('anna-empty-place');stain.material.opacity=.42;audio?.mechanicalEvent('drawer');glitchPulse=1.1;
        showToast('THE CHAIR WAS EMPTY BEFORE YOU MADE YOUR CHOICE.');
      }
      controls.lock();
    };
  }};
  z.interactables.push(ev);
}

const rotatingMachines=[];
function addRoadSurfaceDetails(group) {
  // Leaf litter and flattened weeds are instanced to keep the open landscape light.
  const leafShape=new THREE.Shape();leafShape.moveTo(0,.14);leafShape.quadraticCurveTo(.14,.06,.07,-.13);leafShape.quadraticCurveTo(0,-.19,-.07,-.13);leafShape.quadraticCurveTo(-.14,.06,0,.14);
  const leafGeo=new THREE.ShapeGeometry(leafShape);const leafMat=new THREE.MeshStandardMaterial({color:0x655139,roughness:1,side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(leafGeo,leafMat,420);const dummy=new THREE.Object3D();
  for(let i=0;i<420;i++){let x=(Math.random()-.5)*120,z=(Math.random()-.5)*115;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-8:8);dummy.position.set(x,.022+Math.random()*.006,z);dummy.rotation.set(-Math.PI/2,0,Math.random()*Math.PI*2);const sc=.35+Math.random()*1.5;dummy.scale.set(sc,sc,.6);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new THREE.Color().setHSL(.08+Math.random()*.08,.22,.18+Math.random()*.15));}group.add(leaves);
  const grassGeo=new THREE.PlaneGeometry(.085,.68,1,2);const grassMat=new THREE.MeshStandardMaterial({color:0x66714a,roughness:1,side:THREE.DoubleSide});const grass=new THREE.InstancedMesh(grassGeo,grassMat,780);
  for(let i=0;i<780;i++){let x=(Math.random()-.5)*125,z=(Math.random()-.5)*120;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-10:10);dummy.position.set(x,.30,z);dummy.rotation.set((Math.random()-.5)*.18,Math.random()*Math.PI,(Math.random()-.5)*.5);dummy.scale.set(.45+Math.random(),.45+Math.random()*1.5,1);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);grass.setColorAt(i,new THREE.Color().setHSL(.20+Math.random()*.08,.17,.18+Math.random()*.15));}group.add(grass);
  // Broken concrete flags and patched road shoulders.
  const paverMat=mat(0x65645d,1,{map:TEX.concrete});const pavers=new THREE.InstancedMesh(new THREE.BoxGeometry(1.15,.09,.72),paverMat,85);
  for(let i=0;i<85;i++){const side=i%2?-1:1,zz=-52+Math.random()*100;dummy.position.set(side*(7.5+Math.random()*1.6),.015,zz);dummy.rotation.set(0,(Math.random()-.5)*.16,0);dummy.scale.set(.65+Math.random()*.7,1,.7+Math.random()*.6);dummy.updateMatrix();pavers.setMatrixAt(i,dummy.matrix);}group.add(pavers);
  // Puddles catch the wrong reflection, not the sky.
  const puddleMat=new THREE.MeshStandardMaterial({color:0x263332,roughness:.18,metalness:.28,transparent:true,opacity:.46,side:THREE.DoubleSide});
  for(let i=0;i<24;i++){const w=.4+Math.random()*2.4,h=.25+Math.random()*1.3;const puddle=new THREE.Mesh(new THREE.CircleGeometry(1,24),puddleMat);puddle.rotation.x=-Math.PI/2;puddle.scale.set(w,h,1);puddle.position.set((Math.random()-.5)*16,.022,(Math.random()-.5)*110);group.add(puddle);}
}

function addWoodPavement(group,x,zStart,length=18,width=3.1){
  const boards=[
    mat(0x594332,1,{map:TEX.wood,bumpScale:.12}),
    mat(0x44382c,1,{map:TEX.wood,bumpScale:.15}),
    mat(0x6a5239,1,{map:TEX.wood,bumpScale:.10})
  ];
  const count=Math.floor(length/.48);
  addBox(group,x,.0,zStart+length/2,width+.22,.14,length+.18,M.darkWood,{castShadow:false});
  for(let i=0;i<count;i++){
    const z=zStart+i*.48;
    const board=addBox(group,x,.095,z,width,.12,.445,boards[i%boards.length],{rotation:[0,(i%5-2)*.004,(i%7-3)*.003]});
    board.castShadow=true;board.receiveShadow=true;
    for(const side of [-1,1]){
      const nail=new THREE.Mesh(new THREE.SphereGeometry(.022,7,6),M.metal);
      nail.position.set(x+side*(width*.42),.163,z+(i%2?-.13:.13));group.add(nail);
    }
    if(i%6===2){const split=new THREE.Mesh(new THREE.BoxGeometry(width*.18,.012,.018),M.darkWood);split.position.set(x+(i%2?-.28:.24),.16,z+.05);split.rotation.y=.15;group.add(split);}
  }
  // The boards are slick and dark at the centre, as if the water has been rising through them.
  const wet=new THREE.Mesh(new THREE.PlaneGeometry(width*.72,length*.7),new THREE.MeshStandardMaterial({color:0x202c2b,roughness:.18,metalness:.25,transparent:true,opacity:.22}));
  wet.rotation.x=-Math.PI/2;wet.position.set(x,.17,zStart+length*.56);group.add(wet);
}

function addMachineComplex(group) {
  const g=new THREE.Group();g.position.set(23.3,0,4.3);group.add(g);
  addBox(g,0,.3,0,5.1,.55,3.2,M.darkWall);
  // Belt-driven motor with two visible flywheels and a trembling connecting shaft.
  for(const x of [-1.35,1.15]){
    const wheel=new THREE.Group();wheel.position.set(x,1.45,.25);g.add(wheel);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.88,.095,9,40),M.rust);wheel.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.25,18),M.metal);hub.rotation.x=Math.PI/2;wheel.add(hub);
    for(let j=0;j<8;j++){const spoke=addBox(wheel,0,0,0,.07,.78,.07,M.metal,{castShadow:true});spoke.rotation.z=j*Math.PI/4;}
    rotatingMachines.push({mesh:wheel,speed:x<0?1.1:-.78});
  }
  const crank=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,2.7,12),M.metal);crank.rotation.z=Math.PI/2;crank.position.set(-.1,1.45,.25);g.add(crank);
  const piston=new THREE.Group();piston.position.set(0,.75,-.95);g.add(piston);
  const tube=new THREE.Mesh(new THREE.CylinderGeometry(.19,.24,1.55,12),M.rust);tube.position.y=.72;piston.add(tube);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,1.1,10),M.gold);rod.position.y=1.9;piston.add(rod);rotatingMachines.push({mesh:piston,piston:true,speed:1.25});
  for(let i=0;i<5;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.3+Math.random()*1.5,8),M.rust);pipe.position.set(-2+i*.34,1.1,-1.2);pipe.rotation.z=(Math.random()-.5)*.3;g.add(pipe);}
  const tank=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,2.0,18),M.metal);tank.position.set(2.0,1.25,-.65);g.add(tank);
  const tankTop=new THREE.Mesh(new THREE.CylinderGeometry(.74,.74,.12,18),M.rust);tankTop.position.set(2,2.32,-.65);g.add(tankTop);
  for(let i=0;i<12;i++){const bolt=new THREE.Mesh(new THREE.SphereGeometry(.035,7,6),M.gold);const a=i/12*Math.PI*2;bolt.position.set(2+Math.cos(a)*.7,2.33,-.65+Math.sin(a)*.7);g.add(bolt);}
  addLight(g,0x983d25,.7,5,0,2.1,.5);
  /* the floating sign was removed: nothing hangs in the air without a support */
}

function buildRoad() {
  const z = newZone('road', 0xb6b9b5, .017, { minX: -68, maxX: 68, minZ: -65, maxZ: 65 }, [0, 0, 29]);
  // Road, drainage ditches, canal and the flat Po Valley horizon.
  addPlane(z.group, 0, .005, 0, 12, 130, M.asphalt);
  for (let x of [-6.6, 6.6]) addBox(z.group, x, .08, 0, .17, .15, 130, M.darkWood, { castShadow: false });
  const canalMat = new THREE.MeshStandardMaterial({ color: 0x414c4b, roughness: .18, metalness: .38, transparent: true, opacity: .86 });
  addPlane(z.group, -31, -.01, -27, 13, 95, canalMat);
  for (let i = 0; i < 13; i++) { const reed = addBox(z.group, -38 + Math.random() * 14, .62 + Math.random() * .35, -67 + Math.random() * 78, .035, 1.3, .035, M.wood); reed.rotation.z = (Math.random() - .5) * .2; }
  // Bridge over the canal.
  addBox(z.group, -31, .38, -7, 17, .48, 5.8, M.darkWood);
  for (let side of [-1, 1]) addBox(z.group, -31 + side * 7.7, .8, -7, .17, .7, 5.7, M.rust);
  // Power poles and long cables disappear into white.
  for (let i = 0; i < 7; i++) {
    const x = 11 + (i % 2) * 5; const zz = 42 - i * 17;
    addBox(z.group, x, 5.2, zz, .18, 10.4, .18, M.darkWood);
    addBox(z.group, x, 9.7, zz, 3.8, .12, .12, M.rust);
  }
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 17, 5), M.black); wire.position.set(13, 9.0, 33); wire.rotation.x = Math.PI / 2.5; z.group.add(wire);
  // Trees, weeds, fence fragments.
  for (let i = 0; i < 54; i++) {
    const x = (Math.random() - .5) * 125; const zz = (Math.random() - .5) * 115;
    if (Math.abs(x) < 11 && zz > -20 && zz < 38) continue;
    if (Math.abs(x + 31) < 10) continue;
    addTree(z.group, x, zz, 5 + Math.random() * 6, i + 1);
  }
  // Po Valley cultivation: maize rows, winter wheat and a flooded rice plot with narrow banks.
  addCropRows(z.group,48,-7,4,25,.98,'maize',31);
  addCropRows(z.group,-51,24,4,22,.94,'maize',42);
  addCropRows(z.group,-48,-42,3,18,.78,'wheat',57);
  const paddy=new THREE.Mesh(new THREE.PlaneGeometry(20,.01),new THREE.MeshStandardMaterial({color:0x4d5d57,roughness:.16,metalness:.23,transparent:true,opacity:.78}));paddy.rotation.x=-Math.PI/2;paddy.position.set(45,.025,-42);z.group.add(paddy);
  for(let x=35;x<=55;x+=2){addBox(z.group,x,.08,-52,.12,.16,20,M.wood,{castShadow:false});}
  for(let i=0;i<110;i++){
    const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.16+Math.random()*.2,.055+Math.random()*.08),new THREE.MeshStandardMaterial({color:[0x54503a,0x5f563e,0x343a2c][i%3],side:THREE.DoubleSide,roughness:1}));
    leaf.position.set((Math.random()-.5)*110,.04+Math.random()*.05,(Math.random()-.5)*110);leaf.rotation.set(-Math.PI/2,Math.random()*Math.PI,Math.random()*Math.PI);z.group.add(leaf);leafSpecks.push(leaf);
  }
  for (let i = 0; i < 26; i++) {
    const x = -16 + i * 1.3; addBox(z.group, x, .52, -41, .11, 1.0, .11, M.darkWood);
    if (i % 4 === 0) addBox(z.group, x, .76, -41, .11, .1, 1.0, M.darkWood, { rotation: [0, Math.PI / 2, 0] });
  }
  // Weathered timber houses retain different silhouettes; the church is a separate Romanesque stone mass.
  addHouseExterior(z.group,0,-15,15,13,5.4,2,0x87867b,true);
  addRomanesqueChurchExterior(z.group,37,-25,12,15,6.8);
  addHouseExterior(z.group,-36,-14,12,10,4.8,4,0x77766c,true);
  addHouseExterior(z.group,27,22,10,9,4.2,5,0x555a55,true);
  addRoadSurfaceDetails(z.group); addWoodPavement(z.group,27,10.2,18.2,3.3); addMachineComplex(z.group);
  // The farmhouse's false golden window.
  addLight(z.group,0xffb35d,2.1,18,0,2.0,-7,{decay:1.5});
  const firstPrimo=makeNPC(z.group,-2.15,-5.45,'The First',0x4b463d,1);
  firstPrimo.isOpeningPrimo=true;firstPrimo.radius=4.0;firstPrimo.prompt='[ E ] SPEAK — THE FIRST';
  if (firstPrimo.head) firstPrimo.head.material = headMaterial();
  firstPrimo.dialogue={line:'You made it. I am glad. The road is unpleasant once the fog comes down. Come under the porch a moment; you must be cold.',choices:['Thank you. Have you been waiting long?','Do you know why I was called here?','Who are the people inside?'],replies:['Not long. I kept the lamp on because a person should not have to arrive at a dark door. That is all.','Only what the letter told me. You tune pianos, and you notice when a note is almost right. We have a room that needs that kind of attention.','Neighbours, mostly. They have been keeping one another company. It is easier to be here when somebody remembers to leave a place for you.']};
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshBasicMaterial({ color: 0xc08a4a, transparent: true, opacity: .48 })); windowGlow.position.set(3.8, 3.0, -8.35); z.group.add(windowGlow);
  // Small derelict industrial shed to the east.
  addBox(z.group, 24, 2.2, 5, 16, 4.4, 12, M.darkWall);
  addBox(z.group, 24, 4.6, 5, 17, .3, 13, M.rust);
  for (let i = 0; i < 4; i++) addBox(z.group, 17 + i * 4.5, 2.1, -1.12, .55, 4.3, .2, M.black);
  // Distant industrial chimneys.
  for (let i = 0; i < 3; i++) { const chimney = new THREE.Mesh(new THREE.CylinderGeometry(.65, .8, 22 + i * 5, 8), M.rust); chimney.position.set(48 + i * 4, 12 + i * 2.5, 41); z.group.add(chimney); }
  // A fenced cemetery sits between the derelict works and the distant chimneys.
  const cemetery=new THREE.Group();cemetery.position.set(44,0,18);cemetery.name='INDUSTRIAL_CEMETERY';z.group.add(cemetery);storyRef.cemetery=cemetery;
  const cemeteryGround=new THREE.Mesh(new THREE.PlaneGeometry(16,12),M.darkWall);cemeteryGround.rotation.x=-Math.PI/2;cemeteryGround.position.y=.018;cemetery.add(cemeteryGround);
  for(const x of [-8,8]){for(let zz=-6;zz<=6;zz+=1.25){if(x===-8&&Math.abs(zz)<2.2)continue;addBox(cemetery,x,.72,zz,.08,1.35,.08,M.rust,{castShadow:false});}addBox(cemetery,x,.34,0,.09,.08,12,M.rust,{castShadow:false});addBox(cemetery,x,1.08,0,.09,.08,12,M.rust,{castShadow:false});}
  for(const zz of [-6,6]){for(let xx=-8;xx<=8;xx+=1.25)addBox(cemetery,xx,.72,zz,.08,1.35,.08,M.rust,{castShadow:false});addBox(cemetery,0,.34,zz,16,.08,.09,M.rust,{castShadow:false});addBox(cemetery,0,1.08,zz,16,.08,.09,M.rust,{castShadow:false});}
  for(const zz of [-2.35,2.35]){addBox(cemetery,-8,.95,zz,.22,1.9,.22,M.darkWall);addBox(cemetery,-8,1.95,zz,.32,.14,.32,M.rust);}
  const cemeterySign=new THREE.Mesh(new THREE.PlaneGeometry(2.6,.58),new THREE.MeshBasicMaterial({map:makeLabelTexture('CEMETERY',512,160),transparent:true,side:THREE.DoubleSide}));cemeterySign.position.set(-8.18,1.72,0);cemeterySign.rotation.y=Math.PI/2;cemetery.add(cemeterySign);
  const graves=[[-4,-3],[-.1,-3],[3.9,-3],[-4,1.6],[-.1,1.6],[3.9,1.6]];
  graves.forEach(([gx,gz],i)=>{const mound=new THREE.Mesh(new THREE.SphereGeometry(.9,10,7),mat(0x292820,1,{map:TEX.concrete}));mound.scale.set(1.05,.09,.52);mound.position.set(gx,.065,gz);cemetery.add(mound);const stone=new THREE.Mesh(new THREE.BoxGeometry(.68,.92,.18),M.darkWall);stone.position.set(gx,.52,gz-.66);stone.rotation.z=(i%2?-.055:.04);cemetery.add(stone);addBox(cemetery,gx,.91,gz-.765,.075,.46,.035,M.rust);addBox(cemetery,gx,.84,gz-.765,.34,.065,.04,M.rust);});
  const marksman=new THREE.Group();marksman.position.set(31.1,4.78,7.2);marksman.rotation.y=-Math.PI/2;marksman.visible=false;z.group.add(marksman);storyRef.cemeteryShooter=marksman;
  const shooterBody=new THREE.Mesh(new THREE.CapsuleGeometry(.18,.58,4,7),M.black);shooterBody.position.y=.66;marksman.add(shooterBody);
  const shooterHead=new THREE.Mesh(new THREE.SphereGeometry(.14,8,7),M.black);shooterHead.position.set(0,1.22,.02);marksman.add(shooterHead);
  const rifle=new THREE.Mesh(new THREE.CylinderGeometry(.027,.04,.95,6),M.black);rifle.rotation.z=-Math.PI/2;rifle.position.set(.36,.78,.17);marksman.add(rifle);
  const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.035,6,5),M.rust);muzzle.position.set(.84,.78,.17);marksman.add(muzzle);
  // Doors into interiors.
  addDoor(z.group,0,-8.27,'the farmhouse','home',[0,0,6.2]);
  addDoor(z.group,37,-17.28,'the church','church',[0,0,9.4],false,{style:'roman'});
  addDoor(z.group,-36,-8.78,'the empty house','ruin',[0,0,5.8]);
  const abattoirDoor=addDoor(z.group,27,26.72,'the house of beasts','abattoir',[0,0,7.0],true);
  abattoirDoor.radius = 4.8;
  abattoirDoor.requiredClues = 7;
  addLight(z.group, 0xffb35d, 1.25, 7, 27, 2.5, 27.6, { decay: 1.5 });
  // Clue at the roadside mailbox.
  addBox(z.group, -4.5, .63, 20, .55, 1.25, .48, M.rust);
  addBox(z.group, -4.5, 1.32, 20, .7, .09, .58, M.darkWood);
  addClueMesh(z.group,new THREE.Vector3(-4.0,.83,19.7),'The 1977 Newspaper','A local clipping reports thirteen people found dead in a country church during the winter of 1977. Beside the bodies, a tape recorder was still running. The newspaper does not name the record.','clipping','paper');
  // A wet-coated figure at the bridge, more like a stain than a person.
  const woman = makeNPC(z.group,-31,-3,'The Woman by the Canal',0x242a28,1);
  woman.prompt = '[ E ] SPEAK — THE WOMAN BY THE CANAL';
  woman.dialogue = {
    line:'The water does not flow toward the sea. It flows toward the day it was poured.',
    choices:['What happened here?','I do not know you.'], 
    replies:['They closed the church but left the recording running.','That is better. Names let air in.']
  };
  // Rusted sign and road debris.
  addBox(z.group, 8.8, 1.3, 25, .1, 2.6, .1, M.rust); addBox(z.group, 9.5, 2.1, 25, 2.2, .65, .12, M.darkWood);
  const signText = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .42), new THREE.MeshBasicMaterial({ map: makeLabelTexture('PO / KM 14', 512, 128), transparent: true })); signText.position.set(9.5, 2.1, 24.91); z.group.add(signText);
  z.mist = addFog(z.group, 95, 125, 0xe1e3df, 49);
  z.fog = new THREE.FogExp2(z.fogColor, z.density);
  solid(z, 0, -15, 15.5, 13.5); solid(z, 37, -25, 12.5, 15.5); solid(z, -36, -14, 12.5, 10.5); solid(z, 24, 5, 16.5, 12.5);
  // Keep a clear approach to the abattoir threshold; the doorway itself is not blocked.
  z.solids.push(
    { minX: 21.7, maxX: 22.3, minZ: 17.25, maxZ: 26.75 },
    { minX: 31.7, maxX: 32.3, minZ: 17.25, maxZ: 26.75 },
    { minX: 22, maxX: 32, minZ: 17.25, maxZ: 17.75 },
    { minX: 22, maxX: 25.9, minZ: 26.25, maxZ: 26.75 },
    { minX: 28.1, maxX: 32, minZ: 26.25, maxZ: 26.75 }
  );
  return z;
}
function buildHome() {
  const z = newZone('home', 0x393b36, .052, { minX: -10, maxX: 10, minZ: -9, maxZ: 9 }, [0, 0, 6.4]);
  const floorMat = mat(0x554e42, .98, { map: TEX.wood });
  addBox(z.group, 0, -.13, 0, 20, .26, 18, floorMat);
  // Walls with a deliberately low ceiling line.
  addWindowedWall(z.group, 'x', -9, -10, 10, 3.6, .35, M.wall, [{ at: -4.2, w: 1.7, h: 1.5, y: 1.5 }, { at: 4.5, w: 1.4, h: 1.9, y: 1.2 }]); addBox(z.group, -10, 1.8, 0, .35, 3.6, 18, M.wall); addBox(z.group, 10, 1.8, 0, .35, 3.6, 18, M.wall);
  addBox(z.group, -6.0, 1.8, 9, 8, 3.6, .35, M.wall); addBox(z.group, 6.0, 1.8, 9, 8, 3.6, .35, M.wall);
  // An incomplete partition and a narrow dark corridor.
  for(let i=0;i<14;i++){const drip=new THREE.Mesh(new THREE.BoxGeometry(.018,.18+Math.random()*.5,.018),M.rust);drip.position.set(-8.9+Math.random()*17.8,2.7-Math.random()*.8,-8.77);z.group.add(drip);}
  addBox(z.group, -3.2, 1.45, -1.4, .22, 2.9, 6.8, M.darkWall); addBox(z.group, 4.8, 1.45, -2.1, .22, 2.9, 6.0, M.wall);
  // One substantial kitchen table with proper legs; two chairs have been pushed aside.
  addWoodTable(z.group,-5.2,2.0,3.15,1.48,.86,23);
  addWoodChair(z.group,-5.25,.83,0,.96);addWoodChair(z.group,-6.85,2.05,-Math.PI/2,.92);
  addBox(z.group, -8.5, 1.15, -3.8, 1.2, 2.3, 1.25, M.darkWall);
  addBox(z.group, -8.5, 2.34, -3.8, 1.32, .12, 1.35, M.black);
  addLight(z.group, 0xe9c78b, .85, 6, -8.1, 2.2, -3.8);
  // Harpsichord, open lid, keys and stool.
  addBox(z.group, 5.9, .85, -5.7, 3.9, .85, 1.2, M.darkWood);
  addBox(z.group, 5.9, 1.32, -5.65, 3.85, .08, 1.15, M.wood);
  const lid = addBox(z.group, 5.9, 1.76, -5.65, 3.75, .12, 1.05, M.darkWood, { rotation: [-.44, 0, 0] });
  for (let i = 0; i < 22; i++) addBox(z.group, 4.15 + i * .16, 1.34, -5.0, .145, .05, .34, i % 3 === 0 ? M.darkWood : M.glass, { castShadow: false });
  addBox(z.group, 5.9, .48, -3.9, 1.2, .18, .75, M.wood);
  addBox(z.group, 5.4, .23, -3.7, .1, .46, .1, M.darkWood); addBox(z.group, 6.4, .23, -3.7, .1, .46, .1, M.darkWood);
  // Lamp behind a painted window; its gold is deliberately false.
  addBox(z.group, 7.9, 2.2, -8.78, 2.0, 1.6, .1, M.warmLight, { castShadow: false });
  addBox(z.group, 7.9, 2.2, -8.66, 2.2, 1.8, .08, M.darkWood, { castShadow: false });
  addLight(z.group, 0xffac53, 3.2, 12, 7.9, 2.1, -7.4);
  // A television with no sound, a quiz show frozen on a question.
  buildCRT(z.group,-1.2,.05,-8.2);
  // The room is allowed to breathe: one wall text remains, not a slogan on every surface.
  addCandle(z.group,-5.2,.98,2.0,true);
  addLook(z.group,-4.2,1.6,-8.1,'North window','Beyond the glass, figures circle a fire in the fog. One hangs from a beam. The wind does not move it. It moves only when the room breathes.');
  addLook(z.group,2.1,2.2,-8.1,'The portrait','A family photograph. Someone has scratched away the man’s face. The grooves are still bright.');
  addDistantRitual(z.group, -4.2, -30);
  addDistantRitual(z.group, 4.5, -34);
  // Pictures face the wall, not the room.
  const frame=addBox(z.group,2.1,2.25,-8.72,1.0,.75,.08,M.gold);addBox(z.group,2.1,2.25,-8.66,.82,.58,.025,M.darkWall);
  const thermos=buildThermos(z.group,-5.4,.88,2.15);thermos.rotation.z=.12;addLook(z.group,-5.4,1.08,2.15,'Ines’s thermos','A red enamel thermos. The handle has been worn smooth. On the base, scratched into the metal: GABRI / PASSENGER SEAT. The cup still smells faintly of bitter tea.');
  // Characters.
  const ines = registerCultist(makeNPC(z.group,-6.5,-.2,'Ines',0x52483d,0),{
    line:'The kitchen stays warm even when nobody is hungry. Sit down. I have always believed that no one should die alone.',
    choices:['Who was Gabri?','Did you know what the tea would do?'],
    replies:['He sat in the passenger seat. I put the thermos between his hands because he was cold. I did not ask where the car was going.','I knew it would be gentle. That is not the same as knowing it was right.']
  });
  const ottavio = registerCultist(makeNPC(z.group,3.2,-3.6,'Ottavio',0x373735,1),{
    line:'I am deaf. I have been deaf longer than this house has been standing. They still gave me the only copy of the record.',
    choices:['How can you be the one who listened?','What did you keep?'],
    replies:['I listened with my jaw against the table. The motor stopped. The room did not. I cannot tell you whether that was sound or memory.','The part nobody else could verify. They called it custody. I called it a promise I could never test.']
  });
  const anna=addCultist(z,-5.2,1.2,'Anna',0x4a4035,0,'The soup is still warm. There is a place for a man who has been dead for forty years. Do not clear it.',['Will he come back?','Why keep serving an empty place?'],['No. But the bowl must be ready.','If I stop, the table will remember that he is gone. I cannot be the one to tell it.']);
  anna.object.position.set(-5.2,0,1.2);anna.point=anna.object.position;
  buildSoupBowl(z.group,-5.18,.84,1.23);const trowel=buildTrowel(z.group,-4.55,.82,1.18);trowel.rotation.z=1.18;
  addLook(z.group,-4.85,1.05,1.5,'The soup over the trowel','A bowl of soup sits over a mason’s trowel. You eat while the tool that could disturb a grave lies beneath the tableware. The broth is warm. The handle is wet.');
  const dario=addCultist(z,-8.0,-6.1,'Dario',0x302d28,1,'I believe in The White. I believe in it more than anyone in this house. That is why they avoid looking at me.',['Who leads the rite?','Why do they fear your belief?'],['There is no leader. Only a man who knows where to stand.','Because they are performing an emptiness they do not possess. I am not performing.']);dario.isLeader=true;
  const sergio=addCultist(z,-.8,-6.5,'Sergio',0x4a443a,0,'I stopped believing years ago. I stayed for the company. There was nowhere else to eat in peace.',['Then why not leave?','Did you know what happened in 1977?'],['Loneliness is a door that opens inward. You can walk through it and still be in the same room.','I heard the plan for Dario through the wall. I did not tell him. That is when I belonged here.']);
  addCultist(z,7.9,-6.2,'Marta',0x51483d,0,'I engrave my memoirs with a sunshine that was never there. The gold in the photograph is a lie. I remember the colour, not the day.',['Which memory is true?','Why do you keep writing?'],['The one that hurts the least is usually the one I invented.','If I stop, the memories begin to move without me.']);
  const pino=addCultist(z,8.05,.4,'Pino',0x3d423d,1,'I know how to leave. I know the road, the ditch and the combine. I have been waiting for a reason to run.',['Show me the field path.','Do not go.'],['When the machine starts, do not watch the blades. Watch the man who told you it was only work.','You can ask me to stay. You cannot make the road forget me.']);pino.isRunner=true;
  addCultist(z,8.05,6.1,'Gabri',0x544b43,1,'I wanted someone to look at me without looking through me. In the car, I thought the thermos was a gift.',['Did Ines come with you?','What did you want from The White?'],['She was kind. That was the part I trusted.','An audience. Something that would finally notice I was there.']);
  addCultist(z,.2,7.0,'Walter',0x343a37,1,'Give me a task and I can become a person for as long as it takes to finish it.',['Who gave you the last task?','What happens when it is done?'],['The man with the paperback. He never tells you to push. He only tells you where to stand.','There is always another task. That is how the room keeps its shape.']);
  addCultist(z,-7.8,6.3,'Livia',0x5a4c43,0,'I lost my speech. I kept the melody. Sometimes I can still sing the interval before the machine starts.',['Can you sing it now?','Who taught you the song?'],['No. The note has moved into my teeth.','A woman who never learned the words. She only knew when to breathe.']);
  addCultist(z,5.3,-1.3,'Franco',0x383b39,1,'I cut meat for thirty years and never once for a reason. Here, the knife finally has a liturgy.',['Do you believe in The White?','What is the difference between craft and murder?'],['I believe in the edge. The rest is a room around it.','A witness. Someone who says the work was necessary.']);
  addCultist(z,-1.4,5.3,'Ada',0x66574a,0,'There is no voice inside the tape. There is the shape a voice leaves when it has gone.',['What did you hear?','Was there ever music?'],['A chair scraping. A pipe ticking. A person breathing too close to the microphone.','I do not know. Nobody agrees on what music would have sounded like.']);
  addCultist(z,2.7,6.6,'Elio',0x34322e,1,'The thirteenth chair always faced the wall. The fourteenth had no chair at all.',['Who was the fourteenth?','Why face the wall?'],['The one who arrives after the counting has ended.','So nobody could mistake the empty place for an invitation.']);
  // A staged domestic killing: the room offers the player a choice to look.
  const annaMarker=new THREE.Mesh(new THREE.BoxGeometry(.22,.08,.22),M.clue);annaMarker.position.set(-5.2,.12,1.2);z.group.add(annaMarker);
  z.interactables.push({id:'anna_scene_trigger',type:'event',object:annaMarker,point:annaMarker.position,radius:3.2,prompt:'[ E ] LOOK AT THE EMPTY PLACE',run:()=>triggerAnnaScene(z,annaMarker)});
  const wallEar=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));wallEar.position.set(-9.25,.2,-4.9);z.group.add(wallEar);
  z.interactables.push({id:'dario-wall-listen',type:'event',object:wallEar,point:wallEar.position,radius:2.8,prompt:'[ E ] LISTEN THROUGH THE WALL',requiresFlag:'talked-ines',blockedHint:'First, speak with Ines and Ottavio.',run:startDarioEavesdrop});
  // Evidence in plain sight, once you stop looking for the album.
  addClueMesh(z.group,new THREE.Vector3(-5.2,1.1,2.0),'Seating List','A list of thirteen names. Beneath them, a fourteenth line has been erased so forcefully that it has scored the paper.','list','paper',{requiresFlag:'talked-ines',blockedHint:'Speak with Ines before examining the seating list.'});
  addClueMesh(z.group,new THREE.Vector3(5.8,1.45,-5.0),'Tuning Fork','A tuning fork. A=415 is engraved on the handle. The note does not match the one in your head.','fork','metal',{requiresFlag:'talked-ottavio',blockedHint:'Speak with Ottavio before examining the tuning fork.'});
  addClueMesh(z.group,new THREE.Vector3(1.2,.06,6.1),'The carved beam','A dog, a summer table, a room with no doors. The carvings were cut by several hands, but all share the same shallow final line.','beam','wood');
  const exit = addDoor(z.group,0,8.95,'the road','road',[0,0,-3.4]);exit.prompt='[ E ] RETURN TO THE ROAD';
  const hatch = addDoor(z.group,8.7,-6.2,'the cellar','cellar',[0,0,4.5],true,{rotationY:Math.PI/2,style:'hatch'});hatch.prompt='[ E ] DESCEND — THE CELLAR';
  // The cover is removed as soon as all eight documents have been collected.
  const hatchCover = new THREE.Group();
  hatchCover.name = 'CELLAR_HATCH_COVER';
  z.group.add(hatchCover);
  z.hatchCover = hatchCover;
  addBox(hatchCover, 8.6, .46, -5.0, 1.4, .9, 1.1, M.darkWall);
  addBox(hatchCover, 7.5, .33, -5.7, .8, .65, .7, M.rust);
  z.mist = addFog(z.group, 32, 23, 0xaeb0a9, 27);
  // Collision strips keep the player inside, leaving a gap for the front door.
  z.solids.push({ minX: -10, maxX: -9.7, minZ: -9, maxZ: 9 }, { minX: 9.7, maxX: 10, minZ: -9, maxZ: 9 }, { minX: -9, maxX: -4, minZ: 8.7, maxZ: 9 }, { minX: 4, maxX: 9, minZ: 8.7, maxZ: 9 }, { minX: -9, maxX: 9, minZ: -9, maxZ: -8.7 });
  z.solids.push({ minX: -3.5, maxX: -3.0, minZ: -5, maxZ: 2 });
  z.solids.push({ minX: 4.65, maxX: 4.95, minZ: -6, maxZ: -1 });
  return z;
}
function buildChurch() {
  const z = newZone('church', 0x222522, .042, { minX: -9, maxX: 9, minZ: -17, maxZ: 12 }, [0, 0, 9.2]);
  addBox(z.group, 0, -.14, -2, 18, .28, 30, M.darkWood);
  // Nave walls, broken upper windows and apse.
  const exposedNaveBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.0),M.brick);exposedNaveBrick.position.set(0,1.0,-16.78);z.group.add(exposedNaveBrick);
  addBox(z.group, -9, 3.2, -2, .35, 6.4, 30, M.wall); addBox(z.group, 9, 3.2, -2, .35, 6.4, 30, M.wall);
  addBox(z.group, 0, 3.0, -17, 18, 6, .35, M.darkWall); addBox(z.group, -5.0, 2.2, 12, 8, 4.4, .35, M.wall); addBox(z.group, 5.0, 2.2, 12, 8, 4.4, .35, M.wall);
  addBox(z.group, 0, 6.3, -2, 18, .25, 30, M.darkWall);
  addBox(z.group, 0, .55, -14.4, 3.6, 1.1, 1.1, M.darkWood);
  addCandle(z.group, -1.2, 1.13, -14.4, false, true);
  addCandle(z.group, 0, 1.13, -14.4, false, true);
  addCandle(z.group, 1.2, 1.13, -14.4, false, true);
  addLook(z.group,0,1.4,-13.5,'The altar','Under the cloth is a butcher’s key. On top of it sits a glass of pump water. Nobody has drunk from it.');
  // A row of broken high windows admits cold vertical light.
  for (let side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x99a5a4, transparent: true, opacity: .13, side: THREE.DoubleSide }));
    win.position.set(side * 8.78, 4.55, -12 + i * 6); win.rotation.y = side * Math.PI / 2; z.group.add(win);
  }
  // Pews, altar, rood beam and an organ that has not been maintained.
  for (let row = 0; row < 5; row++) for (let side of [-1, 1]) {
    const x = side * 3.5, zz = 5 - row * 3.7;
    addBench(z.group, x, zz, 0);
  }
  addBox(z.group, 0, 1.12, -12.0, 4.7, 1.25, 1.6, M.darkWood);
  addBox(z.group, 0, 1.82, -12.0, 5.0, .14, 1.8, M.gold);
  addBox(z.group, 0, 4.5, -15.4, .32, 7.4, .32, M.darkWood);
  addBox(z.group, 0, 7.6, -15.4, 5.2, .28, .32, M.darkWood);
  addBox(z.group, -5.9, 1.5, -13, 3.0, 2.7, 1.4, M.darkWood);
  for (let i = 0; i < 9; i++) addBox(z.group, -7.1 + i * .3, 1.65, -12.25, .055, 2.15, .06, M.gold);
  // Candles and red sanctuary light.
  for (let i = 0; i < 6; i++) { addBox(z.group, -2.1 + i * .85, 2.12, -11.3, .055, .58, .055, M.wood); addLight(z.group, 0xffa35b, .24, 3.2, -2.1 + i * .85, 2.55, -11.3); }
  addLight(z.group, 0x9d3026, 1.7, 12, 0, 4.1, -14.2);
  const remo=makeNPC(z.group,1.5,-8.2,'Don Remo',0xddd7c9,1);
  remo.dialogue={line:'I was ordained to speak to a God who no longer answers. The collar remains. The gestures remain. A vocation can outlive the thing it serves.',choices:['Do you still believe?','What happened to the choir?'],replies:['Belief is not a light. It is a room you can keep entering after the lamps have gone out.','They were waiting for a sound. The heater stood in the corner. No one wrote it into the sermon. The report says nothing certain.']};
  const bellMarker=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.18),M.clue);bellMarker.position.set(-6.8,.12,-5.8);z.group.add(bellMarker);z.interactables.push({id:'bell_event',type:'event',object:bellMarker,point:bellMarker.position,radius:2.8,prompt:'[ E ] PULL THE BELL ROPE',run:()=>{audio?.bell();triggerKillScene();}});
  addClueMesh(z.group,new THREE.Vector3(-5.8,1.7,-13.6),'Mass Register','The page lists a sequence of stations. The numbering jumps from the eleventh to the fourteenth. On the reverse: “no funeral.”','mass','paper',{requiresFlag:'talked-remo',blockedHint:'Speak with Don Remo before examining the Mass Register.'});
  addDoor(z.group,0,11.9,'the churchyard','road',[0,0,-29],false,{style:'roman'});
  z.mist = addFog(z.group, 38, 36, 0xb7bcb8, 67);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -17, maxZ: 12 }, { minX: 8.7, maxX: 9, minZ: -17, maxZ: 12 }, { minX: -9, maxX: 9, minZ: -17.3, maxZ: -17 }, { minX: -9, maxX: -5, minZ: 11.7, maxZ: 12 }, { minX: 5, maxX: 9, minZ: 11.7, maxZ: 12 });
  return z;
}
function buildRuin() {
  const z = newZone('ruin', 0x343633, .044, { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  addBox(z.group, 0, -.12, 0, 16, .24, 16, M.darkWood);
  addBox(z.group, -8, 1.9, 0, .32, 3.8, 16, M.wall); addBox(z.group, 8, 1.9, 0, .32, 3.8, 16, M.wall); addBox(z.group, 0, 1.9, -8, 16, 3.8, .32, M.wall);
  addBox(z.group, -5.2, 1.9, 8, 5.6, 3.8, .32, M.wall); addBox(z.group, 5.2, 1.9, 8, 5.6, 3.8, .32, M.wall);
  // Damp brick fragments show through the damaged limewash.
  const ruinBrick=new THREE.Mesh(new THREE.PlaneGeometry(7.2,1.2),M.brick);ruinBrick.position.set(-3.8,.72,-7.78);z.group.add(ruinBrick);
  // A ceiling hole lets a strip of white fog enter.
  addBox(z.group, -3.5, 3.65, -2.5, 7, .2, 11, M.darkWall);
  addBox(z.group, -2.1, .75, -4.4, 3.8, .22, 1.8, M.wood); addBox(z.group, -2.1, 1.1, -3.8, 3.8, .65, .12, M.rust);
  addBox(z.group, 4.8, 1.35, -4.8, 1.0, 2.6, 1.2, M.black);
  const staticScreen = new THREE.Mesh(new THREE.PlaneGeometry(.78, .58), new THREE.MeshBasicMaterial({ map: makeLabelTexture('NO SIGNAL', 512, 256), color: 0x8a8b83 })); staticScreen.position.set(4.8, 1.6, -4.16); z.group.add(staticScreen);
  addLight(z.group, 0x9caaa4, .45, 8, -4.5, 2.8, -6.0);
  const woman=makeNPC(z.group,1.4,-.5,'The Widow',0x2d302e,0);
  woman.dialogue={line:'My husband is not dead. He simply stopped answering the telephone. Eleven winters have passed.',choices:['Why do you keep the light on?','Did you know about the recording?'],replies:['Because night comes in through the sockets. The light keeps it busy.','The technician arrived with an empty suitcase. He left with a song I cannot remember.']};
  addClueMesh(z.group,new THREE.Vector3(-2.2,.95,-4.4),'Burned Photograph','A photograph of the church in 1977. In one corner, almost outside the frame, a small gas heater can be seen behind the choir.','photo','paper',{requiresFlag:'talked-widow',blockedHint:'Speak with the Widow before examining the burned photograph.'});
  addClueMesh(z.group,new THREE.Vector3(5.0,.12,1.0),'Answering Machine','An unlabelled microcassette. The tape contains only the click of the REC button and someone inhaling before speaking.','voicemail','metal',{requiresFlag:'talked-widow',blockedHint:'Speak with the Widow before examining the answering-machine tape.'});
  addDoor(z.group,0,7.95,'the road','road',[-28,0,-2]);
  z.mist = addFog(z.group, 25, 20, 0xb2b7b3, 18);
  z.solids.push({ minX: -8, maxX: -7.7, minZ: -8, maxZ: 8 }, { minX: 7.7, maxX: 8, minZ: -8, maxZ: 8 }, { minX: -8, maxX: 8, minZ: -8.2, maxZ: -8 }, { minX: -8, maxX: -2.5, minZ: 7.7, maxZ: 8 }, { minX: 2.5, maxX: 8, minZ: 7.7, maxZ: 8 });
  return z;
}
function addHangingCarcass(group,x,z,phase=0) {
  const rig=new THREE.Group();rig.position.set(x,0,z);group.add(rig);
  const chainMat=mat(0x272a27,.56,{metalness:.62,map:TEX.rust});
  const chain=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,1.35,7),chainMat);chain.position.y=3.03;rig.add(chain);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(.16,.035,7,14,Math.PI*1.35),M.rust);hook.position.y=2.30;hook.rotation.x=Math.PI/2;rig.add(hook);
  const hideMat=new THREE.MeshStandardMaterial({color:0x62544c,roughness:1,metalness:.02,transparent:true,opacity:.92,map:TEX.plaster,bumpMap:TEX.plaster,bumpScale:.045});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.55,.95,8,16),hideMat);
  torso.position.y=1.72;torso.scale.set(1.30,1.02,.68);rig.add(torso);
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.52,12,10),M.blood);shoulder.position.set(0,2.19,0);shoulder.scale.set(1.2,.58,.72);rig.add(shoulder);
  // An unmistakably bovine but partially abstract head: long muzzle, split nose,
  // ears and curved horns keep the suspended forms legible as cattle, not people.
  const skull=new THREE.Mesh(new THREE.SphereGeometry(.29,14,12),hideMat);skull.position.set(0,2.36,.39);skull.scale.set(.88,.82,1.22);rig.add(skull);
  const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.205,12,10),mat(0x4c4038,1,{map:TEX.plaster,bumpScale:.04}));muzzle.position.set(0,2.18,.66);muzzle.scale.set(1.22,.72,.8);rig.add(muzzle);
  for(const side of [-1,1]){
    const nostril=new THREE.Mesh(new THREE.SphereGeometry(.036,8,6),M.black);nostril.position.set(side*.105,2.19,.81);nostril.scale.set(.72,1,.55);rig.add(nostril);
    const ear=new THREE.Mesh(new THREE.ConeGeometry(.13,.48,7),hideMat);ear.position.set(side*.32,2.46,.24);ear.rotation.z=side*-.72;ear.rotation.x=-.18;rig.add(ear);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),M.black);eye.position.set(side*.205,2.39,.61);rig.add(eye);
    const hornCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.19,2.55,.36),new THREE.Vector3(side*.32,2.76,.31),new THREE.Vector3(side*.40,2.82,.20)]);
    const horn=new THREE.Mesh(new THREE.TubeGeometry(hornCurve,10,.045,6,false),mat(0xafa38d,.95));rig.add(horn);
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.12,.17,1.08,9),hideMat);leg.position.set(side*.37,.57,.24);leg.rotation.z=side*.12;rig.add(leg);
    const rearLeg=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,1.0,9),hideMat);rearLeg.position.set(side*.37,.57,-.28);rearLeg.rotation.z=side*.1;rig.add(rearLeg);
    for(const zoff of [.24,-.28]){
      const hoof=new THREE.Mesh(new THREE.CylinderGeometry(.16,.19,.20,8),mat(0x252522,.98));hoof.position.set(side*.37,.035,zoff);hoof.rotation.z=side*.08;rig.add(hoof);
      const cleft=new THREE.Mesh(new THREE.BoxGeometry(.022,.15,.15),M.rust);cleft.position.set(side*.37,.015,zoff);rig.add(cleft);
    }
  }
  const udder=new THREE.Mesh(new THREE.SphereGeometry(.22,10,8),mat(0x51413b,.96,{map:TEX.plaster}));udder.position.set(0,.98,-.40);udder.scale.set(1,.66,1.1);rig.add(udder);
  for(let i=0;i<4;i++){const teat=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.24,7),M.blood);teat.position.set((i-1.5)*.085,.79,-.39);rig.add(teat);}
  const tailCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.05,-.62),new THREE.Vector3(.05,1.7,-.91),new THREE.Vector3(.12,1.28,-1.02)]);
  const tail=new THREE.Mesh(new THREE.TubeGeometry(tailCurve,12,.035,6,false),hideMat);rig.add(tail);
  const tailTuft=new THREE.Mesh(new THREE.ConeGeometry(.09,.25,7),M.darkWood);tailTuft.position.set(.12,1.18,-1.02);tailTuft.rotation.x=-.2;rig.add(tailTuft);
  for(let i=0;i<7;i++){
    const rib=new THREE.Mesh(new THREE.TorusGeometry(.49-i*.012,.025,6,22,Math.PI),mat(i%2?0x54433c:0x7b685c,.92));
    rib.position.set(0,1.42+i*.19,.02);rib.rotation.x=Math.PI/2;rib.rotation.z=Math.PI;rib.scale.set(1.35,1,.62);rig.add(rib);
  }
  for(let i=0;i<3;i++){const strip=new THREE.Mesh(new THREE.PlaneGeometry(.22,.86+Math.random()*.42),new THREE.MeshStandardMaterial({color:[0x513a34,0x755d51,0x302b27][i],transparent:true,opacity:.62,side:THREE.DoubleSide,roughness:1}));strip.position.set((i-1)*.31,1.35,.42);strip.rotation.z=(i-1)*.14;rig.add(strip);}
  rig.userData.hangPhase=phase;rig.userData.hanging=true;return rig;
}
function buildAbattoir() {
  const z=newZone('abattoir',0x282522,.049,{minX:-12,maxX:12,minZ:-10,maxZ:10},[0,0,7.0]);
  const floor=mat(0x403a32,1,{map:TEX.wood,bumpScale:.14});addBox(z.group,0,-.15,0,24,.3,20,floor);
  addBox(z.group,0,2,-10,24,4,.35,M.wall);addBox(z.group,-12,2,0,.35,4,20,M.wall);addWindowedWall(z.group,'z',12,-10,10,4,.35,M.wall,[{at:-3,w:1.8,h:1.0,y:2.5},{at:3.5,w:1.6,h:1.0,y:2.5}]);addBox(z.group,0,2,10,24,4,.35,M.darkWall);
  addBox(z.group,0,4.0,0,24,.35,20,M.darkWood);
  // Brick courses, limescale, mould patches and peeled plaster leave the building legible as old masonry.
  for(let side of [-1,1]){
    const bricks=new THREE.Mesh(new THREE.PlaneGeometry(22,2.2),M.brick);bricks.position.set(side*11.78,1.12,-.2);bricks.rotation.y=side*Math.PI/2;z.group.add(bricks);
    for(let i=0;i<12;i++){const mould=new THREE.Mesh(new THREE.SphereGeometry(.35+Math.random()*.52,7,6),mat(0x29382c,1,{map:TEX.plaster}));mould.scale.set(1.8,.55,.24);mould.position.set(side*(11.55-Math.random()*.03),.8+Math.random()*2.5,-8+Math.random()*16);z.group.add(mould);}
  }
  for(let i=0;i<8;i++){const beam=addBox(z.group,-10+i*2.85,3.73,0,.16,.28,19,M.darkWood);beam.rotation.z=(Math.random()-.5)*.025;}
  addLight(z.group, 0xff3a22, 1.1, 9, -5, 3.3, 3); addLight(z.group, 0xff3a22, .9, 8, 5, 3.2, -3);
  addBox(z.group, -5, 3.45, 3, .14, .2, .14, M.black); addBox(z.group, 5, 3.45, -3, .14, .2, .14, M.black);
  addLook(z.group,11.2,3.0,-3,'East window','Outside: a larger fire, a ring of figures turning slowly, and a body suspended from a post. Someone has written a number on the glass: 13.');
  addDistantRitual(z.group, 30, -3.4);
  addDistantRitual(z.group, 32, 4.5);
  // Meat rails and overhead hoists; carcasses are sculptural, not realistic gore.
  addBox(z.group,0,3.38,-1.6,19,.16,.18,M.rust);addBox(z.group,0,3.05,-1.6,19,.08,.08,M.metal);
  const carcasses=[];[-6.5,-2.2,2.2,6.5].forEach((x,i)=>carcasses.push(addHangingCarcass(z.group,x,-1.4,i*.7)));
  // A brutalist red enclosure frames the central hanging form.
  for(const x of [-3.0,3.0])addBox(z.group,x,2.05,-5.6,.16,4.1,.16,M.rust);
  for(const y of [.25,3.9])addBox(z.group,0,y,-5.6,6,.16,.16,M.rust);
  const redLight=addLight(z.group,0x8e241d,2.2,15,0,3.2,-5.4);redLight.castShadow=true;
  const overhead=addLight(z.group,0xe1d4b4,1.4,13,0,3.8,1.3);overhead.position.y=3.7;
  for(let i=0;i<6;i++){const chain=new THREE.Mesh(new THREE.CylinderGeometry(.012,.016,.8,6),M.rust);chain.position.set(-8+i*3.2,3.35,3.3);z.group.add(chain);}
  // The room contains manifestos that contradict each other, by design.
  // The cult leader is hidden at the far end; his face is turned away until spoken to.
  const leader=makeNPC(z.group,0,-7.2,'The First',0x171716,1);leader.object.rotation.y=Math.PI; if (leader.head) leader.head.material = headMaterial();leader.dialogue={line:'I am not the leader. I am the first to understand that the room was not empty: we were taking up too much space.',choices:['Remove the tape.','Give me your place.'],replies:['There is no tape to remove. The machine turns without a reel.','The place is not mine. It is what remains when you give up your name.']};
  const eventMarker=new THREE.Mesh(new THREE.BoxGeometry(.34,.14,.34),M.clue);eventMarker.position.set(0,.12,1.7);z.group.add(eventMarker);
  z.interactables.push({id:'abattoir_ropes',type:'event',object:eventMarker,point:eventMarker.position,radius:3.0,prompt:'[ E ] CHOOSE WHAT TO DO WITH THE HOOKS',run:()=>{
    controls.unlock();dialogueOpen=true;$('speaker').textContent='THE ROOM / THE FOUR BODIES';$('subtitle').textContent='The chains are under tension. A voice comes from the floor: “If you free them, the room is left without witnesses. If you leave them, you become part of the inventory.” When you look again, one of the bodies has changed position.';speakVoice($('subtitle').textContent,'THE ROOM');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='';
    [['CUT THE CHAINS','release'],['LEAVE EVERYTHING AS IT IS','keep']].forEach(([label,id])=>{const b=document.createElement('button');b.className='dialogue-option';b.textContent=label;b.onclick=()=>{storyFlags.add(id==='release'?'released':'complicit');if(id==='release'){carcasses[1].rotation.z=.8;carcasses[1].position.y=-.3;audio?.mechanicalEvent('hoist');fear=Math.min(1,fear+.2);scheduleCultSceneFates(2,'the chains','collapse');}else{carcasses[0].rotation.z=.42;storyFlags.add('leader-trust');scheduleCultSceneFates(2,'the silence of the hooks','vanish');}if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;glitchPulse=1.3;$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),220);controls.lock();showToast(id==='release'?'THE IRON IS FREE. THE BODIES ARE NOT.':'THE MACHINE KEEPS TURNING.');};$('dialogue-options').appendChild(b);});
  }});
  // A passage that returns the player to the same room from the wrong direction.
  const loopMarker=new THREE.Mesh(new THREE.BoxGeometry(.4,.12,.4),M.gold);loopMarker.position.set(-8,.1,6.8);z.group.add(loopMarker);
  z.interactables.push({id:'impossible_threshold',type:'event',object:loopMarker,point:loopMarker.position,radius:2.6,prompt:'[ E ] CROSS THE SEWN THRESHOLD',run:()=>{playerAnchor.position.set(8.4,0,-6.8);camera.rotation.y+=Math.PI;glitchPulse=1.35;audio?.mechanicalEvent('latch');showToast('YOU ENTERED THROUGH THE SAME DOOR. THE DUST IS ON THE OTHER SIDE.');storyFlags.add('crossed-impossible');}});
  addClueMesh(z.group,new THREE.Vector3(-7.6,1.35,-7.2),'Slaughterhouse Ledger','The ledger records no animals purchased. It records thirteen names, each crossed out after a single time: 03:17.','butcher-ledger','paper');
  const ledgerEntry = z.interactables.find(item => item.id === 'butcher-ledger');
  if (ledgerEntry) ledgerEntry.radius = 4.2;
  addDoor(z.group,0,9.85,'the road','road',[27,0,29]);
  z.mist=addFog(z.group,32,27,0x8b8177,113);
  z.solids.push({minX:-12,maxX:-11.7,minZ:-10,maxZ:10},{minX:11.7,maxX:12,minZ:-10,maxZ:10},{minX:-12,maxX:12,minZ:-10.2,maxZ:-9.8},{minX:-12,maxX:-4.5,minZ:9.7,maxZ:10},{minX:4.5,maxX:12,minZ:9.7,maxZ:10});
  z.carcasses=carcasses;return z;
}

function buildCellar() {
  const z = newZone('cellar', 0x171713, .062, { minX: -9, maxX: 9, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  addBox(z.group, 0, -.15, 0, 18, .3, 16, M.darkWood);
  addBox(z.group, -9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 0, 1.8, -8, 18, 3.6, .3, M.darkWall); addBox(z.group, -4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall); addBox(z.group, 4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall);
  // Old cellar joists, posts, damp masonry and a long empty table.
  const cellarBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.4),M.brick);cellarBrick.position.set(0,1.2,-7.78);z.group.add(cellarBrick);
  for (let i = 0; i < 8; i++) { addBox(z.group, -8 + i * 2.25, 3.05, 0, .18, .2, 16, M.wood); }
  for (let x of [-7, 0, 7]) for (let zz of [-5, 0, 5]) addBox(z.group, x, 1.7, zz, .22, 3.4, .22, M.darkWood);
  addWoodTable(z.group,0,-1.0,12.8,1.12,.70,71);
  addCandle(z.group, -2, .62, -1, true, false);
  addCandle(z.group, 2, .62, -1, true, false);
  addLook(z.group,0,1.2,-4.2,'The lamp','An iron lamp above the platter. It is warm. It should not be: the power has been cut for three days.');
  // The artificial sun: harsh light in an otherwise unlit room.
  addBox(z.group, 0, 3.15, -4.8, 1.1, .16, .55, M.warmLight);
  addLight(z.group, 0xffb451, 5.8, 15, 0, 2.95, -4.3, { shadow: true, decay: 1.45 });
  // Turntable and the blank acetate. No record audio exists in this game.
  const turntableCabinet=roundedHousing(2.18,.92,1.78,.14,M.darkWood,.05);turntableCabinet.position.set(0,.88,-2.2);z.group.add(turntableCabinet);
  const plinthTop=roundedHousing(2.08,.065,1.66,.09,mat(0x24231f,.62,{metalness:.28}),.025);plinthTop.position.set(0,1.38,-2.2);z.group.add(plinthTop);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(.59, .59, .07, 48), M.metal); platter.position.set(0, 1.49, -2.2); z.group.add(platter);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.51,.51,.018,64),mat(0x111210,.24,{metalness:.45}));disc.position.set(0,1.54,-2.2);z.group.add(disc);
  const voidGrowth=new THREE.Group();voidGrowth.visible=false;voidGrowth.scale.setScalar(.001);z.group.add(voidGrowth);storyRef.voidGrowth=voidGrowth;
  const rootMat=mat(0x313b2d,.98,{map:TEX.wood,bumpScale:.12});
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2;const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a)*.48,.035,-2.2+Math.sin(a)*.48),new THREE.Vector3(Math.cos(a)*1.35,.045,-2.2+Math.sin(a)*1.2),new THREE.Vector3(Math.cos(a)*3.1,.06,-2.2+Math.sin(a)*2.2),new THREE.Vector3(Math.cos(a)*5.9,.09,-2.2+Math.sin(a)*3.6)]);voidGrowth.add(new THREE.Mesh(new THREE.TubeGeometry(curve,30,.05,6,false),rootMat));}
  for(let i=0;i<34;i++){const a=i*2.399,r=1+(i%7)*.72;const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.22+(i%3)*.07,.075),new THREE.MeshStandardMaterial({color:[0x596246,0x343f2d,0x77704d][i%3],roughness:1,side:THREE.DoubleSide,transparent:true,opacity:.92}));leaf.position.set(Math.cos(a)*r,.10+(i%4)*.05,-2.2+Math.sin(a)*r*.66);leaf.rotation.set(-.4,a,.1);voidGrowth.add(leaf);}
  const label = new THREE.Mesh(new THREE.CircleGeometry(.115, 32), mat(0xd1caba, .9)); label.rotation.x = -Math.PI / 2; label.position.set(0, 1.555, -2.2); z.group.add(label);
  const armBase=new THREE.Mesh(new THREE.CylinderGeometry(.09,.10,.09,18),M.gold);armBase.position.set(.77,1.49,-2.0);z.group.add(armBase);
  const tonearmCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.77,1.57,-2.0),new THREE.Vector3(.68,1.64,-2.05),new THREE.Vector3(.46,1.64,-2.12),new THREE.Vector3(.27,1.62,-2.25)]);z.group.add(new THREE.Mesh(new THREE.TubeGeometry(tonearmCurve,20,.025,7,false),M.gold));
  const stylus=new THREE.Mesh(new THREE.ConeGeometry(.035,.12,7),M.rust);stylus.position.set(.27,1.57,-2.25);stylus.rotation.z=Math.PI;z.group.add(stylus);
  // The 1970s transport keeps turning with no tape threaded through its guides.
  const reelDeck=buildReelRecorder(z.group,-6.15,0,-2.65,.82);storyRef.cellarReelDeck=reelDeck;
  // Thirteen individually turned chairs. Their empty places are part of the ritual.
  for(let i=0;i<13;i++){const a=i/13*Math.PI*2,x=Math.cos(a)*5.0,zz=Math.sin(a)*4.1+.3;addWoodChair(z.group,x,zz,-a+Math.PI,.92+(i%3)*.025);}

  // A human outline that could be a coat on a hook.
  const hanging=makeNPC(z.group,-7.0,-4.9,'The Coat',0x141614,1);hanging.object.scale.set(.72,1.12,.72);hanging.prompt='[ E ] EXAMINE — THE COAT';
  hanging.dialogue={line:'The sleeves are still warm. There is nobody inside.',choices:['Who left it here?','Do not touch it.'],replies:['The person who borrows other people’s clothes when he is cold.','It has already been touched. From the side you cannot see.']};
  addDoor(z.group, 0, 7.95, 'the stairs', 'home', [7.5, 0, -5.2]);
  const darkDoor=addDoor(z.group,8.25,0,'the dark room','darkroom',[0,0,9.3],true,{rotationY:Math.PI/2,style:'hatch'});darkDoor.requiresFlag='altar-lit';darkDoor.blockedHint='The three altar candles must be lit before the side door will open.';darkDoor.prompt='[ E ] ENTER THE DARK ROOM';
  const turntableEntry = { id: 'listen', type: 'listen', object: disc, point: disc.position, radius: 3.0, prompt: '[ E ] LISTEN TO THE WHITE', title: 'The White', requiresFlag:'darkroom-cleared', blockedHint:'The room has not been searched. Find what the recording contains before you listen.' };
  z.interactables.push(turntableEntry);
  z.mist = addFog(z.group, 18, 22, 0x8d8c7d, 92);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -8, maxZ: 8 }, { minX: 8.7, maxX: 9, minZ: -8, maxZ: 8 }, { minX: -9, maxX: -4.5, minZ: -8.2, maxZ: -8 }, { minX: 4.5, maxX: 9, minZ: -8.2, maxZ: -8 }, { minX: -9, maxX: -4.6, minZ: 7.7, maxZ: 8 }, { minX: 4.6, maxX: 9, minZ: 7.7, maxZ: 8 });
  return z;
}

function buildDarkroom(){
  const z=newZone('darkroom',0x030404,.115,{minX:-10,maxX:10,minZ:-12,maxZ:12},[0,0,9.2]);
  z.ambient.intensity=.055;z.moon.intensity=.035;
  const floorMat=mat(0x171714,.98,{map:TEX.concrete,bumpScale:.16});addBox(z.group,0,-.14,0,20,.28,24,floorMat);
  const wallMat=mat(0x262723,1,{map:TEX.plaster,bumpScale:.17});
  addBox(z.group,-10,2,0,.32,4,24,wallMat);addBox(z.group,10,2,0,.32,4,24,wallMat);
  addBox(z.group,0,2,-12,20,4,.32,wallMat);
  addBox(z.group,-5.9,2,12,8.2,4,.32,wallMat);addBox(z.group,5.9,2,12,8.2,4,.32,wallMat);
  // The room is a furniture maze, not a corridor kit: tables, chairs and papers make the route.
  const partitions=[
    [-5.4,5.2,.24,9.0],[-1.0,1.7,.24,7.8],[4.7,4.0,.24,8.4],
    [0,-3.1,8.8,.24],[-5.9,-7.3,7.8,.24],[5.6,-8.1,8.5,.24],
    [-7.4,-1.7,.24,5.3],[7.5,1.5,.24,5.6]
  ];
  for(const [x,zp,w,d] of partitions){
    const h=3.3,seg=addBox(z.group,x,h/2,zp,w,h,d,wallMat);
    z.solids.push({minX:x-w/2,maxX:x+w/2,minZ:zp-d/2,maxZ:zp+d/2});
    // Small flaked plaster and water marks give the partitions a lived-in, damp surface.
    for(let k=0;k<5;k++){const stain=new THREE.Mesh(new THREE.SphereGeometry(.18+Math.random()*.18,7,6),mat(k%2?0x30342d:0x403c32,1,{map:TEX.plaster}));stain.scale.set(1.4,.55,.10);stain.position.set(x+(Math.random()-.5)*w, .45+Math.random()*2.2, zp+(Math.random()-.5)*d);z.group.add(stain);}
  }
  // The chair backs and table edges hide the next turn until the lamp reaches them.
  const chairSpots=[[-7,8.0,.1],[-3.2,6.3,1.1],[1.8,7.0,-.7],[6.5,7.2,2.3],[-7,1.7,-1.2],[-3.2,-1.1,2.7],[2.2,-.8,-1.5],[7,-3.6,2.2],[-6.2,-8.4,.3],[0,-8.5,2.1],[5.8,-8.4,-1.1],[2.6,3.5,1.1]];
  chairSpots.forEach(([x,zp,r],i)=>{const ch=addWoodChair(z.group,x,zp,r,.88+(i%3)*.05);ch.userData.mazeChair=true;});
  addWoodTable(z.group,-7.1,4.0,2.15,.92,.74,41);
  addWoodTable(z.group,-1.5,-1.8,2.0,1.0,.72,43);
  addWoodTable(z.group,5.8,2.7,2.1,1.0,.74,47);
  addWoodTable(z.group,1.5,-8.7,2.35,1.0,.76,53);
  // A single dying utility lamp is wired to nothing. It does not light the maze.
  const deadLamp=new THREE.Group();deadLamp.position.set(0,3.2,-1);z.group.add(deadLamp);
  const shade=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(.18,.04),new THREE.Vector2(.31,.18),new THREE.Vector2(.28,.22)],18),M.rust);shade.position.y=.05;deadLamp.add(shade);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.018,.02,.58,8),M.darkWood);stem.position.y=-.28;deadLamp.add(stem);
  const deadBulb=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),mat(0x171614,.9));deadBulb.position.y=-.62;deadLamp.add(deadBulb);
  // Six real objects form the evidence chain. The beam reveals their surfaces; the journal preserves what it reveals.
  const heater=buildGasHeater(z.group,-7.4,0,8.8,.92);
  const heaterPoint=new THREE.Vector3(-7.4,1.15,8.8);
  addLoreProp(z,'dark-heater','The radiant heater','A portable LPG radiant heater: perforated steel hood, ceramic burner panels, a lower guard and four small castors. The gas hose is still attached. A maintenance tag reads: FLUE / AIR INTAKE — BLOCKED. The report never names carbon monoxide. It records a room that was not ventilated, thirteen bodies and a clock stopped at 03:17.','dark-heater',heater,heaterPoint,'[ E ] EXAMINE THE HEATER');
  const plugCase=buildEarplugCase(z.group,6.1,.78,3.1);
  addLoreProp(z,'dark-earplugs','The earplug case','A small brass case contains two soft wax plugs. The lid is engraved with a single initial: C. A note inside says: “Wear them before the first revolution. Stay to watch.” Corrado watched every collapse and never had to hear one.','dark-earplugs',plugCase,new THREE.Vector3(6.1,1.05,3.1),'[ E ] OPEN THE EARPLUG CASE');
  const book=buildPaperback(z.group,-1.7,.77,-1.8);
  addLoreProp(z,'dark-book','The paperback','A battered Nietzsche paperback. It is almost entirely underlined. The margins contain only durations: 4.2 seconds, 7.1 seconds, 11 seconds. “Man would rather will nothingness than not will.” The sentence is copied as an instruction. No sentence in the book tells anyone to push.','dark-book',book,new THREE.Vector3(-1.7,1.0,-1.8),'[ E ] READ THE PAPERBACK');
  const recorder=buildReelRecorder(z.group,-1.8,0,-8.6);
  addLoreProp(z,'dark-reel','The empty transport','Two reels turn. No tape is threaded through the guides. The red RECORD lamp is on; both VU needles remain below zero. The heads touch nothing. There is no music to recover — only the room tone around a machine that continues to turn.','dark-reel',recorder,new THREE.Vector3(-1.8,1.1,-8.6),'[ E ] EXAMINE THE REEL DECK');
  const reportTable=addWoodTable(z.group,7.1,7.1,2.3,1.05,.76,67);
  const report=new THREE.Group();report.position.set(7.0,.82,7.1);z.group.add(report);
  const folder=roundedHousing(.54,.035,.38,.035,mat(0x6b5942,.98),.01);folder.position.y=.015;report.add(folder);
  const sheet=new THREE.Mesh(new THREE.PlaneGeometry(.48,.32),new THREE.MeshBasicMaterial({map:makeLabelTexture('WINTER 1977\\n13 / 03:17\\nCAUSE: UNDETERMINED',512,320),side:THREE.DoubleSide}));sheet.rotation.x=-Math.PI/2;sheet.position.y=.04;report.add(sheet);
  addLoreProp(z,'dark-report','The coroner’s copy','A carbon copy from the winter of 1977. Thirteen names, a church, a room heater and thirteen times written as 03:17. “Cause undetermined” is stamped twice. A handwritten note adds: “the window latches were sealed from the inside.” It is evidence, not a verdict.','dark-report',report,new THREE.Vector3(7.0,1.0,7.1),'[ E ] READ THE CARBON COPY');
  const glyphWall=new THREE.Group();glyphWall.position.set(9.72,0,-6.0);glyphWall.rotation.y=-Math.PI/2;z.group.add(glyphWall);
  const glyphMat=mat(0x968b70,.95,{emissive:0x17120b,emissiveIntensity:.08});
  const glyphPaths=[
    [[0,0],[0,.55],[.22,.72]],[[0,.1],[.22,.48],[.42,.1]],[[.1,0],[.1,.72],[.38,.72]],
    [[0,0],[.35,.7],[.7,0]],[[0,.2],[.35,.2],[.35,.7]],[[.1,0],[.42,.32],[.1,.7]],
    [[0,0],[.3,.0],[.3,.7],[0,.7]],[[0,.7],[.2,.35],[.42,.7]],[[0,.35],[.42,.35],[.2,0],[.2,.7]],
    [[0,0],[.42,.7]],[[0,.7],[.42,0],[.42,.7]],[[.2,0],[.2,.7],[0,.35],[.42,.35]],
    [[0,.0],[.42,.7],[.42,0]],[[.42,.7],[.1,.35],[.42,0]]
  ];
  glyphPaths.forEach((path,i)=>{const glyph=new THREE.Group();glyph.position.set(-4.9+i*.72,1.0,0);path.slice(1).forEach((p,j)=>tubeBetween(glyph,[path[j][0]-.2,path[j][1]-.35,.018],[p[0]-.2,p[1]-.35,.018],.018,glyphMat,6));glyphWall.add(glyph);});
  for(let i=0;i<13;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.026,6,5),M.gold);dot.position.set(-4.9+i*.72,.74,.02);glyphWall.add(dot);}
  const reversed=new THREE.Group();reversed.position.set(5.0,1.0,.025);reversed.scale.x=-1;reversed.add(new THREE.Mesh(new THREE.TorusGeometry(.18,.018,5,16),glyphMat));glyphWall.add(reversed);
  addLoreProp(z,'dark-script','The fourteen marks','Fourteen signs have been scratched into the plaster. They resemble an alphabet but do not match any hand you know. Thirteen face the same way. The last is reversed, like a station turned back toward the person who is meant to occupy it. There is no translation. There is only a place left open.','dark-script',glyphWall,new THREE.Vector3(8.9,1.25,-6.0),'[ E ] STUDY THE FOURTEENTH MARK');
  const returnDoor=addDoor(z.group,0,11.78,'the cellar','cellar',[0,0,5.4],true,{style:'hatch'});returnDoor.requiresFlag='darkroom-cleared';returnDoor.blockedHint='The room is not finished with you. Find all six pieces of evidence first.';
  returnDoor.prompt='[ E ] RETURN TO THE CELLAR';
  z.mist=addFog(z.group,18,26,0x151613,156);z.fog=new THREE.FogExp2(z.fogColor,z.density);
  z.solids.push({minX:-10,maxX:-9.7,minZ:-12,maxZ:12},{minX:9.7,maxX:10,minZ:-12,maxZ:12},{minX:-10,maxX:-1.4,minZ:11.7,maxZ:12},{minX:1.4,maxX:10,minZ:11.7,maxZ:12},{minX:-10,maxX:10,minZ:-12.2,maxZ:-12});
  // Corrado is a moving absence. The light catches him; the dark lets him move.
  const hunter=makeNPC(z.group,7.7,-9.5,'Corrado',0x171614,1);
  const idx=z.interactables.findIndex(item=>item===hunter);if(idx>=0)z.interactables.splice(idx,1);
  hunter.object.visible=false;hunter.object.scale.set(.92,1.04,.86);hunter.object.rotation.y=Math.PI;
  hunter.dialogue={line:'You found the room. It was waiting before you were born.',choices:['What is on the tape?','Why are you following me?'],replies:['The same thing that was here before the tape: a room.','I am not following you. I am keeping the distance at which you can still choose.']};
  storyRef.darkroomHunter=hunter;darkroomHunt={active:false,elapsed:0,reappear:0,lastFlash:0};
  return z;
}
buildRoad(); buildHome(); buildChurch(); buildRuin(); buildAbattoir(); buildCellar(); buildDarkroom(); buildStoryExtras();

// The cellar is deliberately inaccessible until all eight traces have been read.
const abattoirEntrance = zones.road.interactables.find(i => i.destination === 'abattoir');
if (abattoirEntrance) abattoirEntrance.requiredClues = 7;
const cellarDoor = zones.home.interactables.find(i => i.destination === 'cellar');
if (cellarDoor) cellarDoor.requiredClues = clueCount;

// Keep document progress across refreshes. The previous build did not save
// these eight traces, so ?continue=7 provides a one-time recovery checkpoint
// for a player who was already stuck at seven.
const EVIDENCE_SAVE_KEY = 'epistassi-evidence-v1';
function persistEvidenceProgress() {
  try { localStorage.setItem(EVIDENCE_SAVE_KEY, JSON.stringify([...collected])); } catch (_) {}
}
function restoreEvidenceProgress() {
  const params = new URLSearchParams(location.search);
  if (params.get('reset') === '1') {
    try { localStorage.removeItem(EVIDENCE_SAVE_KEY); } catch (_) {}
  }
  let ids = [];
  if (params.get('continue') === '7') {
    ids = ['clipping', 'list', 'fork', 'beam', 'mass', 'photo', 'voicemail'];
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(EVIDENCE_SAVE_KEY) || '[]');
      if (Array.isArray(saved)) ids = saved.filter(id => typeof id === 'string');
    } catch (_) {}
  }
  const wanted = new Set(ids);
  for (const z of Object.values(zones)) {
    for (const item of [...z.interactables]) {
      if (item.type !== 'clue' || !wanted.has(item.id) || collected.has(item.id)) continue;
      collected.add(item.id);
      journal.push({ id: item.id, title: item.title, description: item.description, kind: item.kind || 'documento', zone: z.name });
      item.object.parent?.remove(item.object);
      const index = z.interactables.indexOf(item);
      if (index >= 0) z.interactables.splice(index, 1);
    }
  }
  if (collected.size) persistEvidenceProgress();
}
restoreEvidenceProgress();

function enterZone(name, spawn) {
  Object.values(zones).forEach(v => { v.group.visible = false; });
  zone = zones[name]; currentZone = name; zone.group.visible = true;
  playerAnchor.position.set(spawn[0], 0, spawn[2]);
  camera.position.set(0, 1.63, 0);
  velocity.set(0, 0, 0);
  scene.fog = zone.fog || new THREE.FogExp2(zone.fogColor, zone.density);
  scene.background.set(zone.fogColor);
  $('location').textContent = ({ road: 'FOG ROAD', home: 'THE HOUSE / THIRTEEN PLACES', church: 'THE DECONSECRATED CHURCH', ruin: 'THE EMPTY HOUSE', cellar: 'THE CELLAR / 14-B', darkroom: 'THE DARK ROOM / 14-B', abattoir: 'THE SLAUGHTERHOUSE / THE VOID ROOM', forest: 'THE CANAL FOREST' })[name];
  glitchPulse = Math.max(glitchPulse, .42); audio?.stinger(.32); audio?.setZone(name); if(name==='abattoir'){fear=Math.min(1,fear+.19);audio?.mechanicalEvent('hoist');} if(name==='church' && collected.size>=2 && !scenePlayed) showToast('THE BELL ROPE IS WET.'); if(name==='cellar'||name==='darkroom'){fear=Math.min(1,fear+.18);} if(name==='darkroom'){darkroomHunt.active=!storyFlags.has('darkroom-cleared');if(!storyFlags.has('darkroom-entered')){storyFlags.add('darkroom-entered');darkroomHunt.elapsed=0;darkroomHunt.reappear=3.2;startMonologue(['Corrado: The lamp is not a weapon. It is a question you can only ask in one direction.','Voice: The room is full. You cannot see what it contains.','Corrado: Find what the tape cannot carry. Do not mistake being watched for being seen.'],13);}}
  showToast(({ road: 'THE ROAD IS NOT WHERE YOU LEFT IT', home: 'NO ONE ASKED YOUR NAME', church: 'THE NAVE IS LONGER FROM THE INSIDE', ruin: 'SOMEONE IS WAITING BY THE TELEPHONE', cellar: 'THE ROOM HAS KEPT ITS HEAT', darkroom: 'THE DARK HAS BEEN ARRANGED BY HAND', forest: 'THE FOREST KEEPS YOUR POSITION', abattoir: 'HERE THE FLESH HAS A LONG MEMORY' })[name]);
  placeStalker(name); showChapterCard(name);
}
function currentPosition() { return playerAnchor.position; }
function playerInputEnabled() { return gameStarted && !gameEnded && !listeningPending && !doorTransitioning && !cultFateActive && !dialogueOpen && !journalOpen && !storyScene; }

// -----------------------------------------------------------------------------
// Sound: entirely synthesised, layered and intentionally non-musical.
// -----------------------------------------------------------------------------
class AmbientSound {
  constructor() { this.ctx = null; this.master = null; this.noiseGain = null; this.droneGain = null; this.nodes = []; this.ready = false; this.zoneGain=null; this.pulseGain=null; this.currentZone='road'; }
  async start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master = this.ctx.createGain(); this.master.gain.value = muted ? 0 : .62;
    const low = this.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 130; low.gain.value = 9;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 3.2; comp.attack.value = .02; comp.release.value = .3;
    this.master.connect(low); low.connect(comp); comp.connect(this.ctx.destination);
    // Brown-noise bed with a moving band-pass: wind, room tone, tape hiss.
    const size = this.ctx.sampleRate * 3; const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate); const data = buffer.getChannelData(0); let last = 0;
    for (let i = 0; i < size; i++) { const white = Math.random() * 2 - 1; last = (last + .025 * white) / 1.025; data[i] = last * 3.1; }
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 620;
    const hiss = this.ctx.createGain(); hiss.gain.value = .20; src.connect(filter); filter.connect(hiss); hiss.connect(this.master); src.start();
    this.nodes.push(src, filter, hiss);
    this.noiseGain = hiss;
    // Inharmonic low drone; no melody and no representation of the forbidden record.
    this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = .15; this.droneGain.connect(this.master);
    this.zoneGain=this.ctx.createGain();this.zoneGain.gain.value=.10;this.zoneGain.connect(this.master);
    this.pulseGain=this.ctx.createGain();this.pulseGain.gain.value=.025;this.pulseGain.connect(this.master);
    [55, 58.27, 82.41, 110.8].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.value = [.33, .065, .035, .025][i];
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = .05 + i * .027;
      const lg = this.ctx.createGain(); lg.gain.value = .5 + i * .17; lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(this.droneGain); o.start(); lfo.start(); this.nodes.push(o, g, lfo, lg);
    });
    // A detuned, unstable metallic cluster: bowed iron rather than a conventional score.
    [41.2,43.7,61.7,92.5,117.3].forEach((f,i)=>{const o=this.ctx.createOscillator();o.type=i%2?'sawtooth':'triangle';o.frequency.value=f;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=170+i*115;filter.Q.value=2.4;const g=this.ctx.createGain();g.gain.value=[.012,.009,.006,.004,.003][i];o.connect(filter);filter.connect(g);g.connect(this.zoneGain);o.start();this.nodes.push(o,filter,g);});
    const pulse=this.ctx.createOscillator();pulse.type='square';pulse.frequency.value=.17;const pg=this.ctx.createGain();pg.gain.value=12;pulse.connect(pg);pg.connect(this.pulseGain.gain);pulse.start();this.nodes.push(pulse,pg);
    this.ready = true; this.setZone('road'); this.scheduleKnock(); this.scheduleMechanical();
  }
  scheduleKnock() {
    if (!this.ready || !this.ctx) return;
    const delay = 9000 + Math.random() * 18000;
    setTimeout(() => { if (this.ready && !muted) this.knock(); this.scheduleKnock(); }, delay);
  }
  knock() {
    if (!this.ctx || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(76 + Math.random() * 32, t); o.frequency.exponentialRampToValueAtTime(32, t + .8);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.22, t + .035); g.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.15);
  }
  stinger(intensity = .4) {
    if (!this.ctx || !this.ready || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180 + Math.random() * 110, t); o.frequency.exponentialRampToValueAtTime(42, t + .55);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18 * intensity, t + .025); g.gain.exponentialRampToValueAtTime(.0001, t + .7);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 510; f.Q.value = .8;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + .72);
  }
  setTension(v) { if (this.droneGain && this.ctx) {this.droneGain.gain.setTargetAtTime(.10 + v * .25, this.ctx.currentTime, .7); if(this.pulseGain)this.pulseGain.gain.setTargetAtTime(.018+v*.10,this.ctx.currentTime,.8);} }
  setZone(name){if(!this.ready||!this.ctx)return;this.currentZone=name;const vals={road:.055,home:.11,church:.16,ruin:.20,cellar:.28,abattoir:.32};this.zoneGain.gain.setTargetAtTime(vals[name]??.1,this.ctx.currentTime,1.8);this.noiseGain.gain.setTargetAtTime(({road:.13,home:.2,church:.17,ruin:.26,cellar:.32,abattoir:.38})[name]??.18,this.ctx.currentTime,1.5);}
  powerSurge(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(38,t);o.frequency.exponentialRampToValueAtTime(430,t+.35);o.frequency.exponentialRampToValueAtTime(27,t+1.1);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.25,t+.04);g.gain.exponentialRampToValueAtTime(.0001,t+1.3);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+1.35);}
  bell(){if(!this.ctx)return;const t=this.ctx.currentTime;[73.4,110,146.8,221].forEach((f,i)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12/(i+1),t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+5+i);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+6+i);});}
  killSting(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();o.type='sawtooth';o.frequency.setValueAtTime(260,t);o.frequency.exponentialRampToValueAtTime(24,t+2.6);f.type='lowpass';f.frequency.value=500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.38,t+.08);g.gain.exponentialRampToValueAtTime(.0001,t+3);o.connect(f);f.connect(g);g.connect(this.master);o.start(t);o.stop(t+3.1);}
  doorCreak(){if(!this.ctx||!this.ready||muted)return;this.mechanicalNoise(.16,1700,7,.12,(Math.random()-.5)*.25);setTimeout(()=>{if(!muted){this.mechanicalNoise(1.25,430,2.1,.18,.08);this.mechanicalTone(185,48,1.2,'sawtooth',.045,.08);}},75);setTimeout(()=>{if(!muted)this.mechanicalNoise(.14,2300,8,.075,-.08);},610);}
  voidBloom(){if(!this.ctx||!this.ready||muted)return;this.mechanicalNoise(5.8,180,.48,.19,0);this.mechanicalTone(38,14,6.2,'sine',.12,0);this.whisper(4.6,-.18);}
  mechanicalNoise(duration=.7, frequency=700, q=1.2, volume=.14, pan=0) {
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime;
    const length=Math.ceil(this.ctx.sampleRate*duration);const buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate);const data=buffer.getChannelData(0);let last=0;
    for(let i=0;i<length;i++){const white=Math.random()*2-1;last=(last+.07*white)/1.07;data[i]=last*4.2;}
    const src=this.ctx.createBufferSource();src.buffer=buffer;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=q;
    const gain=this.ctx.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+Math.min(.035,duration*.28));gain.gain.setTargetAtTime(volume*.55,t+Math.min(.08,duration*.5),Math.max(.025,duration*.18));gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const stereo=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(stereo.pan)stereo.pan.value=pan;
    src.connect(filter);filter.connect(gain);gain.connect(stereo);stereo.connect(this.master);src.start(t);src.stop(t+duration+.04);
  }
  mechanicalTone(start=180,end=65,duration=1.2,type='sine',volume=.075,pan=0){
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(start,t);o.frequency.exponentialRampToValueAtTime(Math.max(15,end),t+duration);f.type='lowpass';f.frequency.value=1500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.06);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const panNode=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(panNode.pan)panNode.pan.value=pan;o.connect(f);f.connect(g);g.connect(panNode);panNode.connect(this.master);o.start(t);o.stop(t+duration+.03);
  }
  mechanicalEvent(kind=null){
    if(!this.ctx||muted)return;const zone=this.currentZone;const pan=(Math.random()-.5)*1.7;
    const pool=kind?[kind]:({road:['chain','pipe','metal','gear','hoist'],home:['hinge','drawer','glass','fridge','utensil','clock'],church:['rope','bench','organ','metal','bellows'],ruin:['telephone','cassette','hinge','pipe','latch'],cellar:['ratchet','valve','scrape','bearing','screwdriver'],abattoir:['hoist','chain','hook','meat-saw','drain','latch','hammer']})[zone]||['metal','scrape'];
    const event=pool[Math.floor(Math.random()*pool.length)];
    if(event==='hinge'){this.mechanicalNoise(1.45,380,2.8,.18,pan);this.mechanicalTone(210,74,1.35,'sawtooth',.035,pan);}
    else if(event==='drawer'){this.mechanicalNoise(.72,950,1.8,.12,pan);setTimeout(()=>this.knock(),220);}
    else if(event==='glass'){this.mechanicalNoise(.42,1850,8,.095,pan);this.mechanicalTone(620,480,.8,'sine',.025,pan);}
    else if(event==='fridge'){this.mechanicalTone(52,44,3.2,'sine',.095,pan);this.mechanicalNoise(1.7,240,1.1,.07,pan);}
    else if(event==='chain'||event==='rope'){for(let i=0;i<5;i++)setTimeout(()=>{this.mechanicalNoise(.13+Math.random()*.12,1300+Math.random()*1300,5,.08,pan);},i*95);this.mechanicalTone(175,88,1.1,'triangle',.035,pan);}
    else if(event==='gear'||event==='ratchet'){for(let i=0;i<8;i++)setTimeout(()=>{this.mechanicalNoise(.07,750+Math.random()*800,6,.09,pan);this.mechanicalTone(95+Math.random()*80,38,.12,'square',.014,pan);},i*85);}
    else if(event==='pipe'||event==='valve'||event==='bearing'){this.mechanicalNoise(1.8,220,1.7,.16,pan);this.mechanicalTone(95+Math.random()*35,28,2.3,'sawtooth',.07,pan);}
    else if(event==='telephone'){this.mechanicalTone(420,390,.6,'sine',.05,pan);this.mechanicalTone(422,397,.6,'sine',.04,pan);this.mechanicalNoise(.18,2600,7,.075,pan);}
    else if(event==='cassette'){this.mechanicalNoise(2.1,1450,1.4,.095,pan);this.mechanicalTone(68,56,2.2,'sawtooth',.035,pan);}
    else if(event==='organ'){this.mechanicalNoise(.22,900,4,.07,pan);this.mechanicalTone(71,70,2.8,'triangle',.055,pan);}
    else if(event==='bench'){this.mechanicalNoise(.8,320,2.3,.12,pan);this.mechanicalTone(115,58,.75,'sawtooth',.04,pan);}
    else if(event==='utensil'){this.mechanicalNoise(.09,2600,9,.09,pan);setTimeout(()=>this.mechanicalNoise(.12,1750,8,.055,-pan),145);}
    else if(event==='screwdriver'){this.mechanicalNoise(.34,3100,10,.12,pan);this.mechanicalTone(240,95,.48,'square',.025,pan);setTimeout(()=>this.mechanicalNoise(.24,2500,8,.08,pan),260);}
    else if(event==='scrape'){this.mechanicalNoise(2.1,510,1.1,.15,pan);this.mechanicalTone(148,46,1.9,'sawtooth',.035,pan);}
    else if(event==='hoist'||event==='hook'){for(let i=0;i<4;i++)setTimeout(()=>this.mechanicalNoise(.16,1750+Math.random()*500,7,.075,pan),i*180);this.mechanicalTone(82,39,2.8,'sawtooth',.055,pan);}
    else if(event==='meat-saw'){this.mechanicalNoise(2.0,1250,2.1,.12,pan);this.mechanicalTone(120,98,1.7,'square',.025,pan);}
    else if(event==='drain'){this.mechanicalNoise(2.5,350,1.3,.12,pan);this.mechanicalTone(43,28,2.4,'sine',.06,pan);}
    else if(event==='hammer'){for(let i=0;i<3;i++)setTimeout(()=>this.knock(),i*240);}
    else if(event==='clock'){this.mechanicalNoise(.07,2400,10,.06,pan);setTimeout(()=>this.mechanicalNoise(.07,2300,10,.05,-pan),480);this.mechanicalTone(62,60,1.5,'sine',.018,pan);}
    else if(event==='latch'){this.mechanicalNoise(.35,1350,5,.14,pan);this.mechanicalTone(220,76,.6,'triangle',.03,pan);}
    else if(event==='bellows'){this.mechanicalNoise(1.8,420,1.4,.095,pan);this.mechanicalTone(61,55,1.6,'sine',.04,pan);}
    else {this.mechanicalNoise(.95,540+Math.random()*1200,2+Math.random()*4,.13,pan);this.mechanicalTone(135+Math.random()*150,42,.85,'triangle',.04,pan);}
  }
  scheduleMechanical(){if(!this.ready)return;const delay=4300+Math.random()*11700;setTimeout(()=>{if(this.ready&&!muted)this.mechanicalEvent();this.scheduleMechanical();},delay);}
  killingAudio(){
    if(!this.ctx||!this.ready||muted)return;
    const t=this.ctx.currentTime;
    this.mechanicalNoise(2.25,310,.72,.16,(Math.random()-.5)*.7);
    this.mechanicalTone(92,18,2.4,'sawtooth',.10,(Math.random()-.5)*.4);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.11,3200,9,.13,(Math.random()-.5)*1.2);},720);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.065,1450,12,.065,(Math.random()-.5)*1.2);},910);
  }
  setDayNight(night){
    if(!this.ctx||!this.ready||!this.noiseGain)return;
    this.noiseGain.gain.setTargetAtTime(.12+night*.13,this.ctx.currentTime,3.2);
    if(this.droneGain)this.droneGain.gain.setTargetAtTime(.10+night*.12,this.ctx.currentTime,4.0);
  }
  whisper(duration = 1.6, pan = 0) {
    if (!this.ctx || !this.ready || muted) return;
    const t = this.ctx.currentTime, len = Math.ceil(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 900; bp.Q.value = 2.2;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t);
    // Syllable-like breath pulses, kept strictly in time order.
    for (let k = 0; k * .22 + .2 < duration; k++) {
      const s0 = t + k * .22 + Math.random() * .02;
      g.gain.exponentialRampToValueAtTime(.085, s0 + .05);
      g.gain.exponentialRampToValueAtTime(.012, s0 + .16);
    }
    g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    const pn = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain(); if (pn.pan) pn.pan.value = pan;
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(pn); pn.connect(this.master);
    src.start(t); src.stop(t + duration + .05);
  }
  toggle() { muted = !muted; if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : .62, this.ctx.currentTime, .08); $('sound-button').innerHTML = muted ? 'MUTED <b>[M]</b>' : 'SOUND <b>[M]</b>'; }
}
audio = new AmbientSound();

// -----------------------------------------------------------------------------
// Dialogue, journal, clues and interaction state
// -----------------------------------------------------------------------------
function showToast(text) {
  const el = $('toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}
function addLoreProp(z,id,title,description,flag,object,point,prompt){
  const entry={id,type:'story',object,point:point.clone?point:object.position.clone(),radius:2.8,prompt,title,run:()=>{
    if(storyFlags.has(flag)){showToast('THE OBJECT HAS ALREADY BEEN RECORDED.');return;}
    storyFlags.add(flag);journal.push({id,title,description,kind:'recovered document',zone:z.name});updateJournalCount();
    $('speaker').textContent=title.toUpperCase();$('subtitle').textContent=description;$('subtitle-wrap').classList.add('visible');
    clearTimeout(narrationTimer);narrationTimer=setTimeout(()=>{if(!dialogueOpen)$('subtitle-wrap').classList.remove('visible');},7600);
    flashFragment(flag.replace('dark-',''),140);audio?.mechanicalEvent('scrape');glitchPulse=Math.max(glitchPulse,.8);
    showToast('EVIDENCE RECOVERED // '+title.toUpperCase());updateMissions();completeDarkroomIfReady();
  }};
  z.interactables.push(entry);return entry;
}
function darkroomFindCount(){return ['dark-heater','dark-earplugs','dark-book','dark-reel','dark-report','dark-script'].filter(f=>storyFlags.has(f)).length;}
function completeDarkroomIfReady(){
  if(darkroomFindCount()<6||storyFlags.has('darkroom-cleared'))return;
  storyFlags.add('darkroom-cleared');darkroomHunt.active=false;
  if(storyRef.darkroomHunter)storyRef.darkroomHunter.object.visible=false;
  flashFragment('room-tone',220);audio?.mechanicalTone(67,34,3.2,'sine',.07,0);
  showToast('THE ROOM HAS BEEN RECORDED. THE DOOR IS OPEN.');
  startMonologue([
    'Tobia: The reels moved without tape. The meters did not rise. The room was the recording.',
    'Voice: No one can prove that the room was empty. The dead are not here to correct us.',
    'Tobia: I had been listening for an album. I had only been listening to the place that waited for it.'
  ],17);
  updateMissions();
}
function updateProgress() {
  const n = collected.size; $('evidence-count').textContent = `${n} / ${clueCount} CLUES`;
  $('inventory-count').textContent = String(n);
  $('progress-fill').style.width = `${n / clueCount * 100}%`;
  if (n === 0) $('objective-text').textContent = 'Find the farmhouse. Look for the place where the animals are hung.';
  else if (n < 7) $('objective-text').textContent = 'Collect 7 clues to open the House of Beasts. Follow the boardwalk east.';
  else if (n === 7) $('objective-text').textContent = currentZone === 'abattoir'
    ? '7 / 8 CLUES — Find the slaughterhouse ledger on the north-west side.'
    : '7 / 8 CLUES — The House of Beasts lies east, beyond the boardwalk. The slaughterhouse ledger is the final clue.';
  else $('objective-text').textContent = currentZone === 'cellar'
    ? '8 / 8 CLUES — Approach the black platter and press E to listen to The White.'
    : currentZone === 'home'
      ? '8 / 8 CLUES — The kitchen hatch is uncovered. Descend to the cellar.'
      : '8 / 8 CLUES — Return to the farmhouse and descend through the kitchen hatch.';
  if (abattoirEntrance) {
    const unlocked = n >= (abattoirEntrance.requiredClues || 7);
    abattoirEntrance.locked = !unlocked;
    abattoirEntrance.prompt = unlocked
      ? '[ E ] ENTER — THE HOUSE OF BEASTS'
      : `[ E ] LOCKED — 7 CLUES REQUIRED (${n}/7)`;
    if (abattoirEntrance.slab) abattoirEntrance.slab.material = unlocked ? M.wood : M.rust;
  }
  if (zones.home?.hatchCover) zones.home.hatchCover.visible = n < clueCount;
  if (cellarDoor) {
    cellarDoor.locked = n < clueCount;
    cellarDoor.prompt = n < clueCount ? `[ E ] LOCKED — ${clueCount - n} CLUES MISSING` : '[ E ] DESCEND — THE CELLAR';
    if (cellarDoor.slab) cellarDoor.slab.material = n < clueCount ? M.rust : M.wood;
  }
  $('journal-total').textContent = `${journal.length} ITEMS CATALOGUED`;
}
function updateJournalCount(){ $('journal-total').textContent = `${journal.length} ITEMS CATALOGUED`; $('inventory-count').textContent=String(journal.length); }
function collectClue(item) {
  if (collected.has(item.id)) return;
  if (item.requiresFlag && !storyFlags.has(item.requiresFlag)) { showToast(item.blockedHint || 'Speak with the relevant person first.'); return; }
  collected.add(item.id);
  journal.push({ id: item.id, title: item.title, description: item.description, kind: item.kind || 'documento', zone: currentZone });
  persistEvidenceProgress();
  updateJournalCount();
  zone.group.remove(item.object);
  zone.interactables.splice(zone.interactables.indexOf(item), 1);
  dread = Math.min(1, dread + .13); glitchPulse = Math.max(glitchPulse, .85); audio.stinger(.85);
  showToast(`CLUE RECORDED // ${item.title.toUpperCase()}`); updateProgress();
  if (collected.size === clueCount) showToast('THE HOUSE HAS FINISHED COUNTING. THE HATCH IS OPEN.');
  const next=cultRoster.find(n=>n.fate==='present'&&!isProgressCriticalCultist(n));if(next)queueCultFate(`trace ${collected.size}`,next,collected.size%3===0?'collapse':'vanish');
}
function speakVoice(text, npcName = '') {
  // No speech synthesis: the line is whispered. Its length sets the duration, the speaker sets the side.
  if (!text || !audio) return;
  const clean = String(text).replace(/^[^:]*:\s*/, '');
  const dur = Math.min(4.8, .9 + clean.length * .045);
  const seed = (npcName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const pan = ((seed % 5) - 2) * .35;
  audio.whisper(dur, pan);
  setTimeout(() => audio.whisper(dur * .6, -pan), 280 + (seed % 3) * 90);
  const sub = $('subtitle'); if (sub) { sub.classList.add('distorted'); setTimeout(() => sub.classList.remove('distorted'), dur * 1000); }
  glitchPulse = Math.max(glitchPulse, .3);
}
function openDialogue(npc) {
  if (dialogueOpen) return;
  if (npc.talkedOnce && !npc.isOpeningPrimo && !/primo|the first/i.test(npc.name || '')) { showToast('THEY HAVE NOTHING MORE TO SAY.'); return; }
  dialogueOpen = true; controls.unlock(); $('subtitle-wrap').classList.add('visible');
  $('speaker').textContent = npc.name.toUpperCase(); $('subtitle').textContent = npc.dialogue?.line || 'No answer. Only the sound of clothes.'; speakVoice(npc.dialogue?.line || 'No answer.',npc.name);
  const options = $('dialogue-options'); options.innerHTML = '';
  (npc.dialogue?.choices || ['Listen.', 'Go away.']).forEach((choice, i) => {
    const b = document.createElement('button'); b.className = 'dialogue-option'; b.innerHTML = `<b>[${i + 1}]</b>${choice}`;
    b.addEventListener('click', () => chooseDialogue(npc, i)); options.appendChild(b);
  });
  activeTarget = null; $('prompt').classList.remove('visible');
}
function chooseDialogue(npc, index) {
  if(!npc||(npc.talkedOnce&&!npc.isOpeningPrimo&&!/the first/i.test(npc.name||'')))return;
  npc.talkedOnce=true;
  let reply = npc.dialogue?.replies?.[index] || 'The answer comes from a room that does not exist.';
  const lower=(npc.name||'').toLowerCase();
  if(lower==='ines'){storyFlags.add(index===0?'ines-trust':'ines-betrayed');storyFlags.add('talked-ines');}
  if(lower==='sergio'){storyFlags.add(index===0?'sergio-truth':'sergio-silence');}
  if(lower==='dario'){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='the first'&&!npc.isOpeningPrimo){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='father remo'||lower==='don remo'){storyFlags.add('talked-remo');if(index===1)showToast('DON REMO HAS EXPLAINED THE ALTAR. LIGHT ALL THREE CANDLES.');}
  if(lower==='the widow'||lower==='widow')storyFlags.add('talked-widow');
  if(lower==='ottavio'){storyFlags.add('talked-ottavio');if(index===1)storyFlags.add('ottavio-audio');}
  if(lower==='anna')storyFlags.add(index===0?'anna-mercy':'anna-table');
  if(lower==='pino'){storyFlags.add('talked-pino');if(index===0){storyFlags.add('pino-sent');flashFragment('collapse',140);}}
  if(lower==='marta'&&index===1)flashFragment('nosebleed',120);
  if(lower==='gabri'&&index===0)flashFragment('tea',120);
  if(lower==='livia')storyFlags.add('livia-song');
  if(lower==='ottavio')flashFragment('reel',105);
  if(lower==='ines'&&index===1)flashFragment('tea',180);
  $('subtitle').textContent = reply; speakVoice(reply,npc.name); $('dialogue-options').innerHTML = '<button class="dialogue-option" id="dialogue-end"><b>[↵]</b>Say nothing more.</button>'; 
  $('dialogue-end').addEventListener('click', closeDialogue);
  glitchPulse = Math.max(glitchPulse, .28); audio.stinger(.25);
  applyConsequences(npc, index);
}
function closeDialogue() { dialogueOpen = false; $('subtitle-wrap').classList.remove('visible'); if('speechSynthesis' in window)window.speechSynthesis.cancel(); controls.lock(); }
function openJournal() {
  if (!gameStarted || gameEnded || listeningPending || dialogueOpen) return;
  journalOpen = true; controls.unlock(); $('journal').classList.add('active'); renderJournal();
}
function closeJournal() { journalOpen = false; $('journal').classList.remove('active'); if (gameStarted && !gameEnded) controls.lock(); }
function renderJournal() {
  const list = $('journal-list'); list.innerHTML = '';
  if (!journal.length) { list.innerHTML = '<div class="empty-note">No clues recorded.<br><br>The house is not visible yet.</div>'; return; }
  journal.forEach((entry, i) => {
    const b = document.createElement('button'); b.className = `journal-entry${i === 0 ? ' active' : ''}`;
    b.innerHTML = `<small>${String(i + 1).padStart(2, '0')} / ${entry.zone.toUpperCase()}</small><strong>${entry.title}</strong>`;
    b.addEventListener('click', () => {
      list.querySelectorAll('.journal-entry').forEach(x => x.classList.remove('active')); b.classList.add('active');
      $('journal-detail').innerHTML = `<div class="detail-stamp">EPISTASSI / CLUE ${String(i + 1).padStart(2, '0')}</div><h3>${entry.title}</h3><p>${entry.description}</p><div class="detail-foot">FOUND IN: ${entry.zone.toUpperCase()} · KEPT IN THE JOURNAL</div>`;
    });
    list.appendChild(b);
  });
  list.querySelector('.journal-entry')?.click();
}
function inspectTarget(item) {
  if(item.requiresFlag&&!storyFlags.has(item.requiresFlag)){showToast(item.blockedHint||'The way is not open yet.');audio?.stinger(.22);return;}
  if (item.type === 'clue') { collectClue(item); return; }
  if (item.type === 'event') { if(item.used)return;item.used=true;const ix=zone.interactables.indexOf(item);if(ix>=0)zone.interactables.splice(ix,1);item.run?.();return; }
  if (item.type === 'npc') { openDialogue(item); return; }
  if (item.type === 'door') {
    const required = item.requiredClues ?? (item.locked ? clueCount : 0);
    if (collected.size < required) {
      showToast(`${required - collected.size} CLUES MISSING. THE DOOR DOES NOT RECOGNISE YOUR HANDS.`);
      audio.stinger(.22);
      return;
    }
    activateDoor(item); return;
  }
  if (item.type === 'listen') { beginListening(); return; }
  if (item.type === 'look') { showLook(item); return; }
  if (item.type === 'tool') { tools.add(item.tool); const ix = zone.interactables.indexOf(item); if (ix >= 0) zone.interactables.splice(ix, 1); item.object.parent?.remove(item.object); showToast(`TAKEN: ${item.title.toUpperCase()}`); audio.stinger(.4); updateMissions(); return; }
  if (item.type === 'candle') { lightCandle(item.candle); return; }
  if (item.type === 'dig') { return; }
  if (item.type === 'egg') { collectRelic(item); return; }
  if (item.type === 'story') { item.run(); return; }
}
function activateDoor(item){
  if(doorTransitioning||item._opening)return;doorTransitioning=true;item._opening=true;keys.clear();audio?.doorCreak();
  const pivot=item.doorPivot;
  if(!pivot){setTimeout(()=>{doorTransitioning=false;item._opening=false;enterZone(item.destination,item.spawn);},360);return;}
  const from=pivot.rotation.y,to=item.openAngle??-1.08,start=performance.now(),duration=520;
  const swing=()=>{const k=Math.min(1,(performance.now()-start)/duration),ease=1-Math.pow(1-k,3);pivot.rotation.y=from+(to-from)*ease;if(k<1)requestAnimationFrame(swing);else setTimeout(()=>{doorTransitioning=false;item._opening=false;enterZone(item.destination,item.spawn);},110);};swing();
}
function beginListening(){
  if(collected.size<clueCount){showToast('THE PLATTER IS EMPTY. COLLECT ALL EIGHT CLUES.');return;}
  if(!storyFlags.has('altar-lit')){showToast('THE ALTAR IS STILL DARK. LIGHT ALL THREE CANDLES FIRST.');return;}
  if(!storyFlags.has('darkroom-cleared')){showToast('THE DARK ROOM HAS NOT BEEN SEARCHED. FIND THE SIX RECORDS OF WHAT HAPPENED.');return;}
  if(!storyFlags.has('corrado-tea')){showToast('THE FIRST IS STILL IN THE SLAUGHTERHOUSE. ASK HIM ABOUT THE EARPLUGS.');return;}
  storyFlags.add('listened-to-white');
  if (listeningPending || gameEnded) return;
  // Lock the player inside the listening room. Every remaining cultist is brought
  // into view and receives a visible fate before the ending choices are revealed.
  listeningPending=true;controls.unlock();keys.clear();hiddenBreath=false;activeTarget=null;
  camera.position.set(0,1.63,0);camera.rotation.z=0;cameraDirector.active=false;cameraDirector.cooldown=999;playerRig.visible=false;occludeMat.opacity=0;occludeRight.material.opacity=0;
  $('hud').classList.add('hidden-hud');$('prompt').classList.remove('visible');
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(.26,audio.ctx.currentTime,1.2);
  cultRoster.filter(n=>n.fate==='present').forEach((npc,i)=>queueCultFate('the turn of the record',npc,isProgressCriticalCultist(npc)?'vanish':(i%4===0?'collapse':'vanish')));
  showToast('THIRTEEN NAMES. THE ROOM WANTS TO WATCH THEM LEAVE.');
  speakVoice('Do not lower your eyes. The room must empty before you can choose.','RECORDING 14-B');
  if(!cultFateActive && cultFateQueue.length===0) finishListening();
}
function finishListening(){
  if(!listeningPending)return;listeningPending=false;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');
  $('ending-screen').classList.remove('active');$('ending-choices').classList.remove('visible');$('ending-result').classList.remove('visible');
  $('ending-title').textContent='The White Was Not Heard.';$('ending-copy').textContent='The silence did not remain in the room.';$('ending-small').textContent='THE FOG IS NOT A BORDER.';
  playerAnchor.position.set(0,0,0);camera.position.set(0,1.63,0);camera.rotation.set(0,0,0);
  const growth=storyRef.voidGrowth;if(growth){growth.visible=true;growth.scale.setScalar(.001);}
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(.34,audio.ctx.currentTime,1.4);
  storyScene={type:'ending',t:0,dur:22,i:0,switched:false,lines:[
    [.6,'Voice: The room does not become empty. It lends its emptiness to the weather.'],
    [4.8,'Voice: The fog is not a veil. It is what remains when a name stops insisting on its outline.'],
    [9.4,'The First: You see? Nothing has been taken from you. You are only returning what you have been calling yourself.'],
    [14.2,'Voice: The reeds bend toward the hollow. The trees make room without asking what has left.'],
    [19,'Voice: For a moment, the world has no witness. It does not stop growing.']
  ]};audio?.voidBloom();
}
function revealEndingChoices(){
  storyScene=null;$('subtitle-wrap').classList.remove('visible');$('ending-screen').classList.add('active');
  $('ending-title').textContent='The White Was Not Heard.';$('ending-copy').textContent='The turntable is still in the cellar. The forest has made a place the size of a person.';
  $('ending-small').textContent='THE THIRTEEN HAVE LEFT. WHAT YOU LEFT BEHIND REMAINS.';$('ending-choices').classList.add('visible');
  $('ending-testimony').style.display=storyFlags.has('grave-revealed')?'':'none';$('ending-result').classList.remove('visible');
}

function resolveEnding(choice) {
  const choices={
    testimony:{title:'The Names Took Root',copy:'You spoke the thirteen names as people call to one another from a window. In the forest, thirteen leaves stopped against the wind. They did not return. But for the first time they were no longer only erased shapes. The fog let the light pass without dissolving them.',small:'ENDING IV / TESTIMONY',voice:'Aurelio. Ines. Dario. Sergio. You are not the record. You were here.'},
    fill:{title:'The Place Learned Your Name',copy:'You let The First call you by name, and you stopped correcting him. The figure in the forest filled its coat with your absence. The house remains lit: someone must open the door for the next arrival.',small:'ENDING I / FILLING',voice:'They did not take you away. They convinced you to leave your place.'},
    expose:{title:'The Room Gave Back Its Breath',copy:'You opened the windows. Air entered from the forest and crossed the house without asking permission. The fog carried the dust outside, but left a dry outline on the floor: the place you occupied. There is no salvation in the void; there is at least room to breathe.',small:'ENDING II / AIR',voice:'The room was saturated. Truth cannot return the dead, but it can return air.'},
    preserve:{title:'The Fog Preserved the Shape',copy:'You touched nothing. The windows remain closed, the trees move out of time, and the platter keeps turning without tape. The figure that resembles you remains among the trunks, intact only because nobody looks at it long enough.',small:'ENDING III / PRESERVATION',voice:'You did not choose. Even the fog knows how to preserve a shape.'}
  };
  const result={...(choices[choice]||choices.preserve)};
  if(choice==='expose' && storyFlags.has('sergio-truth')) result.copy='Sergio left you the report: carbon monoxide, blocked ventilation, thirteen people dead before they could hear the record. You opened the windows. The explanation cannot return them, but it breaks the liturgy. The report remains a theory, not a verdict.';
  if(choice==='fill' && storyFlags.has('accepted-leader')) result.copy='You took Dario’s place. He was not the leader: he was only the first to empty himself. Your name is engraved on the fourteenth chair, beneath the other thirteen.';
  if(choice==='preserve' && storyFlags.has('crossed-impossible')) result.copy='The sewn threshold returned you to the same room, but from the opposite wall. You left the platter turning. When you leave, the door opens inward onto the room you have just left.';
  if(choice==='fill' && storyFlags.has('released')) result.copy += ' You cut the chains but freed nobody: the place was filled by a choice you can no longer withdraw.';
  if(choice==='expose' && storyFlags.has('complicit')) result.copy += ' You left the hooks untouched when you could have acted; the truth arrives, but it is not innocent.';
  $('ending-title').textContent=result.title;$('ending-copy').textContent=result.copy;$('ending-small').textContent=result.small;
  $('ending-choices').classList.remove('visible');$('ending-result').classList.add('visible');
  storyFlags.add(`ending-${choice}`);speakVoice(result.voice,'RECORDING 14-B');
  $('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),420);
  glitchPulse=1.4;audio?.killSting();
  if(choice==='preserve'){fear=1;}
}
// -----------------------------------------------------------------------------
// Weather and an intrusive camera director: the camera sometimes behaves like
// a hidden observer rather than a neutral first-person instrument.
// -----------------------------------------------------------------------------
const rainGeometry=new THREE.BufferGeometry();const rainCount=1150;const rainPositions=new Float32Array(rainCount*3);
for(let i=0;i<rainCount;i++){rainPositions[i*3]=(Math.random()-.5)*32;rainPositions[i*3+1]=Math.random()*16;rainPositions[i*3+2]=(Math.random()-.5)*32;}
rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rainPoints=new THREE.Points(rainGeometry,new THREE.PointsMaterial({color:0x9ba7a5,size:.045,transparent:true,opacity:.23,depthWrite:false,sizeAttenuation:true}));scene.add(rainPoints);
const rainStreakArray=new Float32Array(260*6);const rainStreakGeometry=new THREE.BufferGeometry();rainStreakGeometry.setAttribute('position',new THREE.BufferAttribute(rainStreakArray,3));
const rainStreaks=new THREE.LineSegments(rainStreakGeometry,new THREE.LineBasicMaterial({color:0x9daaa8,transparent:true,opacity:.14}));scene.add(rainStreaks);
const weatherState={lightning:0,nextLightning:36+Math.random()*38,wind:0};
const playerRig=new THREE.Group();playerRig.visible=false;controls.getObject().add(playerRig);
const playerCoat=new THREE.Mesh(new THREE.CapsuleGeometry(.29,.66,5,9),M.darkWood);playerCoat.position.y=.98;playerRig.add(playerCoat);
const playerHead=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),M.black);playerHead.position.y=1.58;playerRig.add(playerHead);
for(const x of [-.34,.34]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.46,4,7),M.darkWood);arm.position.set(x,.97,0);arm.rotation.z=x<0?-.13:.13;playerRig.add(arm);}
const directorOccluder=new THREE.Group();camera.add(directorOccluder);
const occludeMat=new THREE.MeshBasicMaterial({color:0x080907,transparent:true,opacity:.0,depthWrite:false,side:THREE.DoubleSide});
const occludeLeft=new THREE.Mesh(new THREE.PlaneGeometry(.34,2.3),occludeMat);occludeLeft.position.set(-.92,.02,-.64);directorOccluder.add(occludeLeft);
const occludeRight=new THREE.Mesh(new THREE.PlaneGeometry(.24,2.1),occludeMat.clone());occludeRight.material.opacity=0;occludeRight.position.set(.94,.02,-.72);directorOccluder.add(occludeRight);
const cameraDirector={timer:0,cooldown:0,active:false,side:1,phase:0,roll:0};
const ambientNightColor=new THREE.Color(0x202b3d), ambientDayColor=new THREE.Color(0xb8c0b3);
const moonNightColor=new THREE.Color(0x53648c), moonDayColor=new THREE.Color(0xffd7aa);
function updateDayNight(dt,t) {
  const phase=((elapsed/265)+.72)%1;
  const sun=Math.max(0,Math.sin((phase-.20)*Math.PI*2)*.5+.5);
  const night=1-sun;dayNightBlend=night;
  const isOutside=currentZone==='road'||currentZone==='ruin';
  for(const z of Object.values(zones)){
    z.ambient.intensity=z.name==='road'||z.name==='ruin' ? .12+sun*.54 : z.name==='abattoir' ? .12+sun*.04 : .11+sun*.18;
    if(isOutside)z.ambient.color.lerpColors(ambientNightColor,ambientDayColor,sun);else z.ambient.color.setHex(0x77736a);
    z.moon.intensity=z.name==='road'||z.name==='ruin' ? .14+night*.48 : .22;
    if(isOutside)z.moon.color.lerpColors(moonNightColor,moonDayColor,sun);else z.moon.color.setHex(0xc0b49c);
  }
  if(isOutside){
    const dawn=new THREE.Color(0x777f80),day=new THREE.Color(0xb9beb5),nightCol=new THREE.Color(0x171e2c);
    const sky=new THREE.Color().lerpColors(nightCol,day,sun);
    if(sun<.24)sky.lerp(dawn,Math.sin((.24-sun)/.24*Math.PI)*.24);
    scene.background.copy(sky);if(scene.fog?.color)scene.fog.color.copy(sky);
    if(sun<.22&&lastDayAnnouncement!=='NIGHT'){lastDayAnnouncement='NIGHT';showToast('DAYLIGHT HAS LEFT THE CANAL.');}
    else if(sun>.72&&lastDayAnnouncement!=='DAWN'){lastDayAnnouncement='DAWN';showToast('LIGHT RETURNS WITHOUT THE SUN.');}
  }
  audio?.setDayNight(night);
  const wind=.5+Math.sin(t*.00013)*.5;
  for(const tree of windTrees){if(!tree.parent)continue;const a=Math.sin(t*.0007+tree.userData.windPhase)*(.008+wind*.018);tree.rotation.z=a;tree.rotation.x=Math.cos(t*.00053+tree.userData.windPhase)*.012;}
  for(const plant of cropPlants){if(!plant.parent)continue;const sway=Math.sin(t*.0011+plant.userData.windPhase)*plant.userData.windBase;plant.rotation.z=sway;plant.userData.leaves.forEach((leaf,i)=>{leaf.rotation.z=(i%2?1:-1)*(.5+sway);});}
  for(const leaf of leafSpecks){leaf.position.x+=Math.sin(t*.0003+leaf.position.z)*dt*.09;leaf.position.z+=Math.cos(t*.00025+leaf.position.x)*dt*.06;}
}
function updateWeather(dt,t){
  const p=currentPosition();const outdoors=currentZone==='road'||currentZone==='ruin';rainPoints.visible=outdoors;rainStreaks.visible=outdoors;
  if(outdoors){rainPoints.position.set(p.x,0,p.z);const a=rainGeometry.attributes.position.array;
    for(let i=0;i<rainCount;i++){const ix=i*3;a[ix+1]-=dt*(9+Math.sin(i)*2);a[ix]-=dt*.6;if(a[ix+1]<.3){a[ix+1]=12+Math.random()*5;a[ix]=(Math.random()-.5)*32;a[ix+2]=(Math.random()-.5)*32;}}rainGeometry.attributes.position.needsUpdate=true;
    for(let i=0;i<260;i++){const x=(Math.random()-.5)*30,z=(Math.random()-.5)*30,y=Math.random()*13;rainStreakArray[i*6]=x;rainStreakArray[i*6+1]=y;rainStreakArray[i*6+2]=z;rainStreakArray[i*6+3]=x-.08;rainStreakArray[i*6+4]=y-.42;rainStreakArray[i*6+5]=z;}rainStreakGeometry.attributes.position.needsUpdate=true;rainStreaks.position.set(p.x,0,p.z);
  }
  weatherState.nextLightning-=dt;if(weatherState.nextLightning<=0&&outdoors){weatherState.lightning=.18;weatherState.nextLightning=38+Math.random()*55;glitchPulse=Math.max(glitchPulse,.7);}
  if(weatherState.lightning>0){weatherState.lightning-=dt;const flash=weatherState.lightning>0?Math.sin(Math.PI*(weatherState.lightning/.18))*1.4:0;const amb=zone?.ambient;if(amb)amb.intensity=.18+flash;}
  if(zone?.mist)zone.mist.rotation.y=Math.sin(t*.00007)*.012;
}
function updateCameraDirector(dt,t){
  cameraDirector.cooldown=Math.max(0,cameraDirector.cooldown-dt);
  const p=currentPosition();
  // Narrow thresholds and furniture can briefly force an over-shoulder, obstructed framing.
  const cover = (currentZone==='home'&&(Math.abs(p.x+3.2)<1.35||Math.abs(p.x-4.8)<1.1)) ||
    (currentZone==='church'&&Math.abs(Math.abs(p.x)-3.5)<.8&&p.z<7&&p.z>-11) ||
    (currentZone==='ruin'&&p.z<-2.8&&Math.abs(p.x+2.1)<1.2) ||
    (currentZone==='cellar'&&Math.abs(p.x)<1.1&&p.z<1.2&&p.z>-3.5) ||
    (currentZone==='abattoir'&&Math.abs(p.x)<3.8&&p.z<-3.5);
  if(!dialogueOpen&&!journalOpen&&!cameraDirector.active&&cameraDirector.cooldown<=0&&((cover&&Math.random()<.012)|| (fear>.38&&elapsed>24&&Math.random()<.0009))){
    cameraDirector.active=true;cameraDirector.timer=1.35+Math.random()*1.7;cameraDirector.side=Math.random()<.5?-1:1;cameraDirector.phase=0;cameraDirector.roll=(Math.random()-.5)*.035;
    showToast('THE RECORDING IS NOT BEHIND YOUR EYES.');
  }
  if(cameraDirector.active){cameraDirector.timer-=dt;cameraDirector.phase=Math.min(1,cameraDirector.phase+dt*1.7);const fade=cameraDirector.timer<.7?Math.max(0,cameraDirector.timer/.7):1;const pull=cameraDirector.phase*fade;
    const desiredZ=2.1*pull, desiredX=cameraDirector.side*.34*pull;
    camera.position.x+= (desiredX-camera.position.x)*Math.min(1,dt*4.5);camera.position.z+=(desiredZ-camera.position.z)*Math.min(1,dt*4.2);
    camera.rotation.z+=(cameraDirector.roll*pull-camera.rotation.z)*Math.min(1,dt*3.5);
    playerRig.visible=pull>.18;occludeMat.opacity=.68*pull;occludeRight.material.opacity=.46*pull;
    if(cameraDirector.timer<=0){cameraDirector.active=false;cameraDirector.cooldown=30+Math.random()*28;}
  }else{
    camera.position.x+=(0-camera.position.x)*Math.min(1,dt*3.5);camera.position.z+=(0-camera.position.z)*Math.min(1,dt*3.5);camera.rotation.z+=(0-camera.rotation.z)*Math.min(1,dt*2.5);
    playerRig.visible=false;occludeMat.opacity+=(0-occludeMat.opacity)*Math.min(1,dt*4);occludeRight.material.opacity+=(0-occludeRight.material.opacity)*Math.min(1,dt*4);
  }
  // Unstable handheld drift remains present even when the hidden camera is inactive.
  camera.rotation.z+=Math.sin(t*.00083)*.0007*(1+fear*2);
}

// -----------------------------------------------------------------------------
// Player, flashlight and target selection
// -----------------------------------------------------------------------------
const flashlight = new THREE.SpotLight(0xe4e3d6, 4.6, 25, Math.PI / 7.5, .48, 1.35);
flashlight.position.set(0, 0, 0); flashlight.target.position.set(0, 0, -8); flashlight.castShadow = true; flashlight.shadow.mapSize.set(512, 512);
camera.add(flashlight); camera.add(flashlight.target);
const fillFlash = new THREE.PointLight(0xe3e2d9, .25, 4); fillFlash.position.set(0, -.2, -.3); camera.add(fillFlash);
function toggleFlashlight() { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; fillFlash.visible = flashlightOn; $('torch-state').textContent = flashlightOn ? 'ON' : 'OFF'; audio.stinger(.18); }
function findTarget() {
  if (!zone || !playerInputEnabled()) return null;
  controls.getDirection(forward); camera.getWorldPosition(cameraWorld);
  let best = null; let bestScore = Infinity;
  for (const item of zone.interactables) {
    if (!item.object || !item.object.parent) continue;
    const p = item.point || item.object.position; targetVec.set(p.x, p.y + (item.type === 'npc' ? 1.15 : .25), p.z);
    const dist = cameraWorld.distanceTo(targetVec); if (dist > (item.radius || 3.0)) continue;
    const dir = targetVec.clone().sub(cameraWorld).normalize(); const dot = forward.dot(dir);
    if (dot < .58) continue;
    const score = dist + (1 - dot) * 2.1;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  return best;
}
function updatePlayer(dt) {
  if (!playerInputEnabled()) return;
  const sprinting=keys.has('ShiftLeft') || keys.has('ShiftRight'); const speed = sprinting ? 5.3 : 3.15; if(sprinting&&wishVec.lengthSq()>.1)fear=Math.min(1,fear+dt*.012);
  const f = hiddenBreath ? 0 : ((keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0) - ((keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0);
  const s = hiddenBreath ? 0 : ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0) - ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0);
  controls.getDirection(forward); forward.y = 0; forward.normalize();
  rightVec.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  wishVec.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(rightVec, s);
  if (wishVec.lengthSq() > 1) wishVec.normalize();
  velocity.x += (wishVec.x * speed - velocity.x) * Math.min(1, dt * 7.5);
  velocity.z += (wishVec.z * speed - velocity.z) * Math.min(1, dt * 7.5);
  if (wishVec.lengthSq() === 0) { velocity.x *= Math.max(0, 1 - dt * 5); velocity.z *= Math.max(0, 1 - dt * 5); }
  const p = currentPosition(); const nx = p.x + velocity.x * dt; const nz = p.z + velocity.z * dt;
  const b = zone.bounds; const r = .34;
  const collides = (x, z) => zone.solids.some(o => x + r > o.minX && x - r < o.maxX && z + r > o.minZ && z - r < o.maxZ);
  if (nx >= b.minX && nx <= b.maxX && !collides(nx, p.z)) p.x = nx; else velocity.x = 0;
  if (nz >= b.minZ && nz <= b.maxZ && !collides(p.x, nz)) p.z = nz; else velocity.z = 0;
  const moving = Math.abs(velocity.x) + Math.abs(velocity.z) > .5;
  camera.position.y = 1.63 + (moving ? Math.sin(elapsed * 9.2) * .023 : Math.sin(elapsed * 1.4) * .006);
}
function updateTargets() {
  activeTarget = findTarget();
  const prompt = $('prompt'); const cross = $('center-mark');
  if (activeTarget) { prompt.textContent = activeTarget.prompt; prompt.classList.add('visible'); cross.classList.add('targeted'); }
  else { prompt.classList.remove('visible'); cross.classList.remove('targeted'); }
}

// -----------------------------------------------------------------------------
// Input and interface
// -----------------------------------------------------------------------------
function requestMouseLock() {
  // Browsers with strict privacy/input policies may reject pointer lock. That must
  // not disable keyboard movement; the game has a click-and-drag look fallback.
  try {
    const result = controls.lock();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_) {
    showToast('MOUSE FREE — WASD ACTIVE, DRAG TO LOOK.');
  }
}
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  keys.clear();
  $('start-screen').classList.remove('active');
  enterZone('road', [0, 0, 29]);
  startIntro();
  $('hud').classList.remove('hidden-hud');
  audio.start().catch(() => {});
  requestMouseLock();
}
$('start-button').addEventListener('click', startGame);
$('journal-button').addEventListener('click', openJournal);
$('journal-close').addEventListener('click', closeJournal);
$('sound-button').addEventListener('click', () => audio.toggle());
$('return-button').addEventListener('click', () => { clearSavedEvidence(); location.reload(); });
$('retry-button').addEventListener('click',()=>{ clearSavedEvidence(); location.reload(); });
$('ending-fill').addEventListener('click',()=>finaleThen('fill'));
$('ending-expose').addEventListener('click',()=>finaleThen('expose'));
$('ending-preserve').addEventListener('click',()=>finaleThen('preserve'));
$('ending-testimony').addEventListener('click',()=>finaleThen('testimony'));
controls.addEventListener('unlock', () => {
  fallbackLookDragging = false;
  if (gameStarted && !dialogueOpen && !journalOpen && !gameEnded) $('prompt').classList.remove('visible');
});
document.addEventListener('pointerlockerror', () => {
  if (playerInputEnabled()) showToast('MOUSE LOCK UNAVAILABLE — WASD WORKS, DRAG TO LOOK.');
});

window.addEventListener('mousedown', (e) => { if (e.button === 2 && playerInputEnabled()) rightMouse = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) rightMouse = false; });
window.addEventListener('contextmenu', (e) => { if (gameStarted) e.preventDefault(); });
const movementCodes = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (playerInputEnabled() && movementCodes.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF' && !e.repeat && playerInputEnabled()) toggleFlashlight();
  if(e.code==='KeyQ' && playerInputEnabled() && !e.repeat){hiddenBreath=true;showToast('HOLD YOUR BREATH. DO NOT MOVE.');}
  if (e.code === 'KeyM' && !e.repeat) audio.toggle();
  if (e.code === 'Tab' && !e.repeat && !listeningPending) { e.preventDefault(); journalOpen ? closeJournal() : openJournal(); }
  if (e.code === 'KeyE' && playerInputEnabled() && activeTarget) inspectTarget(activeTarget);
  if (dialogueOpen && (e.code === 'Digit1' || e.code === 'Digit2')) $('dialogue-options').querySelectorAll('button')[Number(e.code.slice(-1)) - 1]?.click();
  if (dialogueOpen && e.code === 'Escape') closeDialogue();
});
window.addEventListener('keyup', e => {keys.delete(e.code);if(e.code==='KeyQ')hiddenBreath=false;});
window.addEventListener('blur', () => { keys.clear(); hiddenBreath = false; fallbackLookDragging = false; });

// Mouse-look fallback: hold the mouse button and drag over the scene if the
// browser refuses Pointer Lock. Keyboard movement works with or without it.
let fallbackLookDragging = false;
let fallbackPointerX = 0;
let fallbackPointerY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!playerInputEnabled() || controls.isLocked) return;
  fallbackLookDragging = true;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
window.addEventListener('pointermove', (e) => {
  if (!fallbackLookDragging || controls.isLocked || !playerInputEnabled()) return;
  const dx = e.clientX - fallbackPointerX;
  const dy = e.clientY - fallbackPointerY;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  camera.rotation.order = 'YXZ';
  camera.rotation.y -= dx * 0.0024;
  camera.rotation.x -= dy * 0.0024;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x, -Math.PI / 2 + 0.04, Math.PI / 2 - 0.04);
});
window.addEventListener('pointerup', () => { fallbackLookDragging = false; });
window.addEventListener('pointercancel', () => { fallbackLookDragging = false; });
canvas.addEventListener('click', () => {
  if (playerInputEnabled() && !controls.isLocked) requestMouseLock();
});
canvas.addEventListener('contextmenu', (e) => { if (gameStarted) e.preventDefault(); });

// -----------------------------------------------------------------------------
// Ambient motion and render loop
// -----------------------------------------------------------------------------

// =============================================================================
// v3.2: lamps and candles, distant rituals, windows, looks, digging, missions,
// the approaching Il Primo, dialogue consequences, chapter cards, lens and zoom.
// =============================================================================
function addCandle(group, x, y, z, lit = true, interactive = false) {
  const root = new THREE.Group(); root.position.set(x, y, z); group.add(root);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.03, .036, .2, 8), mat(0xd9d0b4, .8)); wax.position.y = .1; root.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  flame.scale.set(1, 1.7, 1); flame.position.y = .23; root.add(flame);
  const light = new THREE.PointLight(0xffa24a, lit ? .9 : 0, 4.2, 2); light.position.set(0, .3, 0); root.add(light);
  const c={root,wax,flame,light,lit,destroyed:false,base:.9,phase:Math.random()*9};
  candles.push(c);
  if (interactive) {
    const entry = { id: `candle_${x}_${z}`, type: 'candle', object: root, point: root.position, radius: 2.1, prompt: '[ E ] LIGHT THE CANDLE', candle: c };
    c.entry = entry; group.userData.interactables.push(entry);
  }
  return c;
}
function updateCandles(t) {
  for (const c of candles) {
    if (!c.lit) { c.light.intensity = 0; c.flame.visible = false; continue; }
    c.flame.visible = true;
    const v = .78 + .22 * Math.sin(t * .011 + c.phase) + .12 * Math.sin(t * .037 + c.phase * 2.3) + (Math.random() - .5) * .12;
    c.light.intensity = c.base * Math.max(.2, v);
    c.flame.scale.set(1 + (v - .8) * .3, 1.7 + (v - .8) * .6, 1);
  }
}
function refreshCandlePrompts(){candles.forEach(c=>{for(const z of Object.values(zones)){const entry=z.interactables.find(item=>item.type==='candle'&&item.candle===c);if(entry)entry.prompt='[ E ] LIGHT THE CANDLE';}});}
function lightCandle(c){
 if(!c||c.lit)return;
 c.lit=true;candlesLit=Math.min(3,candlesLit+1);glitchPulse=Math.max(glitchPulse,.3);audio?.stinger(.3);
 showToast('ALTAR CANDLES LIT: '+candlesLit+' / 3');
 if(candlesLit>=3&&!storyFlags.has('altar-lit')){
   storyFlags.add('altar-lit');storyFlags.add('primo-alerted');storyFlags.add('cemetery-bait');
   fear=Math.min(1,fear+.20);audio?.killSting();audio?.mechanicalEvent('bell');
   if(storyRef.cemeteryShooter)storyRef.cemeteryShooter.visible=true;
   storyLine('The First: Go to the cemetery beside the industries. The missing name is waiting there.');
   placeStalker(currentZone);showToast('THREE FLAMES. A NEW INSTRUCTION ARRIVES FROM THE FACTORIES.');
 }
 updateMissions();
}

// A wall with real openings. axis 'x' runs along x at z=pos; axis 'z' runs along z at x=pos.
function addWindowedWall(group, axis, pos, a, b, height, thick, m, windows) {
  const put = (u0, u1, y0, y1) => {
    const len = u1 - u0; if (len <= .01 || y1 - y0 <= .01) return;
    const cu = (u0 + u1) / 2, cy = (y0 + y1) / 2;
    if (axis === 'x') addBox(group, cu, cy, pos, len, y1 - y0, thick, m);
    else addBox(group, pos, cy, cu, thick, y1 - y0, len, m);
  };
  let u = a;
  for (const w of windows.slice().sort((p, q) => p.at - q.at)) {
    const w0 = w.at - w.w / 2, w1 = w.at + w.w / 2;
    put(u, w0, 0, height); put(w0, w1, 0, w.y); put(w0, w1, w.y + w.h, height);
    u = w1;
  }
  put(u, b, 0, height);
}
// Tableau seen through a window: a fire, a ring of figures and a gallows with a swinging body.
function addDistantRitual(group, x, z) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 20), mat(0x1c1d19, 1)); ground.rotation.x = -Math.PI / 2; ground.position.y = .01; root.add(ground);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a24 }));
  fire.position.y = .6; fire.scale.set(1, 1.6, 1); root.add(fire);
  const figures = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, r = 2.6 + (i % 2) * .4;
    const f = new THREE.Group(); f.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); f.rotation.y = a + Math.PI;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28, .9, 4, 8), mat(0x0c0c0b, 1)); body.position.y = 1.0; f.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 8), mat(0x0c0c0b, 1)); head.position.y = 1.8; f.add(head);
    root.add(f); figures.push(f);
  }
  const beamM = mat(0x17140f, 1);
  const post1 = new THREE.Mesh(new THREE.BoxGeometry(.18, 4.2, .18), beamM); post1.position.set(-6, 2.1, -6); root.add(post1);
  const post2 = new THREE.Mesh(new THREE.BoxGeometry(.18, 4.2, .18), beamM); post2.position.set(-3, 2.1, -6); root.add(post2);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.4, .18, .18), beamM); beam.position.set(-4.5, 4.1, -6); root.add(beam);
  const hung = new THREE.Group(); hung.position.set(-4.5, 4.0, -6); root.add(hung);
  const hbody = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .95, 4, 8), mat(0x0a0908, 1)); hbody.position.y = -1.0; hung.add(hbody);
  const hhead = new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 8), mat(0x0a0908, 1)); hhead.position.y = -2.0; hung.add(hhead);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.45, 48), new THREE.MeshBasicMaterial({ color: 0x7a1a12, transparent: true, opacity: .5 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .02; root.add(ring);
  makeEmitter(root, 0, .3, 0, 'fire'); makeEmitter(root, 0, .9, 0, 'smoke');
  rituals.push({ root, fire, figures, hung, phase: Math.random() * 6 });
  return root;
}
function updateRituals(t) {
  for (const r of rituals) {
    r.fire.scale.set(1 + .14 * Math.sin(t * .011 + r.phase), 1.6 + .25 * Math.sin(t * .017 + r.phase), 1 + .14 * Math.cos(t * .013 + r.phase));
    r.figures.forEach((f, i) => { f.rotation.z = Math.sin(t * .0009 + i + r.phase) * .05; });
    r.hung.rotation.z = Math.sin(t * .0013 + r.phase) * .12;
    r.hung.rotation.x = Math.sin(t * .0007 + r.phase) * .05;
  }
}
function addLook(group, x, y, z, title, text, radius = 2.4) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  marker.position.set(x, y, z); group.add(marker);
  const entry = { id: `look_${title.toLowerCase().replace(/\W/g, '_')}`, type: 'look', object: marker, point: marker.position, radius, prompt: '[ E ] LOOK CLOSER', title, text };
  group.userData.interactables.push(entry); return entry;
}
function showLook(item) {
  zoomPulse = 2.4;
  $('speaker').textContent = item.title.toUpperCase(); $('subtitle').textContent = item.text;
  $('dialogue-options').innerHTML = ''; $('subtitle-wrap').classList.add('visible');
  clearTimeout(narrationTimer);
  narrationTimer = setTimeout(() => { if (!dialogueOpen) $('subtitle-wrap').classList.remove('visible'); }, 7000);
}
function addTool(group, x, z, id, title, text) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.2, 6), mat(0x4a3424)); handle.rotation.z = Math.PI / 2; handle.position.y = .08; root.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.28, .02, .34), mat(0x6e6e68, .4)); blade.position.set(.66, .08, 0); root.add(blade);
  const entry = { id: `tool_${id}`, type: 'tool', tool: id, object: root, point: root.position, radius: 2.0, prompt: `[ E ] TAKE — ${title.toUpperCase()}`, title, text };
  group.userData.interactables.push(entry); return entry;
}
function addDigSite(group, x, z) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.22, .34, 3.4, 8), mat(0x2b2118, 1)); trunk.position.y = 1.7; root.add(trunk);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(.025, .05, 3.2, 4), mat(0x3a3a2a, 1));
    br.position.set(Math.sin(a) * 1.3, 2.4, Math.cos(a) * 1.3); br.rotation.set(Math.cos(a) * .9, 0, -Math.sin(a) * .9); root.add(br);
  }
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat(0x2e2419, 1)); mound.scale.set(1.05, .12, .62); mound.position.set(.5, .04, 1.9); root.add(mound);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(.08, .9, .08), mat(0x4a3420, 1)); cross.position.set(.5, .48, 1.9); root.add(cross);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(.5, .08, .08), mat(0x4a3420, 1)); bar.position.set(.5, .62, 1.9); root.add(bar);
  return { id: 'dig_grave', type: 'dig', object: root, point: new THREE.Vector3(x + .5, .3, z + 1.9), radius: 2.6, prompt: '[ E ] HOLD — DIG' };
}
function digAvailable() { return tools.has('shovel') && !digDone; }
function syncDigSite() {
  if (!digEntry) return;
  const list = zones.road.interactables; const has = list.includes(digEntry);
  if (digAvailable() && !has) list.push(digEntry);
  if (!digAvailable() && has) list.splice(list.indexOf(digEntry), 1);
}
function updateDig(dt) {
  syncDigSite();
  if (!digEntry) return;
  const digging = activeTarget === digEntry && keys.has('KeyE') && playerInputEnabled() && digAvailable();
  digProgress = digging ? Math.min(1, digProgress + dt / 4.5) : Math.max(0, digProgress - dt * .6);
  if (activeTarget === digEntry) digEntry.prompt = digProgress > 0 ? `[ E ] DIGGING… ${Math.round(digProgress * 100)}%` : '[ E ] HOLD — DIG';
  if (digging && digProgress >= 1 && !digDone) { digDone = true; completeDig(); }
}
function completeDig() {
  storyFlags.add('grave-revealed');
  journal.push({id:'grave-name',title:'The Name on the Cross',description:'Beneath the disturbed earth is a metal case. Inside, a sheet bearing one name: Aurelio, choir director. Beside it, a date and a single word: removed. The tape is missing. Perhaps it was never played.',kind:'document',zone:'road'});
  updateJournalCount(); syncDigSite();
  showToast('THERE IS A NAME UNDER THE EARTH. IT IS NOT A SINGER’S NAME.');
  audio.killSting(); glitchPulse = Math.max(glitchPulse, 1.1);
  speakVoice('Aurelio. The name was on the cross. Someone buried it before the others.', 'RECORDING 14-B');
  updateMissions();
}
function buildStoryExtras() {
  buildAtmosphere();
  buildStory();
  buildCinematicExtras();
  digEntry = addDigSite(zones.road.group, -22, 18);
  addTool(zones.ruin.group,4.2,-4.6,'shovel','Shovel','The handle is damp and smooth, as if many hands have gripped it in the dark.');
  syncDigSite();
}
// The approaching The First: he walks toward you whenever you are not looking at him.
function stalkerEligible(name) {
  if (!['home', 'church', 'ruin', 'abattoir', 'cellar'].includes(name)) return false;
  if (storyFlags.has('porch-primo-gone') && (name === 'abattoir' || difficultyTier() >= 2)) return true;
  return collected.size >= 3 || storyFlags.has('primo-alerted');
}
function makeStalker() {
  const g = new THREE.Group();
  const coat = new THREE.Mesh(new THREE.CapsuleGeometry(.36, 1.3, 6, 12), mat(0x050505, 1)); coat.position.y = 1.25; coat.scale.set(1, 1.1, .8); g.add(coat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), headMaterial()); head.scale.set(.82, 1.5, .9); head.position.y = 2.55; g.add(head);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xd9d2b4, emissive: 0xd9d2b4, emissiveIntensity: 1.2 });
  [-.08, .08].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(.024, 8, 6), eyeM); e.position.set(x, 2.6, .2); g.add(e); });
  [-1, 1].forEach(s => { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.07, 1.25, 4, 8), mat(0x0a0a09, .9)); arm.position.set(s * .44, 1.2, .1); arm.rotation.z = s * .12; g.add(arm); });
  return g;
}
function placeStalker(name) {
  storyFlags.add(`visited-${name}`);
  if (!stalkerEligible(name)) { if (stalker) stalker.visible = false; stalkerZone = null; return; }
  if (!stalker) stalker = makeStalker();
  const z = zones[name];
  if (stalker.parent !== z.group) { if (stalker.parent) stalker.parent.remove(stalker); z.group.add(stalker); }
  const b = z.bounds, sp = z.spawn;
  const corners = [[b.minX + 1.2, b.minZ + 1.2], [b.maxX - 1.2, b.minZ + 1.2], [b.minX + 1.2, b.maxZ - 1.2], [b.maxX - 1.2, b.maxZ - 1.2]];
  corners.sort((p, q) => Math.hypot(q[0] - sp.x, q[1] - sp.z) - Math.hypot(p[0] - sp.x, p[1] - sp.z));
  stalker.position.set(corners[0][0], 0, corners[0][1]);
  stalker.visible = true; stalkerZone = name; presenceWarned = false; presence = 0;
}
function updatePresence(dt, t) {
  const active = stalker && stalker.visible && stalkerZone === currentZone && gameStarted && !gameEnded && !listeningPending && !cultFateActive && !dialogueOpen && !journalOpen;
  if (!active) { presence = Math.max(0, presence - dt * .8); return; }
  const p = playerAnchor.position;
  const dx = stalker.position.x - p.x, dz = stalker.position.z - p.z, dist = Math.hypot(dx, dz) || .001;
  camera.getWorldDirection(camDir2);
  const fl = Math.hypot(camDir2.x, camDir2.z) || 1;
  const watched = (camDir2.x * dx + camDir2.z * dz) / (fl * dist) > .55;
  if (!watched && dist > 1.1) {
    const step = Math.min(dist - 1, (.7 + presence * .9 + primoSpeedBonus()) * (watched ? 1 : 1.25) * dt);
    stalker.position.x -= dx / dist * step; stalker.position.z -= dz / dist * step;
  }
  stalker.rotation.y = Math.atan2(-dx, -dz);
  stalker.rotation.z = Math.sin(t * .0027) * .04;
  const target = THREE.MathUtils.clamp(1 - (dist - 1.2) / 8, 0, 1);
  presence += (target - presence) * Math.min(1, dt * 1.6);
  if (presence > .5 && !nearFlag) { nearFlag = true; audio.stinger(1); glitchPulse = Math.max(glitchPulse, .8); }
  if (presence < .3) nearFlag = false;
  if (dist < 2.9 && !presenceWarned) { presenceWarned = true; showToast('DO NOT TURN AROUND. HE IS NEAR. DO NOT WATCH HIM APPROACH.'); }
  if (presence > .3) { beatTimer -= dt; if (beatTimer <= 0) { audio.knock(); beatTimer = 1.1 - presence * .6; } }
  if (dist < 1.2) triggerDeath('THE FIRST HAS FOUND YOU');
}
// Missions: the first unfinished one whose prerequisites are met is shown in the objective panel.
const MISSIONS=[
 {id:'house',text:'Reach the farmhouse by following the gravel path.',done:()=>storyFlags.has('visited-home')},
 {id:'home-talk',text:'Speak with Ines and Ottavio. The things they know are not written down.',when:()=>storyFlags.has('visited-home'),done:()=>storyFlags.has('talked-ines')&&storyFlags.has('talked-ottavio')},
 {id:'wall',text:'Listen through the thin wall. Someone is giving Dario a task.',when:()=>storyFlags.has('talked-ines')&&storyFlags.has('talked-ottavio'),done:()=>storyFlags.has('heard-dario-plan')},
 {id:'shovel',text:'Find a shovel in the ruined house, beside the collapsed wall.',when:()=>storyFlags.has('talked-ines')&&storyFlags.has('talked-ottavio'),done:()=>tools.has('shovel')},
 {id:'grave',text:'Dig beneath the willow. Hold E until the earth gives way.',when:()=>tools.has('shovel'),done:()=>storyFlags.has('grave-revealed')},
 {id:'widow',text:'Question the Widow in the ruined house about the 1977 recording.',when:()=>storyFlags.has('grave-revealed'),done:()=>storyFlags.has('talked-widow')},
 {id:'remo',text:'Speak with Don Remo. Ask why the cross has been turned around.',when:()=>collected.size>=2,done:()=>storyFlags.has('talked-remo')},
 {id:'candles',text:'Light all three altar candles. The flames are part of the way forward.',when:()=>collected.size>=2,done:()=>storyFlags.has('altar-lit')},
 {id:'cemetery',text:'The First says the missing name is buried in the cemetery beside the industries.',when:()=>storyFlags.has('cemetery-bait'),done:()=>storyFlags.has('cemetery-shot')},
  {id:'pino-field',text:'Follow Pino into the wheat field. The combine is still running.',when:()=>storyFlags.has('pino-sent'),done:()=>storyFlags.has('pino-collapsed')}
];
function currentMissionText(){
 if(storyFlags.has('pino-sent')&&!storyFlags.has('pino-collapsed')&&currentZone==='road')return 'PINO WENT TOWARD THE WHEAT FIELD. FOLLOW THE ENGINE.';
 if(currentZone==='darkroom'&&!storyFlags.has('darkroom-cleared'))return 'SEARCH THE DARK ROOM — '+darkroomFindCount()+' / 6. Keep the beam moving.';
 if(storyFlags.has('altar-lit')&&!storyFlags.has('darkroom-cleared'))return currentZone==='cellar'?'THE SIDE DOOR IS OPEN. SEARCH THE DARK ROOM FOR THE SIX RECORDS.':'RETURN TO THE CELLAR. THE SIDE DOOR HAS OPENED.';
 if(storyFlags.has('darkroom-cleared')&&!storyFlags.has('corrado-tea'))return currentZone==='abattoir'?'SPEAK WITH THE FIRST AGAIN. ASK HIM ABOUT THE SOUND HE REFUSED TO HEAR.':'RETURN TO THE SLAUGHTERHOUSE. THE FIRST IS WAITING BESIDE THE HOOKS.';
  if(storyFlags.has('corrado-tea')&&!storyFlags.has('listened-to-white'))return currentZone==='cellar'?'RETURN TO THE BLANK PLATTER. THE ROOM HAS BEEN RECORDED.':'THE BLANK PLATTER IS WAITING IN THE CELLAR.';
 if(currentZone==='home'&&!storyFlags.has('talked-ines'))return 'Speak with Ines before examining the Seating List.';
 if(currentZone==='home'&&!storyFlags.has('talked-ottavio'))return 'Speak with Ottavio before examining the Tuning Fork.';
 if(currentZone==='church'&&!storyFlags.has('talked-remo'))return 'Speak with Don Remo before examining the Mass Register.';
 if(currentZone==='ruin'&&!storyFlags.has('talked-widow'))return 'Speak with the Widow before examining the Burned Photograph.';
 if(storyFlags.has('cemetery-bait')&&!storyFlags.has('cemetery-shot')&&collected.size<clueCount)return 'THE FIRST’S INSTRUCTION: Go to the cemetery beside the industries. Find the missing name.';
 if(collected.size===7)return currentZone==='abattoir'
   ?'7 / 8 CLUES — The slaughterhouse ledger is on the north-west side, near the back wall.'
   :'7 / 8 CLUES — Follow the boardwalk east. The House of Beasts contains the final ledger.';
 if(collected.size>=clueCount&&!storyFlags.has('altar-lit'))return '8 / 8 CLUES — Return to the church and light all three altar candles.';
 if(collected.size>=2&&!storyFlags.has('altar-lit'))return 'LIGHT ALL THREE ALTAR CANDLES — The flames are part of the way forward.';
 if(collected.size>=clueCount){
   if(currentZone==='cellar')return '8 / 8 CLUES — Approach the black platter and press E to listen to The White.';
   if(currentZone==='home')return '8 / 8 CLUES — The kitchen hatch is uncovered. Descend to the cellar.';
   return '8 / 8 CLUES — Return to the farmhouse and descend through the kitchen hatch.';
 }
 for(const m of MISSIONS)if(!m.done()&&(!m.when||m.when()))return m.text;
 return null;
}

function updateMissions() {
  for (const m of MISSIONS) if (!seenMissions.has(m.id) && m.done()) { seenMissions.add(m.id); showToast('OBJECTIVE COMPLETE'); }
  const el = $('objective-text'); const text = currentMissionText();
  if (text && el.textContent !== text) el.textContent = text;
}
function triggerCemeteryAmbush(){
 if(gameEnded||storyFlags.has('cemetery-shot'))return;
 storyFlags.add('cemetery-shot');keys.clear();controls.unlock();activeTarget=null;dialogueOpen=true;
 $('speaker').textContent='THE FACTORY ROOF';$('subtitle').textContent='A rifle cracks from the industrial roof. You feel the impact before the echo reaches the cemetery.';$('subtitle-wrap').classList.add('visible');
 audio?.mechanicalNoise(.16,1850,8,.34,-.18);audio?.mechanicalTone(145,42,.24,'square',.16,-.18);audio?.killSting();
 glitchPulse=Math.max(glitchPulse,2);fear=1;camera.rotation.z+=.11;
 const world=$('world');if(world)world.style.filter='contrast(1.8) saturate(2.2) sepia(.4)';
 const flash=$('event-flash');flash.classList.add('active');setTimeout(()=>flash.classList.remove('active'),130);
 setTimeout(()=>{dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');triggerDeath('SHOT IN THE CEMETERY','You followed the instruction to the cemetery beside the industries. The shot came from the factory roof. The missing name was never there.');},820);
}
function updateCemeteryTrap(){
 if(currentZone!=='road'||!storyFlags.has('cemetery-bait')||storyFlags.has('cemetery-shot')||gameEnded||!zone)return;
 const p=currentPosition();if(p.x>=38&&p.x<=50&&p.z>=12&&p.z<=24)triggerCemeteryAmbush();
}
// Dialogue choices with consequences: some open or close missions, others move the enemy or the cult.
function applyConsequences(npc, index) {
  const key = (npc.name || '').toLowerCase();
  if (key === 'ottavio' && index === 0) { storyFlags.add('ottavio-cold'); showToast('OTTAVIO TURNS HIS BACK ON YOU. SERGIO MAY STILL SPEAK.'); }
  if (key === 'ines' && index === 1) { queueCultFate('Ines was betrayed', npc, 'collapse'); fear = Math.min(1, fear + .12); showToast('INES HAS UNDERSTOOD. THE HOUSE TIGHTENS.'); }
  if (key === 'dario' && index === 1) { storyFlags.add('primo-alerted'); showToast('THE FIRST HAS HEARD YOUR NAME.'); }
  if(key==='pino'&&index===0){storyFlags.add('pino-sent');showToast('PINO HAS SHOWN YOU THE FIELD PATH. THE ENGINE IS STILL WARM.');}
  if (key === 'anna' && index === 1) { queueCultFate('Anna’s empty place', npc, 'collapse'); }
  if (key === 'sergio' && index === 1) { fear = Math.min(1, fear + .05); }
  if (key === 'the first' && npc.isOpeningPrimo) { storyFlags.add('met-primo'); storyFlags.add('primo-first-contact'); }
  else if (key === 'the first') { const d = primoDialogue(); d.actions?.[index]?.(); }
  applyChoiceEffect(key,index,npc);
  if(key==='the first'&&storyFlags.has('darkroom-cleared')&&!storyFlags.has('corrado-tea'))startCorradoTeaScene(npc);
  if (storyFlags.has('primo-alerted')) placeStalker(currentZone);
  updateMissions();
}
const CHAPTER_NAMES = { road: 'I · THE FOG ROAD', home: 'II · THE HOUSE / THIRTEEN PLACES', church: 'III · THE DECONSECRATED CHURCH', ruin: 'IV · THE EMPTY HOUSE', cellar: 'V · THE CELLAR', darkroom: 'VI · THE DARK ROOM', abattoir: 'VII · THE SLAUGHTERHOUSE' };
function showChapterCard(name) {
  if (chapterCardsShown.has(name) || !CHAPTER_NAMES[name]) return;
  chapterCardsShown.add(name);
  const el = $('chapter-card'); el.textContent = CHAPTER_NAMES[name]; el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3200);
}
// Depth of field: focus follows what you look at, so far things (windows, tableaux) blur.
function updateLens(dt) {
  if (!bokeh) return;
  camera.getWorldPosition(cameraWorld);
  const want = activeTarget ? cameraWorld.distanceTo(activeTarget.point || activeTarget.object.position) : 6.5;
  const u = bokeh.uniforms; const zoomed = keys.has('KeyZ') || rightMouse || zoomPulse > 0;
  u.focus.value += (Math.min(want, 40) - u.focus.value) * Math.min(1, dt * 4);
  u.aperture.value += ((zoomed ? .00042 : .00016) + presence * .00012 - u.aperture.value) * Math.min(1, dt * 3);
  u.maxblur.value = .0045;
}
function updateZoom(dt) {
  if (zoomPulse > 0) zoomPulse -= dt;
  const target = !gameStarted ? 72 : (keys.has('KeyZ') || rightMouse) ? 36 : zoomPulse > 0 ? 50 : 72;
  if (Math.abs(camera.fov - target) > .05) { camera.fov += (target - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
}


// =============================================================================
// v3.3: relics (easter eggs), field rituals, macabre props.
// =============================================================================
function addEgg(group, x, z, id, title, text) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  root.add(buildRelicMesh(id));
  const core = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd9b48a })); core.position.y = .2; root.add(core);
  const light = new THREE.PointLight(0xd9b48a, .35, 2.4, 2); light.position.y = .35; root.add(light);
  const entry = { id, type: 'egg', object: root, point: root.position, radius: 2.0, prompt: `[ E ] COLLECT — ${title.toUpperCase()}`, title, text, core, light };
  eggs.push(entry); group.userData.interactables.push(entry); return entry;
}
function updateEggs(t) {
  for (const e of eggs) {
    if (!e.object.parent) continue;
    const p = .5 + .5 * Math.sin(t * .0022 + e.point.x * 3);
    e.light.intensity = .2 + p * .4; e.core.scale.setScalar(.8 + p * .5);
  }
}
function collectRelic(item) {
  if (relics.has(item.id)) return;
  relics.add(item.id);
  const ix = zone.interactables.indexOf(item); if (ix >= 0) zone.interactables.splice(ix, 1);
  item.object.parent?.remove(item.object);
  journal.push({ id: item.id, title: item.title, description: item.text, kind: 'reliquia', zone: currentZone });
  updateJournalCount();
  dread = Math.min(1, dread + .03); glitchPulse = Math.max(glitchPulse, .5); audio.stinger(.45);
  showToast(`RELIC ${relics.size} / ${RELIC_COUNT}`);
  if (relics.size === RELIC_COUNT) {
    journal.push({ id: 'tenth', title: 'The tenth object', description: 'Nine objects, nine empty places. The tenth has no name. It is you.', kind: 'reliquia', zone: currentZone });
    updateJournalCount(); showToast('ALL RELICS FOUND. THE HOUSE TURNS TOWARD YOU.');
  }
}
function addSkull(group, x, y, z, scale = 1) {
  const root = new THREE.Group(); root.position.set(x, y, z); root.scale.setScalar(scale); group.add(root);
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 10), mat(0xd8cfb8, .7)); cranium.scale.set(1, 1.1, 1.05); root.add(cranium);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(.2, .07, .14), mat(0xcdc3aa, .7)); jaw.position.set(0, -.17, .02); root.add(jaw);
  [-1, 1].forEach(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), M.black); e.position.set(s * .07, .02, .14); root.add(e); });
  return root;
}
function addHangingBones(group, x, y, z, count = 6) {
  for (let i = 0; i < count; i++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(.03, .22, 3, 6), mat(0xcfc6ad, .7));
    b.position.set(x + Math.sin(i * 1.3) * .08, y - i * .2, z); b.rotation.z = Math.sin(i * 2.1) * .5; group.add(b);
  }
}
function addJar(group, x, y, z) {
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .42, 12), new THREE.MeshStandardMaterial({ color: 0x9ab0a0, transparent: true, opacity: .35, roughness: .1 }));
  jar.position.set(x, y + .21, z); group.add(jar);
  const blob = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), mat(0x8a3a3a, .5)); blob.scale.set(1.2, .8, 1); blob.position.set(x, y + .2, z); group.add(blob);
}
function addCrow(group, x, y, z) {
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .22, 3, 6), M.black); c.position.set(x, y, z); c.rotation.z = .3; group.add(c);
  const h = new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), M.black); h.position.set(x + .1, y + .12, z); group.add(h);
}
// Rituals in the fields: a ring of figures around a pyre, and three posts with bodies on them.
function addFieldRitual(group, x, z) {
  addDistantRitual(group, x, z);
  for (let k = -1; k <= 1; k++) {
    const px = x + k * 4.2, pz = z + 7;
    const post = new THREE.Mesh(new THREE.BoxGeometry(.14, 3.4, .14), mat(0x17140f, 1)); post.position.set(px, 1.7, pz); group.add(post);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .8, 4, 8), mat(0x0a0908, 1)); body.position.set(px, 1.9, pz + .2); group.add(body);
  }
}
function buildAtmosphere() {
  buildRelics();
  const road = zones.road.group, home = zones.home.group, church = zones.church.group, cellar = zones.cellar.group, abat = zones.abattoir.group, ruin = zones.ruin.group;
  // Road: skulls on the fence posts, crows, and rituals out in the fields.

  [[-3.6, -9.6], [3.6, -26]].forEach(([x, z]) => addCrow(road, x, 1.55, z));
  addFieldRitual(road, -42, -22); addFieldRitual(road, 46, -40); addFieldRitual(road, -30, -56);
  // Home: a skull among the candles, a jar on a crate, bones hanging from the ceiling.

  addBox(home, -9.4, .5, -5.5, .8, 1, .8, M.darkWood); addJar(home, -9.4, 1.0, -5.5);
  addHangingBones(home, 0, 3.1, 4, 6);
  // Church: a skull on the altar and one on a pew.

  // Cellar: a skull on the long table.

  // Abattoir: bone chains and a jar of something pale.
  addHangingBones(abat, 7, 3.5, -6, 7); addHangingBones(abat, -7, 3.5, 6, 7);
  addJar(abat, -9, .0, -7);
  // Ruin: a skull by the rubble.

  // Relics: nine easter eggs across the rooms, each with a small ominous glow.
}


// =============================================================================
// v3.4: smoke and fire, the industrial backdrop, relics as objects, The First's
// double-faced dialogue, the confession, the drive into the forest and the chase.
// =============================================================================
function glow(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: .5, transparent: true });
}
function softTex() {
  if (SOFT_TEX) return SOFT_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  SOFT_TEX = new THREE.CanvasTexture(c); return SOFT_TEX;
}
function isVisibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
function respawnParticle(e, i, first) {
  const fire = e.kind === 'fire', spread = fire ? .5 : .4;
  e.life[i] = first ? Math.random() : 0;
  e.pos[i*3] = (Math.random() - .5) * spread; e.pos[i*3+1] = 0; e.pos[i*3+2] = (Math.random() - .5) * spread;
  e.vel[i*3] = (Math.random() - .5) * .15; e.vel[i*3+1] = fire ? .8 + Math.random() * 1.2 : .5 + Math.random() * .5; e.vel[i*3+2] = (Math.random() - .5) * .15;
}
function makeEmitter(group, x, y, z, kind) {
  const N = kind === 'fire' ? 90 : 60;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fire = kind === 'fire';
  const m = new THREE.PointsMaterial({ map: softTex(), size: fire ? .5 : 1.1, transparent: true, depthWrite: false,
    blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending, color: fire ? 0xff7a2a : 0x6a625a, opacity: fire ? .85 : .32 });
  const pts = new THREE.Points(geo, m); pts.position.set(x, y, z); pts.frustumCulled = false; group.add(pts);
  const e = { pts, geo, pos, life, vel, N, kind };
  for (let i = 0; i < N; i++) respawnParticle(e, i, true);
  emitters.push(e); return e;
}
function updateEmitters(dt) {
  for (const e of emitters) {
    if (!isVisibleChain(e.pts)) continue;
    for (let i = 0; i < e.N; i++) {
      e.life[i] += dt * (e.kind === 'fire' ? 1.6 : .12);
      if (e.life[i] >= 1) respawnParticle(e, i, false);
      e.pos[i*3] += e.vel[i*3] * dt; e.pos[i*3+1] += e.vel[i*3+1] * dt; e.pos[i*3+2] += e.vel[i*3+2] * dt;
      if (e.kind !== 'fire') e.pos[i*3] += Math.sin(e.life[i] * 6 + i) * .1 * dt;
    }
    e.geo.attributes.position.needsUpdate = true;
  }
  for (const r of rigs) {
    if (!isVisibleChain(r.drill)) continue;
    r.t += dt; r.drill.rotation.y += dt * 5;
    r.beacon.material.emissiveIntensity = Math.sin(r.t * 4) > .2 ? 2 : .3;
  }
}
function updateIndustryNoise(dt) {
  industryT -= dt; if (industryT > 0) return;
  industryT = 2.2 + Math.random() * 1.6;
  if (['road', 'home', 'abattoir', 'forest'].includes(currentZone))
    audio?.mechanicalNoise(1.5, 150 + Math.random() * 70, 2.4, .045, (Math.random() - .5) * .6);
}
// A chemical or drilling works on the horizon: offices with lit windows, a stack, pipes, a drill rig and a beacon.
function addIndustry(group, x, z, scale = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); root.scale.setScalar(scale); group.add(root);
  const concrete = mat(0x4a4c46, .95, { map: TEX.plaster }), rust = mat(0x7a4128, .9, { map: TEX.rust }), steel = mat(0x4c5256, .5, { map: TEX.metal });
  addBox(root, 0, 4, 0, 14, 8, 7, concrete);
  addBox(root, 0, 8.2, 0, 14.4, .3, 7.4, mat(0x22231f));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
    const lit = Math.random() < .45;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(.7, .8), lit ? glow(0xd8b070, .9) : mat(0x0c0d0d, .6));
    w.position.set(-5.4 + c * 1.8, 2.2 + r * 1.8, 3.55); root.add(w);
  }
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.15, 24, 14), rust); stack.position.set(10, 12, -2); root.add(stack);
  makeEmitter(root, 10, 24.5, -2, 'smoke');
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 20, 8), steel); p.rotation.z = Math.PI / 2; p.position.set(-1, 6.2 + i * .9, -4.4); root.add(p); }
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 30, 1.2), steel); tower.position.set(-14, 15, -6); root.add(tower);
  const drill = new THREE.Mesh(new THREE.CylinderGeometry(.1, .03, 7, 8), steel); drill.position.set(-14, 17, -6); root.add(drill);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), glow(0xff2a1a, 2)); beacon.position.set(-14, 30.2, -6); root.add(beacon);
  rigs.push({ drill, beacon, t: Math.random() * 6 });
  makeEmitter(root, -14, 20, -6, 'smoke');
  return root;
}
// Relic objects, each modelled after what it represents.
function buildRelicMesh(id) {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  const black = mat(0x111111, .5), paper = mat(0xe4dccb, .9), red = mat(0x7a1414, .6), steel = mat(0x8a8a86, .35), brown = mat(0x4a3424, .7);
  switch (id) {
    case 'relic-tape':
      add(new THREE.BoxGeometry(.2, .13, .03), black, 0, .14, 0);
      add(new THREE.BoxGeometry(.15, .07, .005), paper, 0, .16, .018);
      add(new THREE.CylinderGeometry(.03, .03, .01, 12), mat(0xddd6c4, .6), -.04, .16, .02, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(.03, .03, .01, 12), mat(0xddd6c4, .6), .04, .16, .02, 0, 0, Math.PI / 2);
      break;
    case 'relic-shoe':
      add(new THREE.BoxGeometry(.18, .03, .09), brown, 0, .02, 0);
      add(new THREE.BoxGeometry(.17, .09, .08), mat(0x5a3c28, .7), 0, .075, -.005);
      add(new THREE.BoxGeometry(.1, .012, .02), mat(0x2a1a10, .8), 0, .12, .045);
      add(new THREE.PlaneGeometry(.03, .02), paper, .08, .03, .05, 0, Math.PI / 2, 0);
      break;
    case 'relic-envelope':
      add(new THREE.BoxGeometry(.22, .005, .15), paper, 0, .01, 0);
      add(new THREE.BoxGeometry(.19, .001, .003), mat(0xcab896), 0, .0125, 0);
      add(new THREE.CylinderGeometry(.025, .025, .01, 12), red, .05, .02, .02);
      break;
    case 'relic-tooth':
      add(new THREE.BoxGeometry(.11, .03, .07), red, 0, .015, 0);
      add(new THREE.BoxGeometry(.105, .02, .065), paper, 0, .03, 0);
      add(new THREE.SphereGeometry(.018, 8, 6), mat(0xe3d7b0, .4), 0, .06, 0).scale.set(1, 1.4, 1);
      break;
    case 'relic-program':
      add(new THREE.BoxGeometry(.14, .002, .2), paper, 0, .005, 0);
      add(new THREE.BoxGeometry(.14, .002, .1), paper, 0, .012, .05, -.3, 0, 0);
      add(new THREE.BoxGeometry(.1, .002, .004), black, 0, .007, -.04);
      add(new THREE.BoxGeometry(.1, .002, .004), black, 0, .007, -.06);
      break;
    case 'relic-radio':
      add(new THREE.BoxGeometry(.2, .12, .07), mat(0x2a2a2a, .5), 0, .1, 0);
      add(new THREE.BoxGeometry(.12, .06, .005), mat(0x0a0a0a, .9), -.02, .1, .036);
      add(new THREE.CylinderGeometry(.01, .01, .02, 8), steel, .07, .12, .036, Math.PI / 2, 0, 0);
      add(new THREE.CylinderGeometry(.002, .002, .25, 4), steel, .08, .27, 0, 0, 0, .2);
      break;
    case 'relic-key':
      add(new THREE.TorusGeometry(.04, .008, 8, 16), steel, -.08, .04, 0);
      add(new THREE.BoxGeometry(.2, .018, .02), steel, .03, .02, 0);
      add(new THREE.BoxGeometry(.03, .02, .02), steel, .12, .005, 0);
      break;
    case 'relic-eye':
      add(new THREE.BoxGeometry(.16, .04, .12), mat(0x5a1414, .9), 0, .02, 0);
      const eye = add(new THREE.SphereGeometry(.035, 12, 10), mat(0xf2f0ea, .15), 0, .07, 0);
      add(new THREE.SphereGeometry(.015, 8, 6), black, 0, .07, .03);
      break;
    case 'relic-bone':
      add(new THREE.CylinderGeometry(.012, .012, .2, 8), mat(0xcfc6ad, .6), 0, .02, 0, 0, 0, Math.PI / 2);
      add(new THREE.SphereGeometry(.022, 8, 6), mat(0xcfc6ad, .6), -.1, .02, 0);
      add(new THREE.SphereGeometry(.022, 8, 6), mat(0xcfc6ad, .6), .1, .02, 0);
      break;
    default:
      add(new THREE.BoxGeometry(.12, .1, .12), black, 0, .06, 0);
  }
  return g;
}
function buildRelics() {
  const at = (zn) => zones[zn].group;
  addEgg(at('road'), -30, 12, 'relic-shoe', "Child’s shoe", 'Brown leather, stitched by hand. Inside is a card with the number 13. The number was scratched out and written smaller underneath.');
  addEgg(at('road'), 38, -18, 'relic-tape', 'Cassette 14-B', 'No title, only a marker label: 14-B. It is warm, as if someone has just finished listening to it.');
  addEgg(at('road'), -14, -44, 'relic-bone', 'Wing bone on wire', 'A small wing bone threaded on iron wire and hung from a post. It always turns in the same direction.');
  addEgg(at('home'), -8.2, 7.5, 'relic-envelope', 'Envelope with no name', 'Sealed with dark wax. Inside is a single sheet: "You are not the first to come in. You are the first to stay."');
  addEgg(at('home'), 9, -7.2, 'relic-tooth', 'Tooth in a matchbox', 'A molar in a matchbox. On the lid, in pencil: "This one was also one of them."');
  addEgg(at('church'), 7.6, -15.6, 'relic-program', 'Mass programme, 1977', 'A printed mass sheet. Beside the celebrant’s name, one line has been cut out with a razor.');
  addEgg(at('ruin'), -6, -6, 'relic-radio', 'Radio without batteries', 'A transistor radio with no batteries. When you turn the dial, between the static you hear someone breathing.');
  addEgg(at('cellar'), -7.4, 5.4, 'relic-key', 'Numbered key', 'A butcher’s key with 13 stamped into the bow. It opens nothing in this house. Perhaps it opens something beyond it.');
  addEgg(at('abattoir'), 9, -8.5, 'relic-eye', 'Glass eye', 'A glass eye in a velvet box, the kind used for mannequins. It always faces you from the same angle.');
}
function buildHand() {
  const g = new THREE.Group(); const skin = mat(0xa8927a, .7);
  g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(.22, .06, .26), skin), {}));
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(.018, .16, 3, 6), skin); f.position.set(-.075 + i * .05, .02, -.2); f.rotation.x = -.45; g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(.02, .12, 3, 6), skin); th.position.set(.13, 0, -.06); th.rotation.z = -.8; g.add(th);
  g.rotation.x = Math.PI / 2;
  return g;
}
function buildCar() {
  const g=new THREE.Group(),wheels=[];
  const paint=mat(0x24272a,.44,{map:TEX.metal,bumpScale:.018}),chrome=mat(0x8e928b,.34,{metalness:.78}),rubber=mat(0x111210,.94),glass=new THREE.MeshStandardMaterial({color:0x263032,roughness:.18,metalness:.12,transparent:true,opacity:.48,side:THREE.DoubleSide});
  const body=roundedHousing(1.78,.62,3.72,.26,paint,.07);body.position.y=.62;g.add(body);
  const hood=roundedHousing(1.70,.30,1.04,.19,paint,.045);hood.position.set(0,.99,-1.27);g.add(hood);
  const trunk=roundedHousing(1.66,.29,.78,.16,paint,.04);trunk.position.set(0,.94,1.45);g.add(trunk);
  const cabin=roundedHousing(1.52,.68,1.86,.18,glass,.04);cabin.position.set(0,1.21,.12);g.add(cabin);
  const roof=roundedHousing(1.48,.10,1.66,.07,paint,.03);roof.position.set(0,1.59,.12);g.add(roof);
  for(const side of [-1,1]){
    const pillar=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.68,4,6),chrome);pillar.position.set(side*.69,1.23,.05);pillar.rotation.z=side*.15;g.add(pillar);
    const doorLine=new THREE.Mesh(new THREE.TorusGeometry(.5,.012,4,18,Math.PI),chrome);doorLine.position.set(side*.79,.96,.25);doorLine.rotation.y=side*Math.PI/2;g.add(doorLine);
  }
  // Front grille and twin headlights: old bodywork, not a toy car silhouette.
  const grille=new THREE.Mesh(new THREE.TorusGeometry(.28,.025,6,24,Math.PI),chrome);grille.position.set(0,.55,-1.89);grille.rotation.x=Math.PI/2;g.add(grille);
  for(let i=0;i<8;i++){const slat=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.4,5),chrome);slat.rotation.x=Math.PI/2;slat.position.set(-.14+i*.04,.56,-1.90);g.add(slat);}
  [-.62,.62].forEach(x=>{const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.13,.14,.07,20),glow(0xe8dcb2,.95));lamp.rotation.x=Math.PI/2;lamp.position.set(x,.72,-1.91);g.add(lamp);const rim=new THREE.Mesh(new THREE.TorusGeometry(.14,.018,5,20),chrome);rim.position.set(x,.72,-1.94);g.add(rim);});
  for(const [x,zp] of [[-.82,1.2],[.82,1.2],[-.82,-1.2],[.82,-1.2]]){
    const wheel=new THREE.Group();wheel.position.set(x,.36,zp);g.add(wheel);
    const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.24,20),rubber);tyre.rotation.z=Math.PI/2;wheel.add(tyre);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.23,.035,7,24),chrome);rim.rotation.y=Math.PI/2;wheel.add(rim);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.10,.10,.26,18),mat(0x555951,.34,{metalness:.75}));hub.rotation.z=Math.PI/2;wheel.add(hub);wheels.push(wheel);
  }
  const dash=roundedHousing(1.38,.18,.26,.06,mat(0x171815,.88),.02);dash.position.set(0,1.03,-.62);g.add(dash);
  const steering=new THREE.Mesh(new THREE.TorusGeometry(.22,.018,6,24),chrome);steering.position.set(-.32,1.20,-.35);steering.rotation.x=.35;g.add(steering);
  const seatMat=mat(0x302c27,.95,{map:TEX.wood});for(const side of [-1,1]){
    const seat=roundedHousing(.55,.62,.60,.13,seatMat,.035);seat.position.set(side*.42,.56,.58);g.add(seat);
  }
  const thermos=buildThermos(g,.43,.96,.42);thermos.scale.setScalar(.72);thermos.rotation.z=.08;storyRef.carThermos=thermos;
  g.userData.wheels=wheels;return g;
}
// The forest beyond the canal, with the car, the chaser and the lamp that marks the starting point.
function buildForest() {
  const fz = newZone('forest', 0x0a0d0c, .05, { minX: -30, maxX: 30, minZ: -70, maxZ: 12 }, [0, 0, 0]);
  const g = fz.group;
  for (let i = 0; i < 70; i++) {
    const x = (Math.random() * 2 - 1) * 28, z = 10 - Math.random() * 80;
    if (Math.abs(x) < 3.2) continue;
    addTree(g, x, z, 6 + Math.random() * 5, i + 1);
  }
  addIndustry(g, -26, -68, .8); addIndustry(g, 26, -70, .8);
  addLight(g, 0xffa050, 2.2, 9, 0, 2.6, 0);
  addBox(g, 0, 1.5, 0, .1, 3, .1, mat(0x111111));
  addBox(g, 0, 3.05, 0, .4, .2, .4, glow(0xffb060, 1.8));
  const car = buildCar(); car.visible = false; g.add(car); storyRef.car = car;
  const ch=makeStalker();ch.visible=false;g.add(ch);storyRef.chaser=ch;
  const voidFigure=new THREE.Group();voidFigure.visible=false;voidFigure.position.set(0,0,-29);g.add(voidFigure);
  const bodyMat=new THREE.MeshStandardMaterial({color:0x111512,roughness:1,transparent:true,opacity:.66});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,1.2,7,12),bodyMat);body.position.y=1.18;voidFigure.add(body);
  const headMat=new THREE.MeshStandardMaterial({color:0x0b0d0b,roughness:1,transparent:true,opacity:.50});
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,10),headMat);head.position.y=2.42;voidFigure.add(head);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.45,.035,6,44),new THREE.MeshBasicMaterial({color:0x9ca58f,transparent:true,opacity:.28}));ring.rotation.x=-Math.PI/2;ring.position.y=.04;voidFigure.add(ring);storyRef.voidFigure=voidFigure;
  storyRef.voidLeaves=[];
  for(let i=0;i<42;i++){const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.18+(i%4)*.045,.055+(i%3)*.02),new THREE.MeshStandardMaterial({color:[0x5c6245,0x77714e,0x333d2d][i%3],roughness:1,transparent:true,opacity:.82,side:THREE.DoubleSide}));leaf.position.set(Math.cos(i*2.399)*(2.8+(i%3)),.18+(i%6)*.23,-29+Math.sin(i*2.399)*(2+(i%4)));leaf.userData={phase:i*2.399,radius:Math.hypot(leaf.position.x,leaf.position.z+29),height:leaf.position.y};g.add(leaf);storyRef.voidLeaves.push(leaf);}
}
// The First: friendly on the surface, and every task he gives brings the new arrival closer to the void.
function primoDialogue(){
  const f=storyFlags;
  if(f.has('darkroom-cleared')&&!f.has('corrado-tea'))return{line:'You read the margins. Those numbers are not instructions for falling. They are the seconds I watched after each body stopped moving. You found the earplugs, too.',choices:['Why did you wear them?','Did you ever hear The White?'],replies:['I wanted the image without the sound. Sound makes a fall belong to someone. An image can be kept.','I heard the reels turn. I heard the room when the motor stopped. I never heard an album.'],actions:[()=>storyFlags.add('corrado-questioned'),()=>storyFlags.add('corrado-questioned')]};
  if(f.has('corrado-tea'))return{line:'The cup was warm. The room was not. You keep looking for the moment I fell, but you have already watched it. The sound came later.',choices:['Who is left in the house?','What was The White?'],replies:['The person who pours. The person who opens the door. The person who arrives.','A room that kept being mistaken for a song. That is all I can tell you now.'],actions:[()=>storyFlags.add('ines-survivor-seen'),()=>storyFlags.add('white-questioned')]};
  if(f.has('escaped-forest'))return{line:'You came back. I thought you might. There is a particular way a person walks after seeing the place where they would disappear. You do not have to tell me what you saw.',choices:['I want to leave.','Why did you bring me there?'],replies:['Of course. I would never keep you. The door is open; you only have to decide which side of it you are on.','I wanted you to hear the trees without the village speaking over them. You heard something. That is not the same as understanding it.'],actions:[()=>storyFlags.add('primo-leave'),()=>storyFlags.add('primo-questioned')]};
  if(f.has('primo-task-dig')&&f.has('primo-task-candles'))return{line:'The album is almost ready. You have done more than I asked, and I am grateful. But you have started looking at the doors instead of the rooms. That usually means a person is close to deciding.',choices:['Take me to the car.','I want to leave.','What do you need from me?'],replies:['Good. We can speak where the walls cannot interrupt. The forest is quieter than this room.','Then go. I will not follow. I only hope you do not mistake the road for an answer.','Nothing you do not already know how to give. A little attention. A little space. Your name, perhaps, if you still feel it belongs to you.'],actions:[()=>{storyFlags.add('car-invited');pendingCar=true;},()=>storyFlags.add('primo-leave'),()=>storyFlags.add('primo-questioned')]};
  if(f.has('met-primo'))return{line:'You remember the lamp. I was glad to see you reach it. You looked relieved when I spoke to you. People rarely notice how much they need that small kindness until it is offered.',choices:['You made this place feel safe.','You knew I was coming.','Why are you helping me?'],replies:['I wanted you to feel there was somewhere to return to. A person will walk a very long way if they believe someone has noticed their arrival.','I knew the letter would find you. I did not know what you would bring with you. That part is always your own.','Because carrying yourself everywhere is exhausting. I thought you might want to set something down.'],actions:[()=>storyFlags.add('primo-trust'),()=>storyFlags.add('primo-suspicion'),()=>storyFlags.add('primo-questioned')]};
  return{line:'Good. You listened to the wrong things first, which is how everyone arrives. Let me give you something to do with your hands while you decide what you came for.',choices:['Why must I dig a grave?','What are the candles for?','Take me somewhere quiet.'],replies:['The ground under the willow remembers the first name we lost. Dig it up, and you will understand why we never say it aloud.','Three flames on the altar, so the choir can see where to fall. Light them, and the house will stop asking you questions.','Get in the car. There is a quiet place in the forest. Nobody hears a car in the forest.'],actions:[()=>storyFlags.add('primo-task-dig'),()=>storyFlags.add('primo-task-candles'),()=>{storyFlags.add('car-invited');pendingCar=true;}]};
}

function buildTeacup(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const porcelain=mat(0xb9b09d,.24,{metalness:.08}),tea=mat(0x24150f,.18,{metalness:.04});
  const profile=[new THREE.Vector2(.07,0),new THREE.Vector2(.11,.025),new THREE.Vector2(.15,.16),new THREE.Vector2(.18,.28),new THREE.Vector2(.15,.31),new THREE.Vector2(.06,.31)];
  const cup=new THREE.Mesh(new THREE.LatheGeometry(profile,24),porcelain);cup.position.y=.03;root.add(cup);
  const liquid=new THREE.Mesh(new THREE.CircleGeometry(.145,24),tea);liquid.rotation.x=-Math.PI/2;liquid.position.y=.32;root.add(liquid);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.105,.025,7,20,Math.PI*1.55),porcelain);handle.position.set(.16,.20,0);handle.rotation.z=-.6;root.add(handle);
  const saucer=new THREE.Mesh(new THREE.TorusGeometry(.19,.025,6,24),porcelain);saucer.rotation.x=Math.PI/2;saucer.position.y=.02;root.add(saucer);return root;
}
function startCorradoTeaScene(primo){
  if(storyFlags.has('corrado-tea')||storyScene||gameEnded)return;
  const ines=cultRoster.find(n=>n.name==='Ines');
  if(!ines||ines.fate!=='present'){triggerDeath('THE TEA NEVER CAME','Ines was no longer there to pour it. The room had lost the one person who knew how to make an ending gentle.');return;}
  storyFlags.add('corrado-tea-started');keys.clear();controls.unlock();dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');
  const z=zones.abattoir;const old=z.interactables.indexOf(primo);if(old>=0)z.interactables.splice(old,1);
  if(ines.object.parent!==z.group)transferCultist(ines,z,-2.4,-5.35);else ines.object.position.set(-2.4,0,-5.35);
  ines.point=ines.object.position;ines.object.rotation.y=.72;primo.object.position.set(0,0,-7.15);primo.object.rotation.y=Math.PI;
  const cup=buildTeacup(z.group,-.78,.015,-5.95);storyRef.corradoCup=cup;
  const thermos=buildThermos(z.group,-2.6,0,-5.0);thermos.scale.setScalar(.72);storyRef.corradoThermos=thermos;
  storyScene={type:'corrado-tea',t:0,dur:17,i:0,leader:primo,ines,cup,collapsed:false,sound:false,lines:[
    [.7,'Tobia: She crosses the room with the thermos. Nobody asks her to.'],
    [3.4,'Ines: You have watched so many things fall. You must be tired.'],
    [6.4,'Corrado: I kept the image. I wore the plugs so the sound could not make a claim on me.'],
    [9.3,'Tobia: The cup touches the table. Corrado watches the dust settle.'],
    [11.1,'Ines: Someone has to make it gentle.'],
    [14.1,'Voice: The sound arrives late. The man is already gone.']
  ]};
}
function endCorradoTeaScene(){
  const s=storyScene;if(!s||s.type!=='corrado-tea')return;
  const primo=s.leader,ines=s.ines;
  if(primo){primo.fate='dead';primo.object.visible=false;}
  if(ines){ines.talkedOnce=true;ines.fate='present';ines.object.visible=true;}
  storyFlags.add('corrado-tea');storyFlags.add('corrado-dead');storyFlags.add('institution-survives');
  journal.push({id:'corrado-tea',title:'The cup at 03:17',description:'Ines poured tea for Corrado as he watched dust settle. The image of his fall arrived before its sound. She stayed. The house still had someone to open the door.',kind:'witness account',zone:'abattoir'});updateJournalCount();updateMissions();
  storyScene=null;dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');camera.position.set(0,1.63,0);camera.rotation.set(0,0,0);controls.lock();
  showToast('THE FIRST IS GONE. THE HOUSE IS NOT EMPTY.');
}
function startDarioEavesdrop(){
  if(storyFlags.has('heard-dario-plan')||storyScene||gameEnded)return;
  if(!storyFlags.has('talked-ines')||!storyFlags.has('talked-ottavio')){showToast('SPEAK WITH INES AND OTTAVIO FIRST.');return;}
  keys.clear();controls.unlock();
  storyScene={type:'dario-eavesdrop',t:0,dur:12.5,i:0,flash:false,lines:[
    [.6,'Voice through the wall: Give Dario a task worthy of his belief.'],
    [3.5,'Dario: Tell me where to stand.'],
    [6.7,'Tobia: You hear every word. You do not open the door.'],
    [9.4,'Voice: Silence is not outside the act. It is the place you choose within it.']
  ]};
}
function endDarioEavesdrop(){
  storyFlags.add('heard-dario-plan');storyFlags.add('complicit');
  journal.push({id:'dario-plan',title:'The Words Through the Wall',description:'You heard the instruction given to Dario. You could have opened the door. You did not. The silence was not an absence of action; it was the action you took.',kind:'witness account',zone:'home'});
  updateJournalCount();updateMissions();storyScene=null;camera.position.set(0,1.63,0);camera.rotation.set(0,0,0);controls.lock();
  flashFragment('collapse',135);showToast('YOU HEARD IT. YOU DID NOTHING.');
}
function storyLine(text) {
  const m = /^([^:]+):\s*/.exec(text);
  $('speaker').textContent = m ? m[1].toUpperCase() : 'VOICE';
  $('subtitle').textContent = text.replace(/^[^:]+:\s*/, '');
  $('subtitle-wrap').classList.add('visible');
  speakVoice(text, m ? m[1] : '');
  clearTimeout(storyLine.timer);
  storyLine.timer = setTimeout(() => { if (!dialogueOpen && !storyScene) $('subtitle-wrap').classList.remove('visible'); }, 4200);
}
function buildStory() {
  addIndustry(zones.road.group, 56, -58, 1.1);
  addIndustry(zones.road.group, -60, -62, 1);
  addIndustry(zones.home.group, 14, -44, .9);
  addIndustry(zones.abattoir.group, 44, 0, .9);
  // A rusted combine rests in the wheat field, its header turned toward the road.
  const combine=buildCombineHarvester(zones.road.group,-47,-39,.92);combine.visible=true;storyRef.combine=combine;
  const pinoMarker=new THREE.Mesh(new THREE.SphereGeometry(.18,8,6),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));pinoMarker.position.set(-43,.2,-31);zones.road.group.add(pinoMarker);
  zones.road.interactables.push({id:'pino-combine-event',type:'event',object:pinoMarker,point:pinoMarker.position,radius:4.3,prompt:'[ E ] FOLLOW THE ENGINE',requiresFlag:'pino-sent',blockedHint:'Pino has not asked you to follow him into the field.',run:startPinoCombineScene});
  // The confessional: a booth in the church with a grille between the penitent and the priest.
  const booth = new THREE.Group(); booth.position.set(6.5, 0, -10); zones.church.group.add(booth);
  addBox(booth, 0, 1.1, 0, 1.4, 2.2, 1.2, mat(0x2e2016, .6));
  addBox(booth, 0, 1.45, .62, .9, .5, .05, mat(0x0a0908, .9));
  storyRef.hand = buildHand(); storyRef.hand.position.set(6.5, -1, -12.6); storyRef.hand.visible = false; zones.church.group.add(storyRef.hand);
  zones.church.interactables.push({ id: 'confession', type: 'story', object: booth, point: new THREE.Vector3(6.5, .9, -8.4), radius: 2.4, prompt: '[ E ] ENTER THE CONFESSIONAL', run: startConfession });
  // The First's dialogue is generated from the story so far.
  const primo = zones.abattoir.interactables.find(i => i.name === 'The First' || /primo/i.test(i.name || ''));
  if (primo) Object.defineProperty(primo, 'dialogue', { get: primoDialogue, configurable: true });
  buildForest();
}
function startConfession() {
  if (storyFlags.has('confessed') || storyScene) return;
  storyFlags.add('confessed');
  storyScene = { type: 'confession', t: 0, dur: 21, i: 0, lines: [
    [.6, 'Priest (behind the grille): Kneel. Say nothing until I open the grille.'],
    [4, 'Priest: The register from the winter of 1977 is still in the sacristy. Thirteen names, one recording, one heater nobody checked.'],
    [9, 'Priest: There is a fourteenth name. It was written in the same ink, the morning after the choir died. It is yours.'],
    [13, 'Priest: The date beside it is tomorrow. You agreed to come before you ever knocked on the door.'],
    [16.5, 'Something is rising in the nave behind the grille. A hand, with no arm attached to it.'],
    [19.4, 'The hand sinks back into the dark. The grille closes.']] };
}
function endConfession() {
  storyScene = null; storyRef.hand.visible = false;
  journal.push({ id: 'register-14', title: 'The fourteenth name', description: 'Winter 1977 register: thirteen names, then a fourteenth in the same ink. The name is yours. The date beside it is tomorrow.', kind: 'document', zone: 'church' });
  updateJournalCount(); fear = Math.min(1, fear + .1); glitchPulse = Math.max(glitchPulse, .9);
  showToast('YOUR NAME IS IN THE REGISTER.');
}
function beginForestCar() {
  storyFlags.add('car-invited');
  enterZone('forest', [0, 0, 0]);
  const car = storyRef.car; car.visible = true; car.position.set(0, 0, 0); car.rotation.y = 0;
  storyScene = { type: 'car', t: 0, dur: 17, i: 0, lines: [
    [.8, 'The First: Sit. Breathe on the glass and it fogs up, then it clears. Most things work like that.'],
    [4.5, 'The First: We drive a little. Nobody in the village listens to cars, and the forest does not repeat what it hears.'],
    [9, 'The First: You did well at the table. Most people never ask who taught them to stop asking.'],
    [13.5, 'The First: Get out now. Keep the lamp behind you.']] };
}
function updateStoryScene(dt, t) {
  const s = storyScene; s.t += dt;
  while (s.i < s.lines.length && s.t >= s.lines[s.i][0]) { storyLine(s.lines[s.i][1]); s.i++; }
  if (s.type === 'hold') { if (s.t >= s.dur) storyScene = null; }
  else if(s.type==='dario-eavesdrop'){
    if(s.t>=8.8&&!s.flash){s.flash=true;flashFragment('collapse',125);audio?.mechanicalNoise(.18,380,.8,.09,0);}
    if(s.t>=s.dur)endDarioEavesdrop();
  }
  else if(s.type==='pino-combine'){
    const pino=storyRef.pino,machine=storyRef.combine;
    camera.position.set(-37.2,6.8,-27.8);camera.lookAt(-51,1.0,-39.5);
    if(pino&&pino.fate!=='dead'){
      pino.object.position.x=-49-Math.min(8.2,s.t*1.02);
      pino.object.position.z=-34-Math.sin(s.t*.55)*.55;
      pino.object.rotation.y=-Math.PI/2;pino.object.rotation.z=Math.sin(s.t*4)*.08;pino.walking=true;
    }
    if(machine){
      machine.position.x=-42-Math.max(0,s.t-1.8)*1.55;machine.position.z=-35-Math.max(0,s.t-1.8)*.36;machine.rotation.y=-Math.PI/2;
      if(machine.userData.reel)machine.userData.reel.rotation.x+=dt*2.4;
      if(machine.userData.wheels)machine.userData.wheels.forEach(w=>{w.rotation.z+=dt*4.8;});
    }
    if(s.t>=8.0&&!s.collapse){s.collapse=true;if(pino){pino.fate='dead';pino.walking=false;pino.object.visible=false;}flashFragment('collapse',190);glitchPulse=Math.max(glitchPulse,1.2);}
    if(s.t>=11.3&&!s.sound){s.sound=true;audio?.mechanicalNoise(.34,360,1.1,.18,0);audio?.mechanicalTone(84,32,1.8,'sawtooth',.09,0);audio?.killSting();}
    if(s.t>=s.dur)endPinoCombineScene();
  }
  else if(s.type==='corrado-tea'){
    const leader=s.leader,ines=s.ines,k=THREE.MathUtils.smoothstep(s.t,0,s.dur);
    camera.position.set(-1.2+.22*Math.sin(s.t*.35),1.8,-3.25-.65*k);camera.lookAt(-.2,1.28,-6.35);
    if(ines){ines.object.rotation.y=.68+Math.sin(s.t*1.2)*.018;ines.object.position.x=-2.4+THREE.MathUtils.smoothstep(s.t,1,4)*1.2;}
    if(leader&&s.t<9.9){leader.object.rotation.y=Math.PI+Math.sin(s.t*.42)*.035;leader.object.rotation.x=Math.sin(s.t*.8)*.018;}
    if(leader&&s.t>=9.9&&!s.collapsed){s.collapsed=true;leader.object.rotation.x=1.38;leader.object.rotation.z=.12;leader.object.position.y=-.22;flashFragment('tea',185);glitchPulse=Math.max(glitchPulse,1.45);}
    if(leader&&s.t>=12.1)leader.object.visible=false;
    if(s.t>=14.1&&!s.sound){s.sound=true;audio?.mechanicalNoise(.22,2400,6,.12,.15);audio?.mechanicalTone(96,34,1.2,'sawtooth',.08,-.1);audio?.killSting();}
    if(s.t>=s.dur)endCorradoTeaScene();
  }
  else if (s.type === 'finale') { updateFinale(s, dt); } else if (s.type === 'intro') {
    const k = THREE.MathUtils.smoothstep(s.t, 0, s.dur);
    camera.position.set(Math.sin(s.t * .8) * .05, 1.62 + Math.sin(s.t * 2.6) * .025, THREE.MathUtils.lerp(64, 27, k));
    camera.lookAt(Math.sin(s.t * .3) * .3, .4, -20);
    $('intro-dark').style.opacity = String(Math.max(0, 1 - s.t / 9));
    if (scene.fog) scene.fog.density = Math.min(scene.fog.density, .012);
    if (s.t >= s.dur) endIntro();
  } else if (s.type === 'car') {
    const car = storyRef.car, k = THREE.MathUtils.smoothstep(s.t, 1, s.dur - 3);
    car.position.z = -44 * k; car.position.x = Math.sin(s.t * 1.3) * .05; car.rotation.y = Math.sin(s.t * .4) * .02;
    camera.position.set(car.position.x + .38, 1.12 + Math.sin(s.t * 2.1) * .01, car.position.z - .25);
    camera.lookAt(car.position.x + .02, 1.05, car.position.z - 6);
    if (s.t >= s.dur) endCarScene();
  } else if (s.type === 'confession') {
    camera.position.set(6.5,1.25,-7.7);camera.lookAt(6.5,1.35,-10.6);
    const hand=storyRef.hand,rise=THREE.MathUtils.clamp((s.t-15.5)/1.4,0,1),sink=THREE.MathUtils.clamp((s.t-18)/1.4,0,1);
    hand.visible=s.t>15.5;hand.position.y=-1+2.7*rise-2.7*sink;hand.rotation.z=Math.sin(s.t*3)*.14;if(s.t>=s.dur)endConfession();
  } else if(s.type==='ending'){
    const growth=storyRef.voidGrowth;
    if(s.t<8.2){
      const a=THREE.MathUtils.smoothstep(s.t,0,8.2);
      camera.position.set(Math.sin(s.t*.22)*.035,1.63-a*.22,-.10-a*.55);camera.lookAt(0,1.48,-2.2);
      if(growth){growth.visible=true;growth.scale.setScalar(.001+THREE.MathUtils.smoothstep(s.t,1.4,8.1));}
      if(scene.fog)scene.fog.density=.062+a*.018;scene.background.lerp(new THREE.Color(0x777e76),Math.min(1,a));
    }else{
      if(!s.switched){
        s.switched=true;zones.cellar.group.visible=false;zones.forest.group.visible=true;zone=zones.forest;currentZone='forest';playerAnchor.position.set(0,0,0);camera.position.set(0,2.15,3.8);
        zones.forest.fogColor=0xc4cbc5;zones.forest.density=.024;scene.background.set(0xc4cbc5);scene.fog=new THREE.FogExp2(0xc4cbc5,.024);
        $('location').textContent='THE FOREST / THE SHAPE OF THE VOID';audio?.setZone('forest');if(storyRef.voidFigure)storyRef.voidFigure.visible=true;storyRef.voidLeaves?.forEach(l=>l.visible=true);
      }
      const travel=THREE.MathUtils.smoothstep(s.t,8.2,19.8);camera.position.set(Math.sin(s.t*.18)*.06,2.15+Math.sin(s.t*.4)*.035,3.8-travel*24.5);camera.lookAt(0,1.65,-29);
      const figure=storyRef.voidFigure;
      if(figure){const vanish=THREE.MathUtils.smoothstep(s.t,15,20.5);figure.scale.set(1+vanish*.35,1+vanish*.55,1+vanish*.35);figure.children.forEach(o=>{if(o.material&&'opacity'in o.material)o.material.opacity=(o.geometry?.type==='TorusGeometry'?.28:.60)*(1-vanish);});}
      storyRef.voidLeaves?.forEach((leaf,i)=>{const phase=leaf.userData.phase,pull=THREE.MathUtils.smoothstep(s.t,14,20.8),r=leaf.userData.radius*(1-pull*.96);leaf.position.set(Math.cos(phase+s.t*.52)*r,leaf.userData.height+Math.sin(s.t*.7+phase)*.18,-29+Math.sin(phase+s.t*.52)*r*.72);leaf.rotation.z+=.012+(i%4)*.002;leaf.material.opacity=.82*(1-pull);});
      if(s.t>=s.dur)revealEndingChoices();
    }
  }
}
function endCarScene() {
  storyScene = null;
  playerAnchor.position.set(0, 0, -42);
  const ch = storyRef.chaser; ch.visible = true; ch.position.set(2.5, 0, -40);
  chaseState = { t: 0, next: 2, lunge: 0 };
  storyLine('Walk back to the lamp. It is the only light in the forest, and it is pointing at you.');
  showToast('RUN. THE LAMP IS THE STARTING POINT.');
  fear = Math.min(1, fear + .2); glitchPulse = Math.max(glitchPulse, .8);
}
// The chase: he hesitates when you watch him, lunges when you turn away, and sometimes lies about the way back.
function updateChase(dt, t) {
  if (currentZone !== 'forest') { chaseState = null; storyRef.chaser.visible = false; return; }
  const c = chaseState, ch = storyRef.chaser, p = playerAnchor.position;
  c.t += dt; c.next -= dt;
  if (c.next <= 0) {
    c.lunge = Math.random() < .35 ? 1.2 : 0; c.next = 2.5 + Math.random() * 3;
    if (Math.random() < .35) storyLine(['The First: Come back. The way is shorter from here.', 'The First: You are walking away from the one warm place in the forest.', 'The First: Listen. The forest is listening for your breath.'][(Math.random() * 3) | 0]);
  }
  const dx = p.x - ch.position.x, dz = p.z - ch.position.z, d = Math.hypot(dx, dz) || .001;
  camera.getWorldDirection(camDir2);
  const fl = Math.hypot(camDir2.x, camDir2.z) || 1;
  const watched = (camDir2.x * -dx + camDir2.z * -dz) / (fl * d) > .6 && d < 8;
  if (c.lunge > 0) c.lunge -= dt;
  const speed = c.lunge > 0 ? 4.4 + primoSpeedBonus() : (watched ? 0 : (2.2 + Math.sin(t * .7) * .5 + primoSpeedBonus()) * 1.2);
  if (d > 1.2 && speed > 0) { const step = Math.min(d - 1.1, speed * dt); ch.position.x += dx / d * step; ch.position.z += dz / d * step; }
  ch.rotation.y = Math.atan2(dx, dz); ch.rotation.z = Math.sin(t * .004) * .05;
  if (d < 1.3) { chaseState = null; triggerDeath('THE FOREST KEPT YOU'); return; }
  if (Math.hypot(p.x, p.z) < 2.6) escapeForest();
}
function escapeForest() {
  chaseState = null; storyRef.chaser.visible = false;
  storyFlags.add('escaped-forest');
  enterZone('road', [zones.road.spawn.x, 0, zones.road.spawn.z]);
  showToast('THE CAR NEVER LEFT THE CLEARING. THE ROAD TAKES YOU BACK.');
  updateMissions();
}
function updateDarkroomHunt(dt,t){
  if(currentZone!=='darkroom'||!darkroomHunt.active||storyFlags.has('darkroom-cleared')||gameEnded||dialogueOpen||journalOpen||storyScene)return;
  const npc=storyRef.darkroomHunter;if(!npc?.object)return;
  const p=playerAnchor.position,h=npc.object.position;
  darkroomHunt.elapsed+=dt;darkroomHunt.reappear-=dt;
  const dx=p.x-h.x,dz=p.z-h.z,dist=Math.hypot(dx,dz)||.001;
  camera.getWorldDirection(camDir2);const len=Math.hypot(camDir2.x,camDir2.z)||1;
  const dot=(camDir2.x*dx+camDir2.z*dz)/(len*dist);
  const lampOn=flashlightOn&&dot>.78&&dist<12;
  if(lampOn){
    npc.object.visible=true;darkroomHunt.lastFlash=t;
    npc.object.rotation.y=Math.atan2(dx,dz);
    npc.object.rotation.z=Math.sin(t*.002)*.035;
    fear=Math.max(.10,fear-.025*dt);
    if(dist<4.5&&darkroomHunt.warning<=0){darkroomHunt.warning=4;showToast('CORRADO IS STANDING IN THE LIGHT. DO NOT LOOK AWAY.');audio?.mechanicalTone(82,42,.8,'sine',.035,0);}
  }else{
    npc.object.visible=t-darkroomHunt.lastFlash<240;
    darkroomHunt.warning=Math.max(0,darkroomHunt.warning-dt);
    if(dist>1.65){
      const step=Math.min(dist-1.55,(.78+Math.min(.55,darkroomHunt.elapsed*.012))*dt);
      h.x+=dx/dist*step;h.z+=dz/dist*step;
    }
  }
  // When the player keeps the beam elsewhere, Corrado crosses the room without a footstep.
  if(darkroomHunt.reappear<=0&&!lampOn&&dist>5.5){
    const back=new THREE.Vector3(-camDir2.x,0,-camDir2.z);
    h.set(THREE.MathUtils.clamp(p.x+back.x*(4.5+Math.random()*2),-8.6,8.6),0,THREE.MathUtils.clamp(p.z+back.z*(4.5+Math.random()*2),-10.6,10.6));
    darkroomHunt.reappear=4.5+Math.random()*3.5;npc.object.visible=false;
    flashFragment('collapse',95);audio?.mechanicalEvent('scrape');
  }
  if(dist<1.45&&!lampOn){
    darkroomHunt.active=false;flashFragment('collapse',180);
    triggerDeath('CORRADO FOUND YOU','You saw him only when the beam reached him. When the beam moved, he was already beside you. The room kept the rest of the recording.');return;
  }
}
function storyTick(dt, t) {
  try { updatePorchPrimo(); updateAtmosphere(); updateEscalation(dt); updateCellarHunt(dt, t); updateDarkroomHunt(dt,t); updateCinematic(); } catch (err) { console.error('primo', err); }
  try {
    updateEmitters(dt);
    updateIndustryNoise(dt);
    updateWindAudio();
    updateWindParticles(dt, t);
    if (pendingCar && !dialogueOpen && gameStarted && !gameEnded && currentZone === 'abattoir') { pendingCar = false; beginForestCar(); }
    if (storyScene) updateStoryScene(dt, t);
    if (chaseState) updateChase(dt, t);
  } catch (err) { console.error('story', err); }
}


// =============================================================================
// v3.5: textures (photos and procedural), the opening walk out of the dark,
// wind in the air and in the sound.
// =============================================================================
function repeatTex(canvas, rep) {
  const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t;
}
// A photograph loaded into a texture; until it arrives the material shows its base colour.
function photoTexture(url, rep) {
  const t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  new THREE.ImageLoader().load(url, (img) => { t.image = img; t.needsUpdate = true; }, undefined, () => console.warn('Texture not found:', url));
  return t;
}
function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#3f4a25'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, h = Math.random();
    const col = h < .55 ? 'rgba(' + Math.floor(70 + Math.random() * 40) + ',' + Math.floor(95 + Math.random() * 50) + ',40,.75)'
      : h < .85 ? 'rgba(40,50,25,.7)' : 'rgba(120,105,58,.5)';
    g.strokeStyle = col; g.lineWidth = 1 + Math.random() * 1.2;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (Math.random() - .5) * 4, y - 6, x + (Math.random() - .5) * 8, y - 12 - Math.random() * 8); g.stroke();
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(60,45,30,.35)'; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 14, 4 + Math.random() * 8, 0, 0, Math.PI * 2); g.fill(); }
  return repeatTex(c, 40);
}
function metalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#6c7074'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, len = 40 + Math.random() * 200, v = Math.floor(90 + Math.random() * 90);
    g.strokeStyle = 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',' + (.1 + Math.random() * .25) + ')';
    g.lineWidth = .6 + Math.random() * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (Math.random() - .5) * .6); g.stroke();
  }
  for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(30,28,26,' + (.15 + Math.random() * .2) + ')'; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 10, 1 + Math.random() * 4, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(210,210,200,.25)'; g.lineWidth = 1; g.beginPath(); const x = Math.random() * 512, y = Math.random() * 512; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60); g.stroke(); }
  return repeatTex(c, 2);
}
function rustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#6e3b22'; g.fillRect(0, 0, 512, 512);
  const cols = ['rgba(140,70,30,.35)', 'rgba(60,30,18,.4)', 'rgba(190,120,60,.25)', 'rgba(35,25,20,.35)'];
  for (let i = 0; i < 180; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 30, 4 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(40,22,14,.22)'; g.lineWidth = 2 + Math.random() * 3; const x = Math.random() * 512; g.beginPath(); g.moveTo(x, Math.random() * 512); g.lineTo(x + (Math.random() - .5) * 10, 512 * Math.random() + 80); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(210,140,70,.35)'; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  return repeatTex(c, 2);
}
// Wind strength per place: open ground and the forest feel it most; inside the house barely at all.
function windStrengthFor(name) { const W = { road: .55, forest: .95, abattoir: .35, home: .12, church: .7, ruin: .45, cellar: .02 }; return W[name] ?? .2; }
let windAudio = null;
function ensureWindAudio() {
  if (windAudio || !audio || !audio.ctx || !audio.master) return;
  const ctx = audio.ctx, len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .6;
  const gain = ctx.createGain(); gain.gain.value = .02;
  const gust = ctx.createOscillator(); gust.frequency.value = .11; const gg = ctx.createGain(); gg.gain.value = .014;
  const sway = ctx.createOscillator(); sway.frequency.value = .37; const sg = ctx.createGain(); sg.gain.value = 160;
  gust.connect(gg); gg.connect(gain.gain); sway.connect(sg); sg.connect(bp.frequency);
  src.connect(bp); bp.connect(gain); gain.connect(audio.master);
  src.start(); gust.start(); sway.start();
  windAudio = { gain };
}
function updateWindAudio() {
  ensureWindAudio(); if (!windAudio) return;
  windAudio.gain.gain.setTargetAtTime(.02 + windStrengthFor(currentZone) * .07, audio.ctx.currentTime, .8);
}
// Dust and leaves carried past the camera; they follow the player and only show outdoors.
const WIND_N = 260, windPos = new Float32Array(WIND_N * 3);
const windGeo = new THREE.BufferGeometry(); windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
const windPts = new THREE.Points(windGeo, new THREE.PointsMaterial({ color: 0xcfc8b8, size: .06, transparent: true, opacity: .35, depthWrite: false }));
windPts.frustumCulled = false; windPts.visible = false; scene.add(windPts);
function respawnWind(i) { windPos[i*3] = (Math.random() - .5) * 24; windPos[i*3+1] = Math.random() * 4; windPos[i*3+2] = (Math.random() - .5) * 24; }
for (let i = 0; i < WIND_N; i++) respawnWind(i);
function updateWindParticles(dt, t) {
  const strength = windStrengthFor(currentZone);
  windPts.visible = gameStarted && (currentZone === 'road' || currentZone === 'forest') && strength > .2;
  if (!windPts.visible) return;
  windPts.position.copy(camera.position);
  const gust = strength * (.7 + .3 * Math.sin(t * .0009) + .2 * Math.sin(t * .0023));
  for (let i = 0; i < WIND_N; i++) {
    windPos[i*3] += gust * 6 * dt; windPos[i*3+1] += (-.4 + Math.sin(t * .002 + i) * .2) * dt; windPos[i*3+2] += gust * 1.2 * dt;
    if (Math.abs(windPos[i*3]) > 12 || Math.abs(windPos[i*3+2]) > 12 || windPos[i*3+1] < 0) respawnWind(i);
  }
  windGeo.attributes.position.needsUpdate = true;
}
// The walk out of the dark: the camera comes up the road from the fog behind, and the darkness thins as he walks.
function startIntro() {
  if (storyFlags.has('intro-seen')) return;
  storyFlags.add('intro-seen');
  $('intro-dark').style.opacity = '1';
  storyScene = { type: 'intro', t: 0, dur: 44, i: 0, lines: [
    [1, 'Voice: I came up the lane in the dark. The dark is where I left everything else.'],
    [7, 'Voice: People have always said I listen too well. I hear the pause before a sentence, the room between the words.'],
    [13, 'Voice: Nothing in me has ever asked to be filled. It is easy to empty a room like that, and I have never minded the quiet.'],
    [19, 'Voice: A letter came, with a name in it. I answered by walking, because walking asks nothing back.'],
    [25, 'Voice: The house at the end of the road has waited a long time for someone who listens. I am only the one who did not leave.'],
    [31, 'Voice: Stay quiet. The fog is listening too, and it does not repeat what it hears.'],
    [37, 'Voice: The lamp is lit. Someone is holding the door open.'],
    [40, 'The First: Good evening. You found us. I kept the light on.']] };
}
function endIntro() {
  storyScene = null; $('intro-dark').style.opacity = '0';
  $('objective-text').textContent = 'Reach the farmhouse gate.';
}


// =============================================================================
// v3.6: The First's face, his vanishing and return, difficulty, rewards and
// penalties, one conversation per person, zone soundscapes and the finale.
// =============================================================================
// A face after Francis Bacon's Head VI (1949): a screaming head in a dark cage of brushed strokes.
function headVICanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#1b1210'; g.fillRect(0, 0, 512, 512);
  const grd = g.createRadialGradient(256, 230, 40, 256, 256, 260); grd.addColorStop(0, '#b7a28c'); grd.addColorStop(.7, '#6e5b4e'); grd.addColorStop(1, '#1b1210');
  g.fillStyle = grd; g.beginPath(); g.ellipse(256, 240, 170, 215, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 90; i++) { g.strokeStyle = 'rgba(' + (60 + Math.random() * 60 | 0) + ',' + (40 + Math.random() * 30 | 0) + ',' + (35 + Math.random() * 20 | 0) + ',.45)'; g.lineWidth = 2 + Math.random() * 7;
    const x = 110 + Math.random() * 290; g.beginPath(); g.moveTo(x, 40 + Math.random() * 80); g.quadraticCurveTo(x + (Math.random() - .5) * 40, 260, x + (Math.random() - .5) * 30, 470); g.stroke(); }
  g.fillStyle = '#0b0606'; g.beginPath(); g.ellipse(256, 330, 62, 84, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8dccb'; for (let i = 0; i < 10; i++) g.fillRect(212 + i * 8, 262, 5, 16);
  g.fillStyle = '#050303';
  [[196, 205], [316, 205]].forEach(([x, y]) => { g.beginPath(); g.ellipse(x, y, 30, 20, .2, 0, Math.PI * 2); g.fill(); });
  g.strokeStyle = 'rgba(15,10,8,.85)'; g.lineWidth = 9;
  for (let x = 60; x <= 460; x += 56) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 512); g.stroke(); }
  return c;
}
function headMaterial() {
  if (!HEAD_TEX) { HEAD_TEX = new THREE.CanvasTexture(headVICanvas()); HEAD_TEX.colorSpace = THREE.SRGBColorSpace; }
  return new THREE.MeshStandardMaterial({ map: HEAD_TEX, roughness: .85 });
}
function headVIDataUrl() { if (!JUMP_URL) JUMP_URL = headVICanvas().toDataURL(); return JUMP_URL; }
function paintingTexture(kind) {
  if (PAINT_TEX[kind]) return PAINT_TEX[kind];
  const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d');
  g.fillStyle = '#2a1d17'; g.fillRect(0, 0, 256, 320);
  if (kind === 0) { g.fillStyle = '#8a7060'; g.beginPath(); g.ellipse(128, 130, 52, 66, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0a0606'; g.beginPath(); g.ellipse(128, 160, 22, 14, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a0e0a'; g.lineWidth = 16; g.beginPath(); g.moveTo(40, 300); g.quadraticCurveTo(128, 60, 216, 300); g.stroke(); }
  else { g.fillStyle = '#050403'; g.beginPath(); g.arc(128, 120, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6a5a4a'; g.lineWidth = 6; g.strokeRect(96, 200, 64, 90); g.beginPath(); g.moveTo(96, 200); g.lineTo(96, 290); g.stroke(); }
  for (let i = 0; i < 80; i++) { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3 + Math.random() * 5; const x = Math.random() * 256; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - .5) * 20, 320); g.stroke(); }
  PAINT_TEX[kind] = new THREE.CanvasTexture(c); PAINT_TEX[kind].colorSpace = THREE.SRGBColorSpace; return PAINT_TEX[kind];
}
function difficultyTier() { return Math.min(6, seenMissions.size); }
function primoSpeedBonus() { return difficultyTier() * .13; }
// Choices lead to small rewards or penalties; the table is keyed by speaker and choice index.
function applyChoiceEffect(key,index,npc=null){
 const row=CHOICE_EFFECTS[key],entry=row?.[index]||null;
 const [severity,effect]=entry?entry.split(':'):[index>0?'bad':'good','none'];
 if(severity==='bad'){showThirteenDemises(npc);flashFragment(npc?.name?.toLowerCase()==='ines'?'tea':npc?.name?.toLowerCase()==='ottavio'?'reel':'collapse',125);if(npc?.cultist&&npc.fate==='present')queueCultFate('a wrong answer',npc,'collapse');}
  if (effect === 'map') {
    if (storyFlags.has('map')) return; storyFlags.add('map');
    journal.push({ id: 'map', title: 'Folded map', description: 'The farmhouse plan. The road runs north to the house. The slaughterhouse lies east, behind the barn. The church is past the canal. The forest begins where the lamp goes out.', kind: 'map', zone: currentZone });
    updateJournalCount(); showToast('YOU RECEIVE A FOLDED MAP.');
  } else if (effect === 'health') { fear = Math.max(0, fear - .22); showToast('YOUR BREATHING SLOWS.'); }
  else if (effect === 'key') {
    if (storyFlags.has('key-east')) return;
    storyFlags.add('key-east');
    const hg = zones.home.group;
    [-2.2, 2.2].forEach((x, i) => { const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshStandardMaterial({ map: paintingTexture(i), roughness: .9 })); pm.position.set(x, 1.8, 8.85); pm.rotation.y = Math.PI; hg.add(pm); });
    addLook(hg, -2.2, 1.8, 8.4, 'Two paintings', 'Two canvases. The left shows a hooded figure with its face smeared away, its mouth open. The right shows an empty chair under a black sun. Both were painted from the same chair.');
    journal.push({ id: 'key-east', title: 'Key to the east room', description: 'A brass key with a paper tag: "East room. Two paintings. Do not turn them round."', kind: 'key', zone: currentZone });
    updateJournalCount(); showToast('A KEY TO THE EAST ROOM.');
  }
  else if (effect === 'closer') {
    if (stalker && stalker.visible && stalkerZone === currentZone) {
      const p = playerAnchor.position, dx = p.x - stalker.position.x, dz = p.z - stalker.position.z, d = Math.hypot(dx, dz) || 1;
      stalker.position.x += dx / d * Math.min(4, d - 1); stalker.position.z += dz / d * Math.min(4, d - 1);
    } else storyFlags.add('primo-closer');
    showToast('SOMETHING HAS COME CLOSER.');
  }
  else if (effect === 'jumpscare') jumpscare();
  else if (effect === 'trip') trip();
}
let demiseVision=null;
function showThirteenDemises(sourceNpc=null){
 if(!zone)return;
 if(demiseVision?.group?.parent)demiseVision.group.parent.remove(demiseVision.group);
 const group=new THREE.Group(),dir=new THREE.Vector3();camera.getWorldDirection(dir);dir.y=0;dir.normalize();
 const center=playerAnchor.position.clone().addScaledVector(dir,4.8);group.position.set(center.x,0,center.z);group.rotation.y=Math.atan2(-dir.x,-dir.z);zone.group.add(group);
 const materials=[];
 for(let i=0;i<13;i++){
  const figure=new THREE.Group();
  const shadow=new THREE.MeshStandardMaterial({color:i%3===0?0x50302a:0x191a17,roughness:1,transparent:true,opacity:.86,depthWrite:false});
  const ash=new THREE.MeshStandardMaterial({color:0x82786a,roughness:1,transparent:true,opacity:.54,depthWrite:false});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.15,.56,4,7),shadow);body.position.y=.78;body.scale.set(1.05,1.12,.56);figure.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.12,8,7),ash);head.position.y=1.48;head.scale.set(.82,1.12,.7);figure.add(head);
  for(const side of [-1,1]){
   const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.04,.38,4,6),shadow);arm.position.set(side*.22,.94,0);arm.rotation.z=side*([.8,-.55,.15,1.15][(i+side+4)%4]);figure.add(arm);
   const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.35,4,6),shadow);leg.position.set(side*.085,.28,.02);leg.rotation.z=side*([.45,0,-.6,.2][(i+side+4)%4]);figure.add(leg);
  }
  const noose=new THREE.Mesh(new THREE.TorusGeometry(.12,.017,5,14),ash);noose.position.y=1.68;figure.add(noose);
  const a=(i/12-.5)*2.25,offset=Math.sin(a)*5.5,depth=Math.cos(a)*.65;
  figure.position.set(offset,.02,depth);figure.rotation.z=[-.72,.24,1.18,0][i%4];figure.rotation.x=[.35,-.45,0,.85][i%4];figure.scale.setScalar(.88+(i%4)*.06);group.add(figure);
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.22+(i%3)*.04,14),new THREE.MeshBasicMaterial({color:0x2a090a,transparent:true,opacity:.62,depthWrite:false}));
  stain.rotation.x=-Math.PI/2;stain.position.set(offset,.012,depth);group.add(stain);
  [shadow,ash,stain.material].forEach(m=>{m.userData.baseOpacity=m.opacity;materials.push(m);});
 }
 demiseVision={group,materials,t:0,duration:4.8,sourceNpc};glitchPulse=Math.max(glitchPulse,1.35);fear=Math.min(1,fear+.16);audio?.killingAudio();audio?.killSting();
}
function updateThirteenDemises(dt){
 if(!demiseVision)return;
 const v=demiseVision;v.t+=dt;const fade=THREE.MathUtils.smoothstep(v.t,2.2,v.duration);
 v.materials.forEach(m=>{m.opacity=m.userData.baseOpacity*(1-fade);});
 v.group.scale.setScalar(.94+Math.sin(v.t*6)*.025);v.group.position.y=Math.sin(v.t*1.8)*.035;
 if(v.t>=v.duration){v.group.parent?.remove(v.group);demiseVision=null;}
}
function flashFragment(kind='room-tone',duration=145){
  const c=document.createElement('canvas');c.width=640;c.height=420;
  const g=c.getContext('2d');g.fillStyle='#090907';g.fillRect(0,0,640,420);
  const grain=()=>{for(let i=0;i<1100;i++){g.fillStyle=Math.random()>.5?'rgba(220,210,190,.05)':'rgba(0,0,0,.15)';g.fillRect(Math.random()*640,Math.random()*420,1+Math.random()*3,1);}};
  g.save();g.translate(320,210);g.rotate((Math.random()-.5)*.025);
  if(kind==='heater'||kind==='dark-heater'){
    g.fillStyle='#49453c';g.beginPath();g.moveTo(-110,-135);g.lineTo(92,-132);g.lineTo(116,100);g.lineTo(-124,105);g.closePath();g.fill();
    g.fillStyle='#1b1c18';g.fillRect(-100,-95,200,34);for(let i=0;i<8;i++){g.strokeStyle='rgba(180,160,130,.5)';g.lineWidth=4;g.beginPath();g.moveTo(-86+i*24,-89);g.lineTo(-86+i*24,-62);g.stroke();}
    for(let i=0;i<3;i++){g.fillStyle=['#7b3828','#a14b29','#5b3126'][i];g.beginPath();g.ellipse(-62+i*62,4,26,72,0,0,Math.PI*2);g.fill();}
    g.strokeStyle='#b3a48a';g.lineWidth=8;g.beginPath();g.arc(0,5,137,Math.PI*1.08,Math.PI*1.92);g.stroke();
  }else if(kind==='earplugs'||kind==='dark-earplugs'){
    for(const x of [-78,78]){g.fillStyle='#8f6961';g.beginPath();g.ellipse(x,0,28,68,x/150,0,Math.PI*2);g.fill();g.fillStyle='#2b2420';g.beginPath();g.arc(x,-50,19,0,Math.PI*2);g.fill();}
    g.strokeStyle='#a9926b';g.lineWidth=4;g.beginPath();g.arc(0,0,145,-1.1,1.1);g.stroke();
    g.fillStyle='#d3c5a6';g.font='18px monospace';g.fillText('C',-6,132);
  }else if(kind==='book'||kind==='dark-book'){
    g.fillStyle='#4c3b2d';g.beginPath();g.moveTo(-135,-145);g.lineTo(8,-122);g.lineTo(12,146);g.lineTo(-140,120);g.closePath();g.fill();
    g.fillStyle='#bdb39b';g.beginPath();g.moveTo(8,-122);g.lineTo(140,-145);g.lineTo(140,120);g.lineTo(12,146);g.closePath();g.fill();
    g.strokeStyle='#5a4a39';g.lineWidth=4;for(let y=-83;y<100;y+=17){g.beginPath();g.moveTo(25,y);g.lineTo(117,y-6);g.stroke();}
    g.fillStyle='#241b16';g.font='19px serif';g.fillText('WILL NOTHINGNESS',-116,-90);
  }else if(kind==='reel'||kind==='dark-reel'||kind==='room-tone'){
    for(const x of [-95,95]){g.strokeStyle='#a19a83';g.lineWidth=10;g.beginPath();g.arc(x,-10,74,0,Math.PI*2);g.stroke();g.strokeStyle='#4c4b42';g.lineWidth=5;g.beginPath();g.arc(x,-10,44,0,Math.PI*2);g.stroke();g.fillStyle='#1e201c';g.beginPath();g.arc(x,-10,15,0,Math.PI*2);g.fill();for(let i=0;i<6;i++){const a=i*Math.PI/3;g.strokeStyle='#7e796b';g.lineWidth=7;g.beginPath();g.moveTo(x,-10);g.lineTo(x+Math.cos(a)*58,-10+Math.sin(a)*58);g.stroke();}}
    g.strokeStyle='#b4a88b';g.lineWidth=3;g.beginPath();g.moveTo(-18,-3);g.lineTo(-4,28);g.lineTo(13,28);g.lineTo(23,-2);g.stroke();
  }else if(kind==='report'||kind==='dark-report'){
    g.fillStyle='#b6aa8d';g.fillRect(-120,-155,240,310);g.strokeStyle='#64584a';g.lineWidth=2;
    for(let y=-105;y<95;y+=24){g.beginPath();g.moveTo(-90,y);g.lineTo(89,y);g.stroke();}
    g.fillStyle='#7e1d18';g.font='bold 31px monospace';g.translate(4,12);g.rotate(-.22);g.fillText('03:17',-62,0);g.restore();g.save();g.translate(320,210);
  }else if(kind==='script'||kind==='dark-script'){
    g.strokeStyle='#a79a80';g.lineWidth=8;g.lineCap='round';
    for(let i=0;i<14;i++){const x=-220+i*33;g.beginPath();g.moveTo(x,-110+(i%3)*17);g.lineTo(x+12,80-(i%4)*20);g.lineTo(x+24,-60+(i%5)*13);g.stroke();}
    g.strokeStyle='#8c241f';g.lineWidth=5;g.beginPath();g.arc(0,0,156,0,Math.PI*2);g.stroke();
  }else if(kind==='tea'){
    g.fillStyle='#c8b79a';g.beginPath();g.ellipse(0,42,120,27,0,0,Math.PI*2);g.fill();
    g.fillStyle='#e1d8c4';g.beginPath();g.moveTo(-85,-46);g.quadraticCurveTo(-82,95,-26,84);g.lineTo(61,84);g.quadraticCurveTo(107,52,85,-46);g.closePath();g.fill();
    g.strokeStyle='#bfb29a';g.lineWidth=13;g.beginPath();g.arc(91,9,42,-1.2,1.5);g.stroke();
    g.fillStyle='#29211c';g.beginPath();g.ellipse(0,-44,84,17,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#61241f';g.lineWidth=5;g.beginPath();g.moveTo(-12,-8);g.lineTo(-2,58);g.stroke();
  }else if(kind==='collapse'){
    g.strokeStyle='#9a8a76';g.lineWidth=18;g.beginPath();g.moveTo(-15,-150);g.lineTo(-6,-36);g.lineTo(-78,86);g.stroke();
    g.fillStyle='#a69a86';g.beginPath();g.ellipse(-20,-165,44,62,-.2,0,Math.PI*2);g.fill();
    g.strokeStyle='#4e2621';g.lineWidth=5;g.beginPath();g.moveTo(-10,-120);g.lineTo(45,125);g.stroke();
  }else if(kind==='nosebleed'){
    g.fillStyle='#a99b89';g.beginPath();g.ellipse(0,-4,95,142,0,0,Math.PI*2);g.fill();
    g.fillStyle='#17110e';g.beginPath();g.ellipse(-35,-24,17,12,0,0,Math.PI*2);g.ellipse(35,-24,17,12,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#791b19';g.lineWidth=9;g.beginPath();g.moveTo(5,5);g.bezierCurveTo(18,45,-24,63,-13,136);g.stroke();
  }else{
    g.fillStyle='#a79b84';g.beginPath();g.ellipse(0,-14,91,128,-.08,0,Math.PI*2);g.fill();
    g.fillStyle='#080808';g.beginPath();g.ellipse(-30,-24,19,12,0,0,Math.PI*2);g.ellipse(30,-24,19,12,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#17100e';g.lineWidth=18;g.beginPath();g.moveTo(-68,145);g.quadraticCurveTo(0,0,72,144);g.stroke();
  }
  g.restore();grain();
  const el=document.createElement('div');
  el.style.cssText='position:fixed;inset:0;z-index:70;pointer-events:none;background:rgba(0,0,0,.18) center/cover no-repeat;mix-blend-mode:screen;opacity:.92;filter:contrast(1.5) sepia(.35);';
  el.style.backgroundImage='url('+c.toDataURL('image/png')+')';
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),45);},Math.max(65,duration));
  glitchPulse=Math.max(glitchPulse,.45);return el;
}
function jumpscare() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:50;background:#000 center/cover no-repeat;pointer-events:none';
  el.style.backgroundImage = 'url(' + headVIDataUrl() + ')';
  document.body.appendChild(el);
  audio?.stinger(1); glitchPulse = Math.max(glitchPulse, 1.6); fear = Math.min(1, fear + .2);
  setTimeout(() => el.remove(), 380);
}
function trip() {
  const w = $('world'); if (!w) return;
  w.style.filter = 'hue-rotate(160deg) saturate(2.2) contrast(1.4) blur(1px)';
  glitchPulse = Math.max(glitchPulse, 2);
  setTimeout(() => { w.style.filter = ''; }, 6000);
}
// Soundscapes: a choir in the church, dissonant stabs in the slaughterhouse, scraping in the house, drones elsewhere.
function stab(ctx, dest, f, v) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + 1.6);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 3;
  o.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.7);
}
function stopAtmosphere() {
  atmo.timers.forEach(clearInterval);
  atmo.nodes.forEach(n => { try { n.stop?.(); } catch (e) {} try { n.disconnect?.(); } catch (e) {} });
  atmo.nodes = []; atmo.timers = [];
}
function startAtmosphere(name) {
  if (!audio || !audio.ctx || !audio.master) return;
  stopAtmosphere();
  const ctx = audio.ctx, g = ctx.createGain(); g.gain.value = 0; g.connect(audio.master);
  g.gain.setTargetAtTime(.34, ctx.currentTime, 2); atmo.gain = g; atmo.nodes.push(g);
  const osc = (f, type, vol) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const v = ctx.createGain(); v.gain.value = vol; o.connect(v); v.connect(g); o.start(); atmo.nodes.push(o, v); return o; };
  if (name === 'church') {
    // Orthodox-style chant: a dark modal chord with slow vibrato, and a minor second rubbing against it.
    [146.8, 174.6, 220, 261.6, 329.6].forEach((f, i) => { const o = osc(f, 'sine', .24); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 4.6 + i * .2; lg.gain.value = 3.5; lfo.connect(lg); lg.connect(o.detune); lfo.start(); atmo.nodes.push(lfo, lg); });
    osc(277.2, 'sine', .03);
  } else if (name === 'abattoir') {
    atmo.timers.push(setInterval(() => { [0, 1, 6, 11, 13].forEach(semi => stab(ctx, g, 110 * Math.pow(2, semi / 12), .12)); }, 2600));
  } else if (name === 'home' || name === 'ruin') {
    atmo.timers.push(setInterval(() => stab(ctx, g, 700 * Math.pow(2, Math.random() * 1.4), .07), 1700));
    osc(58.3, 'triangle', .05);
  } else if (name === 'cellar') {
    osc(55, 'sine', .06); osc(57.6, 'sine', .06);
  } else if (name === 'forest' || name === 'road') {
    osc(73.4, 'sine', .05); osc(103.8, 'sine', .03);
  } else { osc(90, 'sine', .04); }
}
function updateAtmosphere() {
  if (!audio || !audio.ctx || !currentZone) return;
  if (atmo.zone !== currentZone) { atmo.zone = currentZone; startAtmosphere(currentZone); }
}
// Finale: you walk toward a fire in the fog; the noise thins to white; the eye appears once, then the screen goes white.
function eyeMesh() {
  const g = new THREE.Group();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0xddd6c0, roughness: .3 }));
  sclera.scale.set(1.5, .85, .5); g.add(sclera);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: .4 }));
  iris.position.set(0, 0, .26); g.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 10), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.set(0, 0, .33); g.add(pupil);
  return g;
}
function finaleThen(choice) {
  if (storyScene || !currentZone || !zones[currentZone]) { resolveEnding(choice); return; }
  $('ending-screen').classList.remove('active');
  const p = playerAnchor.position.clone(), zg = zones[currentZone].group;
  const fg = new THREE.Group(); fg.position.set(p.x, 0, p.z - 9); zg.add(fg);
  makeEmitter(fg, 0, .1, 0, 'fire'); makeEmitter(fg, 0, .9, 0, 'smoke');
  const eye = eyeMesh(); eye.position.set(p.x, 1.7, p.z - 11); eye.visible = false; zg.add(eye);
  storyScene = { type: 'finale', t: 0, dur: 34, i: 0, fg, eye, choice, from: p, to: new THREE.Vector3(p.x, 0, p.z - 6.5), lines: [
    [1, 'Voice: Come closer. The fire is not hot. It only looks like something that should be.'],
    [7, 'Voice: You walked this far on your own feet. Nobody dragged you. That is the part I cannot forgive, or envy.'],
    [14, 'Voice: Listen. The noise is getting thinner. You are the last thing in this room that has not been emptied.'],
    [21, 'Voice: Now there is only white. It is not a light. It is the room, finally quiet.'],
    [27, 'Voice: Look at me once. Just once.']] };
}
function updateFinale(s, dt) {
  const k = THREE.MathUtils.smoothstep(s.t, 0, s.dur - 7);
  camera.position.lerpVectors(s.from.clone().setY(1.6), s.to.clone().setY(1.6), k);
  camera.position.x += Math.sin(s.t * .6) * .04; camera.position.y += Math.sin(s.t * 2) * .02;
  camera.lookAt(s.fg.position.x, 1.4, s.fg.position.z);
  if (scene.fog) scene.fog.density = .05 + k * .24;
  if (audio && audio.ctx && Math.random() < dt * (2 + k * 4)) stab(audio.ctx, audio.master, 180 + Math.random() * 900, .04 * Math.max(0, 1 - (s.t - 18) / 14));
  const white = $('finale-white'); if (white) white.style.opacity = String(THREE.MathUtils.clamp((s.t - 24) / 8, 0, 1));
  if (s.t > 27) { s.eye.visible = true; s.eye.scale.setScalar(1 + (s.t - 27) * .03); }
  if (s.t >= s.dur) {
    storyScene = null; s.eye.visible = false; s.fg.parent?.remove(s.fg); s.eye.parent?.remove(s.eye);
    resolveEnding(s.choice);
    setTimeout(() => { if (white) white.style.opacity = '0'; }, 1600);
  }
}

// The porch Il Primo leaves after his first words, and returns later as the enemy.
function updatePorchPrimo() {
  if (!storyFlags.has('primo-first-contact') || storyFlags.has('porch-primo-gone') || dialogueOpen) return;
  for (const zn of Object.values(zones)) {
    const ix = zn.interactables.findIndex(i => i.isOpeningPrimo);
    if (ix >= 0) {
      const p = zn.interactables.splice(ix, 1)[0]; p.object.visible = false;
      storyFlags.add('porch-primo-gone'); showToast('HE IS NO LONGER ON THE PORCH.'); glitchPulse = Math.max(glitchPulse, .6);
      return;
    }
  }
}


// =============================================================================
// v5: The First's tiers and monologues, claustrophobic escalation, the cellar hunt
// (the record is far away, and he laughs as he moves), cinematic bars, hidden details.
// =============================================================================
let escTier = 0;
const PRIMO_TIER_LINES = {
  1: ['The First: I was not born empty. I was taught to listen until listening was the only thing I had left.', 'The First: You have started counting the chairs. I did that too, in the same house, on the same night.'],
  2: ['The First: Every name you collect is a little less room for your own. I am not taking anything. I am making space.', 'The First: Notice how quiet the rooms become when you stop answering them.'],
  3: ['The First: The fog is not outside the house. It is the house, breathing out a little more each time you come back.', 'The First: I stopped hearing my own voice around the third winter. It was a relief. You will see.'],
  4: ['The First: Look behind you. You will not see me. That is the nature of a hollow thing: it is always just out of the frame.', 'The First: The doors do not lock. They simply stop opening for people who are still full of themselves.'],
  5: ['The First: Do you know the worst part? I liked it when it took me. I had been so tired of being heard.', 'The First: Soon the corridor will be the only way left, and it will be very warm.'],
  6: ['The First: Come down. The record is waiting, and so, a little, am I.', 'The First: Listen. Can you hear the laugh? It is not mine. It is yours, coming back to you late.']
};
function startMonologue(lines, dur = 16) {
  if (storyScene) return;
  storyScene = { type: 'hold', t: 0, dur, i: 0, lines: lines.map((l, k) => [1 + k * 6, l]) };
}
// Escalation: each completed mission brings a monologue, thicker fog, a tighter vignette and more grain.
function updateEscalation(dt) {
  const tier = difficultyTier();
  if (tier !== escTier) {
    escTier = tier;
    if (PRIMO_TIER_LINES[tier]) startMonologue(PRIMO_TIER_LINES[tier], 15);
  }
  const z = zones[currentZone];
  if (scene.fog && z && z.fog && scene.fog === z.fog && !storyScene) scene.fog.density = z.density * (1 + tier * .11);
  const vig = document.getElementById('vignette');
  if (vig) vig.style.background = 'radial-gradient(ellipse at center,transparent ' + (46 - tier * 3 - fear * 6) + '%,rgba(0,0,0,' + (.5 + tier * .06 + fear * .2).toFixed(2) + ') 84%,#000 130%)';
  const grain = document.getElementById('post-noise');
  if (grain) grain.style.opacity = String(Math.min(.4, .12 + fear * .16 + tier * .02));
}
// The laugh: short stabs of filtered sawtooth, falling in pitch.
function laugh() {
  if (!audio || !audio.ctx || !audio.master) return;
  const ctx = audio.ctx, t0 = ctx.currentTime;
  for (let k = 0; k < 4; k++) {
    const t = t0 + k * .17, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(260 - k * 12, t); o.frequency.exponentialRampToValueAtTime(170 - k * 8, t + .14);
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 4;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + .14);
    o.connect(bp); bp.connect(g); g.connect(audio.master); o.start(t); o.stop(t + .16);
  }
}
// In the cellar, the enemy never stays put: he jumps to a new place every few seconds, and laughs.
let hunt = { timer: 4 };
function updateCellarHunt(dt, t) {
  if (currentZone !== 'cellar' || !stalker || !stalker.visible || stalkerZone !== 'cellar' || storyScene || dialogueOpen) return;
  hunt.timer -= dt; if (hunt.timer > 0) return;
  hunt.timer = Math.max(3, 8 - escTier * .7) + Math.random() * 3;
  const p = playerAnchor.position; let x = 0, z = 0, tries = 0;
  do { x = -7 + Math.random() * 14; z = -6 + Math.random() * 12; tries++; } while (Math.hypot(x - p.x, z - p.z) < 4 && tries < 20);
  stalker.position.set(x, 0, z);
  laugh();
  storyLine('The First: [laughs] You looked the wrong way again.');
}
// Cinematic bars during scenes; they slide in and out.
const LB = { top: document.createElement('div'), bottom: document.createElement('div') };
[LB.top, LB.bottom].forEach((b, i) => Object.assign(b.style, { position: 'fixed', left: '0', right: '0', height: '0', background: '#000', zIndex: '7', transition: 'height .9s ease', pointerEvents: 'none', [i ? 'bottom' : 'top']: '0' }));
document.body.append(LB.top, LB.bottom);
function updateCinematic() {
  const on = !!storyScene && storyScene.type !== 'hold';
  LB.top.style.height = on ? '11vh' : '0'; LB.bottom.style.height = on ? '11vh' : '0';
}
function crayonTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const g = c.getContext('2d');
  g.fillStyle = '#d8d0b8'; g.fillRect(0, 0, 256, 192);
  const cols = ['#7a1f1a', '#2a2a2a', '#4a3f7a'];
  for (let i = 0; i < 13; i++) { g.fillStyle = cols[i % 3]; const x = 18 + (i % 7) * 34, y = 40 + Math.floor(i / 7) * 80;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.fillRect(x - 4, y + 9, 8, 26); }
  g.fillStyle = '#7a1f1a'; g.font = '14px monospace'; g.fillText('CONTA', 14, 180);
  return new THREE.CanvasTexture(c);
}
function tallyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#3a342c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(210,200,170,.7)'; g.lineWidth = 3;
  for (let row = 0; row < 6; row++) for (let k = 0; k < 13; k++) {
    const x = 20 + k * 18, y = 24 + row * 36;
    if (k % 5 === 4) { g.beginPath(); g.moveTo(x - 60, y + 14); g.lineTo(x + 2, y - 14); g.stroke(); } else { g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x, y + 14); g.stroke(); }
  }
  return new THREE.CanvasTexture(c);
}
function phonographMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(.9, .18, .7), M.darkWood); base.position.y = .09; g.add(base);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .02, 28), M.black); disc.position.y = .2; g.add(disc);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(.05, .26, .45, 20, 1, true), M.brass || M.gold); horn.position.set(.12, .55, -.14); horn.rotation.set(-.6, 0, .3); g.add(horn);
  return g;
}
function buildCinematicExtras() {
  // The record: moved to the far corner of the cellar, where the lamp barely reaches.
  const cz = zones.cellar; const listen = cz && cz.interactables.find(i => i.type === 'listen');
  if (listen) {
    const pg = phonographMesh(); pg.position.set(7.2, 0, -6.4); cz.group.add(pg);
    listen.object = pg; listen.point = new THREE.Vector3(7.2, .9, -6.4); listen.radius = 2.4;
    listen.prompt = '[ E ] LISTEN TO THE WHITE — AT THE BACK OF THE CELLAR';
  }
  // Hidden details, each one a small unsettling note.
  const hz = zones.home.group;
  const crayon = new THREE.Mesh(new THREE.PlaneGeometry(.9, .68), new THREE.MeshStandardMaterial({ map: crayonTexture(), roughness: .9 }));
  crayon.position.set(-9.82, 1.6, -3.4); crayon.rotation.y = Math.PI / 2; hz.add(crayon);
  addLook(hz, -9.5, 1.6, -3.4, 'A child’s drawing', 'Crayon figures in a ring, thirteen of them, each with a dark mark where a mouth should be. The fourteenth is drawn in a different colour, and it has no hands.');
  const tally = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshStandardMaterial({ map: tallyTexture(), roughness: .95 }));
  tally.position.set(-11.82, 1.8, 2); tally.rotation.y = Math.PI / 2; zones.abattoir.group.add(tally);
  addLook(zones.abattoir.group, -11.4, 1.6, 2, 'Tally marks', 'Rows of tally marks, scratched into the plaster. Every fifth stroke crosses the four before it. Someone has counted the days since the last name was called.');
  addLook(zones.road.group, -6, .6, -20, 'The sack on the post', 'A feed sack tied to a fence post. Something inside it is still moving very slightly, and there is a number written on the cloth: 14.');
  addLook(zones.church.group, -5, .3, -6, 'Under the pew', 'A folded hymn sheet, pushed under the pew by someone who was afraid to be seen kneeling. The hymn is the one they sing before the fourteenth name.');
  const water = new THREE.Mesh(new THREE.CylinderGeometry(.34, .3, .14, 24), new THREE.MeshStandardMaterial({ color: 0x0c1213, roughness: .02, metalness: .3 }));
  water.position.set(-6, .8, 6); cz.group.add(water);
  addLook(cz.group, -6, .9, 6, 'A bowl of water', 'Still water in a enamel bowl. It reflects the ceiling, the lamp and the top of your head, but not the room you are standing in.');
}

function animateZone(t, dt) {
  updateCandles(t); updateRituals(t); updateEggs(t);
  rotatingMachines.forEach(m=>{if(m.piston){m.mesh.position.y=.75+Math.sin(t*.001*m.speed)*.11;}else m.mesh.rotation.z+=dt*m.speed;});
  zones.abattoir?.carcasses?.forEach(c=>{c.rotation.z=Math.sin(t*.00062+c.userData.hangPhase)*.035;c.rotation.x=Math.cos(t*.00047+c.userData.hangPhase)*.018;});
  for (const z of Object.values(zones)) {
    if (!z.group.visible) continue;
    if (z.mist) z.mist.children.forEach((s, i) => {
      s.position.x += Math.sin(t * .00021 + s.userData.phase) * dt * .20;
      s.position.z += Math.cos(t * .00017 + s.userData.phase * 1.3) * dt * .13;
      s.material.opacity = (.07 + dread * .07) * (z.name === 'cellar' ? .55 : 1);
    });
    [...new Set([...z.interactables.filter(x => x.type === 'npc'),...cultRoster.filter(n=>n.object.parent===z.group)])].forEach(n => {
      const phase=t*.0011+n.phase, stride=n.walking?Math.sin(t*.008+n.phase):Math.sin(phase)*.035;
      const bob=n.walking?Math.abs(Math.sin(t*.008+n.phase))*.035:Math.sin(phase)*.009;
      n.object.position.y = n.fate==='dead'?n.object.position.y:bob;
      n.leftArm.rotation.z = -.13 + stride*.46 + Math.sin(phase)*.018;
      n.rightArm.rotation.z = .13 - stride*.46 - Math.sin(phase)*.018;
      n.leftForearm.rotation.z=-.24+stride*.25;n.rightForearm.rotation.z=.24-stride*.25;
      if(n.legs?.length===2){n.legs[0].rotation.x=stride*.52;n.legs[1].rotation.x=-stride*.52;n.shoes?.forEach((shoe,i)=>{shoe.rotation.x=i===0?stride*.52:-stride*.52;});}
      if(n.head){const lurch=n.walking?1+.4*Math.sin(t*.0031+n.phase*3):1;n.head.rotation.z=Math.sin(t*.0009+n.phase)*.12*lurch+(n.walking?Math.sin(t*.008+n.phase)*.07:0);n.head.rotation.x=n.walking?.16:-.05+Math.sin(t*.0007+n.phase)*.05;n.object.rotation.z=n.walking?Math.sin(t*.0045+n.phase)*.035:Math.sin(t*.0013+n.phase)*.012;}
      n.blinkTimer-=dt;if(n.blinkTimer<=0){n.blinkAmount=Math.min(1,n.blinkAmount+dt*15);if(n.blinkAmount>=1){n.blinkTimer=.12;n.blinkAmount=Math.max(0,n.blinkAmount-dt*15);}if(n.blinkAmount===0)n.blinkTimer=2.4+Math.random()*4.8;}
      n.lids?.forEach(lid=>{lid.scale.y=.08+n.blinkAmount*.72;lid.position.y=1.783-n.blinkAmount*.004;});
      
    });
  }
}
function clearSavedEvidence() { try { localStorage.removeItem(EVIDENCE_SAVE_KEY); } catch (_) {} }
function triggerDeath(reason='THE ROOM HAS FOUND YOU',copy='The recording continues for eleven seconds after the body has stopped.') {
  clearSavedEvidence();
  if(gameEnded)return;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');$('death-title').textContent=reason;$('death-copy').textContent=copy;$('death-screen').classList.add('active');audio?.killSting();
}
function updateHorror(dt,t){
  if(!gameStarted||gameEnded||!zone||dialogueOpen||journalOpen)return;
  eventClock+=dt;const p=currentPosition();
  // Fear rises in darkness and falls slowly in lit, occupied rooms.
  const darkFactor=flashlightOn?0.0:.022;
  const zoneFactor=currentZone==='cellar'?.014:currentZone==='abattoir'?(flashlightOn?.002:.009):currentZone==='ruin'?.009:0;
  fear=Math.min(1,Math.max(.04,fear+(darkFactor+zoneFactor-.002)*dt));
  // Brief, mischievous anomalies: the room seems to answer from the wrong side.
  if(fear>.52&&eventClock>26&&Math.random()<.00075){glitchPulse=Math.max(glitchPulse,.65);audio?.mechanicalEvent('clock');showToast('THIRTEEN BREATHS. ONE IS OUT OF TIME.');}
  if(fear>.995&&currentZone==='abattoir'&&!flashlightOn){triggerDeath('THE ROOM HAS OCCUPIED YOUR BODY.');return;}
  if(fear>.88&&Math.random()<.0012){glitchPulse=1.15;audio?.stinger(.9);$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),130);}
  if(hiddenBreath){fear=Math.max(.08,fear-.075*dt);}
  $('fear-value').textContent=`${Math.round(fear*100)}%`;
}

function updateHud(dt) {
  elapsed += dt; const mins = Math.floor(elapsed / 60); const secs = Math.floor(elapsed % 60); const frames = Math.floor((elapsed % 1) * 25);
  $('tape-counter').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  const signal = Math.max(8, Math.round(94 - dread * 42 - Math.sin(elapsed * .31) * 4 - glitchPulse * 17));
  $('signal-value').textContent = `${signal}%`;
  $('clock').textContent = `03:${String(17 + Math.floor(elapsed / 90)).padStart(2, '0')}`;
  $('coords').textContent = currentZone === 'road' ? '45° 02′ N — 10° 41′ E' : ({ home: '45° 02′ N — 10° 41′ E', church: '45° 02′ N — 10° 41′ E', ruin: '45° 02′ N — 10° 41′ E', cellar: '45° 02′ N — 10° 41′ E', abattoir: '45° 02′ N — 10° 41′ E' })[currentZone];
}
let previousTargetId = '';
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04); const t = performance.now();
  if (gameStarted && !gameEnded) {
    updatePlayer(dt); updateCemeteryTrap(); updateTargets(); animateZone(t, dt); updateCultSequence(dt,t);
    if(listeningPending && !cultFateActive && cultFateQueue.length===0) finishListening();
    updateMissions(); updateDig(dt); updatePresence(dt, t);
    if(!gameEnded){updateHorror(dt,t);updateDayNight(dt,t);updateWeather(dt,t);updateCameraDirector(dt,t);updateHud(dt);}
    if (activeTarget?.id !== previousTargetId && activeTarget) audio.stinger(.07);
    previousTargetId = activeTarget?.id || '';
  }
  dread = Math.min(1, .12 + collected.size * .11 + fear*.36 + (currentZone === 'cellar' ? .22 : 0));
  if (zone) { scene.fog.density += (zone.density + dread * .012 - scene.fog.density) * Math.min(1, dt * .8); }
  audio.setTension(Math.max(dread, presence * .9)); updateLens(dt); updateZoom(dt);
  glitchPulse = Math.max(0, glitchPulse - dt * 1.45);
  glitchPass.uniforms.time.value = t * .001;
  baconPass.uniforms.time.value = t * .001; baconPass.uniforms.grade.value = .62 + dread * .3; baconPass.uniforms.smear.value = .05 + dread * .12;
  glitchPass.uniforms.strength.value = .10 + dread * .13 + glitchPulse * .5;
  bloom.strength = .24 + dread * .15; bloom.threshold = .78 - dread * .12;
  storyTick(dt, t);
  composer.render();
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});
window.addEventListener('error', e => { const f = $('fatal'); f.textContent = `SYSTEM ERROR\n${e.message}\n${e.filename || ''}:${e.lineno || ''}`; f.classList.remove('hidden'); });
window.addEventListener('unhandledrejection', e => { const f = $('fatal'); f.textContent = `SYSTEM ERROR\n${e.reason?.stack || e.reason}`; f.classList.remove('hidden'); });
updateProgress();
requestAnimationFrame(loop);
