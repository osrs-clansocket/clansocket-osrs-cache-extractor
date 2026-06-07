/**
 * Typed entity loader.
 *
 *   loadEntity('items',   id) → { type, def, model, modelIds }
 *   loadEntity('npcs',    id) → { type, def, model, modelIds }
 *   loadEntity('objects', id) → { type, def, model, modelIds }
 *
 * Each entity may reference 1-N models. Multi-model entities (NPCs with
 * head + torso, multi-part objects) are MERGED into a single composite
 * model BEFORE lighting — vertex-normal accumulation has to cross sub-mesh
 * boundaries to get smooth shading at the seams.
 *
 * Color-replacement field names differ per type:
 *   items + npcs → colorFind / colorReplace
 *   objects      → recolorToFind / recolorToReplace
 */

import { applyLighting, applyColorReplacements } from './lighting.js';

const TYPE_CONFIG = {
  items: {
    modelIds: def => [def.inventoryModel],
    colorFind: 'colorFind',
    colorReplace: 'colorReplace',
  },
  npcs: {
    modelIds: def => def.models || [],
    colorFind: 'colorFind',
    colorReplace: 'colorReplace',
  },
  objects: {
    modelIds: def => def.modelIds || [],
    colorFind: 'recolorToFind',
    colorReplace: 'recolorToReplace',
  },
};

function mergeModels(models) {
  if (models.length === 1) {
    const m = models[0];
    return {
      id: m.id,
      vertices: m.vertices.map(v => [v[0], v[1], v[2]]),
      faces: m.faces.map(f => ({
        a: f.a, b: f.b, c: f.c,
        color: f.color,
        info: f.info,
        alpha: f.alpha || 0,
        priority: f.priority || 0,
      })),
    };
  }
  const out = { id: 0, vertices: [], faces: [] };
  for (const m of models) {
    const offset = out.vertices.length;
    for (const v of m.vertices) out.vertices.push([v[0], v[1], v[2]]);
    for (const f of m.faces) {
      out.faces.push({
        a: f.a + offset,
        b: f.b + offset,
        c: f.c + offset,
        color: f.color,
        info: f.info,
        alpha: f.alpha || 0,
        priority: f.priority || 0,
      });
    }
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `${url} → ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

export async function loadEntity(type, id) {
  const cfg = TYPE_CONFIG[type];
  if (!cfg) throw new Error('unknown type: ' + type);
  const def = await fetchJson(`/api/entity/${type}/${id}`);
  const modelIds = cfg.modelIds(def).filter(x => Number.isFinite(x) && x >= 0);
  if (modelIds.length === 0) throw new Error(`${type} ${id} has no models`);

  const rawModels = [];
  for (const mid of modelIds) {
    rawModels.push(await fetchJson(`/api/model/${mid}`));
  }
  const merged = mergeModels(rawModels);
  applyColorReplacements(merged, def[cfg.colorFind], def[cfg.colorReplace]);
  applyLighting(merged, def.ambient || 0, def.contrast || 0);
  merged.id = modelIds.length === 1 ? modelIds[0] : `${modelIds[0]}+${modelIds.length - 1}`;
  return { type, def, model: merged, modelIds };
}

export async function searchEntities(type, q) {
  const res = await fetch(`/api/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return res.json();
}
