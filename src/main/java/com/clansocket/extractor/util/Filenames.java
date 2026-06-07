package com.clansocket.extractor.util;

/**
 * Filename helpers for query-friendly asset output. Format: <id>__<name>.png
 * where name is sanitized to lowercase alphanumerics + single underscores.
 *
 * Lookup patterns:
 *   by id   — glob "<id>__*.png"
 *   by name — glob "*__<name>.png" or contains "*<name>*"
 *   split   — name.split("__", 2) yields ["<id>", "<name>.png"]
 */
public final class Filenames {

  private Filenames() {}

  private static final int MAX_NAME_LEN = 80;

  public static String pngFor(int id, String name) {
    String safe = sanitize(name);
    if (safe == null || safe.isEmpty()) return id + ".png";
    return id + "__" + safe + ".png";
  }

  public static String sanitize(String name) {
    if (name == null) return null;
    StringBuilder out = new StringBuilder(Math.min(name.length(), MAX_NAME_LEN));
    boolean lastUnderscore = false;
    for (int i = 0; i < name.length() && out.length() < MAX_NAME_LEN; i++) {
      char c = name.charAt(i);
      if (c >= 'a' && c <= 'z') { out.append(c); lastUnderscore = false; }
      else if (c >= 'A' && c <= 'Z') { out.append((char)(c + 32)); lastUnderscore = false; }
      else if (c >= '0' && c <= '9') { out.append(c); lastUnderscore = false; }
      else if (!lastUnderscore && out.length() > 0) { out.append('_'); lastUnderscore = true; }
    }
    while (out.length() > 0 && out.charAt(out.length() - 1) == '_') out.deleteCharAt(out.length() - 1);
    return out.length() == 0 ? null : out.toString();
  }
}
