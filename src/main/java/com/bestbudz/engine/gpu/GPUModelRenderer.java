package com.bestbudz.engine.gpu;

import com.bestbudz.rendering.model.Model;

/**
 * Texture UV projection — port of BestBudz's ModelVertexEmitter.computeUVs.
 *
 * For a textured face (faceA, faceB, faceC) and its associated textureFace
 * triangle (tA, tB, tC), computes the (u, v) coordinates of each of the three
 * face vertices in the texture's UV plane via barycentric projection.
 *
 * The math: project each face vertex onto the plane spanned by edges
 * (tB - tA) and (tC - tA), then express that projection in barycentric
 * coordinates of the tA/tB/tC triangle. Those barycentrics ARE the UV coords
 * because OSRS conventionally maps tA → (0,0), tB → (1,0), tC → (0,1).
 *
 * Returns UV_DEGENERATE (all zeros) when the texture triangle is degenerate
 * (denominator near zero) — the calling renderer's texture path then renders
 * a single point of the texture, which is a safe fallback.
 */
public final class GPUModelRenderer {

  private GPUModelRenderer() {}

  private static final float[] UV_DEGENERATE = new float[6];
  private static final float[] UV_RESULT = new float[6];

  public static float[] computeUVs(
      Model model, int faceA, int faceB, int faceC, int tA, int tB, int tC) {
    float ax = model.verticesX[tA], ay = model.verticesY[tA], az = model.verticesZ[tA];
    float bx = model.verticesX[tB], by = model.verticesY[tB], bz = model.verticesZ[tB];
    float cx = model.verticesX[tC], cy = model.verticesY[tC], cz = model.verticesZ[tC];

    float d1x = bx - ax, d1y = by - ay, d1z = bz - az;
    float d2x = cx - ax, d2y = cy - ay, d2z = cz - az;

    float d1d1 = d1x * d1x + d1y * d1y + d1z * d1z;
    float d1d2 = d1x * d2x + d1y * d2y + d1z * d2z;
    float d2d2 = d2x * d2x + d2y * d2y + d2z * d2z;

    float denom = d1d1 * d2d2 - d1d2 * d1d2;
    if (Math.abs(denom) < 0.0001f) {
      return UV_DEGENERATE;
    }

    float invDenom = 1.0f / denom;

    float projX = model.verticesX[faceA] - ax;
    float projY = model.verticesY[faceA] - ay;
    float projZ = model.verticesZ[faceA] - az;
    float d1p = d1x * projX + d1y * projY + d1z * projZ;
    float d2p = d2x * projX + d2y * projY + d2z * projZ;
    UV_RESULT[0] = (d2d2 * d1p - d1d2 * d2p) * invDenom;
    UV_RESULT[1] = (d1d1 * d2p - d1d2 * d1p) * invDenom;

    projX = model.verticesX[faceB] - ax;
    projY = model.verticesY[faceB] - ay;
    projZ = model.verticesZ[faceB] - az;
    d1p = d1x * projX + d1y * projY + d1z * projZ;
    d2p = d2x * projX + d2y * projY + d2z * projZ;
    UV_RESULT[2] = (d2d2 * d1p - d1d2 * d2p) * invDenom;
    UV_RESULT[3] = (d1d1 * d2p - d1d2 * d1p) * invDenom;

    projX = model.verticesX[faceC] - ax;
    projY = model.verticesY[faceC] - ay;
    projZ = model.verticesZ[faceC] - az;
    d1p = d1x * projX + d1y * projY + d1z * projZ;
    d2p = d2x * projX + d2y * projY + d2z * projZ;
    UV_RESULT[4] = (d2d2 * d1p - d1d2 * d2p) * invDenom;
    UV_RESULT[5] = (d1d1 * d2p - d1d2 * d1p) * invDenom;

    return UV_RESULT;
  }
}
