package com.bestbudz.engine.gpu;

import com.bestbudz.engine.gpu.shader.ShaderProgram;
import com.bestbudz.engine.gpu.shader.ShaderSources;
import com.bestbudz.engine.texture.GPUTextureManager;
import com.bestbudz.engine.texture.TextureStore;
import com.bestbudz.rendering.model.Model;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.IntBuffer;
import org.jspecify.annotations.Nullable;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.*;

public final class GPUIconRenderer {
  private GPUIconRenderer() {}

  private static final int INTS_PER_VERTEX = 9;
  private static final int MSAA_SAMPLES = 1;

  private static boolean initialized = false;
  private static @Nullable ShaderProgram shader;
  private static int vao;
  private static int vbo;

  private static int msaaFbo;
  private static int msaaColorRb;
  private static int msaaDepthRb;

  private static int fbo;
  private static int fboColorTex;
  private static int fboDepthTex;
  private static int fboWidth;
  private static int fboHeight;

  private static int outputFbo;
  private static int outputColorTex;
  private static int outputFboWidth;
  private static int outputFboHeight;

  private static @Nullable ByteBuffer pixelBuffer;
  private static @Nullable IntBuffer pixelIntView;

  private static int uViewProjection;
  private static int uCameraPosition;
  private static int uTextureArray;
  private static int uPassMode;

  private static @Nullable IntBuffer vertexData;
  private static int vertexDataCapacity;

  private static final double RS2_ANGLE_TO_RADIANS = Math.PI * 2.0 / 2048.0;

  public static boolean initialize() {
    if (initialized) return true;

    try {

      shader = new ShaderProgram(ShaderSources.MODEL_VERTEX, ShaderSources.MODEL_FRAGMENT);
      if (!shader.isValid()) {
        System.err.println("[GPUIconRenderer] Shader compilation failed");
        return false;
      }

      vao = GL30.glGenVertexArrays();
      vbo = GL15.glGenBuffers();
      if (vao == 0 || vbo == 0) {
        System.err.println("[GPUIconRenderer] Failed to create GL objects");
        return false;
      }

      int stride = INTS_PER_VERTEX * 4;
      GL30.glBindVertexArray(vao);
      GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);

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

      shader.bind();
      uViewProjection = shader.getUniformLocation("uViewProjection");
      uCameraPosition = shader.getUniformLocation("uCameraPosition");
      uTextureArray = shader.getUniformLocation("uTextureArray");
      uPassMode = shader.getUniformLocation("uPassMode");
      shader.unbind();

      fboWidth = 32;
      fboHeight = 32;
      outputFboWidth = 32;
      outputFboHeight = 32;
      createFBO(fboWidth, fboHeight, outputFboWidth, outputFboHeight);

      pixelBuffer = BufferUtils.createByteBuffer(4 * 512 * 512);
      pixelBuffer.order(ByteOrder.LITTLE_ENDIAN);
      pixelIntView = pixelBuffer.asIntBuffer();

      vertexDataCapacity = 3000 * INTS_PER_VERTEX;
      vertexData = BufferUtils.createIntBuffer(vertexDataCapacity);

      initialized = true;
      System.out.println("[GPUIconRenderer] Initialized successfully (MSAA " + MSAA_SAMPLES + "x)");
      return true;

    } catch (Exception exception) {
      System.err.println("[GPUIconRenderer] Init failed: " + exception.getMessage());
      exception.printStackTrace();
      return false;
    }
  }

  private static void createFBO(int width, int height, int outW, int outH) {
    msaaFbo = GL30.glGenFramebuffers();
    GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, msaaFbo);

    msaaColorRb = GL30.glGenRenderbuffers();
    GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER, msaaColorRb);
    GL30.glRenderbufferStorageMultisample(GL30.GL_RENDERBUFFER, MSAA_SAMPLES, GL11.GL_RGBA8, width, height);
    GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER, GL30.GL_COLOR_ATTACHMENT0, GL30.GL_RENDERBUFFER, msaaColorRb);

    msaaDepthRb = GL30.glGenRenderbuffers();
    GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER, msaaDepthRb);
    GL30.glRenderbufferStorageMultisample(GL30.GL_RENDERBUFFER, MSAA_SAMPLES, GL14.GL_DEPTH_COMPONENT24, width, height);
    GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER, GL30.GL_DEPTH_ATTACHMENT, GL30.GL_RENDERBUFFER, msaaDepthRb);

    int msaaStatus = GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER);
    if (msaaStatus != GL30.GL_FRAMEBUFFER_COMPLETE) {
      System.err.println("[GPUIconRenderer] MSAA FBO incomplete: " + msaaStatus);
    }

    fbo = GL30.glGenFramebuffers();
    GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, fbo);

    fboColorTex = GL11.glGenTextures();
    GL11.glBindTexture(GL11.GL_TEXTURE_2D, fboColorTex);
    GL11.glTexImage2D(
        GL11.GL_TEXTURE_2D, 0, GL11.GL_RGBA8, width, height, 0,
        GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, (ByteBuffer) null);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_LINEAR);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_LINEAR);
    GL30.glFramebufferTexture2D(
        GL30.GL_FRAMEBUFFER, GL30.GL_COLOR_ATTACHMENT0, GL11.GL_TEXTURE_2D, fboColorTex, 0);

    fboDepthTex = GL11.glGenTextures();
    GL11.glBindTexture(GL11.GL_TEXTURE_2D, fboDepthTex);
    GL11.glTexImage2D(
        GL11.GL_TEXTURE_2D, 0, GL14.GL_DEPTH_COMPONENT24, width, height, 0,
        GL11.GL_DEPTH_COMPONENT, GL11.GL_FLOAT, (ByteBuffer) null);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_NEAREST);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_NEAREST);
    GL30.glFramebufferTexture2D(
        GL30.GL_FRAMEBUFFER, GL30.GL_DEPTH_ATTACHMENT, GL11.GL_TEXTURE_2D, fboDepthTex, 0);

    int status = GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER);
    if (status != GL30.GL_FRAMEBUFFER_COMPLETE) {
      System.err.println("[GPUIconRenderer] Resolve FBO incomplete: " + status);
    }

    outputFbo = GL30.glGenFramebuffers();
    GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, outputFbo);

    outputColorTex = GL11.glGenTextures();
    GL11.glBindTexture(GL11.GL_TEXTURE_2D, outputColorTex);
    GL11.glTexImage2D(
        GL11.GL_TEXTURE_2D, 0, GL11.GL_RGBA8, outW, outH, 0,
        GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, (ByteBuffer) null);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_LINEAR);
    GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_LINEAR);
    GL30.glFramebufferTexture2D(
        GL30.GL_FRAMEBUFFER, GL30.GL_COLOR_ATTACHMENT0, GL11.GL_TEXTURE_2D, outputColorTex, 0);

    int outputStatus = GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER);
    if (outputStatus != GL30.GL_FRAMEBUFFER_COMPLETE) {
      System.err.println("[GPUIconRenderer] Output FBO incomplete: " + outputStatus);
    }

    GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, 0);
  }

  private static void resizeFBO(int width, int height, int outW, int outH) {
    if (msaaFbo != 0) GL30.glDeleteFramebuffers(msaaFbo);
    if (msaaColorRb != 0) GL30.glDeleteRenderbuffers(msaaColorRb);
    if (msaaDepthRb != 0) GL30.glDeleteRenderbuffers(msaaDepthRb);
    if (fbo != 0) GL30.glDeleteFramebuffers(fbo);
    if (fboColorTex != 0) GL11.glDeleteTextures(fboColorTex);
    if (fboDepthTex != 0) GL11.glDeleteTextures(fboDepthTex);
    if (outputFbo != 0) GL30.glDeleteFramebuffers(outputFbo);
    if (outputColorTex != 0) GL11.glDeleteTextures(outputColorTex);

    fboWidth = width;
    fboHeight = height;
    outputFboWidth = outW;
    outputFboHeight = outH;
    createFBO(width, height, outW, outH);

    int needed = 4 * outW * outH;
    if (pixelBuffer == null || pixelBuffer.capacity() < needed) {
      pixelBuffer = BufferUtils.createByteBuffer(needed);
      pixelBuffer.order(ByteOrder.LITTLE_ENDIAN);
      pixelIntView = pixelBuffer.asIntBuffer();
    }
  }

  public static void renderModelToPixels(
      Model model,
      int rotX,
      int rotZ,
      int rotY,
      int offsetX,
      int offsetY,
      int offsetZ,
      int[] targetPixels,
      int width,
      int height,
      int outW,
      int outH) {

    if (!initialized || model == null) return;
    if (model.vertexCount == 0 || model.triangleCount == 0) return;
    if (width <= 0 || height <= 0 || outW <= 0 || outH <= 0) return;
    if (shader == null || pixelBuffer == null || pixelIntView == null || vertexData == null) return;

    try {

      if (width != fboWidth || height != fboHeight || outW != outputFboWidth || outH != outputFboHeight) {
        resizeFBO(width, height, outW, outH);
      }

      GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, msaaFbo);
      GL11.glViewport(0, 0, width, height);
      GL11.glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
      GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);
      GL11.glEnable(GL11.GL_DEPTH_TEST);
      GL11.glDepthFunc(GL11.GL_LEQUAL);
      GL13.glEnable(GL13.GL_MULTISAMPLE);
      GL11.glEnable(GL11.GL_BLEND);
      GL14.glBlendFuncSeparate(
          GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA,
          GL11.GL_ONE,       GL11.GL_ONE_MINUS_SRC_ALPHA);
      GL11.glDisable(GL11.GL_CULL_FACE);

      float near = 50.0f;
      float far = 50000.0f;
      float[] projection = new float[16];
      projection[0] = 32.0f;
      projection[5] = -32.0f;
      projection[10] = (far + near) / (far - near);
      projection[11] = 1.0f;
      projection[14] = -2.0f * far * near / (far - near);

      shader.bind();
      shader.setUniformMatrix4fv(uViewProjection, projection);
      shader.setUniform3f(uCameraPosition, 0.0f, 0.0f, 0.0f);

      if (GPUTextureManager.isInitialized()) {
        GL13.glActiveTexture(GL13.GL_TEXTURE0);
        GL11.glBindTexture(GL30.GL_TEXTURE_2D_ARRAY, GPUTextureManager.getTextureArray());
        shader.setUniform1i(uTextureArray, 0);
      }

      int triCount = model.triangleCount;
      int intsNeeded = triCount * 3 * INTS_PER_VERTEX;
      ensureVertexBufferCapacity(intsNeeded);
      vertexData.clear();

      int sinX = (int) (65536.0 * Math.sin((rotX & 0x7FF) * RS2_ANGLE_TO_RADIANS));
      int cosX = (int) (65536.0 * Math.cos((rotX & 0x7FF) * RS2_ANGLE_TO_RADIANS));
      int sinZ = (int) (65536.0 * Math.sin((rotZ & 0x7FF) * RS2_ANGLE_TO_RADIANS));
      int cosZ = (int) (65536.0 * Math.cos((rotZ & 0x7FF) * RS2_ANGLE_TO_RADIANS));
      int sinY = (int) (65536.0 * Math.sin((rotY & 0x7FF) * RS2_ANGLE_TO_RADIANS));
      int cosY = (int) (65536.0 * Math.cos((rotY & 0x7FF) * RS2_ANGLE_TO_RADIANS));

      int uploadedTris = 0;
      boolean hasTriangleInfo = model.faceInfo.length > 0;
      boolean hasTriangleColors = model.faceColors.length > 0;
      boolean hasTriangleAlpha = model.faceAlpha.length > 0;
      boolean hasFacePriorities = model.facePriorities != null && model.facePriorities.length > 0;
      int basePriority = model.defaultPriority;
      int priorityZStep = 13;

      Integer[] faceOrder = new Integer[triCount];
      for (int i = 0; i < triCount; i++) faceOrder[i] = i;
      final boolean fhp = hasFacePriorities;
      final int bp = basePriority;
      final int[] fp = fhp ? model.facePriorities : null;
      java.util.Arrays.sort(faceOrder, (a, b) -> {
        int pa = fhp ? fp[a] : bp;
        int pb = fhp ? fp[b] : bp;
        if (pa != pb) return Integer.compare(pa, pb);
        return Integer.compare(a, b);
      });

      for (int fi = 0; fi < triCount; fi++) {
        int face = faceOrder[fi];

        if (model.faceVertexA[face] == model.faceVertexB[face]
            && model.faceVertexB[face] == model.faceVertexC[face]) continue;

        int idxA = model.faceVertexA[face];
        int idxB = model.faceVertexB[face];
        int idxC = model.faceVertexC[face];

        int faceType = hasTriangleInfo ? (model.faceInfo[face] & 3) : 0;

        boolean isTextured = (faceType & 2) != 0;

        if (model.lit && model.litColorA[face] == -2) continue;

        int rgbA, rgbB, rgbC;
        int backRgbA, backRgbB, backRgbC;
        int textureId = -1;
        float uA = 0, vA = 0, uB = 0, vB = 0, uC = 0, vC = 0;

        if (isTextured && hasTriangleInfo) {
          int texTriIdx = model.faceInfo[face] >> 2;
          textureId = hasTriangleColors ? model.faceColors[face] : -1;

          if (textureId >= 0 && textureId < TextureStore.textureAmount) {

            int tA;
            int tB;
            int tC;
            if (model.textureFaceA != null
                && model.textureFaceA.length > 0
                && texTriIdx >= 0
                && texTriIdx < model.textureFaceCount) {
              tA = model.textureFaceA[texTriIdx];
              tB = model.textureFaceB[texTriIdx];
              tC = model.textureFaceC[texTriIdx];
            } else {

              tA = idxA;
              tB = idxB;
              tC = idxC;
            }

            if (tA >= 0
                && tA < model.vertexCount
                && tB >= 0
                && tB < model.vertexCount
                && tC >= 0
                && tC < model.vertexCount) {

              float[] uvs = GPUModelRenderer.computeUVs(model, idxA, idxB, idxC, tA, tB, tC);
              uA = uvs[0];
              vA = uvs[1];
              uB = uvs[2];
              vB = uvs[3];
              uC = uvs[4];
              vC = uvs[5];
            } else {
              textureId = -1;
            }
          } else {
            textureId = -1;
          }

          if (textureId >= 0 && model.lit) {
            rgbA = model.litColorA[face];
            rgbB = model.litColorB[face];
            rgbC = model.litColorC[face];
            backRgbA = model.litColorBackA[face];
            backRgbB = model.litColorBackB[face];
            backRgbC = model.litColorBackC[face];
          } else if (textureId >= 0) {
            rgbA = rgbB = rgbC = 0x808080;
            backRgbA = backRgbB = backRgbC = 0x808080;
          } else {
            rgbA = rgbB = rgbC = 0xFF00FF;
            backRgbA = backRgbB = backRgbC = 0xFF00FF;
          }
        } else if (faceType == 1) {

          if (!model.lit) continue;
          rgbA = rgbB = rgbC = model.litColorA[face];
          backRgbA = backRgbB = backRgbC = model.litColorBackA[face];
        } else {

          if (!model.lit) continue;
          rgbA = model.litColorA[face];
          rgbB = model.litColorB[face];
          rgbC = model.litColorC[face];
          backRgbA = model.litColorBackA[face];
          backRgbB = model.litColorBackB[face];
          backRgbC = model.litColorBackC[face];
        }

        int alpha = 255;
        if (hasTriangleAlpha) {
          alpha = 255 - (model.faceAlpha[face] & 0xFF);
        }

        int facePriority = hasFacePriorities ? model.facePriorities[face] : basePriority;
        int faceOffsetZ = offsetZ - facePriority * priorityZStep;

        emitIconVertex(
            model, idxA, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ, rgbA, backRgbA, alpha,
            textureId, uA, vA);
        emitIconVertex(
            model, idxB, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ, rgbB, backRgbB, alpha,
            textureId, uB, vB);
        emitIconVertex(
            model, idxC, sinX, cosX, sinZ, cosZ, sinY, cosY, offsetX, offsetY, faceOffsetZ, rgbC, backRgbC, alpha,
            textureId, uC, vC);

        uploadedTris++;
      }

      if (uploadedTris == 0) {
        shader.unbind();
        return;
      }

      vertexData.flip();
      int uploadedVerts = uploadedTris * 3;

      GL30.glBindVertexArray(vao);
      GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vbo);
      GL15.glBufferData(GL15.GL_ARRAY_BUFFER, vertexData, GL15.GL_STREAM_DRAW);

      shader.setUniform1i(uPassMode, 0);
      GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, uploadedVerts);

      GL11.glDepthMask(false);
      shader.setUniform1i(uPassMode, 1);
      GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, uploadedVerts);
      GL11.glDepthMask(true);

      GL30.glBindVertexArray(0);
      shader.unbind();

      GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, msaaFbo);
      GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER, fbo);
      GL30.glBlitFramebuffer(
          0, 0, width, height,
          0, 0, width, height,
          GL11.GL_COLOR_BUFFER_BIT,
          GL11.GL_NEAREST);

      GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, fbo);
      GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER, outputFbo);
      GL30.glBlitFramebuffer(
          0, 0, width, height,
          0, 0, outW, outH,
          GL11.GL_COLOR_BUFFER_BIT,
          GL11.GL_LINEAR);

      GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER, outputFbo);
      pixelBuffer.clear();
      GL11.glReadPixels(0, 0, outW, outH, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, pixelBuffer);

      pixelIntView.clear();
      for (int row = 0; row < outH; row++) {
        int srcRow = (outH - 1 - row);
        int dstOffset = row * outW;
        pixelIntView.position(srcRow * outW);
        for (int col = 0; col < outW; col++) {
          int rgba = pixelIntView.get();
          int a = (rgba >> 24) & 0xFF;
          if (a > 0) {
            int b = (rgba >> 16) & 0xFF;
            int g = (rgba >> 8) & 0xFF;
            int r = rgba & 0xFF;
            targetPixels[dstOffset + col] = (a << 24) | (r << 16) | (g << 8) | b;
          }
        }
      }

    } catch (Exception exception) {
      System.err.println("[GPUIconRenderer] Render error: " + exception.getClass().getSimpleName());
      exception.printStackTrace();
    }
  }

  private static void emitIconVertex(
      Model model,
      int vertIdx,
      int sinX,
      int cosX,
      int sinZ,
      int cosZ,
      int sinY,
      int cosY,
      int offsetX,
      int offsetY,
      int offsetZ,
      int rgb,
      int backRgb,
      int alpha,
      int textureId,
      float texU,
      float texV) {

    int vx = model.verticesX[vertIdx];
    int vy = model.verticesY[vertIdx];
    int vz = model.verticesZ[vertIdx];

    if (sinZ != 0 || cosZ != 65536) {
      int t = (vy * sinZ + vx * cosZ) >> 16;
      vy = (vy * cosZ - vx * sinZ) >> 16;
      vx = t;
    }

    if (sinX != 0 || cosX != 65536) {
      int t = (vz * sinX + vx * cosX) >> 16;
      vz = (vz * cosX - vx * sinX) >> 16;
      vx = t;
    }

    if (sinY != 0 || cosY != 65536) {
      int t = (vy * cosY - vz * sinY) >> 16;
      vz = (vy * sinY + vz * cosY) >> 16;
      vy = t;
    }

    vx = -vx;
    vz = -vz;

    vx += offsetX;
    vy += offsetY;
    vz += offsetZ;

    if (vertexData == null) return;
    vertexData.put(vx);
    vertexData.put(vy);
    vertexData.put(vz);
    vertexData.put(rgb & 0xFFFFFF);
    vertexData.put(alpha);
    vertexData.put(textureId);
    vertexData.put(Float.floatToRawIntBits(texU));
    vertexData.put(Float.floatToRawIntBits(texV));
    vertexData.put(backRgb & 0xFFFFFF);
  }

  private static void ensureVertexBufferCapacity(int intsNeeded) {
    if (intsNeeded > vertexDataCapacity) {
      vertexDataCapacity = intsNeeded + 5000;
      vertexData = BufferUtils.createIntBuffer(vertexDataCapacity);
    }
  }

  public static boolean isInitialized() {
    return initialized;
  }

  public static void cleanup() {
    if (!initialized) return;

    if (shader != null) {
      shader.cleanup();
      shader = null;
    }
    if (vao != 0) {
      GL30.glDeleteVertexArrays(vao);
      vao = 0;
    }
    if (vbo != 0) {
      GL15.glDeleteBuffers(vbo);
      vbo = 0;
    }
    if (msaaFbo != 0) {
      GL30.glDeleteFramebuffers(msaaFbo);
      msaaFbo = 0;
    }
    if (msaaColorRb != 0) {
      GL30.glDeleteRenderbuffers(msaaColorRb);
      msaaColorRb = 0;
    }
    if (msaaDepthRb != 0) {
      GL30.glDeleteRenderbuffers(msaaDepthRb);
      msaaDepthRb = 0;
    }
    if (fbo != 0) {
      GL30.glDeleteFramebuffers(fbo);
      fbo = 0;
    }
    if (fboColorTex != 0) {
      GL11.glDeleteTextures(fboColorTex);
      fboColorTex = 0;
    }
    if (fboDepthTex != 0) {
      GL11.glDeleteTextures(fboDepthTex);
      fboDepthTex = 0;
    }
    if (outputFbo != 0) {
      GL30.glDeleteFramebuffers(outputFbo);
      outputFbo = 0;
    }
    if (outputColorTex != 0) {
      GL11.glDeleteTextures(outputColorTex);
      outputColorTex = 0;
    }

    initialized = false;
    System.out.println("[GPUIconRenderer] Cleaned up");
  }
}
