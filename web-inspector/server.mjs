#!/usr/bin/env node

/**
 * Standalone read-only inspector server. Serves the public/ static files +
 * exposes API endpoints reading from extracted_osrs_cache/raw/ on demand.
 *
 * Endpoints:
 *   GET /api/entity/items/:id     — full item def
 *   GET /api/entity/npcs/:id      — full npc def
 *   GET /api/entity/objects/:id   — full object def
 *   GET /api/model/:id            — raw model JSON
 *   GET /api/search?type=<t>&q=<> — name search by type
 *   GET /api/health               — index counts
 *
 *   node web-inspector/server.mjs
 *   → http://localhost:8080
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const EXTRACTED = path.join(__dirname, '..', 'extracted_osrs_cache', 'raw');
const CONFIGS_DIR = path.join(EXTRACTED, 'configs');
const MODELS_DIR = path.join(EXTRACTED, 'models');

const PORT = 8080;
const MODELS_CHUNK_SIZE = 2000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const TYPE_PREFIX = { items: 'Items-', npcs: 'Npcs-', objects: 'Objects-' };

const indices = {};
function getIndex(type) {
  if (indices[type]) return indices[type];
  const map = new Map();
  const prefix = TYPE_PREFIX[type];
  if (!prefix) throw new Error('unknown type: ' + type);
  if (!fs.existsSync(CONFIGS_DIR)) { indices[type] = map; return map; }
  for (const fn of fs.readdirSync(CONFIGS_DIR)) {
    if (!fn.startsWith(prefix) || !fn.endsWith('.json')) continue;
    const arr = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, fn), 'utf-8'));
    for (const it of arr) map.set(it.id, it);
  }
  console.log(`[inspector] loaded ${map.size} ${type} defs`);
  indices[type] = map;
  return map;
}

const modelChunkCache = new Map();
function findModel(id) {
  const chunk = Math.floor(id / MODELS_CHUNK_SIZE);
  if (!modelChunkCache.has(chunk)) {
    const file = path.join(MODELS_DIR, `Models-${chunk}.json`);
    if (!fs.existsSync(file)) return null;
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const map = new Map();
    for (const m of arr) map.set(m.id, m);
    modelChunkCache.set(chunk, map);
  }
  return modelChunkCache.get(chunk).get(id) || null;
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
function sendError(res, code, msg) { sendJson(res, code, { error: msg }); }

function serveStatic(req, res) {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(PUBLIC, rel);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function handleEntity(p, res) {
  const rest = p.slice('/api/entity/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return sendError(res, 400, 'bad entity path');
  const type = rest.slice(0, slash);
  const idStr = rest.slice(slash + 1);
  if (!TYPE_PREFIX[type]) return sendError(res, 400, 'unknown type');
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return sendError(res, 400, 'invalid id');
  const def = getIndex(type).get(id);
  if (!def) return sendError(res, 404, `${type} ${id} not found`);
  return sendJson(res, 200, def);
}

function handleSearch(url, res) {
  const type = url.searchParams.get('type') || 'items';
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  if (!TYPE_PREFIX[type]) return sendError(res, 400, 'unknown type');
  if (q.length < 2) return sendJson(res, 200, []);
  const map = getIndex(type);
  const out = [];
  for (const [id, def] of map) {
    if (def.name && def.name.toLowerCase().includes(q)) {
      out.push({ id, name: def.name });
      if (out.length >= 100) break;
    }
  }
  return sendJson(res, 200, out);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p.startsWith('/api/entity/')) return handleEntity(p, res);

  if (p.startsWith('/api/model/')) {
    const id = parseInt(p.slice('/api/model/'.length), 10);
    if (!Number.isFinite(id)) return sendError(res, 400, 'invalid id');
    const m = findModel(id);
    if (!m) return sendError(res, 404, 'model not found');
    return sendJson(res, 200, m);
  }

  if (p === '/api/search') return handleSearch(url, res);

  if (p === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      items: getIndex('items').size,
      npcs: getIndex('npcs').size,
      objects: getIndex('objects').size,
    });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  getIndex('items');
  getIndex('npcs');
  getIndex('objects');
  console.log(`[inspector] http://localhost:${PORT}`);
});
