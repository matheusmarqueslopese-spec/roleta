"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { stageTimes, wheelAt, type SpinPlan } from "@/lib/spinPlan";

/**
 * Avatar humano 3D estilo CARTOON / desenho animado (modelo GLB rigado com
 * esqueleto completo, incluindo dedos) animado em tempo real:
 *  - cel-shading (toon) + contorno cartoon em todas as malhas;
 *  - proporções cartoon: cabeça e olhos ampliados, bochechas rosadas;
 *  - squash & stretch sincronizado com a ação (antecipação, puxada, frenagem, festa);
 *  - IK de dois ossos nos braços reais do modelo + orientação das mãos + curvatura dos dedos;
 *  - olhar com sacadas, convergência e pálpebra acompanhando o olhar;
 *  - piscadas, sobrancelhas e "squint" criados como blendshapes na malha do rosto;
 *  - sorriso/boca pelos blendshapes nativos do modelo;
 *  - toda a ação lê a MESMA linha do tempo do disco (planRef), então puxada,
 *    giro, frenagem e reação ficam sincronizados ao progresso real da roleta.
 *
 * Coordenadas do palco (iguais às da .wheel-rig): x ∈ [-1, 1], y de 0 (base) a H (topo),
 * centro da roleta em (0, 1), raio externo ≈ 1.
 */

export type AvatarStatus = "loading" | "ready" | "error";

const MODEL_URL = "/models/avatar.glb";

const WHEEL_CY = 1;
const RING_CONTACT_R = 0.92; // mão apoiada sobre o aro prateado (parte FIXA)
const DISC_CONTACT_R = 0.8; // borda do disco (parte que GIRA)
const CONTACT_Z = 0.36; // face frontal da roleta (mãos)
const SHOULDER_Y = 2.12;
const BODY_Z = -0.24; // tronco recuado: só as mãos passam do plano da roleta
const FRONT_Z = 0.13; // acima disso a geometria é desenhada à frente da roleta
const OCCLUDE_Z = 0.2; // disco oclusor invisível: corpo atrás, mãos à frente
const OCCLUDE_R = 1.0; // raio do disco oclusor (igual ao aro externo)
const HIDE_BELOW_Y = 0.95;

const REST_R = -34; // mão direita do personagem (lado esquerdo da tela)
const REST_L = 34;
const GRAB_R = -54;
const BRAKE_R = -30;
const BRAKE_L = 30;

const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const Z_AXIS = new V3(0, 0, 1);

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));
const noise = (t: number, seed: number) =>
  Math.sin(t * 0.71 + seed) * 0.5 +
  Math.sin(t * 1.37 + seed * 2.1) * 0.3 +
  Math.sin(t * 2.93 + seed * 0.7) * 0.2;

type HandPose = {
  angle: number; // graus, horário a partir do topo
  contactR: number;
  lift: number; // 0 = apoiada, 1 = levantada
  curl: number;
  contact: number; // opacidade da sombra de contato
  free?: { pos: THREE.Vector3; F: THREE.Vector3; N: THREE.Vector3; weight: number };
};

type Intent = {
  lean: number;
  twist: number;
  side: number;
  shrugL: number;
  shrugR: number;
  bounce: number;
  roll: number;
  nod: number;
  look: THREE.Vector3;
  smile: number;
  open: number;
  browUp: number;
  browDown: number;
  squint: number;
  handR: HandPose;
  handL: HandPose;
};

type Rig = {
  model: THREE.Object3D;
  bones: Record<string, THREE.Bone>;
  bindLocal: Map<THREE.Bone, THREE.Quaternion>;
  bindWorld: Map<THREE.Bone, THREE.Quaternion>;
  handBasis0: { L: THREE.Quaternion; R: THREE.Quaternion };
  fingerAxes: { bone: THREE.Bone; axis: THREE.Vector3; max: number; side: "L" | "R" }[];
  handLen: number;
  faceMeshes: THREE.Mesh[];
  baseY: number;
  S: number;
  anchor: THREE.Vector3;
};

const _pq = new Q();
const _pqi = new Q();
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_pq);
  _pqi.copy(_pq).invert();
  bone.quaternion.premultiply(_pq).premultiply(q).premultiply(_pqi);
}

function basisQuat(f: THREE.Vector3, n: THREE.Vector3, out: THREE.Quaternion) {
  const ff = f.clone().normalize();
  const nn = n.clone().addScaledVector(ff, -n.dot(ff)).normalize();
  const bb = new V3().crossVectors(ff, nn);
  const m = new THREE.Matrix4().makeBasis(ff, nn, bb);
  return out.setFromRotationMatrix(m);
}

/** Cria blendshapes de pálpebra, "squint" e sobrancelhas diretamente na malha do rosto. */
function addFacialMorphs(head: THREE.SkinnedMesh, eyes: THREE.Mesh[]) {
  const geo = head.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const blink = new Float32Array(n * 3);
  const squint = new Float32Array(n * 3);
  const browUp = new Float32Array(n * 3);
  const browDown = new Float32Array(n * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;

  let ok = false;
  for (const eye of eyes) {
    const eg = eye.geometry as THREE.BufferGeometry;
    eg.computeBoundingSphere();
    const c = eg.boundingSphere!.center;
    const r = eg.boundingSphere!.radius;
    if (!bb.containsPoint(c) || r <= 0) continue;
    ok = true;

    // limites da abertura do olho: menor ângulo acima e maior ângulo abaixo do centro
    let openLow = -0.55;
    let openHigh = 0.55;
    for (let i = 0; i < n; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r * 1.22 || Math.abs(dx) > r * 0.45 || dz < 0) continue;
      const phi = Math.atan2(dy, dz);
      if (dy < 0) openLow = Math.max(openLow, phi);
      else openHigh = Math.min(openHigh, phi);
    }
    const closeTarget = openLow + 0.06;

    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const dx = x - c.x;
      const dy = y - c.y;
      const dz = z - c.z;
      if (dz < -r * 0.15) continue;
      const lateral = Math.abs(dx);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rho = Math.sqrt(dy * dy + dz * dz);
      const phi = Math.atan2(dy, dz);
      const ringW = 1 - smooth((d - r * 1.0) / (r * 0.9));
      const latW = 1 - smooth((lateral - r * 1.0) / (r * 0.55));
      const w = ringW * latW;
      if (w > 0.001 && d < r * 2.0) {
        if (dy > -r * 0.1 && phi > closeTarget) {
          const theta = (phi - closeTarget) * w;
          const np = phi - theta;
          blink[i * 3 + 1] += rho * Math.sin(np) - dy;
          blink[i * 3 + 2] += rho * Math.cos(np) - dz;
        }
        if (dy < r * 0.05) {
          const target = lerp(openLow, openHigh, 0.32);
          if (phi < target) {
            const theta = (target - phi) * w * 0.55;
            const np = phi + theta;
            squint[i * 3 + 1] += rho * Math.sin(np) - dy;
            squint[i * 3 + 2] += rho * Math.cos(np) - dz;
          }
        }
      }
      // sobrancelhas
      if (dy > r * 0.9 && dy < r * 3.0 && lateral < r * 2.0 && dz > -r * 0.4) {
        const vy = Math.exp(-Math.pow((dy - r * 1.75) / (r * 0.7), 2));
        const lx = 1 - smooth((lateral - r * 1.2) / (r * 0.8));
        const wb = vy * lx;
        browUp[i * 3 + 1] += r * 0.3 * wb;
        // franzir: parte interna desce e aproxima do centro
        const inner = c.x > 0 ? (x < c.x ? 1 : 0.35) : x > c.x ? 1 : 0.35;
        browDown[i * 3 + 1] -= r * 0.17 * wb * inner;
        browDown[i * 3] += (c.x > 0 ? -1 : 1) * r * 0.07 * wb * inner;
      }
    }
  }
  if (!ok) return false;

  const add = (name: string, data: Float32Array) => {
    const attr = new THREE.BufferAttribute(data, 3);
    attr.name = name;
    if (!geo.morphAttributes.position) geo.morphAttributes.position = [];
    geo.morphAttributes.position.push(attr);
    if (geo.morphAttributes.normal) {
      const nAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      nAttr.name = name;
      geo.morphAttributes.normal.push(nAttr);
    }
    if (!head.morphTargetInfluences) head.morphTargetInfluences = [];
    if (!head.morphTargetDictionary) head.morphTargetDictionary = {};
    head.morphTargetDictionary[name] = head.morphTargetInfluences.length;
    head.morphTargetInfluences.push(0);
  };
  geo.morphTargetsRelative = true;
  add("frBlink", blink);
  add("frSquint", squint);
  add("frBrowUp", browUp);
  add("frBrowDown", browDown);
  return true;
}

function setMorph(meshes: THREE.Mesh[], name: string, value: number) {
  for (const m of meshes) {
    const idx = m.morphTargetDictionary?.[name];
    if (idx !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[idx] = value;
  }
}

function makeRadialTexture(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Mapa de 4 tons para o cel-shading cartoon. */
function makeToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([110, 170, 225, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Converte um MeshStandardMaterial em MeshToonMaterial preservando mapas e cor. */
function toonify(
  src: THREE.MeshStandardMaterial,
  gradientMap: THREE.Texture,
  tint: [number, number, number] | null,
  onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms) => void
): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: tint ? new THREE.Color(...tint) : src.color.clone(),
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    gradientMap,
  });
  if (src.transparent) {
    mat.transparent = true;
    mat.opacity = src.opacity;
    if (src.alphaMap) mat.alphaMap = src.alphaMap;
  }
  if (onBeforeCompile) {
    mat.onBeforeCompile = onBeforeCompile as (shader: object) => void;
    mat.needsUpdate = true;
  }
  return mat;
}

const suitTintShader = (shader: { fragmentShader: string }) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#ifdef USE_MAP
      vec4 frTex = texture2D( map, vMapUv );
      float frL = dot( frTex.rgb, vec3( 0.299, 0.587, 0.114 ) );
      diffuseColor.rgb *= mix( vec3( 0.02, 0.05, 0.16 ), vec3( 0.07, 0.17, 0.42 ), smoothstep( 0.04, 0.65, frL ) );
    #endif`
  );
};

/**
 * Contorno cartoon (casca invertida deslocada ao longo da normal).
 * Para SkinnedMesh o clone compartilha o esqueleto; os morphs são
 * compartilhados por referência para piscada/sorriso acompanharem.
 */
function addOutlineShell(mesh: THREE.Mesh, thickness: number, color = 0x0a1230) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThick = { value: thickness };
    shader.vertexShader =
      "uniform float uThick;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntransformed += normalize( normal ) * uThick;"
      );
  };
  const outline = mesh.clone() as THREE.Mesh;
  outline.material = mat;
  outline.frustumCulled = false;
  outline.raycast = () => {};
  outline.renderOrder = -2;
  const srcSkin = mesh as THREE.SkinnedMesh;
  const outSkin = outline as THREE.SkinnedMesh;
  if (srcSkin.isSkinnedMesh && outSkin.isSkinnedMesh && srcSkin.skeleton) {
    outSkin.skeleton = srcSkin.skeleton;
    outSkin.bindMatrix.copy(srcSkin.bindMatrix);
    outSkin.bindMatrixInverse.copy(srcSkin.bindMatrixInverse);
    outSkin.normalizeSkinWeights?.();
  }
  if (mesh.morphTargetInfluences) {
    outline.morphTargetInfluences = mesh.morphTargetInfluences;
    outline.morphTargetDictionary = mesh.morphTargetDictionary;
  }
  mesh.parent?.add(outline);
  return outline;
}

/** Bochechas rosadas cartoon presas ao osso da cabeça. */
function addCheekBlush(model: THREE.Object3D, bones: Record<string, THREE.Bone>, S: number) {
  const head = bones.Head;
  if (!head) return;
  model.updateMatrixWorld(true);
  const headW = head.getWorldPosition(new V3());
  for (const eyeName of ["LeftEye", "RightEye"]) {
    const eye = bones[eyeName];
    if (!eye) continue;
    const eyeW = eye.getWorldPosition(new V3());
    const side = Math.sign(eyeW.x - headW.x) || (eyeName === "LeftEye" ? 1 : -1);
    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.036 * S, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0xff7d90,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    cheek.scale.set(1.3, 0.8, 0.4);
    cheek.position.copy(eyeW).add(new V3(side * 0.052 * S, -0.078 * S, 0.072 * S));
    cheek.renderOrder = 3;
    cheek.frustumCulled = false;
    cheek.raycast = () => {};
    model.add(cheek);
    model.updateMatrixWorld(true);
    head.attach(cheek);
  }
}

/** Camisa clara + gravata azul cartoon presas ao osso do peito (sobre o paletó azul-marinho). */
function addShirtAndTie(model: THREE.Object3D, top: THREE.SkinnedMesh, spine2: THREE.Bone, neck: THREE.Bone, S: number, gradientMap: THREE.Texture) {
  model.updateMatrixWorld(true);
  const neckW = neck.getWorldPosition(new V3());
  const pos = top.geometry.attributes.position as THREE.BufferAttribute;
  const bins = 14;
  const span = 0.3 * S;
  const maxZ = new Array<number>(bins).fill(-Infinity);
  const v = new V3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(top.matrixWorld);
    if (Math.abs(v.x - neckW.x) > 0.025 * S) continue;
    const rel = neckW.y + 0.01 * S - v.y;
    if (rel < 0 || rel >= span) continue;
    const b = Math.floor((rel / span) * bins);
    maxZ[b] = Math.max(maxZ[b], v.z);
  }
  let last = neckW.z + 0.08 * S;
  for (let b = 0; b < bins; b++) {
    if (!Number.isFinite(maxZ[b])) maxZ[b] = last;
    last = maxZ[b];
  }
  const zAt = (rel: number) => maxZ[clamp(Math.floor((rel / span) * bins), 0, bins - 1)];

  const strip = (
    widthAt: (u: number) => number,
    relStart: number,
    relEnd: number,
    offset: number,
    color: number,
    rough: number
  ) => {
    const seg = 10;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let s = 0; s <= seg; s++) {
      const u = s / seg;
      const rel = lerp(relStart, relEnd, u);
      const y = neckW.y + 0.01 * S - rel;
      const z = zAt(rel) + offset;
      const w = widthAt(u);
      const a = spine2.worldToLocal(new V3(neckW.x - w, y, z));
      const b = spine2.worldToLocal(new V3(neckW.x + w, y, z));
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (s < seg) {
        const k = s * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshToonMaterial({ color, gradientMap, side: THREE.DoubleSide })
    );
    void rough;
    m.frustumCulled = false;
    spine2.add(m);
  };

  // Camisa social branca limpa de alta definição com corte elegante
  strip((u) => lerp(0.082, 0.005, u) * S, 0.0, 0.23 * S, 0.005 * S, 0xffffff, 0.42);

  // Colarinho branco estruturado em V ao redor do pescoço
  const collarL = new THREE.Mesh(
    new THREE.BoxGeometry(0.065 * S, 0.032 * S, 0.015 * S),
    new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap })
  );
  collarL.position.set(neckW.x - 0.038 * S, neckW.y - 0.018 * S, zAt(0.02 * S) + 0.012 * S);
  collarL.rotation.set(0.2, 0.35, -0.42);
  const collarR = new THREE.Mesh(
    new THREE.BoxGeometry(0.065 * S, 0.032 * S, 0.015 * S),
    new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap })
  );
  collarR.position.set(neckW.x + 0.038 * S, neckW.y - 0.018 * S, zAt(0.02 * S) + 0.012 * S);
  collarR.rotation.set(0.2, -0.35, 0.42);
  spine2.add(collarL, collarR);

  // Gravata azul cartoon vibrante
  strip(
    (u) =>
      (u < 0.15 ? lerp(0.028, 0.036, u / 0.15) : lerp(0.026, 0.042, (u - 0.15) / 0.85)) * S,
    0.012 * S,
    0.32 * S,
    0.012 * S,
    0x1d55b0,
    0.28
  );

  // Nó da gravata 3D proeminente e bem encaixado sob o colarinho
  const tieKnot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026 * S, 0.018 * S, 0.042 * S, 14),
    new THREE.MeshToonMaterial({ color: 0x1b3f7d, gradientMap })
  );
  tieKnot.position.set(neckW.x, neckW.y - 0.026 * S, zAt(0.03 * S) + 0.018 * S);
  tieKnot.rotation.set(0.12, 0, 0);
  spine2.add(tieKnot);
}

function buildRig(gltf: { scene: THREE.Object3D }, H: number): Rig {
  const model = gltf.scene;
  const bones: Record<string, THREE.Bone> = {};
  const faceMeshes: THREE.Mesh[] = [];
  let headMesh: THREE.SkinnedMesh | null = null;
  let topMesh: THREE.SkinnedMesh | null = null;
  let bodyMesh: THREE.SkinnedMesh | null = null;
  let hairMesh: THREE.Mesh | null = null;
  const eyeMeshes: THREE.Mesh[] = [];
  const gradientMap = makeToonGradient();
  const toonCache = new Map<string, THREE.MeshToonMaterial>();

  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mesh.name === "Wolf3D_Head") headMesh = mesh as THREE.SkinnedMesh;
      if (mesh.name === "Wolf3D_Outfit_Top") topMesh = mesh as THREE.SkinnedMesh;
      if (mesh.name === "Wolf3D_Body") bodyMesh = mesh as THREE.SkinnedMesh;
      if (mesh.name === "Wolf3D_Headwear") hairMesh = mesh;
      if (mesh.name === "EyeLeft" || mesh.name === "EyeRight") eyeMeshes.push(mesh);
      if (mesh.morphTargetDictionary && mesh.name !== "Wolf3D_Beard") faceMeshes.push(mesh);
      // Personagem cartoon de rosto barbeado e limpo (sem barba)
      if (mesh.name === "Wolf3D_Beard") {
        mesh.visible = false;
      }
      // Peças da cintura para baixo nunca aparecem (atrás da roleta / abaixo do corte):
      // oculta para economizar GPU — o esqueleto continua animando normalmente
      if (mesh.name === "Wolf3D_Outfit_Bottom" || mesh.name === "Wolf3D_Outfit_Footwear") {
        mesh.visible = false;
      }

      // Estilo cartoon: cel-shading com paleta vibrante de desenho animado
      if (mat && mat.isMeshStandardMaterial && mesh.name !== "Wolf3D_Beard") {
        let toon = toonCache.get(mat.name);
        if (!toon) {
          if (mat.name === "Wolf3D_Skin" || mat.name === "Wolf3D_Body") {
            // Pele cartoon: pêssego quente e limpo
            toon = toonify(mat, gradientMap, [1.08, 0.82, 0.66]);
          } else if (mat.name === "Wolf3D_Eye") {
            toon = toonify(mat, gradientMap, [1.15, 1.15, 1.12]);
          } else if (mat.name === "Wolf3D_Teeth") {
            toon = toonify(mat, gradientMap, [1.0, 1.0, 1.0]);
          } else if (mat.name === "Wolf3D_Headwear") {
            // Cabelo cartoon castanho-escuro
            toon = toonify(mat, gradientMap, [0.32, 0.2, 0.14]);
          } else if (mat.name === "Wolf3D_Outfit_Top") {
            // Paletó cartoon azul-marinho vibrante
            toon = toonify(mat, gradientMap, null, suitTintShader);
          } else {
            toon = toonify(mat, gradientMap, null);
          }
          toonCache.set(mat.name, toon);
        }
        mesh.material = toon;
      }
    }
  });

  if (headMesh) addFacialMorphs(headMesh, eyeMeshes);

  // Contorno cartoon nas malhas principais
  if (headMesh) addOutlineShell(headMesh, 0.0075);
  if (bodyMesh) addOutlineShell(bodyMesh, 0.009);
  if (topMesh) addOutlineShell(topMesh, 0.011);
  if (hairMesh) addOutlineShell(hairMesh, 0.009);

  // orientação: o personagem deve olhar para a câmera (+Z), com a mão esquerda em +X
  model.updateMatrixWorld(true);
  const lh = bones.LeftHand.getWorldPosition(new V3());
  const rh = bones.RightHand.getWorldPosition(new V3());
  if (lh.x < rh.x) model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);

  const shoulderMid = bones.LeftArm.getWorldPosition(new V3())
    .add(bones.RightArm.getWorldPosition(new V3()))
    .multiplyScalar(0.5);
  const headTop = (bones.HeadTop_End ?? bones.Head).getWorldPosition(new V3());
  const span = Math.max(0.2, headTop.y - shoulderMid.y);
  const S = Math.min(1.55, (H - 0.12 - SHOULDER_Y) / span);
  model.scale.setScalar(S);
  model.position.set(-shoulderMid.x * S, SHOULDER_Y - shoulderMid.y * S, BODY_Z - shoulderMid.z * S);
  model.updateMatrixWorld(true);

  // Proporções cartoon: cabeça maior e olhos bem maiores e expressivos
  if (bones.Head) bones.Head.scale.setScalar(1.1);
  if (bones.LeftEye) bones.LeftEye.scale.setScalar(1.28);
  if (bones.RightEye) bones.RightEye.scale.setScalar(1.28);
  model.updateMatrixWorld(true);
  addCheekBlush(model, bones, S);

  const bindLocal = new Map<THREE.Bone, THREE.Quaternion>();
  const bindWorld = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of Object.values(bones)) {
    bindLocal.set(b, b.quaternion.clone());
    bindWorld.set(b, b.getWorldQuaternion(new Q()));
  }

  const handFrame = (side: "L" | "R") => {
    const pre = side === "L" ? "Left" : "Right";
    const hand = bones[`${pre}Hand`].getWorldPosition(new V3());
    const mid = bones[`${pre}HandMiddle1`].getWorldPosition(new V3());
    const index = bones[`${pre}HandIndex1`].getWorldPosition(new V3());
    const pinky = bones[`${pre}HandPinky1`].getWorldPosition(new V3());
    const F0 = mid.clone().sub(hand).normalize();
    const across = index.clone().sub(pinky).normalize();
    const N0 = side === "L" ? new V3().crossVectors(F0, across) : new V3().crossVectors(across, F0);
    N0.addScaledVector(F0, -N0.dot(F0)).normalize();
    return { F0, N0, len: hand.distanceTo(mid) };
  };
  const fL = handFrame("L");
  const fR = handFrame("R");
  const handBasis0 = { L: basisQuat(fL.F0, fL.N0, new Q()), R: basisQuat(fR.F0, fR.N0, new Q()) };

  const fingerAxes: Rig["fingerAxes"] = [];
  for (const side of ["L", "R"] as const) {
    const pre = side === "L" ? "Left" : "Right";
    const fr = side === "L" ? fL : fR;
    const kWorld = new V3().crossVectors(fr.F0, fr.N0).normalize();
    for (const finger of ["Index", "Middle", "Ring", "Pinky", "Thumb"]) {
      for (let j = 1; j <= 3; j++) {
        const bone = bones[`${pre}Hand${finger}${j}`];
        if (!bone) continue;
        const axis = kWorld.clone().applyQuaternion(bindWorld.get(bone)!.clone().invert()).normalize();
        const max = finger === "Thumb" ? [0.25, 0.35, 0.35][j - 1] : [1.05, 1.2, 0.85][j - 1];
        fingerAxes.push({ bone, axis, max, side });
      }
    }
  }

  if (topMesh && bones.Spine2 && bones.Neck) {
    try {
      addShirtAndTie(model, topMesh, bones.Spine2, bones.Neck, S, gradientMap);
    } catch {
      /* acabamento opcional */
    }
  }

  return {
    model,
    bones,
    bindLocal,
    bindWorld,
    handBasis0,
    fingerAxes,
    handLen: (fL.len + fR.len) * 0.5 * S,
    faceMeshes,
    baseY: model.position.y,
    S,
    anchor: shoulderMid.clone(),
  };
}

export default function Avatar3D({
  planRef,
  onStatus,
}: {
  planRef: MutableRefObject<SpinPlan | null>;
  onStatus?: (status: AvatarStatus) => void;
}) {
  const backRef = useRef<HTMLCanvasElement | null>(null);
  const frontRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    if (!back || !front) return;
    const fctx = front.getContext("2d");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: back, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      statusRef.current?.("error");
      return;
    }
    statusRef.current?.("loading");
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.12;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.35;

    const camera = new THREE.OrthographicCamera(-1, 1, 2.82, 0, 0.1, 30);
    camera.position.set(0, 0, 10);

    // Iluminação de estúdio cartoon: chave quente forte + preenchimento frio + rim ciano
    scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x1a2c55, 0.95));
    const key = new THREE.DirectionalLight(0xfff3e2, 2.7);
    key.position.set(1.6, 3.6, 4.2);
    const fill = new THREE.DirectionalLight(0x9cc8ff, 1.0);
    fill.position.set(-2.4, 1.8, 3);
    const rim = new THREE.DirectionalLight(0x3fd8ff, 2.1);
    rim.position.set(-0.6, 2.6, -3);
    const bounce = new THREE.PointLight(0x2fb8ff, 1.0, 3, 1.5);
    bounce.position.set(0, 1.55, 1.1);
    scene.add(key, fill, rim, bounce);

    const backPlanes = [new THREE.Plane(new V3(0, 1, 0), -HIDE_BELOW_Y)];
    const frontPlanes = [new THREE.Plane(new V3(0, 1, 0), -HIDE_BELOW_Y), new THREE.Plane(new V3(0, 0, 1), -FRONT_Z)];

    const shadowTex = makeRadialTexture("rgba(2,8,22,0.85)", "rgba(2,8,22,0)");
    const makeShadow = () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 })
      );
      m.renderOrder = -1;
      scene.add(m);
      return m;
    };
    const shadowR = makeShadow();
    const shadowL = makeShadow();

    // Disco oclusor invisível no plano da roleta: na passada da frente, tudo que
    // está atrás dele (tronco, gravata, camisa) é descartado pelo depth-test e
    // só as mãos — que ficam à frente dele — aparecem sobre o aro
    const occluder = new THREE.Mesh(
      new THREE.CircleGeometry(OCCLUDE_R, 48),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
    );
    occluder.position.set(0, WHEEL_CY, OCCLUDE_Z);
    occluder.renderOrder = -10;
    occluder.frustumCulled = false;
    occluder.visible = false;
    scene.add(occluder);

    let H = 2.82;
    let rig: Rig | null = null;
    let disposed = false;
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const debugOn = window.location.search.includes("avatarDebug");
    const m = reduced ? 0.3 : 1;

    const resize = () => {
      const w = Math.max(1, back.clientWidth);
      const h = Math.max(1, back.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      front.width = Math.round(w * dpr);
      front.height = Math.round(h * dpr);
      H = (2 * h) / w;
      camera.top = H;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(back);
    resize();

    // ---------- estado contínuo (expressão viva o tempo todo) ----------
    const st = {
      lean: 0.06, twist: 0, side: 0, shrugL: 0, shrugR: 0, bounce: 0, roll: 0, nod: 0,
      smile: 0.38, open: 0.03, browUp: 0.1, browDown: 0, squint: 0.15, squash: 1,
      headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0,
      look: new V3(0, 2.4, 10),
    };
    let nextBlink = 1.4;
    let blinkStart = -1;
    let doubleBlink = false;
    let nextSaccade = 0.6;
    const saccade = { x: 0, y: 0, tx: 0, ty: 0 };

    const blinkValue = (time: number) => {
      if (blinkStart < 0 && time >= nextBlink) {
        blinkStart = time;
        doubleBlink = Math.random() < 0.15;
      }
      if (blinkStart < 0) return 0;
      const e = time - blinkStart;
      const one = (x: number) => (x < 0.07 ? x / 0.07 : x < 0.17 ? 1 - (x - 0.07) / 0.1 : 0);
      let v = one(e);
      if (doubleBlink && e > 0.22) v = one(e - 0.22);
      if (e > (doubleBlink ? 0.42 : 0.2)) {
        blinkStart = -1;
        nextBlink = time + 2.2 + Math.random() * 3.6;
      }
      return smooth(v);
    };

    const viewer = new V3(0, 2.45, 10);
    const pointer = new V3(0, 1.8, 0.45);
    const wheelC = new V3(0, 1.3, 0.45);
    const tmpV = new V3();

    const rest = (angle: number): HandPose => ({ angle, contactR: RING_CONTACT_R, lift: 0, curl: 0.35, contact: 1 });
    const mixHand = (a: HandPose, b: HandPose, k: number, arc = 0): HandPose => ({
      angle: lerp(a.angle, b.angle, k),
      contactR: lerp(a.contactR, b.contactR, k),
      lift: lerp(a.lift, b.lift, k) + Math.sin(k * Math.PI) * arc,
      curl: lerp(a.curl, b.curl, k),
      contact: lerp(a.contact, b.contact, k) * (1 - Math.sin(k * Math.PI) * arc),
    });

    let lastPlanT = -1;
    const computeIntent = (time: number): Intent => {
      const breath = Math.sin(time * 1.55);
      const plan = planRef.current;
      // ---- repouso ----
      const glanceCycle = time % 9.5;
      const glance = smooth((glanceCycle - 6.2) / 0.5) * (1 - smooth((glanceCycle - 7.8) / 0.5));
      const idle: Intent = {
        lean: 0.05 + 0.012 * breath * m,
        twist: 0.03 * noise(time * 0.3, 1) * m,
        side: 0.015 * noise(time * 0.25, 4) * m,
        shrugL: 0.01 * breath * m,
        shrugR: 0.01 * breath * m,
        bounce: 0,
        roll: 0.035 * noise(time * 0.22, 7) * m,
        nod: 0.02 * noise(time * 0.4, 9) * m,
        look: viewer.clone().lerp(wheelC, glance),
        smile: 0.54 + 0.08 * noise(time * 0.2, 2) * m + 0.06 * (1 - glance),
        open: 0.04 + 0.02 * (breath * 0.5 + 0.5),
        browUp: 0.16 + 0.12 * Math.max(0, noise(time * 0.35, 5)) * m + 0.1 * glance,
        browDown: 0,
        squint: 0.14,
        handR: rest(REST_R + 0.8 * noise(time * 0.3, 11) * m),
        handL: rest(REST_L + 0.8 * noise(time * 0.3, 13) * m),
      };
      if (!plan) return idle;

      const t = (performance.now() - plan.startMs) / 1000;
      lastPlanT = t;
      const T = stageTimes(plan);
      const w = wheelAt(plan, t);
      const travel = w.angle - plan.fromAngle;

      if (t < T.grab) {
        // 2. preparação: olha para a roleta, inclina-se e posiciona a mão na borda do disco
        const k = smooth(t / T.grab);
        const grabPose: HandPose = { angle: GRAB_R, contactR: DISC_CONTACT_R, lift: 0, curl: 0.6, contact: 1 };
        return {
          ...idle,
          lean: lerp(idle.lean, 0.2, k),
          twist: lerp(idle.twist, -0.14, k),
          look: viewer.clone().lerp(wheelC.clone().setX(-0.45), smooth(t / 0.45)),
          smile: lerp(idle.smile, 0.3, k),
          browUp: lerp(idle.browUp, 0.2, k),
          handR: mixHand(idle.handR, grabPose, k, 0.9),
        };
      }
      if (t < T.release) {
        // 3. puxada: a mão acompanha EXATAMENTE o ângulo do disco (sem deslizar)
        const p = (t - T.grab) / (T.release - T.grab);
        return {
          ...idle,
          lean: 0.21 + 0.05 * Math.sin(p * Math.PI),
          twist: lerp(-0.14, 0.12, smooth(p)),
          side: lerp(-0.04, 0.05, p),
          shrugR: 0.06,
          shrugL: 0.02,
          look: wheelC.clone().setX(lerp(-0.45, 0, p)),
          smile: 0.18,
          open: 0.14,
          browUp: 0.05,
          browDown: 0.25,
          squint: 0.3,
          handR: { angle: GRAB_R + travel, contactR: DISC_CONTACT_R, lift: 0, curl: 0.66, contact: 1 },
        };
      }
      if (t < T.holdStart) {
        // solta o disco e volta a mão ao aro fixo
        const k = smooth((t - T.release) / (T.holdStart - T.release));
        const from: HandPose = { angle: GRAB_R + plan.handTravelDeg, contactR: DISC_CONTACT_R, lift: 0, curl: 0.66, contact: 1 };
        return {
          ...idle,
          lean: lerp(0.24, 0.13, k),
          twist: lerp(0.12, 0, k),
          look: pointer.clone().lerp(wheelC, 0.4),
          smile: lerp(0.18, 0.55, k),
          open: lerp(0.14, 0.07, k),
          browUp: lerp(0.05, 0.3, k),
          browDown: lerp(0.25, 0, k),
          squint: 0.22,
          handR: mixHand(from, rest(REST_R), k, 0.8),
        };
      }
      if (t < T.brakeStart) {
        // 4. giro rápido: acompanha com o olhar, postura firme
        const track = Math.sin((w.angle * Math.PI) / 180);
        return {
          ...idle,
          lean: 0.13 + 0.01 * breath,
          twist: 0.03 * track * m,
          look: pointer.clone().lerp(wheelC, 0.35).add(tmpV.set(0.12 * track, 0, 0)),
          smile: 0.55 + 0.05 * noise(time * 0.5, 3),
          open: 0.06,
          browUp: 0.3,
          squint: 0.2,
          handR: rest(REST_R),
          handL: rest(REST_L),
        };
      }
      const v0 = Math.max(1, wheelAt(plan, T.brakeStart).velocity);
      if (t < T.stop) {
        // 5. desaceleração: esforço controlado para frear (atrito na borda do disco)
        const kIn = smooth((t - T.brakeStart) / 0.55);
        const vr = clamp01(w.velocity / v0);
        const effort = kIn * (0.35 + 0.65 * vr);
        const drag = 4 * vr * kIn;
        const tremor = 0.6 * effort * Math.sin(time * 31) * m;
        const brR: HandPose = { angle: BRAKE_R + drag + tremor, contactR: DISC_CONTACT_R, lift: 0, curl: 0.25, contact: 1 };
        const brL: HandPose = { angle: BRAKE_L + drag - tremor, contactR: DISC_CONTACT_R, lift: 0, curl: 0.25, contact: 1 };
        return {
          ...idle,
          lean: 0.24 + 0.06 * effort,
          twist: 0,
          side: 0,
          shrugL: 0.07 * effort,
          shrugR: 0.07 * effort,
          roll: 0,
          look: pointer,
          smile: lerp(0.5, 0.22, kIn),
          open: 0.02,
          browUp: 0.08,
          browDown: 0.38 * effort,
          squint: 0.2 + 0.25 * effort,
          handR: mixHand(rest(REST_R), brR, kIn, 0.6),
          handL: mixHand(rest(REST_L), brL, kIn, 0.6),
        };
      }
      const brR: HandPose = { angle: BRAKE_R, contactR: DISC_CONTACT_R, lift: 0, curl: 0.25, contact: 1 };
      const brL: HandPose = { angle: BRAKE_L, contactR: DISC_CONTACT_R, lift: 0, curl: 0.25, contact: 1 };
      if (t < T.reaction) {
        // 6. resultado: relaxa e olha para o setor indicado pelo ponteiro
        const k = smooth((t - T.stop) / (T.reaction - T.stop));
        return {
          ...idle,
          lean: lerp(0.27, 0.1, k),
          shrugL: lerp(0.03, 0, k),
          shrugR: lerp(0.03, 0, k),
          look: pointer,
          smile: lerp(0.25, 0.5, k),
          open: lerp(0.12, 0.05, k),
          browUp: lerp(0.1, 0.35, k),
          browDown: lerp(0.2, 0, k),
          squint: 0.2,
          handR: mixHand(brR, rest(REST_R), k, 0.5),
          handL: mixHand(brL, rest(REST_L), k, 0.5),
        };
      }
      if (t < T.done) {
        // 7. reação (prêmio ou "tente de novo") e 8. retorno suave ao repouso
        const e = t - T.reaction;
        const out = 1 - smooth((t - T.returnStart) / (T.done - T.returnStart));
        if (plan.outcome === "prize") {
          const raise = smooth(e / 0.35) * (1 - smooth((e - 1.55) / 0.45));
          const pump = Math.max(0, Math.sin(clamp01((e - 0.35) / 1.1) * Math.PI * 4)) * raise;
          const shoulder = rig ? rig.bones.RightArm.getWorldPosition(new V3()) : new V3(-0.3, 2.1, 0);
          return {
            ...idle,
            lean: lerp(idle.lean, 0.02, out),
            twist: lerp(idle.twist, 0.09 * raise, out),
            bounce: 0.038 * pump,
            roll: lerp(idle.roll, 0.08 * raise, out),
            look: viewer,
            smile: lerp(idle.smile, 1, out),
            open: lerp(idle.open, 0.4 + 0.1 * pump, out),
            browUp: lerp(idle.browUp, 0.55, out),
            squint: lerp(idle.squint, 0.5, out),
            handR: {
              ...rest(REST_R),
              curl: lerp(0.35, 1, raise),
              free: {
                pos: shoulder.clone().add(tmpV.set(-0.05, 0.27 + 0.05 * pump, 0.45)),
                F: new V3(0.05, 1, 0.3),
                N: new V3(0.35, 0, -1),
                weight: raise,
              },
            },
          };
        }
        const k = smooth(e / 0.45);
        const nod = 0.07 * Math.sin(e * 5.2) * k * (1 - smooth((e - 1.1) / 0.5));
        const shrug = 0.05 * Math.sin(clamp01(e / 0.9) * Math.PI);
        return {
          ...idle,
          lean: lerp(idle.lean, 0.05, out),
          roll: lerp(idle.roll, 0.12 * k, out),
          nod: lerp(idle.nod, nod, out),
          shrugL: shrug,
          shrugR: shrug,
          look: viewer,
          smile: lerp(idle.smile, 0.62, out),
          open: lerp(idle.open, 0.05, out),
          browUp: lerp(idle.browUp, 0.55, out),
          squint: lerp(idle.squint, 0.3, out),
        };
      }
      return idle;
    };

    // ---------- aplicação da pose nos ossos ----------
    const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _t = new V3(), _p = new V3();
    const _q = new Q(), _q2 = new Q();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    const solveArm = (side: "L" | "R", target: THREE.Vector3, pole: THREE.Vector3) => {
      if (!rig) return;
      const pre = side === "L" ? "Left" : "Right";
      const arm = rig.bones[`${pre}Arm`];
      const fore = rig.bones[`${pre}ForeArm`];
      const hand = rig.bones[`${pre}Hand`];
      arm.getWorldPosition(_a);
      fore.getWorldPosition(_b);
      hand.getWorldPosition(_c);
      const l1 = _a.distanceTo(_b);
      const l2 = _b.distanceTo(_c);
      _d.subVectors(target, _a);
      const dist = clamp(_d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.995);
      _d.normalize();
      const A = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
      _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
      _e.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_p, Math.sin(A)).normalize();
      _q.setFromUnitVectors(_t.subVectors(_b, _a).normalize(), _e);
      rotateWorld(arm, _q);
      fore.getWorldPosition(_b);
      hand.getWorldPosition(_c);
      const goal = _a.clone().addScaledVector(_d, dist);
      _q.setFromUnitVectors(_t.subVectors(_c, _b).normalize(), goal.sub(_b).normalize());
      rotateWorld(fore, _q);
    };

    const orientHand = (side: "L" | "R", F: THREE.Vector3, N: THREE.Vector3) => {
      if (!rig) return;
      const hand = rig.bones[side === "L" ? "LeftHand" : "RightHand"];
      basisQuat(F, N, _q);
      _q.multiply(_q2.copy(rig.handBasis0[side]).invert()).multiply(rig.bindWorld.get(hand)!);
      hand.parent!.getWorldQuaternion(_pq);
      hand.quaternion.copy(_pq.invert().multiply(_q));
    };

    const handTarget = (pose: HandPose) => {
      const a = (pose.angle * Math.PI) / 180;
      const u = new V3(Math.sin(a), Math.cos(a), 0);
      const hl = rig ? rig.handLen : 0.14;
      const F = u.clone().multiplyScalar(-0.97).add(new V3(0, 0, 0.24 + pose.lift * 0.45)).normalize();
      const N = new V3(0, 0, -1).addScaledVector(u, -0.25).normalize();
      const contact = new V3(u.x * pose.contactR, WHEEL_CY + u.y * pose.contactR, CONTACT_Z);
      const wrist = contact
        .clone()
        .addScaledVector(u, hl * 0.62 + pose.lift * 0.05)
        .add(new V3(0, 0, -0.02 + pose.lift * 0.09));
      return { wrist, F, N, contact, u };
    };

    const applyHand = (side: "L" | "R", pose: HandPose, shadow: THREE.Mesh) => {
      if (!rig) return;
      const ht = handTarget(pose);
      let wrist = ht.wrist;
      let F = ht.F;
      let N = ht.N;
      let pole = new V3(side === "L" ? 0.85 : -0.85, -0.2, 0.5);
      const fw = pose.free?.weight ?? 0;
      if (pose.free && fw > 0) {
        wrist = wrist.clone().lerp(pose.free.pos, fw);
        F = F.clone().lerp(pose.free.F, fw).normalize();
        N = N.clone().lerp(pose.free.N, fw).normalize();
        pole = pole.lerp(new V3(side === "L" ? 0.9 : -0.9, -0.45, 0.05), fw);
      }
      solveArm(side, wrist, pole);
      orientHand(side, F, N);
      for (const fa of rig.fingerAxes) {
        if (fa.side !== side) continue;
        fa.bone.quaternion.copy(rig.bindLocal.get(fa.bone)!).multiply(_q.setFromAxisAngle(fa.axis, fa.max * pose.curl));
      }
      const op = pose.contact * (1 - fw) * (1 - clamp01(pose.lift));
      shadow.visible = op > 0.02;
      const sm = shadow.material as THREE.MeshBasicMaterial;
      sm.opacity = 0.5 * op;
      shadow.position.set(ht.contact.x, ht.contact.y, CONTACT_Z - 0.015);
      shadow.rotation.set(0, 0, -(pose.angle * Math.PI) / 180);
      shadow.scale.set(rig.handLen * 2.1, rig.handLen * 1.1, 1);
    };

    const lookRel = (from: THREE.Vector3, target: THREE.Vector3, curQ: THREE.Quaternion, bindQ: THREE.Quaternion) => {
      const fwd = Z_AXIS.clone().applyQuaternion(_q2.copy(curQ).multiply(bindQ.clone().invert()));
      const d = target.clone().sub(from).normalize();
      return {
        yaw: Math.atan2(d.x, d.z) - Math.atan2(fwd.x, fwd.z),
        pitch: Math.asin(clamp(-d.y, -1, 1)) - Math.asin(clamp(-fwd.y, -1, 1)),
      };
    };

    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const freeze = (window as unknown as { __fatorAvatarForce?: Record<string, number> }).__fatorAvatarForce?.freeze;
      const time = freeze ? 3 : clock.elapsedTime;
      if (!rig) return;

      const it = computeIntent(time);
      const r = 6.5 * dt;
      void r;
      st.lean = damp(st.lean, it.lean, 7, dt);
      st.twist = damp(st.twist, it.twist, 6, dt);
      st.side = damp(st.side, it.side, 6, dt);
      st.shrugL = damp(st.shrugL, it.shrugL, 8, dt);
      st.shrugR = damp(st.shrugR, it.shrugR, 8, dt);
      st.bounce = damp(st.bounce, it.bounce, 14, dt);
      st.roll = damp(st.roll, it.roll, 5, dt);
      st.nod = damp(st.nod, it.nod, 10, dt);
      st.smile = damp(st.smile, it.smile, 5, dt);
      st.open = damp(st.open, it.open, 8, dt);
      st.browUp = damp(st.browUp, it.browUp, 6, dt);
      st.browDown = damp(st.browDown, it.browDown, 6, dt);
      st.squint = damp(st.squint, it.squint, 6, dt);
      st.look.lerp(it.look, 1 - Math.exp(-5 * dt));

      // Squash & stretch cartoon sincronizado com a linha do tempo do giro
      let squashTarget = 1 + Math.sin(time * 1.55) * 0.006 * m;
      {
        const plan = planRef.current;
        if (plan && lastPlanT >= 0) {
          const T = stageTimes(plan);
          const t = lastPlanT;
          if (t < T.grab) squashTarget = lerp(1, 0.94, smooth(t / T.grab));
          else if (t < T.release) squashTarget = lerp(0.94, 1.07, smooth((t - T.grab) / (T.release - T.grab)));
          else if (t < T.holdStart) squashTarget = lerp(1.07, 1.0, smooth((t - T.release) / (T.holdStart - T.release)));
          else if (t < T.brakeStart) squashTarget = 1 + Math.sin(time * 1.55) * 0.008 * m;
          else if (t < T.stop) squashTarget = 0.965;
          else if (t < T.reaction) squashTarget = lerp(0.965, 1.03, smooth((t - T.stop) / (T.reaction - T.stop)));
          else if (t < T.done) {
            const e = t - T.reaction;
            const out = 1 - smooth((t - T.returnStart) / (T.done - T.returnStart));
            squashTarget =
              plan.outcome === "prize"
                ? lerp(1, 1.04 + 0.035 * Math.abs(Math.sin(e * 6.5)), out)
                : lerp(1, 1.015, out);
          }
        }
      }
      st.squash = damp(st.squash, squashTarget, 11, dt);

      // sacadas oculares naturais
      if (freeze) {
        saccade.tx = 0;
        saccade.ty = 0;
      } else if (time >= nextSaccade) {
        saccade.tx = (Math.random() - 0.5) * 0.09;
        saccade.ty = (Math.random() - 0.5) * 0.05;
        nextSaccade = time + 0.5 + Math.random() * 1.9;
      }
      saccade.x = damp(saccade.x, saccade.tx, 30, dt);
      saccade.y = damp(saccade.y, saccade.ty, 30, dt);

      const { bones, bindLocal, bindWorld } = rig;
      for (const [b, q] of bindLocal) b.quaternion.copy(q);
      // Aplica o squash & stretch preservando o volume e a âncora nos ombros
      {
        const sy = rig.S * st.squash;
        const sxz = rig.S / Math.sqrt(Math.max(0.5, st.squash));
        rig.model.scale.set(sxz, sy, sxz);
        rig.model.position.set(
          -rig.anchor.x * sxz,
          SHOULDER_Y - rig.anchor.y * sy + st.bounce,
          BODY_Z - rig.anchor.z * sxz
        );
      }

      // tronco (distribuído na coluna) + respiração
      const breath = Math.sin(time * 1.55) * m;
      for (const name of ["Spine", "Spine1", "Spine2"]) {
        const b = bones[name];
        if (!b) continue;
        euler.set(st.lean / 3 + (name === "Spine2" ? -0.012 * breath : 0), st.twist / 3, st.side / 3);
        rotateWorld(b, _q.setFromEuler(euler));
      }
      if (bones.LeftShoulder) rotateWorld(bones.LeftShoulder, _q.setFromAxisAngle(Z_AXIS, st.shrugL));
      if (bones.RightShoulder) rotateWorld(bones.RightShoulder, _q.setFromAxisAngle(Z_AXIS, -st.shrugR));

      // cabeça: olhar relativo à orientação atual (compensa a inclinação do tronco)
      const head = bones.Head;
      const neck = bones.Neck;
      head.getWorldPosition(_c);
      const headCur = head.getWorldQuaternion(new Q());
      const rel = lookRel(_c, st.look, headCur, bindWorld.get(head)!);
      const wantYaw = clamp(rel.yaw * 0.6, -0.55, 0.55);
      const wantPitch = clamp(rel.pitch * 0.6, -0.3, 0.45);
      st.headYaw = damp(st.headYaw, wantYaw, 4.5, dt);
      st.headPitch = damp(st.headPitch, wantPitch, 4.5, dt);
      euler.set((st.headPitch + st.nod) / 2, st.headYaw / 2, st.roll / 2);
      rotateWorld(neck, _q.setFromEuler(euler));
      rotateWorld(head, _q.setFromEuler(euler));

      // olhos (cada um mira o alvo → convergência natural)
      let pitchForLid = 0;
      for (const name of ["LeftEye", "RightEye"]) {
        const eye = bones[name];
        if (!eye) continue;
        eye.getWorldPosition(_a);
        const cur = eye.getWorldQuaternion(new Q());
        const er = lookRel(_a, st.look, cur, bindWorld.get(eye)!);
        const ey = clamp(er.yaw + saccade.x, -0.4, 0.4);
        const ep = clamp(er.pitch + saccade.y, -0.3, 0.35);
        st.eyeYaw = damp(st.eyeYaw, ey, 26, dt);
        st.eyePitch = damp(st.eyePitch, ep, 26, dt);
        pitchForLid = st.eyePitch;
        euler.set(st.eyePitch, st.eyeYaw, 0);
        rotateWorld(eye, _q.setFromEuler(euler));
      }

      // braços e mãos (contato com a parte correta da roleta)
      applyHand("R", it.handR, shadowR);
      applyHand("L", it.handL, shadowL);

      // expressão facial
      const force = (window as unknown as { __fatorAvatarForce?: Record<string, number> }).__fatorAvatarForce;
      const blink = force?.blink ?? blinkValue(time);
      if (force?.smile !== undefined) st.smile = force.smile;
      if (force?.browUp !== undefined) st.browUp = force.browUp;
      const lidFollow = 0.32 * clamp01(pitchForLid / 0.3);
      const fm = rig.faceMeshes;
      // Expressões exageradas estilo cartoon (olhos felizes em "U" no sorriso)
      setMorph(fm, "frBlink", clamp01(Math.max(blink, lidFollow + st.squint * 0.25)));
      setMorph(fm, "frSquint", clamp01(st.squint + st.smile * 0.34));
      setMorph(fm, "frBrowUp", clamp01(st.browUp * 1.18));
      setMorph(fm, "frBrowDown", clamp01(st.browDown * 1.12));
      setMorph(fm, "mouthSmile", clamp01(st.smile));
      setMorph(fm, "mouthOpen", clamp01(st.open));

      // duas passadas: frente (só as mãos, sobre o aro) e fundo (corpo atrás da roleta)
      occluder.visible = true;
      renderer.clippingPlanes = frontPlanes;
      renderer.render(scene, camera);
      if (fctx) {
        fctx.clearRect(0, 0, front.width, front.height);
        fctx.drawImage(renderer.domElement, 0, 0, front.width, front.height);
      }
      occluder.visible = false;
      renderer.clippingPlanes = backPlanes;
      renderer.render(scene, camera);

      const dbg = window as unknown as { __fatorAvatar?: Record<string, unknown> };
      if (!debugOn) {
        if (!dbg.__fatorAvatar) dbg.__fatorAvatar = { ready: true };
        return;
      }
      dbg.__fatorAvatar = {
        ready: true,
        headTopY: (bones.HeadTop_End ?? head).getWorldPosition(new V3()).y,
        H,
        handR: bones.RightHand.getWorldPosition(new V3()).toArray(),
        handL: bones.LeftHand.getWorldPosition(new V3()).toArray(),
        targetR: handTarget(it.handR).wrist.toArray(),
        blink,
        disc: planRef.current ? wheelAt(planRef.current, lastPlanT).angle - planRef.current.fromAngle : null,
        planT: planRef.current ? lastPlanT : null,
        elbowR: bones.RightForeArm.getWorldPosition(new V3()).toArray(),
        elbowL: bones.LeftForeArm.getWorldPosition(new V3()).toArray(),
        eyeL: bones.LeftEye?.getWorldPosition(new V3()).toArray(),
        eyeR: bones.RightEye?.getWorldPosition(new V3()).toArray(),
        morphs: rig.faceMeshes.map((fm) => Object.keys(fm.morphTargetDictionary ?? {}).join("|")),
      };
    };
    animate();

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        try {
          rig = buildRig(gltf, H);
          scene.add(rig.model);
          statusRef.current?.("ready");
        } catch (err) {
          console.error("Avatar3D: falha ao montar o rig", err);
          statusRef.current?.("error");
        }
      },
      undefined,
      (err) => {
        console.error("Avatar3D: falha ao carregar o modelo", err);
        statusRef.current?.("error");
      }
    );

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      envTex.dispose();
      pmrem.dispose();
      shadowTex.dispose();
      occluder.geometry.dispose();
      (occluder.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [planRef]);

  return (
    <div className="mascot3d-rig" aria-label="Avatar humano 3D estilo cartoon animado em tempo real">
      <canvas ref={backRef} className="mascot-back" />
      <canvas ref={frontRef} className="mascot-front" />
    </div>
  );
}
