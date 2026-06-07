package com.clansocket.extractor.data;

/**
 * NPC definition for inventory-style icon rendering. Field names mirror the
 * keys in extracted Npcs-N.json (decoded by pipeline/lossless from cache
 * index 2 / archive 9) — Gson populates by name match.
 */
public final class NpcDef {

  public int id;
  public String name = "";

  public int[] models = new int[0];
  public int[] chatheadModels = new int[0];

  public int[] recolorToFind = new int[0];
  public int[] recolorToReplace = new int[0];
  public int[] retextureToFind = new int[0];
  public int[] textureToReplace = new int[0];

  public int ambient;
  public int contrast;

  public int size = 1;

  public boolean hasRenderableModel() {
    return models != null && models.length > 0 && models[0] > 0;
  }

  public int firstModelId() {
    if (models == null || models.length == 0) return -1;
    return models[0];
  }
}
