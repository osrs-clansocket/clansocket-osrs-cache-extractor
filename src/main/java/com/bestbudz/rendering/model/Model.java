package com.bestbudz.rendering.model;

/**
 * Simplified Model — data fields only.
 *
 * The BestBudz client's Model class extends Renderable and carries animation +
 * FlatBuffer construction infrastructure. For ClanSocket's icon extractor we only
 * need the public fields that GPUIconRenderer.renderModelToPixels reads
 * (vertexCount + verticesX/Y/Z, triangleCount + faceVertexA/B/C, faceColors,
 * faceInfo, faceAlpha, lit + litColorA/B/C, textureFaceA/B/C + textureFaceCount),
 * plus modelHeight (used by the extractor to position the model in the icon frame)
 * and replaceColor (used by ItemModelBuilder when applying ItemDef.colorFind /
 * ItemDef.colorReplace recolor arrays).
 *
 * No inheritance, no FlatBuffer decode, no animation methods, no lighting math —
 * those concerns belong upstream of the renderer. Lighting is pre-baked at JSON
 * load time by copying faceColors into litColorA/B/C[] (flat shading; see
 * ModelLoader). Textured faces fall back to a neutral colour because our texture
 * stubs report textureAmount=0 and GPUTextureManager.isInitialized()=false.
 */
public final class Model {

  public int vertexCount;
  public int[] verticesX = new int[0];
  public int[] verticesY = new int[0];
  public int[] verticesZ = new int[0];

  public int triangleCount;
  public int[] faceVertexA = new int[0];
  public int[] faceVertexB = new int[0];
  public int[] faceVertexC = new int[0];

  public boolean lit;
  public int[] litColorA = new int[0];
  public int[] litColorB = new int[0];
  public int[] litColorC = new int[0];
  public int[] litColorBackA = new int[0];
  public int[] litColorBackB = new int[0];
  public int[] litColorBackC = new int[0];

  public int[] faceInfo = new int[0];
  public int[] facePriorities = new int[0];
  public int[] faceAlpha = new int[0];
  public int[] faceColors = new int[0];

  public int defaultPriority;

  public int textureFaceCount;
  public int[] textureFaceA = new int[0];
  public int[] textureFaceB = new int[0];
  public int[] textureFaceC = new int[0];

  public int modelHeight = 1000;
  public int maxY;

  public Model() {}

  public void replaceColor(int find, int replace) {
    for (int i = 0; i < faceColors.length; i++) {
      if (faceColors[i] == find) faceColors[i] = replace;
    }
  }
}
