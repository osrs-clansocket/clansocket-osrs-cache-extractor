package com.bestbudz.engine.texture;

import com.google.gson.Gson;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.Reader;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.lwjgl.BufferUtils;

/**
 * CPU-side storage for OSRS textures.
 *
 * Expected layout (output of pipeline/lossless/extract-textures.mjs):
 *   &lt;textureDir&gt;/TextureIndex-0.json   array of {id, width, height, file}
 *   &lt;textureDir&gt;/model/&lt;id&gt;.png       per-texture PNGs (OSRS-native sizes, 17x18-ish)
 *
 * Source PNGs are tiny (OSRS native dimensions). We upscale to a uniform
 * LAYER_SIZE on load so all layers in the GL_TEXTURE_2D_ARRAY have the same
 * footprint (a hard OpenGL requirement). 128x128 strikes the balance: large
 * enough that texture detail remains visible at our 256px render resolution,
 * small enough that loading ~200 textures fits in well under 100MB.
 *
 * IDs in TextureIndex are non-contiguous (e.g. "11" is missing in the sample) —
 * we allocate textureRgba[maxId+1] and leave missing slots null. textureAmount
 * tracks (maxId + 1) so GPUIconRenderer's range check at line 259 of the
 * BestBudz copy works as designed:
 *   if (textureId &gt;= 0 &amp;&amp; textureId &lt; TextureStore.textureAmount) ...
 */
public final class TextureStore {

  public static final int LAYER_SIZE = 128;

  public static int textureAmount;
  public static ByteBuffer[] textureRgba = new ByteBuffer[0];
  public static int[] textureWidths = new int[0];
  public static int[] textureHeights = new int[0];

  private TextureStore() {}

  public static boolean isTexturePresent(int id) {
    return id >= 0 && id < textureAmount && textureRgba[id] != null;
  }

  public static void loadFromIndex(Path textureDir, Path indexJson) throws IOException {
    if (!Files.isRegularFile(indexJson)) {
      throw new IOException("TextureIndex not found: " + indexJson);
    }
    TextureEntry[] entries;
    try (Reader reader = Files.newBufferedReader(indexJson)) {
      entries = new Gson().fromJson(reader, TextureEntry[].class);
    }
    if (entries == null) entries = new TextureEntry[0];

    int maxId = -1;
    for (TextureEntry e : entries) {
      int id = e.parsedId();
      if (id > maxId) maxId = id;
    }
    textureAmount = maxId + 1;
    textureRgba = new ByteBuffer[textureAmount];
    textureWidths = new int[textureAmount];
    textureHeights = new int[textureAmount];

    int loaded = 0;
    int failed = 0;
    for (TextureEntry e : entries) {
      int id = e.parsedId();
      if (id < 0) continue;
      Path png = textureDir.resolve(e.file);
      if (!Files.isRegularFile(png)) {
        failed++;
        continue;
      }
      try {
        textureRgba[id] = loadAndUpscale(png);
        textureWidths[id] = LAYER_SIZE;
        textureHeights[id] = LAYER_SIZE;
        loaded++;
      } catch (IOException ioe) {
        failed++;
        System.err.println("[TextureStore] failed to load " + png + ": " + ioe.getMessage());
      }
    }

    System.out.println("[TextureStore] loaded " + loaded + " textures (" + failed
        + " failed/missing); textureAmount=" + textureAmount);
  }

  private static ByteBuffer loadAndUpscale(Path png) throws IOException {
    BufferedImage src = ImageIO.read(png.toFile());
    if (src == null) {
      throw new IOException("ImageIO.read returned null for " + png);
    }
    BufferedImage scaled = new BufferedImage(LAYER_SIZE, LAYER_SIZE, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = scaled.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.drawImage(src, 0, 0, LAYER_SIZE, LAYER_SIZE, null);
    g.dispose();

    ByteBuffer buf = BufferUtils.createByteBuffer(LAYER_SIZE * LAYER_SIZE * 4);
    int[] argb = new int[LAYER_SIZE * LAYER_SIZE];
    scaled.getRGB(0, 0, LAYER_SIZE, LAYER_SIZE, argb, 0, LAYER_SIZE);
    for (int pixel : argb) {
      buf.put((byte) ((pixel >> 16) & 0xFF));
      buf.put((byte) ((pixel >> 8) & 0xFF));
      buf.put((byte) (pixel & 0xFF));
      buf.put((byte) ((pixel >> 24) & 0xFF));
    }
    buf.flip();
    return buf;
  }

  private static final class TextureEntry {
    String id;
    int width;
    int height;
    String file;

    int parsedId() {
      try { return Integer.parseInt(id); } catch (Exception e) { return -1; }
    }
  }
}
