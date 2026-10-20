package accessinspector;

import accessinspector.Inventory.Endpoint;
import accessinspector.Inventory.Expected;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/** Project Dimensions: the project's own labels, assigned to every endpoint by ordered rules. */
final class Dimensions {
  private Dimensions() {}

  record Assign(String dimension, String value, Predicate<Endpoint> when) {}

  static final class MissingDimension extends RuntimeException {
    MissingDimension(String message) {
      super(message);
    }
  }

  static final Map<String, List<String>> DIMENSIONS = new LinkedHashMap<>();
  static final Map<String, Map<String, Expected>> EXPECTED = new LinkedHashMap<>();

  // --- project ---
  static {
    // Declared values, in order, e.g. DIMENSIONS.put("access_tier", List.of("public", "customer", "staff"));
    // What each value should allow, as the team confirmed it; a value left out is not checked, e.g.
    // EXPECTED.put("access_tier", Inventory.ordered(Map.entry("staff", new Expected(List.of("required"), List.of("rule")))));
  }

  // Most specific first; the first matching rule of a dimension wins, e.g.:
  // new Assign("access_tier", "staff", e -> e.path().startsWith("/admin/")),
  static final List<Assign> RULES = List.of();
  // --- end project ---

  /** One value per declared dimension; an endpoint no rule covers is a failure, never a null. */
  static Map<String, String> assign(Endpoint endpoint, Map<String, List<String>> dimensions, List<Assign> rules) {
    var assigned = new LinkedHashMap<String, String>();
    for (String dimension : dimensions.keySet()) {
      var rule = rules.stream().filter(r -> r.dimension().equals(dimension) && r.when().test(endpoint)).findFirst();
      if (rule.isEmpty()) throw new MissingDimension(Inventory.label(endpoint) + ": no rule assigns dimension '" + dimension + "'");
      assigned.put(dimension, rule.get().value());
    }
    return assigned;
  }

  static Map<String, String> assign(Endpoint endpoint) {
    return assign(endpoint, DIMENSIONS, RULES);
  }
}
