package com.bestbudz.engine.gpu.shader;

import java.nio.FloatBuffer;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL20;
import org.lwjgl.opengl.GL32;
import org.lwjgl.opengl.GL43;
import org.lwjgl.system.MemoryUtil;

public class ShaderProgram {

  private static final FloatBuffer MATRIX_BUFFER = MemoryUtil.memAllocFloat(16);
  private static final FloatBuffer UNIFORM_2FV_BUFFER = MemoryUtil.memAllocFloat(256);

  private int programId;
  private boolean valid;

  public static ShaderProgram createCompute(String computeSource) {
    return new ShaderProgram(computeSource);
  }

  private ShaderProgram(String computeSource) {
    programId = 0;
    valid = false;

    int computeShader = compileShader(GL43.GL_COMPUTE_SHADER, computeSource);
    if (computeShader == 0) return;

    programId = GL20.glCreateProgram();
    GL20.glAttachShader(programId, computeShader);
    GL20.glLinkProgram(programId);

    if (GL20.glGetProgrami(programId, GL20.GL_LINK_STATUS) == GL11.GL_FALSE) {
      String error = GL20.glGetProgramInfoLog(programId);
      System.err.println("[ShaderProgram] Compute link failed: " + error);
      GL20.glDeleteProgram(programId);
      programId = 0;
      GL20.glDeleteShader(computeShader);
      return;
    }

    GL20.glDeleteShader(computeShader);
    valid = true;
  }

  public ShaderProgram(String vertexSource, String fragmentSource) {
    this(vertexSource, "", fragmentSource);
  }

  public ShaderProgram(String vertexSource, String geometrySource, String fragmentSource) {
    programId = 0;
    valid = false;

    int vertexShader = compileShader(GL20.GL_VERTEX_SHADER, vertexSource);
    if (vertexShader == 0) {
      return;
    }

    int geometryShader = 0;
    if (!geometrySource.isEmpty()) {
      geometryShader = compileShader(GL32.GL_GEOMETRY_SHADER, geometrySource);
      if (geometryShader == 0) {
        GL20.glDeleteShader(vertexShader);
        return;
      }
    }

    int fragmentShader = compileShader(GL20.GL_FRAGMENT_SHADER, fragmentSource);
    if (fragmentShader == 0) {
      GL20.glDeleteShader(vertexShader);
      if (geometryShader != 0) GL20.glDeleteShader(geometryShader);
      return;
    }

    programId = GL20.glCreateProgram();
    GL20.glAttachShader(programId, vertexShader);
    if (geometryShader != 0) GL20.glAttachShader(programId, geometryShader);
    GL20.glAttachShader(programId, fragmentShader);
    GL20.glLinkProgram(programId);

    if (GL20.glGetProgrami(programId, GL20.GL_LINK_STATUS) == GL11.GL_FALSE) {
      String error = GL20.glGetProgramInfoLog(programId);
      System.err.println("[ShaderProgram] Link failed: " + error);
      GL20.glDeleteProgram(programId);
      programId = 0;
      GL20.glDeleteShader(vertexShader);
      if (geometryShader != 0) GL20.glDeleteShader(geometryShader);
      GL20.glDeleteShader(fragmentShader);
      return;
    }

    GL20.glDeleteShader(vertexShader);
    if (geometryShader != 0) GL20.glDeleteShader(geometryShader);
    GL20.glDeleteShader(fragmentShader);
    valid = true;
  }

  private static int compileShader(int type, String source) {
    int shader = GL20.glCreateShader(type);
    GL20.glShaderSource(shader, source);
    GL20.glCompileShader(shader);

    if (GL20.glGetShaderi(shader, GL20.GL_COMPILE_STATUS) == GL11.GL_FALSE) {
      String error = GL20.glGetShaderInfoLog(shader);
      String typeName;
      if (type == GL20.GL_VERTEX_SHADER) typeName = "vertex";
      else if (type == GL20.GL_FRAGMENT_SHADER) typeName = "fragment";
      else if (type == GL32.GL_GEOMETRY_SHADER) typeName = "geometry";
      else if (type == GL43.GL_COMPUTE_SHADER) typeName = "compute";
      else typeName = "unknown(" + type + ")";
      System.err.println("[ShaderProgram] " + typeName + " compile failed: " + error);
      GL20.glDeleteShader(shader);
      return 0;
    }

    return shader;
  }

  public void bind() {
    GL20.glUseProgram(programId);
  }

  public void unbind() {
    GL20.glUseProgram(0);
  }

  public int getUniformLocation(String name) {
    return GL20.glGetUniformLocation(programId, name);
  }

  public void setUniform1i(int location, int value) {
    GL20.glUniform1i(location, value);
  }

  public void setUniform1f(int location, float value) {
    GL20.glUniform1f(location, value);
  }

  public void setUniform2f(int location, float valueX, float valueY) {
    GL20.glUniform2f(location, valueX, valueY);
  }

  public void setUniform3f(int location, float valueX, float valueY, float valueZ) {
    GL20.glUniform3f(location, valueX, valueY, valueZ);
  }

  public void setUniform4f(int location, float valueX, float valueY, float valueZ, float valueW) {
    GL20.glUniform4f(location, valueX, valueY, valueZ, valueW);
  }

  public void setUniform2i(int location, int valueX, int valueY) {
    GL20.glUniform2i(location, valueX, valueY);
  }

  public void setUniform2fv(int location, float[] values) {
    UNIFORM_2FV_BUFFER.clear();
    UNIFORM_2FV_BUFFER.put(values, 0, Math.min(values.length, 256)).flip();
    GL20.glUniform2fv(location, UNIFORM_2FV_BUFFER);
  }

  public void setUniformMatrix4fv(int location, float[] matrix) {
    MATRIX_BUFFER.clear();
    MATRIX_BUFFER.put(matrix).flip();
    GL20.glUniformMatrix4fv(location, false, MATRIX_BUFFER);
  }

  public boolean isValid() {
    return valid;
  }

  public int getProgramId() {
    return programId;
  }

  public void cleanup() {
    if (programId != 0) {
      GL20.glDeleteProgram(programId);
      programId = 0;
      valid = false;
    }
  }
}
