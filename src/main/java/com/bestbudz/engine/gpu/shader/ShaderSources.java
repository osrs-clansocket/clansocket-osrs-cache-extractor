package com.bestbudz.engine.gpu.shader;

public final class ShaderSources {

  private ShaderSources() {}

  public static final String SCENE_VERTEX =
      """
      #version 460 core

      layout (location = 0) in ivec4 aPositionAndColor;
      layout (location = 1) in int aAlpha;
      layout (location = 2) in int aTextureId;
      layout (location = 3) in vec2 aTexCoord;
      layout (location = 4) in int aEntityId;
      layout (location = 5) in int aNormal;
      layout (location = 6) in ivec4 aInstanceOffset;   // worldX, worldZ, pickingId, rotation|indoor|plane|rotateHeights
      layout (location = 7) in ivec4 aHeightAndScale;  // flatHeight, scalePack, scaleYTransY, translatePack

      uniform mat4 uViewProjection;
      uniform vec3 uCameraPosition;
      uniform float uTick;
      uniform isampler2DArray uHeightmap;
      uniform ivec2 uHeightmapOrigin;

      out vec3 vColor;
      flat out int vAlpha;
      flat out int vTextureId;
      flat out int vWaterType;
      flat out int vWaterDepth;
      out vec2 vTexCoord;
      out vec3 vWorldPos;
      flat out int vEntityId;
      out vec3 vVertexNormal;

      void main() {
          vec3 modelPos = vec3(aPositionAndColor.xyz);
          // GPU-side rotation for instanced objects/entities
          int rotAndFlags = aInstanceOffset.w;
          if ((rotAndFlags & int(0x80000000)) != 0) {
              // Continuous rotation (entities): 11-bit angle (0-2047) in bits 0-10
              int angle = rotAndFlags & 0x7FF;
              float rad = float(angle) * 0.00306796157; // 2*PI / 2048
              float s = sin(rad);
              float c = cos(rad);
              float newX = modelPos.z * s + modelPos.x * c;
              float newZ = modelPos.z * c - modelPos.x * s;
              modelPos = vec3(newX, modelPos.y, newZ);
          } else {
              // Discrete 90-degree rotation (static objects): rot in bits 0-7
              int rot = rotAndFlags & 0xFF;
              if (rot == 1) modelPos = vec3(modelPos.z, modelPos.y, -modelPos.x);
              else if (rot == 2) modelPos = vec3(-modelPos.x, modelPos.y, -modelPos.z);
              else if (rot == 3) modelPos = vec3(-modelPos.z, modelPos.y, modelPos.x);
          }

          // GPU-side scale and translate for instanced objects (avoids per-scale mesh duplication)
          // Unpack from aHeightAndScale: .y=scalePack, .z=scaleYTransY, .w=translatePack
          int scaleX = aHeightAndScale.y & 0xFFFF;
          int scaleZ = (aHeightAndScale.y >> 16) & 0xFFFF;
          int scaleY = aHeightAndScale.z & 0xFFFF;
          if (scaleX != 0) {
              // Scale: vertex * scale / 128 (matches CPU modelScale)
              modelPos.x = modelPos.x * float(scaleX) / 128.0;
              modelPos.y = modelPos.y * float(scaleY) / 128.0;
              modelPos.z = modelPos.z * float(scaleZ) / 128.0;
              // Translate: vertex + offset (matches CPU translateCoords)
              int translateY = ((aHeightAndScale.z >> 16) & 0xFFFF) - 32768;
              int translateX = (aHeightAndScale.w & 0xFFFF) - 32768;
              int translateZ = ((aHeightAndScale.w >> 16) & 0xFFFF) - 32768;
              modelPos.x += float(translateX);
              modelPos.y += float(translateY);
              modelPos.z += float(translateZ);
          }

          // Per-vertex heightmap contouring via GPU texture sampling
          float flatH = float(aHeightAndScale.x);

          // Determine if this instance should contour to terrain
          // Entity = bit 31 set → never contour. Object = bit 11 (rotateHeights) → contour.
          bool doContour = ((rotAndFlags & int(0x80000000)) == 0)
                        && ((rotAndFlags & 0x800) != 0);

          if (doContour) {
              // Compute world-space vertex position for heightmap lookup
              float vwx = float(aInstanceOffset.x) + modelPos.x;
              float vwz = float(aInstanceOffset.y) + modelPos.z;
              // Convert to tile coordinates relative to heightmap origin
              float tileX = vwx / 128.0 - float(uHeightmapOrigin.x);
              float tileZ = vwz / 128.0 - float(uHeightmapOrigin.y);
              int ix = int(floor(tileX));
              int iz = int(floor(tileZ));
              float fx = tileX - float(ix);
              float fz = tileZ - float(iz);
              int plane = (rotAndFlags >> 9) & 0x3;

              // Sample 4 corners from heightmap texture and bilinear interpolate
              float hSW = float(texelFetch(uHeightmap, ivec3(ix, iz, plane), 0).r);
              float hSE = float(texelFetch(uHeightmap, ivec3(ix+1, iz, plane), 0).r);
              float hNE = float(texelFetch(uHeightmap, ivec3(ix+1, iz+1, plane), 0).r);
              float hNW = float(texelFetch(uHeightmap, ivec3(ix, iz+1, plane), 0).r);

              float interpW = hSW + (hSE - hSW) * fx;
              float interpE = hNW + (hNE - hNW) * fx;
              modelPos.y += (interpW + (interpE - interpW) * fz) - flatH;
          }

          // Instance offset: worldX in .x, worldZ in .y, Y from flatHeight
          vec3 pos = vec3(float(aInstanceOffset.x), flatH, float(aInstanceOffset.y))
                   + modelPos
                   - uCameraPosition;
          gl_Position = uViewProjection * vec4(pos, 1.0);
          // Depth bias: face priority (bits 26-31) + plane (bits 24-25)
          // Subtract to bring high-priority / upper-plane geometry closer to camera
          int pw = aPositionAndColor.w;
          int faceBias = (pw >> 26) & 0x3F;
          int planeId = (pw >> 24) & 0x3;
          // Bit 23 of rotAndFlags: depth nudge for secondary corner wall faces (z-fighting fix)
          float cornerNudge = ((rotAndFlags & 0x800000) != 0) ? 0.0005 : 0.0;
          gl_Position.z -= float(faceBias) / 512.0 + float(planeId) * 0.001 + cornerNudge;
          // Unpack RGB for smooth interpolation (terrain corner blending, Gouraud models)
          vColor = vec3(
              float((pw >> 16) & 0xFF) / 255.0,
              float((pw >> 8) & 0xFF) / 255.0,
              float(pw & 0xFF) / 255.0);
          vAlpha = aAlpha | (rotAndFlags & 0x100);
          vWaterType = (aAlpha >> 9) & 0xFF;
          vWaterDepth = (aAlpha >> 17) & 0x1;
          // Unpack texture ID (low 16 bits) and baked animation scroll (high 16 bits)
          int texId = (aTextureId << 16) >> 16;
          int scrollU = (aTextureId << 8) >> 24;
          int scrollV = aTextureId >> 24;
          vTextureId = texId;
          vec2 tc = aTexCoord;
          if (scrollU != 0 || scrollV != 0) {
              tc += uTick * vec2(float(scrollU), float(scrollV)) * 50.0 / 128.0;
          }
          vTexCoord = tc;
          vWorldPos = pos;
          vEntityId = aEntityId;
          // Instance picking ID overrides per-vertex entity ID for static objects.
          // Check bit 30 (0x40000000) to distinguish real picking IDs from OpenGL's
          // default w=1 when terrain/entity passes provide fewer than 4 components.
          // pickingId is in .z of the instance offset.
          if ((aInstanceOffset.z & 0x40000000) != 0) {
              vEntityId = aInstanceOffset.z;
          }
          // Unpack per-vertex normal if present (terrain smooth shading)
          if (aNormal != 0) {
              vec3 n = normalize(vec3(
                  float((aNormal >> 16) & 0xFF) - 128.0,
                  float((aNormal >> 8) & 0xFF) - 128.0,
                  float(aNormal & 0xFF) - 128.0));
              // Apply same rotation as model position
              if ((rotAndFlags & int(0x80000000)) != 0) {
                  int angle = rotAndFlags & 0x7FF;
                  float rad = float(angle) * 0.00306796157;
                  float s = sin(rad);
                  float c = cos(rad);
                  n = vec3(n.z * s + n.x * c, n.y, n.z * c - n.x * s);
              } else {
                  int rot = rotAndFlags & 0xFF;
                  if (rot == 1) n = vec3(n.z, n.y, -n.x);
                  else if (rot == 2) n = vec3(-n.x, n.y, -n.z);
                  else if (rot == 3) n = vec3(-n.z, n.y, n.x);
              }
              vVertexNormal = n;
          } else {
              vVertexNormal = vec3(0.0);
          }
      }
      """;

  public static final String SCENE_FRAGMENT =
      """
      #version 460 core

      uniform sampler2DArray uTextureArray;

      // Lighting uniforms
      uniform int uLightingEnabled;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uSunStrength;
      uniform vec3 uAmbientColor;
      uniform float uAmbientStrength;

      uniform float uTick;
      uniform vec3 uCameraPosition;

      // Shadow mapping uniforms
      uniform sampler2D uShadowMap;
      uniform mat4 uLightSpaceMatrix;
      uniform int uShadowsEnabled;
      uniform float uShadowBias;
      uniform vec3 uShadowOrigin; // actual camera world position for shadow reconstruction

      // PBR uniforms
      uniform float uDefaultRoughness; // 0.8 = RS2-like matte
      uniform float uDefaultMetallic;  // 0.0 = dielectric

      // PBR texture arrays
      uniform sampler2DArray uNormalArray;
      uniform sampler2DArray uORMArray;
      uniform sampler2DArray uHeightArray;
      uniform sampler2DArray uEmissionArray;
      uniform sampler2DArray uDetailNormalArray;
      uniform int uPbrMapsEnabled; // 1 when PBR texture arrays are bound

      // PBR advanced parameters (per-material overrides via JSON, defaults from EnvironmentConfig)
      uniform float uParallaxScale;    // parallax occlusion depth (0.03 default)
      uniform float uEmissionStrength; // emission intensity multiplier (1.0 default)
      uniform float uDetailNormalStrength; // detail normal blend weight (0.3 default)
      uniform float uSubsurfaceStrength;  // subsurface scattering (0.0 = off)
      uniform float uClearCoatStrength;   // clear coat layer (0.0 = off)

      // IBL (Image-Based Lighting) — uniforms declared only when IBL is initialized
      // to avoid NVIDIA sampler type mismatch artifacts with unbound cubemaps.
      // See IBLGenerator.isInitialized() and bindPBRTextures() for runtime binding.
      uniform int uIblEnabled;

      // Material SSBO: 2x ivec4 per albedo layer (8 ints per material)
      // [id*2+0] = ivec4(normalLayer, ormLayer, emissionLayer, heightLayer)
      // [id*2+1] = ivec4(detailNormalLayer, reserved, reserved, reserved)
      layout(std430, binding = 3) readonly buffer MaterialData {
          ivec4 materials[];
      };

      // Normal direction flag (terrain winding is opposite to entity model winding)
      uniform int uFlipNormals;

      // Entity highlight (editor: hovered object gets tinted)
      uniform int uHighlightEntityId;

      // Camera plane for per-plane terrain visibility masking (RS2 hid indoor tiles above camera)
      uniform int uCameraPlane;

      // Fog uniforms
      uniform vec3 uFogColor;
      uniform float uFogStart;
      uniform float uFogEnd;

      in vec3 vColor;
      flat in int vAlpha;
      flat in int vTextureId;
      flat in int vWaterType;
      flat in int vWaterDepth;
      in vec2 vTexCoord;
      in vec3 vWorldPos;
      flat in int vEntityId;
      in vec3 vVertexNormal;

      // Water uniforms
      uniform sampler2D uWaterNormalMap;
      uniform sampler2D uWaterFlowMap;
      uniform sampler2D uWaterFoamMap;
      uniform sampler2D uWaterCausticsMap;
      uniform int uWaterEnabled;
      uniform vec3 uWaterSurfaceColor[4];
      uniform vec3 uWaterDepthColor[4];
      uniform vec3 uWaterFoamColor[4];
      uniform float uWaterSpecStrength[4];
      uniform float uWaterSpecGloss[4];
      uniform float uWaterNormalStrength[4];
      uniform float uWaterOpacity[4];
      uniform float uWaterFresnelAmount[4];
      uniform float uWaterDuration[4];
      uniform int uWaterHasFoam[4];
      uniform int uWaterIsFlat[4];

      layout (location = 0) out vec4 FragColor;
      layout (location = 1) out int IdOutput;

      const float PI = 3.14159265359;

      // ===== PBR: GGX/Trowbridge-Reitz Normal Distribution Function =====
      float distributionGGX(vec3 N, vec3 H, float roughness) {
          float a = roughness * roughness;
          float a2 = a * a;
          float NdotH = max(dot(N, H), 0.0);
          float NdotH2 = NdotH * NdotH;
          float denom = NdotH2 * (a2 - 1.0) + 1.0;
          denom = PI * denom * denom;
          return a2 / max(denom, 0.0000001);
      }

      // ===== PBR: Smith's Schlick-GGX Geometry Function =====
      float geometrySchlickGGX(float NdotV, float roughness) {
          float r = roughness + 1.0;
          float k = (r * r) / 8.0;
          return NdotV / (NdotV * (1.0 - k) + k);
      }

      float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
          float NdotV = max(dot(N, V), 0.0);
          float NdotL = max(dot(N, L), 0.0);
          return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
      }

      // ===== PBR: Schlick Fresnel Approximation =====
      vec3 fresnelSchlick(float cosTheta, vec3 F0) {
          return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
      }

      // ===== PBR: Cotangent-frame normal perturbation (no vertex tangent needed) =====
      vec3 perturbNormal(vec3 N, vec3 worldPos, vec2 uv, vec3 normalSample) {
          vec3 dp1 = dFdx(worldPos);
          vec3 dp2 = dFdy(worldPos);
          vec2 duv1 = dFdx(uv);
          vec2 duv2 = dFdy(uv);
          vec3 dp2perp = cross(dp2, N);
          vec3 dp1perp = cross(N, dp1);
          vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
          vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
          float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
          mat3 TBN = mat3(T * invmax, B * invmax, N);
          return normalize(TBN * normalSample);
      }

      // ===== Shadow: 3x3 PCF Sampling =====
      float sampleShadow(vec3 worldPos) {
          vec4 lightSpacePos = uLightSpaceMatrix * vec4(worldPos + uShadowOrigin, 1.0);
          vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
          projCoords = projCoords * 0.5 + 0.5;
          if (projCoords.z > 1.0) return 1.0;

          float currentDepth = projCoords.z;
          vec2 texelSize = 1.0 / textureSize(uShadowMap, 0);
          float shadow = 0.0;
          for (int x = -1; x <= 1; x++) {
              for (int y = -1; y <= 1; y++) {
                  float closestDepth = texture(uShadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                  shadow += (currentDepth - uShadowBias > closestDepth) ? 0.0 : 1.0;
              }
          }
          return shadow / 9.0;
      }

      void main() {
          float alpha = float(vAlpha & 0xFF) / 255.0;
          // Discard fully transparent fragments so they don't write to the depth buffer.
          // RS2 faces with faceAlpha=255 are invisible — without discard they create
          // depth-buffer walls that block visible geometry behind them (grey spikes, missing parts).
          if (alpha < 0.01) discard;

          // Absolute world position (vWorldPos is camera-relative)
          vec3 absWorldPos = vWorldPos + uCameraPosition;

          // ===== UNDERWATER TERRAIN TINTING + CAUSTICS (Gap 6, 7) =====
          if (vWaterDepth > 0 && vWaterType > 0 && uWaterEnabled != 0) {
              int wIdx = vWaterType - 1;
              vec3 uwColor = vColor;

              // Tint terrain with water depth color (gradient toward dark)
              float depthFactor = 0.6;
              uwColor *= mix(vec3(1.0), uWaterDepthColor[wIdx], depthFactor);

              // Underwater caustics — dual scrolling layers with chromatic aberration
              // RLHD: animationFrame(17) * ivec2(1,-2) and animationFrame(23) * -ivec2(1,-2)
              vec2 causticsUv = -absWorldPos.xz / (128.0 * 1.75) * 0.75;
              float duration = uWaterDuration[wIdx];
              float cAnim17 = mod(uTick, 17.0 * duration) / (17.0 * duration);
              float cAnim23 = mod(uTick, 23.0 * duration) / (23.0 * duration);
              vec2 cFlow1 = causticsUv + cAnim17 * vec2(1.0, -2.0);
              vec2 cFlow2 = causticsUv * 1.5 + cAnim23 * vec2(-1.0, 2.0);
              float aberration = 0.005;
              float cr = min(
                  texture(uWaterCausticsMap, cFlow1 + aberration * vec2(1.0, 1.0)).r,
                  texture(uWaterCausticsMap, cFlow2 + aberration * vec2(1.0, 1.0)).r);
              float cg = min(
                  texture(uWaterCausticsMap, cFlow1 + aberration * vec2(1.0, -1.0)).r,
                  texture(uWaterCausticsMap, cFlow2 + aberration * vec2(1.0, -1.0)).r);
              float cb = min(
                  texture(uWaterCausticsMap, cFlow1 + aberration * vec2(-1.0, -1.0)).r,
                  texture(uWaterCausticsMap, cFlow2 + aberration * vec2(-1.0, -1.0)).r);
              vec3 caustics = vec3(cr, cg, cb);

              float lightDot = max(dot(vec3(0.0, -1.0, 0.0), uSunDirection), 0.0);
              uwColor *= 1.0 + caustics * vec3(0.8, 0.9, 1.0) * 0.6 * lightDot * uSunStrength;

              // Standard lighting on underwater terrain
              vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
              float NdotL = abs(dot(N, uSunDirection));
              float shadow = (uShadowsEnabled != 0) ? sampleShadow(vWorldPos) : 1.0;
              vec3 lit = uAmbientColor * uAmbientStrength + uSunColor * uSunStrength * NdotL * (1.0 - shadow);
              uwColor *= lit;

              // Fog
              float dist = length(vWorldPos);
              float f = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
              float fogFactor = 1.0 - exp(-f * f * 3.0);
              uwColor = mix(uwColor, uFogColor, fogFactor);

              FragColor = vec4(uwColor, 1.0);
              IdOutput = 0;
              return;
          }

          // ===== WATER SURFACE SHADING (RLHD-inspired) =====
          if (vWaterType > 0 && uWaterEnabled != 0) {
              int wIdx = vWaterType - 1;

              // World-space UVs using ABSOLUTE position (not camera-relative)
              vec2 worldUv = -absWorldPos.xz / (128.0 * 3.0);
              float duration = uWaterDuration[wIdx];

              // Two animated normal map layers scrolling at different speeds/directions
              // RLHD: animationFrame(N) = mod(elapsedSeconds, N) / N → 0..1 over N seconds
              float anim28 = mod(uTick, 28.0 * duration) / (28.0 * duration);
              float anim24 = mod(uTick, 24.0 * duration) / (24.0 * duration);
              vec2 uv1 = worldUv.yx - vec2(anim28);
              vec2 uv2 = worldUv + vec2(anim24);

              // Flow map distortion for organic movement
              float anim50 = mod(uTick, 50.0 * duration) / (50.0 * duration);
              vec2 flowUv = worldUv / 5.0 + vec2(anim50);
              vec2 flow = texture(uWaterFlowMap, flowUv).rg * 0.025;
              uv1 += flow;
              uv2 += flow;
              vec2 uv3 = vTexCoord + flow;

              // Sample normal maps with linearToSrgb conversion (Gap 9)
              vec3 n1raw = texture(uWaterNormalMap, uv1).rgb;
              vec3 n2raw = texture(uWaterNormalMap, uv2).rgb;
              n1raw = pow(n1raw, vec3(1.0 / 2.2));
              n2raw = pow(n2raw, vec3(1.0 / 2.2));
              vec3 n1 = n1raw * 2.0 - 1.0;
              vec3 n2 = n2raw * 2.0 - 1.0;
              float nStr = uWaterNormalStrength[wIdx];
              n1 = -vec3(n1.x * nStr, n1.z, n1.y * nStr);
              n2 = -vec3(n2.x * nStr, n2.z, n2.y * nStr);
              vec3 waterNormal = normalize(n1 + n2);

              // Dot products for lighting
              float lightDotNormals = dot(waterNormal, uSunDirection);
              vec3 viewDir = normalize(-vWorldPos);
              float viewDotNormals = dot(viewDir, waterNormal);

              // Shadow
              float shadow = 1.0;
              if (uShadowsEnabled != 0) {
                  shadow = sampleShadow(vWorldPos);
              }
              float inverseShadow = 1.0 - shadow;

              // Composite lighting (ambient + directional diffuse + sky light)
              vec3 ambientOut = uAmbientColor * uAmbientStrength;
              vec3 dirLightColor = uSunColor * uSunStrength * inverseShadow;
              vec3 diffuseOut = max(lightDotNormals, 0.0) * dirLightColor;
              vec3 skyLightOut = max(-waterNormal.y, 0.0) * uFogColor * 0.5;

              // Specular sun glint
              vec3 lightReflectDir = reflect(-uSunDirection, waterNormal);
              float spec = pow(max(dot(lightReflectDir, viewDir), 0.0), uWaterSpecGloss[wIdx]);
              vec3 specularOut = dirLightColor * spec * uWaterSpecStrength[wIdx];

              vec3 compositeLight = ambientOut + diffuseOut + specularOut + skyLightOut;

              // Fresnel — steep angle shows water color, shallow angle shows sky reflection
              float fresnel = 1.0 - clamp(viewDotNormals, 0.0, 1.0);
              float baseOpacity = uWaterOpacity[wIdx];
              float finalFresnel = clamp(mix(baseOpacity, 1.0, fresnel * 1.2), 0.0, 1.0);

              // Shadow reduces fresnel slightly (shadowed water less reflective)
              finalFresnel -= finalFresnel * shadow * 0.2;

              // Sky color gradient for reflection (3-stop gradient)
              vec3 surfColor = uWaterSurfaceColor[wIdx];
              vec3 depthColor = uWaterDepthColor[wIdx];
              vec3 skyTint = vec3(0.8, 0.85, 0.95);
              vec3 surfaceColor;
              if (finalFresnel < 0.5) {
                  surfaceColor = mix(depthColor, surfColor, finalFresnel * 2.0);
              } else {
                  surfaceColor = mix(surfColor, skyTint, (finalFresnel - 0.5) * 2.0);
              }
              vec3 surfaceColorOut = surfaceColor * max(uWaterSpecStrength[wIdx], 0.2);

              // Apply lighting to surface color
              vec3 baseColor = surfColor * compositeLight;
              baseColor = mix(baseColor, surfaceColor, uWaterFresnelAmount[wIdx]);

              // Shore foam (Gap 5) — sample foam texture, blend at edges
              float foamAmount = 0.0;
              if (uWaterHasFoam[wIdx] != 0) {
                  float foamMask = texture(uWaterFoamMap, uv3).r;
                  // Use vertex color brightness as shore proximity hint
                  // Brighter vertex color = closer to land edge
                  float shoreMask = 1.0 - clamp(length(vColor - vec3(0.5)) * 2.0, 0.0, 1.0);
                  foamAmount = clamp(shoreMask * 0.5, 0.0, 0.8);
                  foamAmount *= foamMask;
                  vec3 foamColor = uWaterFoamColor[wIdx] * foamMask * compositeLight;
                  baseColor = mix(baseColor, foamColor, foamAmount);
              }

              // Add specular on top
              vec3 specularComposite = mix(specularOut, vec3(0.0), foamAmount);
              baseColor += specularComposite / 3.0;

              // Flat water mode (Gap 10) — fully opaque, blend depth color into surface
              float waterAlpha;
              if (uWaterIsFlat[wIdx] != 0) {
                  baseColor = mix(depthColor, baseColor,
                      max(baseOpacity, max(foamAmount, max(finalFresnel, length(specularComposite) / 3.0))));
                  waterAlpha = 1.0;
              } else {
                  waterAlpha = max(baseOpacity,
                      max(foamAmount, max(finalFresnel, length(specularComposite) / 3.0)));
              }

              // Distance fog (same as terrain)
              float dist = length(vWorldPos);
              float f = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
              float fogFactor = 1.0 - exp(-f * f * 3.0);
              baseColor = mix(baseColor, uFogColor, fogFactor);

              FragColor = vec4(baseColor, waterAlpha);
              IdOutput = 0;
              return;
          }

          vec3 color;
          if (vTextureId >= 0) {
              vec4 texColor = texture(uTextureArray, vec3(vTexCoord, float(vTextureId)));
              if (texColor.a < 0.01) discard;
              color = texColor.rgb * vColor * 2.0;
          } else {
              color = vColor;
          }

          // GPU-side PBR lighting (Cook-Torrance BRDF)
          if (uLightingEnabled != 0) {
              // Compute face normal
              vec3 N;
              float vnLen = dot(vVertexNormal, vVertexNormal);
              if (vnLen > 0.25) {
                  N = normalize(vVertexNormal);
              } else {
                  N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
                  if (uFlipNormals != 0) N = -N;
              }

              // View vector (camera at origin in view space)
              vec3 V = normalize(-vWorldPos);
              vec3 L = uSunDirection;
              vec3 H = normalize(V + L);

              // Clamp roughness to prevent mirror blow-up if uniform not received (GLSL default = 0)
              float roughness = max(uDefaultRoughness, 0.04);
              float metallic = uDefaultMetallic;

              // Sample PBR material maps if available.
              // Skip PBR for fragments with partial texture alpha — at alpha-test
              // edges, dFdx/dFdy derivatives are undefined (discarded fragment quads),
              // producing garbage normals, parallax offsets, and ORM values.
              float ao = 1.0;
              if (uPbrMapsEnabled != 0 && vTextureId >= 0) {
                  int matIdx = vTextureId * 2;
                  if (matIdx + 1 < materials.length()) {
                      ivec4 mat0 = materials[matIdx];
                      ivec4 mat1 = materials[matIdx + 1];
                      int normalLayer = mat0.x;
                      int ormLayer = mat0.y;
                      int emissionLayer = mat0.z;
                      int heightLayer = mat0.w;
                      int detailLayer = mat1.x;

                      // Parallax occlusion mapping — offset UVs based on height map
                      vec2 pbrTexCoord = vTexCoord;
                      if (heightLayer >= 0 && uParallaxScale > 0.0) {
                          vec3 viewDir = normalize(-vWorldPos);
                          // Compute tangent-space view direction for parallax
                          vec3 dp1 = dFdx(vWorldPos);
                          vec3 dp2 = dFdy(vWorldPos);
                          vec2 duv1 = dFdx(vTexCoord);
                          vec2 duv2 = dFdy(vTexCoord);
                          vec3 dp2p = cross(dp2, N);
                          vec3 dp1p = cross(N, dp1);
                          vec3 T = dp2p * duv1.x + dp1p * duv2.x;
                          vec3 B = dp2p * duv1.y + dp1p * duv2.y;
                          float invM = inversesqrt(max(dot(T, T), dot(B, B)));
                          mat3 tbn = mat3(T * invM, B * invM, N);
                          vec3 tbnView = normalize(transpose(tbn) * viewDir);

                          // Steep parallax mapping (8 layers)
                          float layerDepth = 1.0 / 8.0;
                          float currentLayerDepth = 0.0;
                          vec2 deltaUV = tbnView.xy / tbnView.z * uParallaxScale * layerDepth;
                          vec2 currentUV = vTexCoord;
                          float currentHeight = texture(uHeightArray,
                              vec3(currentUV, float(heightLayer))).r;

                          for (int pi = 0; pi < 8; pi++) {
                              if (currentLayerDepth >= currentHeight) break;
                              currentUV -= deltaUV;
                              currentHeight = texture(uHeightArray,
                                  vec3(currentUV, float(heightLayer))).r;
                              currentLayerDepth += layerDepth;
                          }

                          // Interpolation between last two layers for smooth result
                          vec2 prevUV = currentUV + deltaUV;
                          float afterDepth = currentHeight - currentLayerDepth;
                          float beforeDepth = texture(uHeightArray,
                              vec3(prevUV, float(heightLayer))).r
                              - currentLayerDepth + layerDepth;
                          float weight = afterDepth / (afterDepth - beforeDepth);
                          pbrTexCoord = mix(currentUV, prevUV, weight);
                      }

                      // Normal mapping
                      if (normalLayer >= 0) {
                          vec3 ns = texture(uNormalArray,
                              vec3(pbrTexCoord, float(normalLayer))).rgb * 2.0 - 1.0;
                          N = perturbNormal(N, vWorldPos, pbrTexCoord, ns);
                      }

                      // Detail normal blending (high-frequency micro grain)
                      if (detailLayer >= 0 && uDetailNormalStrength > 0.0) {
                          vec3 dn = texture(uDetailNormalArray,
                              vec3(pbrTexCoord, float(detailLayer))).rgb * 2.0 - 1.0;
                          // UDN blending: blend detail into existing normal
                          vec3 detailN = perturbNormal(N, vWorldPos, pbrTexCoord, dn);
                          N = normalize(mix(N, detailN, uDetailNormalStrength));
                      }

                      // ORM sampling
                      if (ormLayer >= 0) {
                          vec3 orm = texture(uORMArray,
                              vec3(pbrTexCoord, float(ormLayer))).rgb;
                          ao = orm.r;
                          roughness = orm.g;
                          metallic = orm.b;
                      }

                      // Emission (additive, feeds bloom via HDR values > 1.0)
                      if (emissionLayer >= 0 && uEmissionStrength > 0.0) {
                          vec3 emissionColor = texture(uEmissionArray,
                              vec3(pbrTexCoord, float(emissionLayer))).rgb;
                          // Emission is applied after lighting (additive)
                          // Store for later — will be added after Lo + ambient
                      }
                  }
              }

              // Base reflectivity: dielectric = 0.04, metallic = albedo color
              vec3 albedo = color;
              vec3 F0 = mix(vec3(0.04), albedo, metallic);

              // Cook-Torrance specular BRDF
              float NDF = distributionGGX(N, H, roughness);
              float G = geometrySmith(N, V, L, roughness);
              vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

              vec3 numerator = NDF * G * F;
              float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
              vec3 specular = numerator / denominator;

              // Simplified energy conservation — full Fresnel-based kD creates visible
              // dark rings on terrain where the view/sun half-vector modulates diffuse.
              // Use metallic-only gating: metals have no diffuse, dielectrics have full diffuse.
              vec3 kD = vec3(1.0 - metallic);

              // Terrain (uFlipNormals=0): one-sided directional.
              // Models (uFlipNormals=1): abs() so co-planar back-to-back faces
              // on thin walls produce identical color (no z-fight flicker).
              // Hemisphere ambient still provides vertical directionality.
              float rawNdotL = dot(N, L);
              float NdotL = (uFlipNormals != 0)
                  ? abs(rawNdotL)
                  : max(rawNdotL, 0.0);

              // Shadow
              float shadow = (uShadowsEnabled != 0) ? sampleShadow(vWorldPos) : 1.0;

              // Final lighting: diffuse + specular with shadow + AO
              // Note: skipping /PI on diffuse term — matches most game engines (Unreal, Unity).
              // Physically the PI normalization is correct but makes everything ~3x darker,
              // requiring compensating light intensity increases across all presets.
              vec3 Lo = (kD * albedo + specular) * uSunColor * uSunStrength * NdotL * shadow;

              // Hemisphere ambient: sky color from above, warm ground bounce from below
              float hemisphere = N.y * 0.5 + 0.5;
              vec3 skyAmbient = uAmbientColor * uAmbientStrength;
              vec3 groundAmbient = skyAmbient * vec3(0.5, 0.4, 0.35);
              vec3 ambient = mix(groundAmbient, skyAmbient, hemisphere) * albedo * ao;
              color = ambient + Lo;

              // Subsurface scattering approximation (wrap lighting)
              if (uSubsurfaceStrength > 0.0) {
                  float wrap = max(0.0, (dot(N, L) + 0.5) / 1.5);
                  vec3 subsurface = albedo * uSunColor * wrap * uSubsurfaceStrength;
                  color += subsurface;
              }

              // Clear coat: secondary specular lobe (non-metallic, low roughness)
              if (uClearCoatStrength > 0.0) {
                  float ccRoughness = 0.1;
                  float ccNDF = distributionGGX(N, H, ccRoughness);
                  float ccG = geometrySmith(N, V, L, ccRoughness);
                  vec3 ccF = fresnelSchlick(max(dot(H, V), 0.0), vec3(0.04));
                  vec3 ccSpec = (ccNDF * ccG * ccF)
                      / (4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001);
                  color += ccSpec * uSunColor * uSunStrength * NdotL * shadow * uClearCoatStrength;
              }

              // Emission (additive, values > 1.0 feed bloom naturally)
              if (uPbrMapsEnabled != 0 && vTextureId >= 0) {
                  int emIdx = vTextureId * 2;
                  if (emIdx < materials.length()) {
                      int emLayer = materials[emIdx].z;
                      if (emLayer >= 0 && uEmissionStrength > 0.0) {
                          vec2 emUV = vTexCoord; // emission uses base UV (not parallax-offset)
                          vec3 emColor = texture(uEmissionArray,
                              vec3(emUV, float(emLayer))).rgb;
                          color += emColor * uEmissionStrength;
                      }
                  }
              }
          }

          // Distance fog (exponential squared) — linearize fog color to match scene
          float dist = length(vWorldPos);
          float f = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
          float fogFactor = 1.0 - exp(-f * f * 3.0);
          color = mix(color, uFogColor, fogFactor);

          // Highlight hovered entity (editor object selection)
          if (uHighlightEntityId != 0 && vEntityId == uHighlightEntityId) {
              color = mix(color, vec3(0.0, 0.8, 1.0), 0.4);
          }

          FragColor = vec4(color, alpha);
          // Output entity ID to picking buffer
          IdOutput = vEntityId;
      }
      """;

  public static final String HIZ_GENERATE_COMPUTE =
      """
      #version 460 core
      layout(local_size_x = 16, local_size_y = 16) in;

      uniform sampler2D uInputDepth;
      layout(r32f, binding = 0) writeonly uniform image2D uOutputMip;
      uniform ivec2 uOutputSize;
      uniform int uCopyPass; // 1 = direct 1:1 copy (mip 0), 0 = 2x2 max downsample (mip 1+)

      void main() {
          ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
          if (pos.x >= uOutputSize.x || pos.y >= uOutputSize.y) return;

          if (uCopyPass != 0) {
              // Mip 0: direct 1:1 copy from depth buffer
              float d = texelFetch(uInputDepth, pos, 0).r;
              imageStore(uOutputMip, pos, vec4(d));
          } else {
              // Mip 1+: 2x2 max downsample from previous mip
              ivec2 srcPos = pos * 2;
              float d0 = texelFetch(uInputDepth, srcPos, 0).r;
              float d1 = texelFetch(uInputDepth, srcPos + ivec2(1, 0), 0).r;
              float d2 = texelFetch(uInputDepth, srcPos + ivec2(0, 1), 0).r;
              float d3 = texelFetch(uInputDepth, srcPos + ivec2(1, 1), 0).r;

              // Max = farthest depth. If occludee is behind this, it's behind everything.
              imageStore(uOutputMip, pos, vec4(max(max(d0, d1), max(d2, d3))));
          }
      }
      """;

  public static final String BLOCK_CULL_COMPUTE =
      """
      #version 460 core
      layout(local_size_x = 64) in;

      // Per-block metadata: 6 ints each (vboOffset, vertexCount, minX, minZ, maxX, maxZ)
      layout(std430, binding = 0) readonly buffer BlockMeta {
          int blockMeta[];
      };

      // DrawArraysIndirectCommand: { count, instanceCount, first, baseInstance }
      layout(std430, binding = 1) writeonly buffer DrawCommands {
          uint drawCmds[];
      };

      // Atomic draw command count
      layout(std430, binding = 2) buffer DrawCount {
          uint drawCount;
      };

      uniform vec4 uFrustumPlanes[6];
      uniform vec3 uCameraPos;
      uniform uint uTotalBlocks;
      uniform mat4 uViewProjection;
      uniform vec2 uScreenSize;
      uniform sampler2D uHiZMap;
      uniform int uHiZMipLevels;
      uniform int uHiZEnabled;

      void main() {
          uint blockIdx = gl_GlobalInvocationID.x;
          if (blockIdx >= uTotalBlocks) return;

          // Read block metadata
          uint base = blockIdx * 6u;
          int vboOffset   = blockMeta[base];
          int vertexCount = blockMeta[base + 1u];
          float minX = float(blockMeta[base + 2u]);
          float minZ = float(blockMeta[base + 3u]);
          float maxX = float(blockMeta[base + 4u]);
          float maxZ = float(blockMeta[base + 5u]);

          if (vertexCount == 0) return;

          // Block AABB (camera-relative). Y range covers all terrain heights.
          vec3 bMin = vec3(minX - uCameraPos.x, -3000.0 - uCameraPos.y, minZ - uCameraPos.z);
          vec3 bMax = vec3(maxX - uCameraPos.x,  2000.0 - uCameraPos.y, maxZ - uCameraPos.z);

          // --- Frustum cull: test AABB against 6 planes ---
          for (int i = 0; i < 6; i++) {
              vec4 pl = uFrustumPlanes[i];
              float d = max(bMin.x * pl.x, bMax.x * pl.x)
                      + max(bMin.y * pl.y, bMax.y * pl.y)
                      + max(bMin.z * pl.z, bMax.z * pl.z)
                      + pl.w;
              if (d < 0.0) return;
          }

          // --- Hi-Z occlusion cull: test block AABB against previous frame's depth ---
          if (uHiZEnabled != 0) {
              // Project all 8 AABB corners to find screen-space bounding rect + min depth
              vec2 ssRectMin = vec2(1.0);
              vec2 ssRectMax = vec2(0.0);
              float nearestDepth = 1.0;
              bool allBehindNear = true;

              for (int c = 0; c < 8; c++) {
                  vec3 corner = vec3(
                      (c & 1) != 0 ? bMax.x : bMin.x,
                      (c & 2) != 0 ? bMax.y : bMin.y,
                      (c & 4) != 0 ? bMax.z : bMin.z
                  );
                  vec4 clip = uViewProjection * vec4(corner, 1.0);
                  if (clip.w > 0.0) {
                      allBehindNear = false;
                      vec3 ndc = clip.xyz / clip.w;
                      vec2 ss = ndc.xy * 0.5 + 0.5;
                      ssRectMin = min(ssRectMin, ss);
                      ssRectMax = max(ssRectMax, ss);
                      nearestDepth = min(nearestDepth, ndc.z * 0.5 + 0.5);
                  }
              }

              // If any corner is in front of near plane, skip Hi-Z (partially clipped)
              if (!allBehindNear) {
                  ssRectMin = clamp(ssRectMin, 0.0, 1.0);
                  ssRectMax = clamp(ssRectMax, 0.0, 1.0);

                  vec2 ssSize = (ssRectMax - ssRectMin) * uScreenSize;
                  float mipLevel = ceil(log2(max(max(ssSize.x, ssSize.y), 1.0)));
                  mipLevel = clamp(mipLevel, 0.0, float(uHiZMipLevels - 1));

                  float h0 = textureLod(uHiZMap, vec2(ssRectMin.x, ssRectMin.y), mipLevel).r;
                  float h1 = textureLod(uHiZMap, vec2(ssRectMax.x, ssRectMin.y), mipLevel).r;
                  float h2 = textureLod(uHiZMap, vec2(ssRectMin.x, ssRectMax.y), mipLevel).r;
                  float h3 = textureLod(uHiZMap, vec2(ssRectMax.x, ssRectMax.y), mipLevel).r;
                  float hiZ = max(max(h0, h1), max(h2, h3));

                  if (nearestDepth > hiZ) return;
              }
          }

          // Block is visible — write DrawArraysIndirectCommand
          uint slot = atomicAdd(drawCount, 1u);
          uint cmdBase = slot * 4u;
          drawCmds[cmdBase]      = uint(vertexCount);  // count
          drawCmds[cmdBase + 1u] = 1u;                 // instanceCount
          drawCmds[cmdBase + 2u] = uint(vboOffset);    // first
          drawCmds[cmdBase + 3u] = 0u;                 // baseInstance
      }
      """;

  public static final String MODEL_VERTEX =
      """
      #version 460 core

      layout (location = 0) in ivec4 aPositionAndColor;
      layout (location = 1) in int aAlpha;
      layout (location = 2) in int aTextureId;
      layout (location = 3) in vec2 aTexCoord;
      layout (location = 4) in int aBackColor;

      uniform mat4 uViewProjection;
      uniform vec3 uCameraPosition;

      out vec3 vColor;
      out vec3 vBackColor;
      flat out int vAlpha;
      flat out int vTextureId;
      out vec2 vTexCoord;

      void main() {
          vec3 pos = vec3(aPositionAndColor.xyz) - uCameraPosition;
          gl_Position = uViewProjection * vec4(pos, 1.0);
          int rgb = aPositionAndColor.w;
          vColor = vec3(
              float((rgb >> 16) & 0xFF) / 255.0,
              float((rgb >> 8) & 0xFF) / 255.0,
              float(rgb & 0xFF) / 255.0
          );
          vBackColor = vec3(
              float((aBackColor >> 16) & 0xFF) / 255.0,
              float((aBackColor >> 8) & 0xFF) / 255.0,
              float(aBackColor & 0xFF) / 255.0
          );
          vAlpha = aAlpha;
          vTextureId = aTextureId;
          vTexCoord = aTexCoord;
      }
      """;

  public static final String MODEL_FRAGMENT =
      """
      #version 460 core

      uniform sampler2DArray uTextureArray;
      uniform int uPassMode;

      in vec3 vColor;
      in vec3 vBackColor;
      flat in int vAlpha;
      flat in int vTextureId;
      in vec2 vTexCoord;

      out vec4 FragColor;

      void main() {
          float alpha = float(vAlpha) / 255.0;
          if (alpha < 0.01) discard;

          if (uPassMode == 0 && alpha < 0.99) discard;
          if (uPassMode == 1 && alpha >= 0.99) discard;

          vec3 sideColor = gl_FrontFacing ? vColor : vBackColor;

          if (vTextureId >= 0) {
              vec4 texColor = texture(uTextureArray, vec3(vTexCoord, float(vTextureId)));
              if (texColor.a < 0.01) discard;
              vec3 modulated = clamp(texColor.rgb * sideColor * 2.0, 0.0, 1.0);
              FragColor = vec4(modulated, alpha);
          } else {
              FragColor = vec4(sideColor, alpha);
          }
      }
      """;
}
