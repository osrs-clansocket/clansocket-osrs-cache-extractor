package com.clansocket.extractor.data;

import java.util.Arrays;

/**
 * Item definition — JSON-loadable POJO matching the OSRS-native field shape
 * emitted by pipeline/lossless/extract-raw.mjs (port of net.runelite.cache's
 * ItemLoader) into raw/configs/Items-N.json chunks.
 *
 * Field names mirror RuneLite's ItemDefinition exactly — no @SerializedName
 * bridging, no BestBudz-317 renames. Gson maps JSON keys to fields by exact
 * name; missing fields keep the defaults declared here. Extras in the JSON
 * (groundOps, interfaceOptions, weight, cost, isMembers, wearPos*, maleModel*,
 * femaleModel*, etc.) are silently ignored when no matching field exists —
 * that's the intentional contract; this POJO declares only what the icon
 * extractor actually consumes.
 */
public final class ItemDef {

  public int id;
  public String name = "";
  public String examine = "";

  public int inventoryModel;
  public int zoom2d = 2000;
  public int xan2d;
  public int yan2d;
  public int zan2d;
  public int xOffset2d;
  public int yOffset2d;

  public int[] colorFind = new int[0];
  public int[] colorReplace = new int[0];
  public int[] textureFind = new int[0];
  public int[] textureReplace = new int[0];

  public int stackable;
  public int[] countObj;
  public int[] countCo;

  public int notedID = -1;
  public int notedTemplate = -1;
  public int placeholderId = -1;
  public int placeholderTemplateId = -1;
  public int boughtId = -1;
  public int boughtTemplateId = -1;

  public int resizeX = 128;
  public int resizeY = 128;
  public int resizeZ = 128;

  public int ambient;
  public int contrast;

  public boolean hasRenderableModel() {
    return inventoryModel > 0;
  }

  public int pickStackedModelId(int amount) {
    if (amount <= 1 || stackable == 0 || countObj == null || countCo == null) {
      return inventoryModel;
    }
    int pick = -1;
    int n = Math.min(countObj.length, countCo.length);
    for (int i = 0; i < n; i++) {
      if (amount >= countCo[i] && countCo[i] != 0) {
        pick = countObj[i];
      }
    }
    return pick > 0 ? pick : inventoryModel;
  }

  @Override
  public String toString() {
    return "ItemDef{id=" + id + ", name='" + name + "', inventoryModel=" + inventoryModel
        + ", zoom2d=" + zoom2d + ", rot=(" + xan2d + "," + yan2d + "," + zan2d + ")"
        + ", offset=(" + xOffset2d + "," + yOffset2d + ")"
        + ", colorFind=" + Arrays.toString(colorFind)
        + ", colorReplace=" + Arrays.toString(colorReplace)
        + "}";
  }
}
