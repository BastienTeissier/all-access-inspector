package accessinspector;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

/** Endpoint Inventory model, canonical serialisation and the checks JSON Schema cannot express. */
record Inventory(
    String schemaVersion,
    String stack,
    String discoveryMode,
    String coverage,
    String coverageNote,
    BaseScript baseScript,
    BootEnvironment bootEnvironment,
    Map<String, List<String>> projectDimensions,
    Map<String, Map<String, Expected>> expectedAccess,
    List<Endpoint> endpoints) {

  static final String SCHEMA_VERSION = "1";
  static final List<String> METHODS = List.of("ANY", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT");
  static final List<String> AUTHENTICATION = List.of("anonymous", "optional", "required", "unknown");
  static final List<String> AUTHORIZATION = List.of("none", "rule", "unknown");
  static final List<String> LAYERS = Arrays.asList("global", "class", "method", "framework-default", null);
  static final Map<String, List<String>> EXPECTED_AXES =
      ordered(Map.entry("authentication", List.of("anonymous", "optional", "required")), Map.entry("authorization", List.of("none", "rule")));

  /** value, layer, raw, rule; evidence is the Recognition Rule's file:line, null otherwise. */
  record Axis(String value, String layer, String raw, String rule, String evidence) {}

  /** acknowledged: the unknown_reason is an Acknowledged Unknown's. */
  record Endpoint(
      String method,
      String path,
      String handler,
      Axis authentication,
      Axis authorization,
      Map<String, String> dimensions,
      String unknownReason,
      boolean acknowledged) {

    Endpoint withDimensions(Map<String, String> dimensions) {
      return new Endpoint(method, path, handler, authentication, authorization, dimensions, unknownReason, acknowledged);
    }
  }

  record BaseScript(String stack, String version) {}

  record Env(String name, String value, String reason) {}

  record Stub(String target, String reason) {}

  record Pin(String setting, Object value, String reason) {}

  record BootEnvironment(String entry, List<Env> environ, List<Stub> stubs, List<Pin> pinned) {}

  /** What a dimension value should allow, as the team confirmed it. */
  record Expected(List<String> authentication, List<String> authorization) {}

  static final class ValidationError extends RuntimeException {
    ValidationError(String message) {
      super(message);
    }
  }

  @SafeVarargs
  static <V> Map<String, V> ordered(Map.Entry<String, V>... entries) {
    var map = new LinkedHashMap<String, V>();
    for (var e : entries) map.put(e.getKey(), e.getValue());
    return map;
  }

  static boolean isUnknown(Endpoint e) {
    return e.authentication().value().equals("unknown") || e.authorization().value().equals("unknown");
  }

  static String label(Endpoint e) {
    return e.method() + " " + e.path() + " (" + e.handler() + ")";
  }

  /** Code point order, as Python sorts strings; String.compareTo compares UTF-16 code units. */
  static int compareText(String a, String b) {
    int[] x = a.codePoints().toArray();
    int[] y = b.codePoints().toArray();
    return Arrays.compare(x, y);
  }

  static final Comparator<Endpoint> ORDER = Comparator.<Endpoint, String>comparing(Endpoint::path, Inventory::compareText)
      .thenComparing(Endpoint::method, Inventory::compareText)
      .thenComparing(Endpoint::handler, Inventory::compareText);

  private static List<String> identity(Endpoint e) {
    return List.of(e.path(), e.method(), e.handler());
  }

  // --- canonical form ---

  private static Map<String, Object> tree(Axis a) {
    var m = new LinkedHashMap<String, Object>();
    m.put("value", a.value());
    m.put("layer", a.layer());
    m.put("raw", a.raw());
    m.put("rule", a.rule());
    m.put("evidence", a.evidence());
    return m;
  }

  /** The endpoint's keys in schema order; dimensions in declaration order, any undeclared one after. */
  static Map<String, Object> tree(Endpoint e, List<String> declared) {
    var dimensions = new LinkedHashMap<String, Object>();
    for (String d : declared) if (e.dimensions().containsKey(d)) dimensions.put(d, e.dimensions().get(d));
    e.dimensions().forEach((d, v) -> dimensions.putIfAbsent(d, v));
    var m = new LinkedHashMap<String, Object>();
    m.put("method", e.method());
    m.put("path", e.path());
    m.put("handler", e.handler());
    m.put("authentication", tree(e.authentication()));
    m.put("authorization", tree(e.authorization()));
    m.put("dimensions", dimensions);
    m.put("unknown_reason", e.unknownReason());
    m.put("acknowledged", e.acknowledged());
    return m;
  }

  /** Every object with its keys in schema order, whatever order the source had. */
  static Map<String, Object> tree(Inventory inventory) {
    var boot = inventory.bootEnvironment();
    var environment = new LinkedHashMap<String, Object>();
    environment.put("entry", boot.entry());
    environment.put("environ", boot.environ().stream().map(e -> (Object) ordered(Map.entry("name", e.name()), Map.entry("value", e.value()), Map.entry("reason", e.reason()))).toList());
    environment.put("stubs", boot.stubs().stream().map(s -> (Object) ordered(Map.entry("target", s.target()), Map.entry("reason", s.reason()))).toList());
    environment.put("pinned", boot.pinned().stream().map(p -> {
      var pin = new LinkedHashMap<String, Object>();
      pin.put("setting", p.setting());
      pin.put("value", p.value());
      pin.put("reason", p.reason());
      return (Object) pin;
    }).toList());
    var expected = new LinkedHashMap<String, Object>();
    inventory.expectedAccess().forEach((dimension, values) -> {
      var byValue = new LinkedHashMap<String, Object>();
      values.forEach((value, access) -> byValue.put(value, ordered(Map.entry("authentication", access.authentication()), Map.entry("authorization", access.authorization()))));
      expected.put(dimension, byValue);
    });
    var declared = List.copyOf(inventory.projectDimensions().keySet());
    var m = new LinkedHashMap<String, Object>();
    m.put("schema_version", inventory.schemaVersion());
    m.put("stack", inventory.stack());
    m.put("discovery_mode", inventory.discoveryMode());
    m.put("coverage", inventory.coverage());
    m.put("coverage_note", inventory.coverageNote());
    m.put("base_script", ordered(Map.entry("stack", inventory.baseScript().stack()), Map.entry("version", inventory.baseScript().version())));
    m.put("boot_environment", environment);
    m.put("project_dimensions", new LinkedHashMap<String, Object>(inventory.projectDimensions()));
    m.put("expected_access", expected);
    m.put("endpoints", inventory.endpoints().stream().map(e -> (Object) tree(e, declared)).toList());
    return m;
  }

  static String compact(Endpoint e, Inventory inventory) {
    return Json.compact(tree(e, List.copyOf(inventory.projectDimensions().keySet())));
  }

  /** Serialise per plan §2; the reference bytes are schema/samples/canonical.json. */
  static String toCanonicalJson(Inventory inventory) {
    var header = tree(inventory);
    header.remove("endpoints");
    var lines = new ArrayList<String>();
    lines.add("{");
    header.forEach((key, value) -> lines.add("  " + Json.quote(key) + ": " + Json.compact(value) + ","));
    var declared = List.copyOf(inventory.projectDimensions().keySet());
    var endpoints = inventory.endpoints().stream().sorted(ORDER).map(e -> "    " + Json.compact(tree(e, declared))).toList();
    if (endpoints.isEmpty()) {
      lines.add("  \"endpoints\": []");
    } else {
      lines.add("  \"endpoints\": [");
      lines.add(String.join(",\n", endpoints));
      lines.add("  ]");
    }
    lines.add("}");
    return String.join("\n", lines) + "\n";
  }

  // --- reading ---

  private static Object get(Object map, String key) {
    if (!(map instanceof Map<?, ?> m)) throw new IllegalArgumentException("expected an object holding " + key);
    if (!m.containsKey(key)) throw new IllegalArgumentException("missing key");
    return m.get(key);
  }

  private static String text(Object map, String key) {
    Object value = get(map, key);
    if (value != null && !(value instanceof String)) throw new IllegalArgumentException(key + " must be a string or null");
    return (String) value;
  }

  @SuppressWarnings("unchecked")
  private static <T> List<T> list(Object map, String key) {
    if (!(get(map, key) instanceof List<?> l)) throw new IllegalArgumentException(key + " must be a list");
    return (List<T>) l;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> object(Object map, String key) {
    if (!(get(map, key) instanceof Map<?, ?> m)) throw new IllegalArgumentException(key + " must be an object");
    return (Map<String, Object>) m;
  }

  private static Axis axis(Object a) {
    return new Axis(text(a, "value"), text(a, "layer"), text(a, "raw"), text(a, "rule"), text(a, "evidence"));
  }

  @SuppressWarnings("unchecked")
  private static Endpoint endpoint(Object e) {
    if (!(get(e, "acknowledged") instanceof Boolean acknowledged)) throw new IllegalArgumentException("acknowledged must be a boolean");
    var dimensions = new LinkedHashMap<String, String>();
    object(e, "dimensions").forEach((k, v) -> dimensions.put(k, (String) v));
    return new Endpoint(text(e, "method"), text(e, "path"), text(e, "handler"), axis(get(e, "authentication")), axis(get(e, "authorization")), dimensions, text(e, "unknown_reason"), acknowledged);
  }

  /** Read a Committed Inventory; throws on a missing key, so a malformed file fails before the boot. */
  @SuppressWarnings("unchecked")
  static Inventory fromJson(String json) {
    Object data = Json.parse(json);
    Object boot = get(data, "boot_environment");
    Object base = get(data, "base_script");
    var dimensions = new LinkedHashMap<String, List<String>>();
    object(data, "project_dimensions").forEach((k, v) -> dimensions.put(k, (List<String>) v));
    var expected = new LinkedHashMap<String, Map<String, Expected>>();
    object(data, "expected_access").forEach((dimension, values) -> {
      var byValue = new LinkedHashMap<String, Expected>();
      ((Map<String, Object>) values).forEach((value, access) -> byValue.put(value, new Expected(list(access, "authentication"), list(access, "authorization"))));
      expected.put(dimension, byValue);
    });
    return new Inventory(
        text(data, "schema_version"),
        text(data, "stack"),
        text(data, "discovery_mode"),
        text(data, "coverage"),
        text(data, "coverage_note"),
        new BaseScript(text(base, "stack"), text(base, "version")),
        new BootEnvironment(
            text(boot, "entry"),
            list(boot, "environ").stream().map(e -> new Env(text(e, "name"), text(e, "value"), text(e, "reason"))).toList(),
            list(boot, "stubs").stream().map(s -> new Stub(text(s, "target"), text(s, "reason"))).toList(),
            list(boot, "pinned").stream().map(p -> new Pin(text(p, "setting"), get(p, "value"), text(p, "reason"))).toList()),
        dimensions,
        expected,
        list(data, "endpoints").stream().map(Inventory::endpoint).toList());
  }

  // --- check ---

  /**
   * Diff lines from the Committed Inventory to the regenerated one; empty when they match.
   * Structural, so the committed file's ordering and whitespace never count as a difference.
   */
  static List<String> check(Inventory committedInventory, Inventory currentInventory) {
    var old = tree(committedInventory);
    var current = fromJson(toCanonicalJson(currentInventory)); // compare as written
    var now = tree(current);
    var lines = new ArrayList<String>();
    now.forEach((key, value) -> {
      if (!key.equals("endpoints") && !Json.compact(sortKeys(old.get(key))).equals(Json.compact(sortKeys(value)))) {
        lines.add("~ " + key + ": " + Json.compact(old.get(key)) + " -> " + Json.compact(value));
      }
    });
    var before = new HashMap<List<String>, Endpoint>();
    for (var e : committedInventory.endpoints()) {
      if (before.containsKey(identity(e))) lines.add("- " + label(e) + " (duplicate entry)");
      before.put(identity(e), e);
    }
    var after = new HashMap<List<String>, Endpoint>();
    for (var e : current.endpoints()) after.put(identity(e), e);
    var keys = new HashMap<List<String>, Endpoint>(before);
    keys.putAll(after);
    var oldDeclared = List.copyOf(committedInventory.projectDimensions().keySet());
    var nowDeclared = List.copyOf(current.projectDimensions().keySet());
    for (var e : keys.values().stream().sorted(ORDER).toList()) {
      var was = before.get(identity(e));
      var is = after.get(identity(e));
      if (is == null) {
        lines.add("- " + label(was));
      } else if (was == null) {
        lines.add("+ " + label(is) + " authentication=" + is.authentication().value() + " authorization=" + is.authorization().value() + (isUnknown(is) ? " [unknown]" : ""));
      } else {
        var x = flatten(tree(was, oldDeclared), "");
        var y = flatten(tree(is, nowDeclared), "");
        var names = new LinkedHashSet<>(x.keySet());
        names.addAll(y.keySet());
        for (String name : names) {
          if (!Json.compact(x.get(name)).equals(Json.compact(y.get(name)))) {
            lines.add("~ " + label(is) + " " + name + ": " + shown(x.get(name)) + " -> " + shown(y.get(name)));
          }
        }
      }
    }
    return lines;
  }

  /** Objects with their keys sorted, so key order never counts as a difference (lists keep theirs). */
  private static Object sortKeys(Object value) {
    if (value instanceof List<?> l) return l.stream().map(Inventory::sortKeys).toList();
    if (value instanceof Map<?, ?> m) {
      var sorted = new TreeMap<String, Object>(Inventory::compareText);
      m.forEach((k, v) -> sorted.put((String) k, sortKeys(v)));
      return sorted;
    }
    return value;
  }

  private static Map<String, Object> flatten(Map<String, Object> data, String prefix) {
    var flat = new LinkedHashMap<String, Object>();
    data.forEach((key, value) -> {
      if (value instanceof Map<?, ?> m) {
        @SuppressWarnings("unchecked")
        var nested = (Map<String, Object>) m;
        flat.putAll(flatten(nested, prefix + key + "."));
      } else {
        flat.put(prefix + key, value);
      }
    });
    return flat;
  }

  private static String shown(Object value) {
    return value instanceof String s ? s : Json.compact(value);
  }

  // --- validation ---

  /** Throw ValidationError naming the first offending endpoint; never write an invalid inventory. */
  static void validate(Inventory inventory) {
    if (inventory.discoveryMode().equals("static") && !inventory.coverage().equals("best-effort")) {
      throw new ValidationError("static discovery must claim coverage best-effort");
    }
    if (inventory.coverage().equals("best-effort") && (inventory.coverageNote() == null || inventory.coverageNote().isEmpty())) {
      throw new ValidationError("coverage best-effort requires a coverage_note");
    }
    inventory.projectDimensions().forEach((name, values) -> {
      if (values.isEmpty() || new HashSet<>(values).size() != values.size() || values.contains("")) {
        throw new ValidationError("dimension " + name + " needs a non-empty list of distinct non-empty values");
      }
    });
    validateExpected(inventory.expectedAccess(), inventory.projectDimensions());
    var seen = new HashSet<List<String>>();
    for (var e : inventory.endpoints()) {
      validateEndpoint(e, inventory.projectDimensions());
      if (!seen.add(identity(e))) throw new ValidationError("duplicate endpoint " + label(e));
    }
  }

  private static void validateExpected(Map<String, Map<String, Expected>> expected, Map<String, List<String>> projectDimensions) {
    expected.forEach((dimension, values) -> values.forEach((value, access) -> {
      String where = "expected access " + dimension + "=" + Json.quote(value);
      if (!projectDimensions.getOrDefault(dimension, List.of()).contains(value)) {
        throw new ValidationError(where + " is not a declared dimension value");
      }
      if (access.authentication() == null || access.authorization() == null) {
        throw new ValidationError(where + " needs exactly [" + String.join(",", EXPECTED_AXES.keySet()) + "]");
      }
      for (var axis : EXPECTED_AXES.entrySet()) {
        var listed = axis.getKey().equals("authentication") ? access.authentication() : access.authorization();
        if (listed.isEmpty() || new HashSet<>(listed).size() != listed.size() || !axis.getValue().containsAll(listed)) {
          throw new ValidationError(where + ": " + axis.getKey() + " needs a non-empty list of distinct values from " + String.join(", ", axis.getValue()));
        }
      }
    }));
  }

  private static void validateEndpoint(Endpoint e, Map<String, List<String>> projectDimensions) {
    java.util.function.Consumer<String> fail = message -> {
      throw new ValidationError(label(e) + ": " + message);
    };
    if (!METHODS.contains(e.method())) fail.accept("method " + Json.compact(e.method()) + " outside " + String.join(", ", METHODS));
    if (!e.path().startsWith("/")) fail.accept("path must start with /");
    for (var named : List.of(Map.entry("authentication", e.authentication()), Map.entry("authorization", e.authorization()))) {
      String name = named.getKey();
      Axis a = named.getValue();
      var values = name.equals("authentication") ? AUTHENTICATION : AUTHORIZATION;
      if (!values.contains(a.value())) fail.accept(name + ".value " + Json.compact(a.value()) + " outside the Core Classification");
      if (!LAYERS.contains(a.layer())) fail.accept(name + ".layer " + Json.compact(a.layer()) + " outside the layers");
      if (a.value().equals("unknown") != (a.rule() == null)) fail.accept(name + ": an unknown value has no rule and any other value names one");
      boolean recognition = a.rule() != null && a.rule().startsWith("recognition:");
      if (recognition != (a.evidence() != null && !a.evidence().isEmpty())) fail.accept(name + ": evidence is set exactly when a Recognition Rule decides");
    }
    if (e.unknownReason() != null && (e.unknownReason().isEmpty() || !isUnknown(e))) {
      fail.accept("unknown_reason must be non-empty and sit next to an unknown value");
    }
    if (e.acknowledged() && e.unknownReason() == null) fail.accept("an acknowledged endpoint carries its unknown_reason");
    var declared = projectDimensions.keySet().stream().sorted().toList();
    var given = e.dimensions().keySet().stream().sorted().toList();
    if (!given.equals(declared)) {
      fail.accept("dimensions [" + String.join(",", given) + "] must equal project dimensions [" + String.join(",", declared) + "]");
    }
    e.dimensions().forEach((dimension, value) -> {
      if (!projectDimensions.get(dimension).contains(value)) fail.accept("dimension " + dimension + "=" + Json.quote(value) + " is not declared");
    });
  }

  static Stream<Endpoint> unknowns(Inventory inventory) {
    return inventory.endpoints().stream().sorted(ORDER).filter(Inventory::isUnknown);
  }
}
