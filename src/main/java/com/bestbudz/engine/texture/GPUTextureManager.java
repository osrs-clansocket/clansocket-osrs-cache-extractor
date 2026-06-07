package com.bestbudz.engine.texture;

import java.nio.ByteBuffer;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;
import org.lwjgl.opengl.GL30;

/**
 * GL_TEXTURE_2D_ARRAY uploader — consumes TextureStore's CPU-side RGBA buffers
 * and copies them into a GPU texture array bound at texture unit 0 of
 * GPUIconRenderer's shader (uniform sampler2DArray uTextureArray).
 *
 * Simplified vs. BestBudz's full GPUTextureManager: no PBR aux maps (normal /
 * ORM / height / emission), no anisotropic filtering (skip the
 * EXTTextureFilterAnisotropic dance), no per-material SSBO. Just the base
 * colour layer that GPUIconRenderer's textured-face branch needs.
 *
 * Call order at extractor startup:
 *   1. GLFW context current + GL.createCapabilities()
 *   2. TextureStore.loadFromIndex(...) — populates CPU-side buffers
 *   3. GPUTextureManager.initialize() — uploads to GPU
 *   4. GPUIconRenderer.initialize() — its texture-binding code (lines 212-216
 *      of the copy) reads getTextureArray() once isInitialized() returns true
 */
public final class GPUTextureManager {

  public static final int LAYER_SIZE = TextureStore.LAYER_SIZE;

  private static int textureArray;
  private static boolean initialized;

  private GPUTextureManager() {}

  public static boolean initialize() {
    if (initialized) return true;
    int count = TextureStore.textureAmount;
    if (count <= 0) {
      System.err.println("[GPUTextureManager] No textures to load (textureAmount=" + count + ")");
      return false;
    }

    textureArray = GL11.glGenTextures();
    GL11.glBindTexture(GL30.GL_TEXTURE_2D_ARRAY, textureArray);

    GL12.glTexImage3D(
        GL30.GL_TEXTURE_2D_ARRAY,
        0,
        GL11.GL_RGBA8,
        LAYER_SIZE,
        LAYER_SIZE,
        count,
        0,
        GL11.GL_RGBA,
        GL11.GL_UNSIGNED_BYTE,
        (ByteBuffer) null);

    ByteBuffer transparentLayer = BufferUtils.createByteBuffer(LAYER_SIZE * LAYER_SIZE * 4);
    for (int i = 0; i < LAYER_SIZE * LAYER_SIZE; i++) {
      transparentLayer.put((byte) 0).put((byte) 0).put((byte) 0).put((byte) 0);
    }
    transparentLayer.flip();

    int loaded = 0;
    for (int id = 0; id < count; id++) {
      ByteBuffer rgba = TextureStore.isTexturePresent(id) ? TextureStore.textureRgba[id] : null;
      if (rgba == null) {
        transparentLayer.rewind();
        GL12.glTexSubImage3D(
            GL30.GL_TEXTURE_2D_ARRAY,
            0,
            0, 0, id,
            LAYER_SIZE, LAYER_SIZE, 1,
            GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE,
            transparentLayer);
        continue;
      }
      rgba.rewind();
      GL12.glTexSubImage3D(
          GL30.GL_TEXTURE_2D_ARRAY,
          0,
          0, 0, id,
          LAYER_SIZE, LAYER_SIZE, 1,
          GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE,
          rgba);
      loaded++;
    }

    GL30.glGenerateMipmap(GL30.GL_TEXTURE_2D_ARRAY);

    GL11.glTexParameteri(GL30.GL_TEXTURE_2D_ARRAY, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_LINEAR_MIPMAP_LINEAR);
    GL11.glTexParameteri(GL30.GL_TEXTURE_2D_ARRAY, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_LINEAR);
    GL11.glTexParameteri(GL30.GL_TEXTURE_2D_ARRAY, GL11.GL_TEXTURE_WRAP_S, GL11.GL_REPEAT);
    GL11.glTexParameteri(GL30.GL_TEXTURE_2D_ARRAY, GL11.GL_TEXTURE_WRAP_T, GL11.GL_REPEAT);

    initialized = true;
    System.out.println("[GPUTextureManager] uploaded " + loaded + " texture layers (" + count + " total)");
    return true;
  }

  public static boolean isInitialized() {
    return initialized;
  }

  public static int getTextureArray() {
    return textureArray;
  }

  public static void cleanup() {
    if (!initialized) return;
    GL11.glDeleteTextures(textureArray);
    textureArray = 0;
    initialized = false;
  }
}
