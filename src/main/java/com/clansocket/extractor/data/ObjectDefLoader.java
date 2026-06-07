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

public final class ObjectDefLoader {

  private ObjectDefLoader() {}

  private static final Gson GSON = new Gson();

  public static Map<Integer, ObjectDef> loadAll(Path objectsDir) throws IOException {
    Map<Integer, ObjectDef> byId = new HashMap<>();
    if (!Files.isDirectory(objectsDir)) {
      throw new IOException("Objects directory not found: " + objectsDir);
    }

    try (Stream<Path> stream = Files.list(objectsDir)) {
      List<Path> chunks = stream
          .filter(p -> {
            String fn = p.getFileName().toString();
            return fn.startsWith("Objects-") && fn.endsWith(".json");
          })
          .sorted()
          .toList();

      for (Path chunk : chunks) {
        ObjectDef[] defs = readChunk(chunk);
        if (defs == null) continue;
        for (ObjectDef def : defs) {
          if (def != null) byId.put(def.id, def);
        }
      }
    }

    return byId;
  }

  private static ObjectDef @Nullable [] readChunk(Path chunk) throws IOException {
    try (Reader reader = Files.newBufferedReader(chunk)) {
      return GSON.fromJson(reader, ObjectDef[].class);
    } catch (Exception e) {
      System.err.println("[ObjectDefLoader] failed to read " + chunk + ": " + e.getMessage());
      return null;
    }
  }
}
