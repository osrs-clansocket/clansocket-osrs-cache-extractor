package com.clansocket.extractor;

import com.bestbudz.engine.gpu.GPUIconRenderer;
import com.bestbudz.engine.texture.GPUTextureManager;
import com.bestbudz.engine.texture.TextureStore;
import com.bestbudz.rendering.model.Model;
import com.clansocket.extractor.data.EntityModelBuilder;
import com.clansocket.extractor.data.ModelLoader;
import com.clansocket.extractor.data.NpcDef;
import com.clansocket.extractor.data.NpcDefLoader;
import com.clansocket.extractor.data.ObjectDef;
import com.clansocket.extractor.data.ObjectDefLoader;

import java.awt.image.BufferedImage;
import java.io.IOException;
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
 * Renders OSRS object/NPC defs to PNG icons using the same GPU pipeline as
 * items. Output goes to game_objects_xl/ or game_npcs_xl/ depending on --type.
 *
 *   ./gradlew extractObjects   → renders every ObjectDef with modelIds
 *   ./gradlew extractNpcs      → renders every NpcDef with models
 *
 * For v1, multi-model entities render only the first model id (no merge).
 */
public final class ClanSocketEntitySpriteExtractor {

  private ClanSocketEntitySpriteExtractor() {}

  private static final int DEFAULT_RENDER_SIZE = 8192;
  private static final int[] DEFAULT_SIZES = {1024};
  private static final double RS2_ANGLE_TO_RADIANS = Math.PI * 2.0 / 2048.0;
  private static final int PROGRESS_STEP = 500;
  private static final int PNG_WORKER_THREADS = 16;
  private static final int SHUTDOWN_WAIT_MINUTES = 30;

  // Eight-angle render: 4 orthogonal + 4 diagonal (45° between each ortho pair).
  // Diagonal views capture two sides + top in one snap. yan2d rotates the model
  // around its vertical axis; xan2d=128 elevates the camera ~22.5° — slight high
  // angle that keeps the NPC's face clearly visible while showing a bit of top.
  private static final int DEFAULT_XAN2D = 128;
  private static final int DEFAULT_ZAN2D = 0;
  private static final String[] FACE_NAMES = {"front", "front-right", "right"};
  private static final int[] FACE_YAN2D = {0, 256, 512};

  enum EntityType { OBJECT, NPC }

  public static void main(String[] args) throws Exception {
    EntityType type = EntityType.OBJECT;
    Path defsDir = null;
    Path modelsDir = null;
    Path texturesDir = null;
    Path outputDir = null;
    int renderSize = DEFAULT_RENDER_SIZE;
    int[] sizes = DEFAULT_SIZES;
    int limit = -1;

    for (int i = 0; i < args.length; i++) {
      String a = args[i];
      switch (a) {
        case "--type":
          String t = args[++i].toLowerCase();
          type = t.equals("npc") ? EntityType.NPC : EntityType.OBJECT;
          break;
        case "--defs":     defsDir = Paths.get(args[++i]).toAbsolutePath(); break;
        case "--models":   modelsDir = Paths.get(args[++i]).toAbsolutePath(); break;
        case "--textures": texturesDir = Paths.get(args[++i]).toAbsolutePath(); break;
        case "--output":   outputDir = Paths.get(args[++i]).toAbsolutePath(); break;
        case "--render-size": renderSize = Integer.parseInt(args[++i]); break;
        case "--sizes": {
          String[] parts = args[++i].split(",");
          sizes = new int[parts.length];
          for (int k = 0; k < parts.length; k++) sizes[k] = Integer.parseInt(parts[k].trim());
          break;
        }
        case "--limit": limit = Integer.parseInt(args[++i]); break;
        default: break;
      }
    }

    Path workspaceRoot = Paths.get("").toAbsolutePath();
    Path extractedRoot = workspaceRoot.resolve("extracted_osrs_cache").resolve("raw");
    if (defsDir == null) defsDir = extractedRoot.resolve("configs");
    if (modelsDir == null) modelsDir = extractedRoot.resolve("models");
    if (texturesDir == null) texturesDir = extractedRoot.resolve("textures");
    if (outputDir == null) {
      String folder = (type == EntityType.NPC) ? "game_npcs_xl" : "game_objects_xl";
      outputDir = workspaceRoot.resolve("../clansocket-app/public/resources/osrs/" + folder).normalize();
    }

    int outputSize = 0;
    for (int s : sizes) if (s > outputSize) outputSize = s;
    if (outputSize <= 0) outputSize = renderSize;

    String tag = "[ClanSocket" + (type == EntityType.NPC ? "Npc" : "Object") + "SpriteExtractor]";
    System.out.println(tag + " type:     " + type);
    System.out.println(tag + " defs:     " + defsDir);
    System.out.println(tag + " models:   " + modelsDir);
    System.out.println(tag + " textures: " + texturesDir);
    System.out.println(tag + " output:   " + outputDir);
    System.out.println(tag + " render:   " + renderSize + " (GPU native)");
    System.out.println(tag + " outSize:  " + outputSize + " (GPU downsample target)");

    for (int s : sizes) {
      for (String face : FACE_NAMES) {
        Files.createDirectories(outputDir.resolve(String.valueOf(s)).resolve(face));
      }
    }

    long startTime = System.currentTimeMillis();
    long window = initGl();
    System.out.println(tag + " OpenGL context ready");

    Path textureIndex = texturesDir.resolve("TextureIndex-0.json");
    if (Files.isRegularFile(textureIndex)) {
      TextureStore.loadFromIndex(texturesDir, textureIndex);
      if (!GPUTextureManager.initialize()) {
        System.err.println(tag + " GPUTextureManager init failed");
      }
    } else {
      System.err.println(tag + " no TextureIndex-0.json at " + textureIndex);
    }

    if (!GPUIconRenderer.initialize()) {
      System.err.println(tag + " GPUIconRenderer.initialize() failed");
      GPUTextureManager.cleanup();
      cleanupGl(window);
      System.exit(1);
    }

    ModelLoader.initialize(modelsDir);

    int rendered = 0;
    int skipped = 0;
    int[] basePixels = new int[outputSize * outputSize];
    ExecutorService pngWriters = Executors.newFixedThreadPool(PNG_WORKER_THREADS);

    if (type == EntityType.OBJECT) {
      Map<Integer, ObjectDef> defs = ObjectDefLoader.loadAll(defsDir);
      System.out.println(tag + " loaded " + defs.size() + " object definitions");
      for (ObjectDef def : defs.values()) {
        if (!def.hasRenderableModel()) { skipped++; continue; }
        boolean anyRendered = false;
        for (int fi = 0; fi < FACE_NAMES.length; fi++) {
          try {
            if (renderEntity(def.firstModelId(),
                def.recolorToFind, def.recolorToReplace,
                def.ambient, def.contrast,
                def.modelSizeX, def.modelSizeHeight, def.modelSizeY,
                FACE_YAN2D[fi],
                basePixels, renderSize, outputSize)) {
              int[] pixelsCopy = basePixels.clone();
              int id = def.id;
              String entName = def.name;
              int outSize2 = outputSize;
              int[] sizes2 = sizes;
              Path outDir = outputDir;
              String faceName = FACE_NAMES[fi];
              pngWriters.submit(() -> encodeAndWrite(pixelsCopy, id, entName, faceName, outSize2, sizes2, outDir));
              anyRendered = true;
            }
          } catch (Exception ex) {
            System.err.println(tag + " id=" + def.id + " face=" + FACE_NAMES[fi] + " error: " + ex.getMessage());
          }
        }
        if (anyRendered) {
          rendered++;
          logProgress(tag, rendered, def.id, startTime);
        } else {
          skipped++;
        }
        if (limit > 0 && rendered >= limit) break;
      }
    } else {
      Map<Integer, NpcDef> defs = NpcDefLoader.loadAll(defsDir);
      System.out.println(tag + " loaded " + defs.size() + " npc definitions");
      for (NpcDef def : defs.values()) {
        if (!def.hasRenderableModel()) { skipped++; continue; }
        boolean anyRendered = false;
        for (int fi = 0; fi < FACE_NAMES.length; fi++) {
          try {
            if (renderEntity(def.firstModelId(),
                def.recolorToFind, def.recolorToReplace,
                def.ambient, def.contrast,
                128, 128, 128,
                FACE_YAN2D[fi],
                basePixels, renderSize, outputSize)) {
              int[] pixelsCopy = basePixels.clone();
              int id = def.id;
              String entName = def.name;
              int outSize2 = outputSize;
              int[] sizes2 = sizes;
              Path outDir = outputDir;
              String faceName = FACE_NAMES[fi];
              pngWriters.submit(() -> encodeAndWrite(pixelsCopy, id, entName, faceName, outSize2, sizes2, outDir));
              anyRendered = true;
            }
          } catch (Exception ex) {
            System.err.println(tag + " id=" + def.id + " face=" + FACE_NAMES[fi] + " error: " + ex.getMessage());
          }
        }
        if (anyRendered) {
          rendered++;
          logProgress(tag, rendered, def.id, startTime);
        } else {
          skipped++;
        }
        if (limit > 0 && rendered >= limit) break;
      }
    }

    System.out.println(tag + " GPU done in "
        + (System.currentTimeMillis() - startTime) + "ms - "
        + rendered + " submitted, " + skipped + " skipped - waiting for PNG writers");

    pngWriters.shutdown();
    pngWriters.awaitTermination(SHUTDOWN_WAIT_MINUTES, TimeUnit.MINUTES);

    long duration = System.currentTimeMillis() - startTime;
    System.out.println(tag + " Done in " + duration + "ms - "
        + rendered + " rendered, " + skipped + " skipped");

    GPUIconRenderer.cleanup();
    GPUTextureManager.cleanup();
    cleanupGl(window);
  }

  private static void logProgress(String tag, int rendered, int lastId, long startTime) {
    if (rendered % PROGRESS_STEP == 0) {
      long elapsed = System.currentTimeMillis() - startTime;
      double rate = rendered * 1000.0 / elapsed;
      System.out.println(tag + "   ... submitted " + rendered
          + " (last id=" + lastId + ", rate=" + String.format("%.1f", rate) + " /sec)");
    }
  }

  private static boolean renderEntity(
      int modelId,
      int[] recolorFind, int[] recolorReplace,
      int ambient, int contrast,
      int resizeX, int resizeY, int resizeZ,
      int yan2d,
      int[] pixels, int renderSize, int outputSize) {

    Model model = EntityModelBuilder.build(
        modelId, recolorFind, recolorReplace,
        ambient, contrast, resizeX, resizeY, resizeZ);
    if (model == null) return false;

    int vc = model.vertexCount;
    if (vc == 0) return false;
    java.util.Arrays.fill(pixels, 0);

    double zRad = DEFAULT_ZAN2D * RS2_ANGLE_TO_RADIANS;
    double xRad = yan2d * RS2_ANGLE_TO_RADIANS;
    double yRad = DEFAULT_XAN2D * RS2_ANGLE_TO_RADIANS;
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

    double targetNdc = 0.85;
    double cameraDepth = maxHalf * 32.0 / targetNdc;
    if (cameraDepth < 100.0) cameraDepth = 100.0;

    int offsetX = (int) Math.round(-rotCx);
    int offsetY = (int) Math.round(-rotCy);
    int offsetZ = (int) Math.round(cameraDepth - rotCz);

    GPUIconRenderer.renderModelToPixels(
        model,
        yan2d, DEFAULT_ZAN2D, DEFAULT_XAN2D,
        offsetX, offsetY, offsetZ,
        pixels,
        renderSize, renderSize,
        outputSize, outputSize);
    return !isEmpty(pixels);
  }

  private static boolean isEmpty(int[] pixels) {
    for (int p : pixels) if (((p >>> 24) & 0xFF) != 0) return false;
    return true;
  }

  private static void encodeAndWrite(int[] pixels, int id, String entName, String faceName, int outputSize, int[] sizes, Path outputDir) {
    try {
      BufferedImage img = new BufferedImage(outputSize, outputSize, BufferedImage.TYPE_INT_ARGB);
      img.setRGB(0, 0, outputSize, outputSize, pixels, 0, outputSize);
      String fileName = com.clansocket.extractor.util.Filenames.pngFor(id, entName);
      for (int s : sizes) {
        BufferedImage scaled;
        if (s == outputSize) {
          scaled = img;
        } else {
          scaled = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
          scaled.getGraphics().drawImage(
              img.getScaledInstance(s, s, java.awt.Image.SCALE_SMOOTH), 0, 0, null);
        }
        Path target = outputDir.resolve(String.valueOf(s)).resolve(faceName).resolve(fileName);
        ImageIO.write(scaled, "PNG", target.toFile());
      }
    } catch (IOException e) {
      System.err.println("[ClanSocketEntitySpriteExtractor] encode/write " + id + " face=" + faceName + ": " + e.getMessage());
    }
  }

  private static long initGl() {
    if (!GLFW.glfwInit()) throw new IllegalStateException("GLFW init failed");
    GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE, GLFW.GLFW_FALSE);
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR, 4);
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR, 6);
    GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE, GLFW.GLFW_OPENGL_CORE_PROFILE);
    long window = GLFW.glfwCreateWindow(64, 64, "headless", 0, 0);
    if (window == 0) throw new IllegalStateException("GLFW window creation failed");
    GLFW.glfwMakeContextCurrent(window);
    GL.createCapabilities();
    return window;
  }

  private static void cleanupGl(long window) {
    if (window != 0) GLFW.glfwDestroyWindow(window);
    GLFW.glfwTerminate();
  }
}
