package com.clansocket.extractor.test;

import com.bestbudz.engine.gpu.shader.ShaderProgram;
import com.bestbudz.engine.gpu.shader.ShaderSources;
import com.bestbudz.rendering.model.Model;
import com.clansocket.extractor.data.ItemDef;
import com.clansocket.extractor.data.ItemDefLoader;
import com.clansocket.extractor.data.ItemModelBuilder;
import com.clansocket.extractor.data.ModelLoader;

import java.nio.IntBuffer;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import javax.swing.SwingUtilities;

import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.glfw.GLFWCursorPosCallbackI;
import org.lwjgl.glfw.GLFWMouseButtonCallbackI;
import org.lwjgl.glfw.GLFWScrollCallbackI;
import org.lwjgl.opengl.GL;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL14;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL20;
import org.lwjgl.opengl.GL30;

/**
 * Real-time model inspector for diagnosing sticker/lighting/priority issues.
 * Side-by-side with Swing sidebar (InspectorSidebar) that mutates the shared
 * InspectorState. Mouse drag rotates camera; scroll zooms.
 *
 * Run: ./gradlew inspect
 *      ./gradlew inspect -Pargs="--item 9810"
 */
public final class ClanSocketModelInspector {

  private static final InspectorState STATE = new InspectorState();
  private static final double RS2_ANGLE_TO_RADIANS = Math.PI * 2.0 / 2048.0;
  private static final int INTS_PER_VERTEX = 9;
  private static final int WIN_W = 900;
  private static final int WIN_H = 900;

  private static long window;
  private static int vao, vbo;
  private static ShaderProgram shader;
  private static int uViewProjection;
  private static int uCameraPosition;
  private static int uTextureArray;
  private static int uPassMode;
  private static IntBuffer vertexData;
  private static int vertexCapacity;
  private static Map<Integer, ItemDef> items;
  private static Model currentModel;

  private static double dragX = -1, dragY = -1;
  private static boolean dragging = false;

  public static void main(String[] args) throws Exception {
    for (int i = 0; i < args.length; i++) {
      if ("--item".equals(args[i]) && i + 1 < args.length) {
        STATE.itemId = Integer.parseInt(args[++i]);
      }
    }

    SwingUtilities.invokeLater(() -> new InspectorSidebar(STATE));

    initGl();
    initShader();
    initBuffers();
    initModels();
    setupCallbacks();

    runRenderLoop();
    cleanup();
  }

  private static void initGl() {
    if (!GLFW.glfwInit()) throw new IllegalStateException("GLFW init failed");
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR, 4);
    GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR, 6);
    GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE, GLFW.GLFW_OPENGL_CORE_PROFILE);
    GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE, GLFW.GLFW_TRUE);
    GLFW.glfwWindowHint(GLFW.GLFW_RESIZABLE, GLFW.GLFW_FALSE);
    window = GLFW.glfwCreateWindow(WIN_W, WIN_H, "ClanSocket Inspector — drag to rotate, scroll to zoom", 0, 0);
    if (window == 0) throw new IllegalStateException("GLFW window creation failed");
    GLFW.glfwMakeContextCurrent(window);
    GL.createCapabilities();
    GLFW.glfwSwapInterval(1);
    GLFW.glfwSetWindowPos(window, 420, 50);
  }

  private static void initShader() {
    shader = new ShaderProgram(ShaderSources.MODEL_VERTEX, ShaderSources.MODEL_FRAGMENT);
    if (!shader.isValid()) throw new IllegalStateException("Shader compile failed");
    uViewProjection = shader.getUniformLocation("uViewProjection");
    uCameraPosition = shader.getUniformLocation("uCameraPosition");
    uTextureArray = shader.getUniformLocation("uTextureArray");
    uPassMode = shader.getUniformLocation("uPassMode");
  }

  private static void initBuffers() {
    vao = GL30.glGenVertexArrays();
    vbo = GL15.glGenBuffers();
    GL30.glBindVertexArray(vao);
    GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);
    int stride = INTS_PER_VERTEX * 4;
    GL30.glVertexAttribIPointer(0, 4, GL11.GL_INT, stride, 0);
    GL20.glEnableVertexAttribArray(0);
    GL30.glVertexAttribIPointer(1, 1, GL11.GL_INT, stride, 16);
    GL20.glEnableVertexAttribArray(1);
    GL30.glVertexAttribIPointer(2, 1, GL11.GL_INT, stride, 20);
    GL20.glEnableVertexAttribArray(2);
    GL20.glVertexAttribPointer(3, 2, GL11.GL_FLOAT, false, stride, 24);
    GL20.glEnableVertexAttribArray(3);
    GL30.glVertexAttribIPointer(4, 1, GL11.GL_INT, stride, 32);
    GL20.glEnableVertexAttribArray(4);
    GL30.glBindVertexArray(0);
    vertexCapacity = 3000 * INTS_PER_VERTEX;
    vertexData = BufferUtils.createIntBuffer(vertexCapacity);
  }

  private static void initModels() throws Exception {
    Path extracted = Paths.get("").toAbsolutePath().resolve("extracted_osrs_cache").resolve("raw");
    items = ItemDefLoader.loadAll(extracted.resolve("configs"));
    ModelLoader.initialize(extracted.resolve("models"));
    System.out.println("[Inspector] loaded " + items.size() + " item defs");
  }

  private static void setupCallbacks() {
    GLFW.glfwSetMouseButtonCallback(window, (GLFWMouseButtonCallbackI) (win, button, action, mods) -> {
      if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
        if (action == GLFW.GLFW_PRESS) {
          double[] cx = new double[1], cy = new double[1];
          GLFW.glfwGetCursorPos(win, cx, cy);
          dragX = cx[0]; dragY = cy[0];
          dragging = true;
        } else if (action == GLFW.GLFW_RELEASE) {
          dragging = false;
        }
      }
    });
    GLFW.glfwSetCursorPosCallback(window, (GLFWCursorPosCallbackI) (win, x, y) -> {
      if (!dragging) return;
      double dx = x - dragX;
      double dy = y - dragY;
      dragX = x; dragY = y;
      int newYan = (STATE.yan2d + (int)(dx * 4)) & 0x7FF;
      int newXan = (STATE.xan2d - (int)(dy * 4)) & 0x7FF;
      STATE.yan2d = newYan;
      STATE.xan2d = newXan;
      STATE.touchDirty();
    });
    GLFW.glfwSetScrollCallback(window, (GLFWScrollCallbackI) (win, dx, dy) -> {
      STATE.zoomMultiplier = Math.max(0.1, Math.min(5.0, STATE.zoomMultiplier * (dy > 0 ? 1.1 : 0.91)));
      STATE.touchDirty();
    });
    GLFW.glfwSetKeyCallback(window, (win, key, scan, action, mods) -> {
      if (action != GLFW.GLFW_PRESS) return;
      if (key == GLFW.GLFW_KEY_R) STATE.touchReload();
      if (key == GLFW.GLFW_KEY_ESCAPE) GLFW.glfwSetWindowShouldClose(win, true);
    });
  }

  private static void runRenderLoop() {
    System.out.println("[Inspector] ready — drag to rotate, scroll to zoom, R to reload, ESC to quit");
    while (!GLFW.glfwWindowShouldClose(window)) {
      reloadIfNeeded();
      applyGLState();
      GL11.glClearColor(0.18f, 0.18f, 0.20f, 1.0f);
      GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);
      GL11.glViewport(0, 0, WIN_W, WIN_H);
      if (currentModel != null) renderModel();
      GLFW.glfwSwapBuffers(window);
      GLFW.glfwPollEvents();
    }
  }

  private static void reloadIfNeeded() {
    if (STATE.reloadModel) {
      ItemDef def = items.get(STATE.itemId);
      if (def != null) {
        try {
          currentModel = ItemModelBuilder.getStackedModel(def, 1);
          System.out.println("[Inspector] loaded item " + STATE.itemId + ": " + def.name
              + " (model " + def.inventoryModel + ", " + (currentModel == null ? 0 : currentModel.triangleCount) + " faces)");
        } catch (Exception ex) {
          System.err.println("[Inspector] reload failed: " + ex.getMessage());
        }
      } else {
        System.err.println("[Inspector] no item def for id " + STATE.itemId);
        currentModel = null;
      }
      STATE.reloadModel = false;
    }
  }

  private static void applyGLState() {
    GL11.glEnable(GL11.GL_DEPTH_TEST);
    GL11.glDepthFunc(STATE.glLequal ? GL11.GL_LEQUAL : GL11.GL_LESS);
    GL11.glDepthMask(STATE.depthWrite);
    if (STATE.alphaBlend) {
      GL11.glEnable(GL11.GL_BLEND);
      GL14.glBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA,
          GL11.GL_ONE, GL11.GL_ONE_MINUS_SRC_ALPHA);
    } else {
      GL11.glDisable(GL11.GL_BLEND);
    }
    if (STATE.cullFace) {
      GL11.glEnable(GL11.GL_CULL_FACE);
      GL11.glCullFace(STATE.cullDirection == 0 ? GL11.GL_BACK : GL11.GL_FRONT);
    } else {
      GL11.glDisable(GL11.GL_CULL_FACE);
    }
    GL11.glPolygonMode(GL11.GL_FRONT_AND_BACK, STATE.wireframe ? GL11.GL_LINE : GL11.GL_FILL);
  }

  private static void renderModel() {
    Model model = currentModel;
    int vc = model.vertexCount;
    int fc = model.triangleCount;
    if (vc == 0 || fc == 0) return;

    int xan = STATE.xan2d, yan = STATE.yan2d, zan = STATE.zan2d;
    int isolate = STATE.isolatePriority;
    int priorityZStep = STATE.priorityZStep;
    boolean sort = STATE.prioritySort;

    double zRad = zan * RS2_ANGLE_TO_RADIANS;
    double xRad = yan * RS2_ANGLE_TO_RADIANS;
    double yRad = xan * RS2_ANGLE_TO_RADIANS;
    double sinZf = Math.sin(zRad), cosZf = Math.cos(zRad);
    double sinXf = Math.sin(xRad), cosXf = Math.cos(xRad);
    double sinYf = Math.sin(yRad), cosYf = Math.cos(yRad);

    boolean[] vertUsed = new boolean[vc];
    for (int f = 0; f < fc; f++) {
      if (isolate >= 0) {
        int p = model.facePriorities != null && model.facePriorities.length > 0
            ? model.facePriorities[f] : model.defaultPriority;
        if (p != isolate) continue;
      }
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
      vy = vy * cosZf - vx * sinZf; vx = t1;
      t1 = vz * sinXf + vx * cosXf;
      vz = vz * cosXf - vx * sinXf; vx = t1;
      t1 = vy * cosYf - vz * sinYf;
      vz = vy * sinYf + vz * cosYf; vy = t1;
      if (vx < rotMinX) rotMinX = vx; if (vx > rotMaxX) rotMaxX = vx;
      if (vy < rotMinY) rotMinY = vy; if (vy > rotMaxY) rotMaxY = vy;
      if (vz < rotMinZ) rotMinZ = vz; if (vz > rotMaxZ) rotMaxZ = vz;
    }
    if (rotMinX == Double.MAX_VALUE) return;
    double rotCx = (rotMinX + rotMaxX) * 0.5;
    double rotCy = (rotMinY + rotMaxY) * 0.5;
    double rotCz = (rotMinZ + rotMaxZ) * 0.5;
    double halfX = Math.max(rotMaxX - rotCx, rotCx - rotMinX);
    double halfY = Math.max(rotMaxY - rotCy, rotCy - rotMinY);
    double maxHalf = Math.max(halfX, halfY);
    double targetNdc = 0.85 / STATE.zoomMultiplier;
    double cameraDepth = maxHalf * 32.0 / targetNdc;
    if (cameraDepth < 100.0) cameraDepth = 100.0;
    int offsetX = (int) Math.round(-rotCx);
    int offsetY = (int) Math.round(-rotCy);
    int offsetZ = (int) Math.round(cameraDepth - rotCz);

    int sinX = (int) (65536.0 * Math.sin((yan & 0x7FF) * RS2_ANGLE_TO_RADIANS));
    int cosX = (int) (65536.0 * Math.cos((yan & 0x7FF) * RS2_ANGLE_TO_RADIANS));
    int sinZ = (int) (65536.0 * Math.sin((zan & 0x7FF) * RS2_ANGLE_TO_RADIANS));
    int cosZ = (int) (65536.0 * Math.cos((zan & 0x7FF) * RS2_ANGLE_TO_RADIANS));
    int sinY = (int) (65536.0 * Math.sin((xan & 0x7FF) * RS2_ANGLE_TO_RADIANS));
    int cosY = (int) (65536.0 * Math.cos((xan & 0x7FF) * RS2_ANGLE_TO_RADIANS));

    Integer[] faceOrder = new Integer[fc];
    for (int i = 0; i < fc; i++) faceOrder[i] = i;
    if (sort) {
      boolean hp = model.facePriorities != null && model.facePriorities.length > 0;
      int bp = model.defaultPriority;
      int[] fp = hp ? model.facePriorities : null;
      java.util.Arrays.sort(faceOrder, (a, b) -> {
        int pa = hp ? fp[a] : bp;
        int pb = hp ? fp[b] : bp;
        if (pa != pb) return Integer.compare(pa, pb);
        return Integer.compare(a, b);
      });
    }

    int intsNeeded = fc * 3 * INTS_PER_VERTEX;
    if (intsNeeded > vertexCapacity) {
      vertexCapacity = intsNeeded + 5000;
      vertexData = BufferUtils.createIntBuffer(vertexCapacity);
    }
    vertexData.clear();

    int emitted = 0;
    boolean hasInfo = model.faceInfo.length > 0;
    boolean hasAlpha = model.faceAlpha.length > 0;
    boolean hasPri = model.facePriorities != null && model.facePriorities.length > 0;
    int basePri = model.defaultPriority;

    for (int fi = 0; fi < fc; fi++) {
      int face = faceOrder[fi];
      if (model.faceVertexA[face] == model.faceVertexB[face]
          && model.faceVertexB[face] == model.faceVertexC[face]) continue;
      int pri = hasPri ? model.facePriorities[face] : basePri;
      if (isolate >= 0 && pri != isolate) continue;
      if (model.lit && model.litColorA[face] == -2) continue;

      int idxA = model.faceVertexA[face];
      int idxB = model.faceVertexB[face];
      int idxC = model.faceVertexC[face];

      int rgbA, rgbB, rgbC, backRgbA, backRgbB, backRgbC;
      if (!model.lit) continue;
      int faceType = hasInfo ? (model.faceInfo[face] & 3) : 0;
      if (faceType == 1) {
        rgbA = rgbB = rgbC = model.litColorA[face];
        backRgbA = backRgbB = backRgbC = STATE.dualColor ? model.litColorBackA[face] : rgbA;
      } else {
        rgbA = model.litColorA[face];
        rgbB = model.litColorB[face];
        rgbC = model.litColorC[face];
        if (STATE.dualColor) {
          backRgbA = model.litColorBackA[face];
          backRgbB = model.litColorBackB[face];
          backRgbC = model.litColorBackC[face];
        } else {
          backRgbA = rgbA; backRgbB = rgbB; backRgbC = rgbC;
        }
      }

      int alpha = 255;
      if (hasAlpha) alpha = 255 - (model.faceAlpha[face] & 0xFF);
      int faceOffsetZ = offsetZ - pri * priorityZStep;

      emitVertex(model, idxA, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ,
          rgbA, backRgbA, alpha, -1, 0, 0);
      emitVertex(model, idxB, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ,
          rgbB, backRgbB, alpha, -1, 0, 0);
      emitVertex(model, idxC, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ,
          rgbC, backRgbC, alpha, -1, 0, 0);
      emitted++;
    }
    if (emitted == 0) return;

    vertexData.flip();

    float near = 50.0f, far = 50000.0f;
    float[] projection = new float[16];
    projection[0] = 32.0f;
    projection[5] = -32.0f;
    projection[10] = (far + near) / (far - near);
    projection[11] = 1.0f;
    projection[14] = -2.0f * far * near / (far - near);

    shader.bind();
    shader.setUniformMatrix4fv(uViewProjection, projection);
    shader.setUniform3f(uCameraPosition, 0.0f, 0.0f, 0.0f);
    shader.setUniform1i(uTextureArray, 0);

    GL30.glBindVertexArray(vao);
    GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);
    GL15.glBufferData(GL15.GL_ARRAY_BUFFER, vertexData, GL15.GL_STREAM_DRAW);

    shader.setUniform1i(uPassMode, 0);
    GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, emitted * 3);

    if (STATE.alphaBlend) {
      GL11.glDepthMask(false);
      shader.setUniform1i(uPassMode, 1);
      GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, emitted * 3);
      GL11.glDepthMask(STATE.depthWrite);
    }

    GL30.glBindVertexArray(0);
    shader.unbind();
  }

  private static void emitVertex(Model model, int vIdx,
      int sinX, int cosX, int sinZ, int cosZ, int sinY, int cosY,
      int offX, int offY, int offZ, int rgb, int backRgb, int alpha,
      int texId, float u, float v) {
    int vx = model.verticesX[vIdx];
    int vy = model.verticesY[vIdx];
    int vz = model.verticesZ[vIdx];
    if (sinZ != 0 || cosZ != 65536) {
      int t = (vy * sinZ + vx * cosZ) >> 16;
      vy = (vy * cosZ - vx * sinZ) >> 16; vx = t;
    }
    if (sinX != 0 || cosX != 65536) {
      int t = (vz * sinX + vx * cosX) >> 16;
      vz = (vz * cosX - vx * sinX) >> 16; vx = t;
    }
    if (sinY != 0 || cosY != 65536) {
      int t = (vy * cosY - vz * sinY) >> 16;
      vz = (vy * sinY + vz * cosY) >> 16; vy = t;
    }
    vx += offX; vy += offY; vz += offZ;
    vertexData.put(vx); vertexData.put(vy); vertexData.put(vz);
    vertexData.put(rgb & 0xFFFFFF);
    vertexData.put(alpha);
    vertexData.put(texId);
    vertexData.put(Float.floatToRawIntBits(u));
    vertexData.put(Float.floatToRawIntBits(v));
    vertexData.put(backRgb & 0xFFFFFF);
  }

  private static void cleanup() {
    if (shader != null) shader.cleanup();
    if (vao != 0) GL30.glDeleteVertexArrays(vao);
    if (vbo != 0) GL15.glDeleteBuffers(vbo);
    if (window != 0) GLFW.glfwDestroyWindow(window);
    GLFW.glfwTerminate();
  }
}
