package com.clansocket.extractor.data;

import com.bestbudz.rendering.model.Model;
import com.google.gson.Gson;
import com.google.gson.stream.JsonReader;
import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;

/**
 * Lazy id-keyed model loader.
 *
 * Models-N.json chunks (output of pipeline/lossless/extract-models.mjs) are
 * scanned once at startup to build an id → chunk path index. Individual models
 * deserialize on demand from the matching chunk — avoids loading 60k+ Model
 * objects at once.
 *
 * JSON shape per model (model-loader.mjs buildFacesRaw output):
 *   { id, format, vertices: [[x,y,z], ...],
 *     faces: [{a,b,c,color,info,alpha,priority}, ...],
 *     defaultPriority?, textureFaces?: [[a,b,c], ...] }
 *
 * faceColors stays HSL16 (raw cache values, no palette conversion at load).
 * Per-item lighting + HSL→RGB happens in ItemLighter.applyLighting, called by
 * ItemModelBuilder after resize + recolor with item.ambient / item.contrast.
 */
public final class ModelLoader {

  private ModelLoader() {}

  private static final Gson GSON = new Gson();

  private static Path modelsDir;
  private static final Map<Integer, JsonModel> jsonById = new HashMap<>();

  public static void initialize(Path dir) throws IOException {
    modelsDir = dir;
    jsonById.clear();
    if (!Files.isDirectory(dir)) {
      throw new IOException("Models directory not found: " + dir);
    }

    long t0 = System.currentTimeMillis();
    int chunkCount = 0;
    try (Stream<Path> stream = Files.list(dir)) {
      List<Path> chunks = stream
          .filter(p -> {
            String fn = p.getFileName().toString().toLowerCase();
            return (fn.startsWith("models-") || fn.startsWith("model-")) && fn.endsWith(".json");
          })
          .sorted()
          .toList();

      for (Path chunk : chunks) {
        loadChunk(chunk);
        chunkCount++;
      }
    }

    long dt = System.currentTimeMillis() - t0;
    System.out.println("[ModelLoader] cached " + jsonById.size() + " models across "
        + chunkCount + " chunks in " + dt + "ms");
  }

  private static void loadChunk(Path chunk) {
    try (Reader reader = Files.newBufferedReader(chunk)) {
      JsonModel[] arr = GSON.fromJson(reader, JsonModel[].class);
      if (arr == null) return;
      for (JsonModel jm : arr) {
        if (jm != null) jsonById.put(jm.id, jm);
      }
    } catch (IOException e) {
      System.err.println("[ModelLoader] failed to load " + chunk + ": " + e.getMessage());
    }
  }

  public static @Nullable Model load(int id) {
    JsonModel jm = jsonById.get(id);
    if (jm == null) return null;
    return materialize(jm);
  }

  private static Model materialize(JsonModel jm) {
    Model m = new Model();

    int vc = jm.vertices != null ? jm.vertices.length : 0;
    m.vertexCount = vc;
    m.verticesX = new int[vc];
    m.verticesY = new int[vc];
    m.verticesZ = new int[vc];
    int minY = Integer.MAX_VALUE;
    int maxY = Integer.MIN_VALUE;
    for (int i = 0; i < vc; i++) {
      int[] v = jm.vertices[i];
      m.verticesX[i] = v[0];
      m.verticesY[i] = v[1];
      m.verticesZ[i] = v[2];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
    }
    if (vc > 0) {
      m.modelHeight = Math.max(1, maxY - minY);
      m.maxY = maxY;
    }

    int fc = jm.faces != null ? jm.faces.length : 0;
    m.triangleCount = fc;
    m.faceVertexA = new int[fc];
    m.faceVertexB = new int[fc];
    m.faceVertexC = new int[fc];
    m.faceColors = new int[fc];
    m.faceInfo = new int[fc];
    m.faceAlpha = new int[fc];
    m.facePriorities = new int[fc];
    m.litColorA = new int[fc];
    m.litColorB = new int[fc];
    m.litColorC = new int[fc];
    m.litColorBackA = new int[fc];
    m.litColorBackB = new int[fc];
    m.litColorBackC = new int[fc];
    for (int i = 0; i < fc; i++) {
      JsonFace f = jm.faces[i];
      m.faceVertexA[i] = f.a;
      m.faceVertexB[i] = f.b;
      m.faceVertexC[i] = f.c;
      m.faceColors[i] = f.color;
      m.faceInfo[i] = f.info;
      m.faceAlpha[i] = f.alpha;
      m.facePriorities[i] = f.priority;
    }
    m.lit = false;

    if (jm.textureFaces != null && jm.textureFaces.length > 0) {
      int tfc = jm.textureFaces.length;
      m.textureFaceCount = tfc;
      m.textureFaceA = new int[tfc];
      m.textureFaceB = new int[tfc];
      m.textureFaceC = new int[tfc];
      for (int i = 0; i < tfc; i++) {
        int[] tf = jm.textureFaces[i];
        m.textureFaceA[i] = tf[0];
        m.textureFaceB[i] = tf[1];
        m.textureFaceC[i] = tf[2];
      }
    }

    m.defaultPriority = jm.defaultPriority != null ? jm.defaultPriority : 0;
    return m;
  }

  private static final class JsonModel {
    int id;
    String format;
    int[][] vertices;
    JsonFace[] faces;
    @Nullable Integer defaultPriority;
    int[][] textureFaces;
  }

  private static final class JsonFace {
    int a;
    int b;
    int c;
    int color;
    int info;
    int alpha;
    int priority;
  }
}
