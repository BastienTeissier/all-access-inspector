package accessinspector;

import accessinspector.Inventory.Axis;
import accessinspector.Inventory.Endpoint;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** The shared samples every Base Script serialises byte for byte. */
final class Samples {
  private Samples() {}

  static final Path DIR = Path.of("..", "..", "schema", "samples");

  static String text(String name) {
    try {
      return Files.readString(DIR.resolve(name));
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  static Inventory load(String name) {
    return Inventory.fromJson(text(name));
  }

  static Endpoint endpoint(String method, String path, String handler) {
    var axis = new Axis("anonymous", "framework-default", null, "builtin:no_chain", null);
    return new Endpoint(method, path, handler, axis, new Axis("none", "framework-default", null, "builtin:no_chain", null), Map.of("access_tier", "public"), null, false);
  }

  static Endpoint endpoint(String method, String path) {
    return endpoint(method, path, "com.acme.ShopController.list");
  }

  static Inventory withEndpoints(Inventory i, java.util.List<Endpoint> endpoints) {
    return new Inventory(i.schemaVersion(), i.stack(), i.discoveryMode(), i.coverage(), i.coverageNote(), i.baseScript(), i.bootEnvironment(), i.projectDimensions(), i.expectedAccess(), endpoints);
  }
}
