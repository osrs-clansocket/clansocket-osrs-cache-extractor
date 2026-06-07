package com.clansocket.extractor.data;

import com.google.gson.Gson;
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
 * Loads all Items-N.json chunk files from a configs directory into a single
 * id-indexed map.
 *
 * Expected directory layout (output of pipeline/lossless/extract-raw.mjs):
 *   &lt;configs&gt;/Items-0.json
 *   &lt;configs&gt;/Items-1.json
 *   ...
 *
 * Each chunk file is a JSON array of ItemDef-shaped objects.
 */
public final class ItemDefLoader {

  private ItemDefLoader() {}

  private static final Gson GSON = new Gson();

  public static Map<Integer, ItemDef> loadAll(Path itemsDir) throws IOException {
    Map<Integer, ItemDef> byId = new HashMap<>();
    if (!Files.isDirectory(itemsDir)) {
      throw new IOException("Items directory not found: " + itemsDir);
    }

    try (Stream<Path> stream = Files.list(itemsDir)) {
      List<Path> chunks = stream
          .filter(p -> {
            String fn = p.getFileName().toString();
            return fn.startsWith("Items-") && fn.endsWith(".json");
          })
          .sorted()
          .toList();

      for (Path chunk : chunks) {
        ItemDef[] defs = readChunk(chunk);
        if (defs == null) continue;
        for (ItemDef def : defs) {
          if (def != null) byId.put(def.id, def);
        }
      }
    }

    return byId;
  }

  private static ItemDef @Nullable [] readChunk(Path chunk) throws IOException {
    try (Reader reader = Files.newBufferedReader(chunk)) {
      ItemDef[] defs = GSON.fromJson(reader, ItemDef[].class);
      return defs;
    } catch (Exception e) {
      System.err.println("[ItemDefLoader] failed to read " + chunk + ": " + e.getMessage());
      return null;
    }
  }
}
