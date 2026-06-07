package com.clansocket.extractor.data;

import com.bestbudz.rendering.model.Model;
import org.jspecify.annotations.Nullable;

/**
 * Generic model builder for non-item entities (objects, NPCs). Mirrors
 * ItemModelBuilder.getStackedModel without the stack-template handling —
 * just loads a single model id, applies recolor/lighting, returns a lit Model.
 */
public final class EntityModelBuilder {

  private EntityModelBuilder() {}

  private static final int IDENTITY_RESIZE = 128;
  private static final int RESIZE_SHIFT = 7;

  public static @Nullable Model build(
      int modelId,
      int[] recolorFind, int[] recolorReplace,
      int ambient, int contrast,
      int resizeX, int resizeY, int resizeZ) {
    if (modelId <= 0) return null;

    Model model = ModelLoader.load(modelId);
    if (model == null) return null;

    if (resizeX != IDENTITY_RESIZE || resizeY != IDENTITY_RESIZE || resizeZ != IDENTITY_RESIZE) {
      int vc = model.vertexCount;
      for (int i = 0; i < vc; i++) {
        model.verticesX[i] = (model.verticesX[i] * resizeX) >> RESIZE_SHIFT;
        model.verticesY[i] = (model.verticesY[i] * resizeY) >> RESIZE_SHIFT;
        model.verticesZ[i] = (model.verticesZ[i] * resizeZ) >> RESIZE_SHIFT;
      }
    }

    if (recolorFind != null && recolorReplace != null) {
      int n = Math.min(recolorFind.length, recolorReplace.length);
      for (int i = 0; i < n; i++) {
        model.replaceColor(recolorFind[i], recolorReplace[i]);
      }
    }

    ItemLighter.applyLighting(model, ambient, contrast);
    return model;
  }
}
