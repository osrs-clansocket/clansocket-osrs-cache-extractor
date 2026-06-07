package com.clansocket.extractor;

import com.bestbudz.engine.gpu.GPUIconRenderer;
import com.bestbudz.engine.texture.GPUTextureManager;
import com.bestbudz.engine.texture.TextureStore;
import com.bestbudz.rendering.model.Model;
import com.clansocket.extractor.data.ItemDef;
import com.clansocket.extractor.data.ItemDefLoader;
import com.clansocket.extractor.data.ItemModelBuilder;
import com.clansocket.extractor.data.ModelLoader;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;

/**
 * OSRS item-icon extractor — renders each lossless item def via LWJGL3 OpenGL.
 *
 * Render pipeline (per item):
 *   1. GPU renders at native renderSize × renderSize into an MSAA 8x FBO.
 *   2. MSAA blit-resolve to single-sample FBO at renderSize.
 *   3. GPU downsample (glBlitFramebuffer with GL_LINEAR) to outputFbo at
 *      outputSize × outputSize. Output size = max of cfg.sizes — GPU handles
 *      the heavy supersample reduction, CPU never touches the 16-64 MB
 *      renderSize buffer.
 *   4. glReadPixels at outputSize (1-4 MB transfer, fast).
 *   5. Submit to 16-worker PNG thread pool: BufferedImage via DataBufferInt
 *      System.arraycopy (no setRGB), then Java2D bicubic downsample to any
 *      smaller --sizes tiers.
 *
 * For --render-size 4096 --sizes 512: 8× supersample, GPU downsample, single
 * 4 MB readback per item. Net throughput ≫ CPU-side downsample on giant buffers.
 *
 * Template recursion mirrors net.runelite.cache.item.ItemSpriteFactory.
 *
 * CLI args:
 *   --items-dir &lt;path&gt;     items chunk dir (default: extracted_osrs_cache/raw/configs)
 *   --models-dir &lt;path&gt;    models chunk dir (default: extracted_osrs_cache/raw/models)
 *   --textures-dir &lt;path&gt;  textures dir (default: extracted_osrs_cache/raw/textures)
 *   --output &lt;path&gt;        output base dir
 *   --render-size &lt;n&gt;      GPU native render resolution (default 1024)
 *   --sizes 32,64,128,256  pyramid output sizes; max(sizes) is the GPU readback resolution
 *   --limit &lt;n&gt;            stop after N items rendered (smoke-test flag; default: render all)
 */
public final class ClanSocketItemSpriteExtractor {

  private ClanSocketItemSpriteExtractor() {}

  private static final int DEFAULT_RENDER_SIZE = 8192;
  private static final int[] DEFAULT_SIZES = {1024};
  private static final double RS2_ANGLE_TO_RADIANS = Math.PI * 2.0 / 2048.0;
  private static final int PROGRESS_STEP = 500;
  private static final int PNG_WORKER_THREADS = 16;
  private static final int SHUTDOWN_WAIT_MINUTES = 30;
  private static final int NOTED_STACK_QUANTITY = 10;
  private static final double NOTED_ZOOM_BOOST = 1.7;
  private static final double NOTED_Y_BIAS_NDC = -0.08;

  public static void main(String[] args) throws Exception {
    Config cfg = Config.parse(args);

    int outputSize = 0;
    for (int s : cfg.sizes) if (s > outputSize) outputSize = s;
    if (outputSize <= 0) outputSize = cfg.renderSize;

    System.out.println("[ClanSocketItemSpriteExtractor] items:    " + cfg.itemsDir);
    System.out.println("[ClanSocketItemSpriteExtractor] models:   " + cfg.modelsDir);
    System.out.println("[ClanSocketItemSpriteExtractor] textures: " + cfg.texturesDir);
    System.out.println("[ClanSocketItemSpriteExtractor] output:   " + cfg.outputDir);
    System.out.println("[ClanSocketItemSpriteExtractor] render:   " + cfg.renderSize + " (GPU native)");
    System.out.println("[ClanSocketItemSpriteExtractor] outSize:  " + outputSize + " (GPU downsample target)");
    StringBuilder sizes = new StringBuilder();
    for (int s : cfg.sizes) { if (sizes.length() > 0) sizes.append(','); sizes.append(s); }
    System.out.println("[ClanSocketItemSpriteExtractor] sizes:    " + sizes);

    for (int s : cfg.sizes) {
      Files.createDirectories(cfg.outputDir.resolve(String.valueOf(s)));
    }

    long startTime = System.currentTimeMillis();

    long window = initGl();
    System.out.println("[ClanSocketItemSpriteExtractor] OpenGL context ready");

    Path textureIndex = cfg.texturesDir.resolve("TextureIndex-0.json");
    if (Files.isRegularFile(textureIndex)) {
      TextureStore.loadFromIndex(cfg.texturesDir, textureIndex);
      if (!GPUTextureManager.initialize()) {
        System.err.println("[ClanSocketItemSpriteExtractor] GPUTextureManager init failed");
      }
    } else {
      System.err.println("[ClanSocketItemSpriteExtractor] no TextureIndex-0.json at " + textureIndex
          + " — textured items render with placeholder grey");
    }

    if (!GPUIconRenderer.initialize()) {
      System.err.println("[ClanSocketItemSpriteExtractor] GPUIconRenderer.initialize() failed");
      GPUTextureManager.cleanup();
      cleanupGl(window);
      System.exit(1);
    }

    Map<Integer, ItemDef> items = ItemDefLoader.loadAll(cfg.itemsDir);
    ModelLoader.initialize(cfg.modelsDir);
    System.out.println("[ClanSocketItemSpriteExtractor] loaded " + items.size() + " item definitions");

    ExecutorService pngWriters = Executors.newFixedThreadPool(PNG_WORKER_THREADS);
    int rendered = 0;
    int skipped = 0;
    int renderSize = cfg.renderSize;
    int[] basePixels = new int[outputSize * outputSize];
    int[] auxPixels = new int[outputSize * outputSize];
    int[] sizes2 = cfg.sizes;
    int outSize2 = outputSize;
    Path outputDir = cfg.outputDir;

    for (ItemDef def : items.values()) {
      try {
        if (renderItemWithTemplates(def, items, basePixels, auxPixels, renderSize, outputSize) && !isEmpty(basePixels)) {
          int[] pixelsCopy = basePixels.clone();
          int itemId = def.id;
          String itemName = def.name;
          pngWriters.submit(() -> encodeAndWrite(pixelsCopy, itemId, itemName, outSize2, sizes2, outputDir));
          rendered++;
          if (rendered % PROGRESS_STEP == 0) {
            long elapsed = System.currentTimeMillis() - startTime;
            double rate = rendered * 1000.0 / elapsed;
            System.out.println("[ClanSocketItemSpriteExtractor]   ... submitted " + rendered
                + " (last id=" + def.id + ", rate=" + String.format("%.1f", rate) + " items/sec)");
          }
        } else {
          skipped++;
        }
      } catch (Exception ex) {
        skipped++;
        System.err.println("[ClanSocketItemSpriteExtractor] id=" + def.id + " error: " + ex.getMessage());
      }
      if (cfg.limit > 0 && rendered >= cfg.limit) break;
    }

    System.out.println("[ClanSocketItemSpriteExtractor] GPU done in "
        + (System.currentTimeMillis() - startTime) + "ms — "
        + rendered + " submitted, " + skipped + " skipped — waiting for PNG writers");

    pngWriters.shutdown();
    pngWriters.awaitTermination(SHUTDOWN_WAIT_MINUTES, TimeUnit.MINUTES);

    long duration = System.currentTimeMillis() - startTime;
    System.out.println("[ClanSocketItemSpriteExtractor] Done in " + duration + "ms — "
        + rendered + " rendered, " + skipped + " skipped");

    GPUIconRenderer.cleanup();
    GPUTextureManager.cleanup();
    cleanupGl(window);
  }

  private static boolean renderItemWithTemplates(
      ItemDef def, Map<Integer, ItemDef> items,
      int[] basePixels, int[] auxPixels, int renderSize, int outputSize) {
    if (def.notedTemplate != -1 && def.notedID >= 0) {
      ItemDef templateDef = items.get(def.notedTemplate);
      ItemDef underlyingDef = items.get(def.notedID);
      if (templateDef == null || underlyingDef == null) return false;
      if (!renderItemToBuffer(templateDef, 1, basePixels, renderSize, outputSize, 1.0, 0.0)) return false;
      if (renderItemToBuffer(underlyingDef, NOTED_STACK_QUANTITY, auxPixels, renderSize, outputSize, NOTED_ZOOM_BOOST, NOTED_Y_BIAS_NDC)) {
        overlayOnto(basePixels, auxPixels);
      }
      return true;
    }
    if (def.placeholderTemplateId != -1 && def.placeholderId >= 0) {
      ItemDef templateDef = items.get(def.placeholderTemplateId);
      ItemDef underlyingDef = items.get(def.placeholderId);
      if (templateDef == null || underlyingDef == null) return false;
      if (!renderItemToBuffer(underlyingDef, 1, basePixels, renderSize, outputSize, 1.0, 0.0)) {
        java.util.Arrays.fill(basePixels, 0);
      }
      if (renderItemToBuffer(templateDef, 1, auxPixels, renderSize, outputSize, 1.0, 0.0)) {
        overlayOnto(basePixels, auxPixels);
      }
      return true;
    }
    if (def.boughtTemplateId != -1 && def.boughtId >= 0) {
      ItemDef templateDef = items.get(def.boughtTemplateId);
      ItemDef underlyingDef = items.get(def.boughtId);
      if (templateDef == null || underlyingDef == null) return false;
      if (!renderItemToBuffer(templateDef, 1, basePixels, renderSize, outputSize, 1.0, 0.0)) return false;
      if (renderItemToBuffer(underlyingDef, 1, auxPixels, renderSize, outputSize, 1.0, 0.0)) {
        overlayOnto(basePixels, auxPixels);
      }
      return true;
    }
    if (!def.hasRenderableModel()) return false;
    return renderItemToBuffer(def, 1, basePixels, renderSize, outputSize, 1.0, 0.0);
  }

  private static boolean renderItemToBuffer(ItemDef def, int quantity, int[] pixels,
      int renderSize, int outputSize, double zoomMultiplier, double yBiasNdc) {
    Model model = ItemModelBuilder.getStackedModel(def, quantity);
    if (model == null) return false;
    int vc = model.vertexCount;
    if (vc == 0) return false;
    java.util.Arrays.fill(pixels, 0);

    double zRad = def.zan2d * RS2_ANGLE_TO_RADIANS;
    double xRad = def.yan2d * RS2_ANGLE_TO_RADIANS;
    double yRad = def.xan2d * RS2_ANGLE_TO_RADIANS;
    double sinZf = Math.sin(zRad), cosZf = Math.cos(zRad);
    double sinXf = Math.sin(xRad), cosXf = Math.cos(xRad);
    double sinYf = Math.sin(yRad), cosYf = Math.cos(yRad);

    boolean[] vertUsed = new boolean[vc];
    int fc = model.triangleCount;
    for (int f = 0; f < fc; f++) {
      int a = model.faceVertexA[f], b = model.faceVertexB[f], c = model.faceVertexC[f];
      if (a >= 0 && a < vc) vertUsed[a] = true;
      if (b >= 0 && b < vc) vertUsed[b] = true;
      if (c >= 0 && c < vc) vertUsed[c] = true;
    }

    double rotMinX = Double.MAX_VALUE, rotMinY = Double.MAX_VALUE, rotMinZ = Double.MAX_VALUE;
    double rotMaxX = -Double.MAX_VALUE, rotMaxY = -Double.MAX_VALUE, rotMaxZ = -Double.MAX_VALUE;
    for (int i = 0; i < vc; i++) {
      if (!vertUsed[i]) continue;
      double vx = model.verticesX[i];
      double vy = model.verticesY[i];
      double vz = model.verticesZ[i];
      double t1 = vy * sinZf + vx * cosZf;
      vy = vy * cosZf - vx * sinZf;
      vx = t1;
      t1 = vz * sinXf + vx * cosXf;
      vz = vz * cosXf - vx * sinXf;
      vx = t1;
      t1 = vy * cosYf - vz * sinYf;
      vz = vy * sinYf + vz * cosYf;
      vy = t1;
      vx = -vx; vz = -vz;
      if (vx < rotMinX) rotMinX = vx; if (vx > rotMaxX) rotMaxX = vx;
      if (vy < rotMinY) rotMinY = vy; if (vy > rotMaxY) rotMaxY = vy;
      if (vz < rotMinZ) rotMinZ = vz; if (vz > rotMaxZ) rotMaxZ = vz;
    }

    double rotCx = (rotMinX + rotMaxX) * 0.5;
    double rotCy = (rotMinY + rotMaxY) * 0.5;
    double rotCz = (rotMinZ + rotMaxZ) * 0.5;
    double halfX = Math.max(rotMaxX - rotCx, rotCx - rotMinX);
    double halfY = Math.max(rotMaxY - rotCy, rotCy - rotMinY);
    double maxHalf = Math.max(halfX, halfY);

    double targetNdc = 0.85 / zoomMultiplier;
    double cameraDepth = maxHalf * 32.0 / targetNdc;
    if (cameraDepth < 100.0) cameraDepth = 100.0;

    double yBiasModel = yBiasNdc * cameraDepth / 32.0;
    int offsetX = (int) Math.round(-rotCx);
    int offsetY = (int) Math.round(-rotCy + yBiasModel);
    int offsetZ = (int) Math.round(cameraDepth - rotCz);

    GPUIconRenderer.renderModelToPixels(
        model,
        def.yan2d, def.zan2d, def.xan2d,
        offsetX,
        offsetY,
        offsetZ,
        pixels,
        renderSize, renderSize,
        outputSize, outputSize);
    return !isEmpty(pixels);
  }

  private static void overlayOnto(int[] base, int[] overlay) {
    for (int i = 0; i < base.length; i++) {
      int top = overlay[i];
      if (top == 0) continue;
      int topAlpha = (top >>> 24) & 0xFF;
      if (topAlpha == 0) continue;
      int bot = base[i];
      if (topAlpha == 255 || bot == 0) {
        base[i] = top;
        continue;
      }
      int botAlpha = (bot >>> 24) & 0xFF;
      int oneMinusTop = 255 - topAlpha;
      int botContribAlpha = (botAlpha * oneMinusTop + 127) / 255;
      int outAlpha = topAlpha + botContribAlpha;
      if (outAlpha == 0) { base[i] = 0; continue; }
      int topR = (top >> 16) & 0xFF;
      int topG = (top >> 8) & 0xFF;
      int topB = top & 0xFF;
      int botR = (bot >> 16) & 0xFF;
      int botG = (bot >> 8) & 0xFF;
      int botB = bot & 0xFF;
      int outR = (topR * topAlpha + botR * botContribAlpha) / outAlpha;
      int outG = (topG * topAlpha + botG * botContribAlpha) / outAlpha;
      int outB = (topB * topAlpha + botB * botContribAlpha) / outAlpha;
      base[i] = (outAlpha << 24) | (outR << 16) | (outG << 8) | outB;
    }
  }

  private static void encodeAndWrite(int[] pixels, int itemId, String itemName, int outputSize, int[] sizes, Path outputDir) {
    try {
      int[] centered = autoCenter(pixels, outputSize, outputSize);
      BufferedImage base = toTransparentImage(outputSize, outputSize, centered);
      String fileName = com.clansocket.extractor.util.Filenames.pngFor(itemId, itemName);
      for (int s : sizes) {
        BufferedImage out = (s == outputSize) ? base : downsample(base, s);
        Path target = outputDir.resolve(String.valueOf(s)).resolve(fileName);
        ImageIO.write(out, "png", target.toFile());
      }
    } catch (Exception ex) {
      System.err.println("[ClanSocketItemSpriteExtractor] async write id=" + itemId + " error: " + ex.getMessage());
    }
  }

  private static int[] autoCenter(int[] pixels, int w, int h) {
    int minX = w, minY = h, maxX = -1, maxY = -1;
    int alphaThreshold = 32;
    for (int y = 0; y < h; y++) {
      int rowBase = y * w;
      for (int x = 0; x < w; x++) {
        int alpha = (pixels[rowBase + x] >>> 24) & 0xFF;
        if (alpha >= alphaThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return pixels;
    int shiftX = (w - 1 - (minX + maxX)) / 2;
    int shiftY = (h - 1 - (minY + maxY)) / 2;
    if (shiftX == 0 && shiftY == 0) return pixels;
    int[] shifted = new int[w * h];
    int srcMinX = Math.max(0, -shiftX);
    int srcMaxX = Math.min(w, w - shiftX);
    int srcMinY = Math.max(0, -shiftY);
    int srcMaxY = Math.min(h, h - shiftY);
    for (int y = srcMinY; y < srcMaxY; y++) {
      int srcBase = y * w;
      int dstBase = (y + shiftY) * w + shiftX;
      for (int x = srcMinX; x < srcMaxX; x++) {
        shifted[dstBase + x] = pixels[srcBase + x];
      }
    }
    return shifted;
  }

  private static long initGl() {
    if (!GLFW.glfwInit()) {
      throw new IllegalStateException("GLFW init failed");
    }
    GLFW.glfwDefaultWindowHints();
    GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE, GLFW.GLFW_FALSE);
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR, 4);
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR, 6);
    GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE, GLFW.GLFW_OPENGL_CORE_PROFILE);
    GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_FORWARD_COMPAT, GLFW.GLFW_TRUE);
    long window = GLFW.glfwCreateWindow(1, 1, "clansocket-osrs-cache-extractor", 0, 0);
    if (window == 0) {
      GLFW.glfwTerminate();
      throw new IllegalStateException("GLFW window creation failed");
    }
    GLFW.glfwMakeContextCurrent(window);
    GL.createCapabilities();
    return window;
  }

  private static void cleanupGl(long window) {
    if (window != 0) GLFW.glfwDestroyWindow(window);
    GLFW.glfwTerminate();
  }

  private static boolean isEmpty(int[] pixels) {
    for (int p : pixels) if (p != 0) return false;
    return true;
  }

  private static BufferedImage toTransparentImage(int width, int height, int[] pixels) {
    BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    int[] dataBuffer = ((DataBufferInt) img.getRaster().getDataBuffer()).getData();
    System.arraycopy(pixels, 0, dataBuffer, 0, pixels.length);
    return img;
  }

  private static BufferedImage downsample(BufferedImage src, int targetSize) {
    BufferedImage dst = new BufferedImage(targetSize, targetSize, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = dst.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.drawImage(src, 0, 0, targetSize, targetSize, null);
    g.dispose();
    return dst;
  }

  private static final class Config {
    Path itemsDir;
    Path modelsDir;
    Path texturesDir;
    Path outputDir;
    int renderSize = DEFAULT_RENDER_SIZE;
    int[] sizes = DEFAULT_SIZES;
    int limit = -1;

    static Config parse(String[] args) {
      Config c = new Config();
      Path defaultExtractedRoot = Paths.get("").toAbsolutePath().resolve("extracted_osrs_cache");
      c.itemsDir = defaultExtractedRoot.resolve("raw/configs");
      c.modelsDir = defaultExtractedRoot.resolve("raw/models");
      c.texturesDir = defaultExtractedRoot.resolve("raw/textures");
      c.outputDir = Paths.get("").toAbsolutePath().resolve("../clansocket-app/public/resources/osrs/icon_item_ids_xl").normalize();

      for (int i = 0; i < args.length; i++) {
        String arg = args[i];
        switch (arg) {
          case "--items-dir":
            c.itemsDir = Paths.get(args[++i]).toAbsolutePath();
            break;
          case "--models-dir":
            c.modelsDir = Paths.get(args[++i]).toAbsolutePath();
            break;
          case "--textures-dir":
            c.texturesDir = Paths.get(args[++i]).toAbsolutePath();
            break;
          case "--output":
            c.outputDir = Paths.get(args[++i]).toAbsolutePath();
            break;
          case "--render-size":
            c.renderSize = Integer.parseInt(args[++i]);
            break;
          case "--sizes":
            String[] parts = args[++i].split(",");
            int[] s = new int[parts.length];
            for (int j = 0; j < parts.length; j++) s[j] = Integer.parseInt(parts[j].trim());
            c.sizes = s;
            break;
          case "--limit":
            c.limit = Integer.parseInt(args[++i]);
            break;
          default:
            throw new IllegalArgumentException("Unknown argument: " + arg);
        }
      }
      return c;
    }
  }
}
