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

public final class NpcDefLoader {

  private NpcDefLoader() {}

  private static final Gson GSON = new Gson();

  public static Map<Integer, NpcDef> loadAll(Path npcsDir) throws IOException {
    Map<Integer, NpcDef> byId = new HashMap<>();
    if (!Files.isDirectory(npcsDir)) {
      throw new IOException("Npcs directory not found: " + npcsDir);
    }

    try (Stream<Path> stream = Files.list(npcsDir)) {
      List<Path> chunks = stream
          .filter(p -> {
            String fn = p.getFileName().toString();
            return fn.startsWith("Npcs-") && fn.endsWith(".json");
          })
          .sorted()
          .toList();

      for (Path chunk : chunks) {
        NpcDef[] defs = readChunk(chunk);
        if (defs == null) continue;
        for (NpcDef def : defs) {
          if (def != null) byId.put(def.id, def);
        }
      }
    }

    return byId;
  }

  private static NpcDef @Nullable [] readChunk(Path chunk) throws IOException {
    try (Reader reader = Files.newBufferedReader(chunk)) {
      return GSON.fromJson(reader, NpcDef[].class);
    } catch (Exception e) {
      System.err.println("[NpcDefLoader] failed to read " + chunk + ": " + e.getMessage());
      return null;
    }
  }
}
