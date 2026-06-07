/**
 * Standalone WebGL2 entity inspector. Pure view — no extraction.
 *
 * Mirrors the Java GPUIconRenderer pipeline 1:1:
 *   - rotation chain: Z then X then Y (applied on CPU when packing verts)
 *   - cache angle mapping: def.xan2d → step 3, def.yan2d → step 2, def.zan2d → step 1
 *   - projection: scale 32, Y flipped via projection[5] = -32, +Z forward
 *   - winding fix: frontFace(CW) compensates for the Y-flip in projection
 *   - auto-fit: cameraDepth = maxHalf * 32 / 0.85 measured on rotated bbox
 *   - priority sort + GL_LEQUAL + per-face Z bias of `priority * priorityZStep`
 *   - dual-side lighting via gl_FrontFacing
 *   - two-pass alpha (opaque with depth write, transparent without)
 *
 * Supports three entity types: items, npcs, objects. Multi-model entities
 * (NPCs with multiple body parts, objects with multiple sub-meshes) get
 * merged into a single composite model upstream in model-loader.js.
 */

import { loadEntity, searchEntities } from './model-loader.js';
import { rgbToFloats } from './palette.js';

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
if (!gl) {
  document.body.innerHTML = '<div style="padding:20px;color:#f88">WebGL2 not supported in this browser.</div>';
  throw new Error('WebGL2 not supported');
}

const VERT_SRC = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aFront;
in vec3 aBack;
in float aAlpha;
in float aPriority;

uniform mat4 uView;
uniform mat4 uProj;
uniform float uPriorityZStep;

out vec3 vFront;
out vec3 vBack;
out float vAlpha;

void main() {
  vec4 view = uView * vec4(aPos, 1.0);
  view.z -= aPriority * uPriorityZStep;
  gl_Position = uProj * view;
  vFront = aFront;
  vBack = aBack;
  vAlpha = aAlpha;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform int uPassMode;
uniform bool uDualColor;
uniform bool uWireframe;

in vec3 vFront;
in vec3 vBack;
in float vAlpha;

out vec4 FragColor;

void main() {
  if (vAlpha < 0.004) discard;
  if (uPassMode == 0 && vAlpha < 0.996) discard;
  if (uPassMode == 1 && vAlpha >= 0.996) discard;
  vec3 c = uDualColor && !gl_FrontFacing ? vBack : vFront;
  if (uWireframe) c = vec3(0.85);
  FragColor = vec4(c, vAlpha);
}`;

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function linkProgram() {
  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

const program = linkProgram();
gl.useProgram(program);

const aPos = gl.getAttribLocation(program, 'aPos');
const aFront = gl.getAttribLocation(program, 'aFront');
const aBack = gl.getAttribLocation(program, 'aBack');
const aAlpha = gl.getAttribLocation(program, 'aAlpha');
const aPriority = gl.getAttribLocation(program, 'aPriority');
const uView = gl.getUniformLocation(program, 'uView');
const uProj = gl.getUniformLocation(program, 'uProj');
const uPriorityZStep = gl.getUniformLocation(program, 'uPriorityZStep');
const uPassMode = gl.getUniformLocation(program, 'uPassMode');
const uDualColor = gl.getUniformLocation(program, 'uDualColor');
const uWireframe = gl.getUniformLocation(program, 'uWireframe');

const vao = gl.createVertexArray();
const vbo = gl.createBuffer();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

const STRIDE_FLOATS = 11;
const STRIDE_BYTES = STRIDE_FLOATS * 4;

gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE_BYTES, 0);
gl.enableVertexAttribArray(aFront);
gl.vertexAttribPointer(aFront, 3, gl.FLOAT, false, STRIDE_BYTES, 12);
gl.enableVertexAttribArray(aBack);
gl.vertexAttribPointer(aBack, 3, gl.FLOAT, false, STRIDE_BYTES, 24);
gl.enableVertexAttribArray(aAlpha);
gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, STRIDE_BYTES, 36);
gl.enableVertexAttribArray(aPriority);
gl.vertexAttribPointer(aPriority, 1, gl.FLOAT, false, STRIDE_BYTES, 40);

const state = {
  entityType: 'items',
  itemId: 9810,
  xan2d: 0,
  yan2d: 0,
  zan2d: 0,
  zoomMultiplier: 1.0,
  priorityZStep: 13,
  prioritySort: true,
  dualColor: true,
  alphaBlend: true,
  depthWrite: true,
  cullFace: false,
  wireframe: false,
  isolatePriority: -1,
  loaded: null,
  vertCount: 0,
  cameraDepth: 1000,
  dirty: true,
};

function rsAngle(a) { return (a * Math.PI * 2) / 2048; }

function rotateVertexJava(v, sinZ, cosZ, sinX, cosX, sinY, cosY) {
  let vx = v[0], vy = v[1], vz = v[2];
  let t1 = vy * sinZ + vx * cosZ;
  vy = vy * cosZ - vx * sinZ;
  vx = t1;
  t1 = vz * sinX + vx * cosX;
  vz = vz * cosX - vx * sinX;
  vx = t1;
  t1 = vy * cosY - vz * sinY;
  vz = vy * sinY + vz * cosY;
  vy = t1;
  return [vx, vy, vz];
}

function buildVertexBuffer() {
  if (!state.loaded) {
    state.vertCount = 0;
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    return;
  }
  const { model } = state.loaded;
  const faces = model.faces;
  const verts = model.vertices;
  const litA = model.litA, litB = model.litB, litC = model.litC;
  const litBackA = model.litBackA, litBackB = model.litBackB, litBackC = model.litBackC;

  const order = [];
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f.a < 0 || f.b < 0 || f.c < 0) continue;
    if (f.a === f.b && f.b === f.c) continue;
    const litFront = litA[i];
    if (litFront === -1 || litFront === -2 || litFront === -3) continue;
    const prio = f.priority || 0;
    if (state.isolatePriority >= 0 && prio !== state.isolatePriority) continue;
    order.push(i);
  }
  if (state.prioritySort) {
    order.sort((x, y) => {
      const px = faces[x].priority || 0;
      const py = faces[y].priority || 0;
      if (px !== py) return px - py;
      return x - y;
    });
  }

  const zRad = rsAngle(state.zan2d);
  const xRad = rsAngle(state.yan2d);
  const yRad = rsAngle(state.xan2d);
  const sinZ = Math.sin(zRad), cosZ = Math.cos(zRad);
  const sinX = Math.sin(xRad), cosX = Math.cos(xRad);
  const sinY = Math.sin(yRad), cosY = Math.cos(yRad);

  const referenced = new Set();
  for (const i of order) {
    const f = faces[i];
    referenced.add(f.a); referenced.add(f.b); referenced.add(f.c);
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const rotated = new Map();
  for (const idx of referenced) {
    const v = verts[idx];
    const r = rotateVertexJava(v, sinZ, cosZ, sinX, cosX, sinY, cosY);
    rotated.set(idx, r);
    if (r[0] < minX) minX = r[0]; if (r[0] > maxX) maxX = r[0];
    if (r[1] < minY) minY = r[1]; if (r[1] > maxY) maxY = r[1];
    if (r[2] < minZ) minZ = r[2]; if (r[2] > maxZ) maxZ = r[2];
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const halfX = Math.max(maxX - cx, cx - minX);
  const halfY = Math.max(maxY - cy, cy - minY);
  const maxHalf = Math.max(halfX, halfY, 1);
  const targetNdc = 0.85 / state.zoomMultiplier;
  state.cameraDepth = Math.max(100, (maxHalf * 32) / targetNdc);

  const arr = new Float32Array(order.length * 3 * STRIDE_FLOATS);
  let w = 0;
  for (const i of order) {
    const f = faces[i];
    const prio = f.priority || 0;
    const alpha = (255 - (f.alpha || 0)) / 255;
    const verts3 = [
      [f.a, litA[i], litBackA[i]],
      [f.b, litB[i], litBackB[i]],
      [f.c, litC[i], litBackC[i]],
    ];
    for (const [vi, rgbF, rgbB] of verts3) {
      const r = rotated.get(vi);
      const fc = rgbToFloats(rgbF);
      const bc = rgbToFloats(rgbB);
      arr[w++] = r[0] - cx;
      arr[w++] = r[1] - cy;
      arr[w++] = r[2] - cz;
      arr[w++] = fc[0]; arr[w++] = fc[1]; arr[w++] = fc[2];
      arr[w++] = bc[0]; arr[w++] = bc[1]; arr[w++] = bc[2];
      arr[w++] = alpha;
      arr[w++] = prio;
    }
  }
  gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
  state.vertCount = order.length * 3;
}

function mat4JavaTranslate(x, y, z) {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function mat4JavaProjection(near, far) {
  const fn = 1 / (far - near);
  return new Float32Array([
    32, 0, 0, 0,
    0, -32, 0, 0,
    0, 0, (far + near) * fn, 1,
    0, 0, -2 * far * near * fn, 0,
  ]);
}

function render() {
  if (state.dirty) {
    buildVertexBuffer();
    state.dirty = false;
  }

  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clearDepth(1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  if (state.vertCount === 0) {
    requestAnimationFrame(render);
    return;
  }

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(state.prioritySort ? gl.LEQUAL : gl.LESS);

  if (state.cullFace) {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  } else {
    gl.disable(gl.CULL_FACE);
  }

  gl.useProgram(program);
  const view = mat4JavaTranslate(0, 0, state.cameraDepth);
  const proj = mat4JavaProjection(50, 50000);
  gl.uniformMatrix4fv(uView, false, view);
  gl.uniformMatrix4fv(uProj, false, proj);
  gl.uniform1f(uPriorityZStep, state.prioritySort ? state.priorityZStep : 0);
  gl.uniform1i(uDualColor, state.dualColor ? 1 : 0);
  gl.uniform1i(uWireframe, state.wireframe ? 1 : 0);

  gl.bindVertexArray(vao);

  if (state.alphaBlend) {
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.disable(gl.BLEND);
  }

  gl.depthMask(state.depthWrite);
  gl.uniform1i(uPassMode, 0);
  gl.drawArrays(state.wireframe ? gl.LINES : gl.TRIANGLES, 0, state.vertCount);

  if (state.alphaBlend) {
    gl.depthMask(false);
    gl.uniform1i(uPassMode, 1);
    gl.drawArrays(state.wireframe ? gl.LINES : gl.TRIANGLES, 0, state.vertCount);
    gl.depthMask(state.depthWrite);
  }

  requestAnimationFrame(render);
}

function updateInfo() {
  const el = document.getElementById('info');
  if (!state.loaded) { el.textContent = 'no entity loaded'; return; }
  const { type, def, model, modelIds } = state.loaded;
  const name = def.name || '(unnamed)';
  const modelStr = modelIds.length === 1 ? `model ${modelIds[0]}` : `models ${modelIds.join('+')}`;
  const angles = type === 'items' ? ` · def xan2d=${def.xan2d||0} yan2d=${def.yan2d||0} zan2d=${def.zan2d||0} zoom2d=${def.zoom2d||0}` : '';
  el.textContent = `${type.slice(0, -1)} ${def.id} · ${name} · ${modelStr} · ${model.vertices.length}v ${model.faces.length}f${angles}`;
}

function syncSlider(id, value, fmt) {
  const el = document.getElementById(id);
  if (el) el.value = value;
  const label = document.getElementById(id + 'Val');
  if (label) label.textContent = fmt ? fmt(value) : value;
}

function applyEntityDefaults(type, def) {
  if (type === 'items') {
    state.xan2d = (def.xan2d || 0) & 0x7FF;
    state.yan2d = (def.yan2d || 0) & 0x7FF;
    state.zan2d = (def.zan2d || 0) & 0x7FF;
  } else {
    state.xan2d = 128;
    state.yan2d = 0;
    state.zan2d = 0;
  }
  state.zoomMultiplier = 1.0;
  syncSlider('xan2d', state.xan2d);
  syncSlider('yan2d', state.yan2d);
  syncSlider('zan2d', state.zan2d);
  syncSlider('zoom', 100, () => '1.00');
}

async function loadAndRender(id, type) {
  type = type || state.entityType;
  try {
    state.loaded = await loadEntity(type, id);
    state.itemId = id;
    state.entityType = type;
    applyEntityDefaults(type, state.loaded.def);
    state.dirty = true;
    updateInfo();
  } catch (err) {
    document.getElementById('info').textContent = `error: ${err.message}`;
  }
}

function bindSidebar() {
  const angleSlider = (id, key) => {
    const el = document.getElementById(id);
    const label = document.getElementById(id + 'Val');
    el.addEventListener('input', () => {
      const v = Number(el.value);
      state[key] = v;
      if (label) label.textContent = v;
      state.dirty = true;
    });
  };
  angleSlider('xan2d', 'xan2d');
  angleSlider('yan2d', 'yan2d');
  angleSlider('zan2d', 'zan2d');

  const zoomEl = document.getElementById('zoom');
  const zoomLabel = document.getElementById('zoomVal');
  zoomEl.addEventListener('input', () => {
    state.zoomMultiplier = Number(zoomEl.value) / 100;
    if (zoomLabel) zoomLabel.textContent = state.zoomMultiplier.toFixed(2);
    state.dirty = true;
  });

  const pzEl = document.getElementById('priorityZStep');
  const pzLabel = document.getElementById('pzVal');
  pzEl.addEventListener('input', () => {
    state.priorityZStep = Number(pzEl.value);
    if (pzLabel) pzLabel.textContent = state.priorityZStep;
  });

  const flag = (id, key, dirty = false) => {
    document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.checked;
      if (dirty) state.dirty = true;
    });
  };
  flag('prioritySort', 'prioritySort', true);
  flag('dualColor', 'dualColor');
  flag('alphaBlend', 'alphaBlend');
  flag('depthWrite', 'depthWrite');
  flag('cullFace', 'cullFace');
  flag('wireframe', 'wireframe');

  const typeSelect = document.getElementById('entityType');
  typeSelect.value = state.entityType;
  typeSelect.addEventListener('change', () => {
    state.entityType = typeSelect.value;
    document.getElementById('searchResults').innerHTML = '';
  });

  document.getElementById('loadBtn').addEventListener('click', () => {
    const id = Number(document.getElementById('itemId').value);
    if (Number.isFinite(id)) loadAndRender(id, state.entityType);
  });
  document.getElementById('itemId').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const id = Number(e.target.value);
      if (Number.isFinite(id)) loadAndRender(id, state.entityType);
    }
  });

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { searchResults.innerHTML = ''; return; }
      const hits = await searchEntities(state.entityType, q);
      searchResults.innerHTML = hits.map(h =>
        `<div class="hit" data-id="${h.id}"><span>${escapeHtml(h.name)}</span><span class="id">${h.id}</span></div>`
      ).join('');
      for (const node of searchResults.querySelectorAll('.hit')) {
        node.addEventListener('click', () => {
          const id = Number(node.dataset.id);
          document.getElementById('itemId').value = id;
          loadAndRender(id, state.entityType);
        });
      }
    }, 150);
  });

  const pBtns = document.getElementById('priorityButtons');
  const all = ['all', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
  pBtns.innerHTML = all.map(p => `<button data-p="${p}">${p}</button>`).join('');
  for (const btn of pBtns.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      const p = btn.dataset.p;
      state.isolatePriority = p === 'all' ? -1 : Number(p);
      for (const b of pBtns.querySelectorAll('button')) b.classList.remove('active');
      btn.classList.add('active');
      state.dirty = true;
    });
  }
  pBtns.querySelector('[data-p="all"]').classList.add('active');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

let dragging = false;
let dragLastX = 0, dragLastY = 0;
canvas.addEventListener('mousedown', e => {
  dragging = true;
  dragLastX = e.clientX;
  dragLastY = e.clientY;
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = e.clientX - dragLastX;
  const dy = e.clientY - dragLastY;
  dragLastX = e.clientX;
  dragLastY = e.clientY;
  state.yan2d = ((state.yan2d + Math.round(dx * 4)) % 2048 + 2048) % 2048;
  state.xan2d = ((state.xan2d + Math.round(dy * 4)) % 2048 + 2048) % 2048;
  syncSlider('yan2d', state.yan2d);
  syncSlider('xan2d', state.xan2d);
  state.dirty = true;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  state.zoomMultiplier = Math.max(0.2, Math.min(5, state.zoomMultiplier * delta));
  syncSlider('zoom', Math.round(state.zoomMultiplier * 100), () => state.zoomMultiplier.toFixed(2));
  state.dirty = true;
}, { passive: false });
window.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') {
    if (state.itemId != null) loadAndRender(state.itemId, state.entityType);
  }
});

bindSidebar();
loadAndRender(state.itemId, state.entityType);
requestAnimationFrame(render);
