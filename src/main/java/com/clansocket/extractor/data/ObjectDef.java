package com.clansocket.extractor.data;

/**
 * Object definition for inventory-style icon rendering. Field names mirror the
 * keys in extracted Objects-N.json (decoded by pipeline/lossless from cache
 * index 2 / archive 6) — Gson populates by name match.
 */
public final class ObjectDef {

  public int id;
  public String name = "";

  public int[] modelIds = new int[0];
  public int[] modelTypes = new int[0];

  public int[] recolorToFind = new int[0];
  public int[] recolorToReplace = new int[0];
  public int[] retextureToFind = new int[0];
  public int[] textureToReplace = new int[0];

  public int ambient;
  public int contrast;

  public int modelSizeX = 128;
  public int modelSizeY = 128;
  public int modelSizeHeight = 128;

  public boolean hasRenderableModel() {
    return modelIds != null && modelIds.length > 0 && modelIds[0] > 0;
  }

  public int firstModelId() {
    if (modelIds == null || modelIds.length == 0) return -1;
    return modelIds[0];
  }
}
