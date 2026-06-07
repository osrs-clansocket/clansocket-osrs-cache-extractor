package com.clansocket.extractor.data;

import com.bestbudz.rendering.model.Model;
import org.jspecify.annotations.Nullable;

/**
 * Builds a lit Model for an ItemDef + stack-amount pair — mirrors
 * net.runelite.cache.item.ItemSpriteFactory.getModel + .light call sequence.
 *
 * Per-item transforms applied in order:
 *   1. resize(resizeX/Y/Z) when any axis != 128 — scales vertices by axis/128
 *      (matches RuneLite ModelDefinition.resize, shift-right-7).
 *   2. recolor(colorFind, colorReplace) — replaceColor pairs. Both sides are
 *      HSL16 unsigned shorts (lossless extraction); direct match against
 *      model.faceColors which now holds HSL16 too.
 *   3. ItemLighter.applyLighting(ambient, contrast) — per-vertex gouraud
 *      lighting in HSL16 space, palette-converted to RGB at face time. Three
 *      distinct lit colors per face → real gouraud interpolation when the
 *      renderer reads litColorA/B/C.
 *
 * ModelLoader returns a fresh Model per call so vertex/color mutation here
 * doesn't affect other items that share the same model id.
 */
public final class ItemModelBuilder {

  private ItemModelBuilder() {}

  private static final int IDENTITY_RESIZE = 128;
  private static final int RESIZE_SHIFT = 7;

  public static @Nullable Model getStackedModel(ItemDef def, int amount) {
    if (def == null) return null;
    int targetId = def.pickStackedModelId(amount);
    if (targetId <= 0) return null;

    Model model = ModelLoader.load(targetId);
    if (model == null) return null;

    if (def.resizeX != IDENTITY_RESIZE || def.resizeY != IDENTITY_RESIZE || def.resizeZ != IDENTITY_RESIZE) {
      resize(model, def.resizeX, def.resizeY, def.resizeZ);
    }

    int recolorCount = Math.min(def.colorFind.length, def.colorReplace.length);
    for (int i = 0; i < recolorCount; i++) {
      model.replaceColor(def.colorFind[i], def.colorReplace[i]);
    }

    ItemLighter.applyLighting(model, def.ambient, def.contrast);

    return model;
  }

  private static void resize(Model model, int resizeX, int resizeY, int resizeZ) {
    int vc = model.vertexCount;
    for (int i = 0; i < vc; i++) {
      model.verticesX[i] = (model.verticesX[i] * resizeX) >> RESIZE_SHIFT;
      model.verticesY[i] = (model.verticesY[i] * resizeY) >> RESIZE_SHIFT;
      model.verticesZ[i] = (model.verticesZ[i] * resizeZ) >> RESIZE_SHIFT;
    }
  }
}
