package accessinspector;

import static accessinspector.Samples.endpoint;
import static accessinspector.Samples.load;
import static accessinspector.Samples.withEndpoints;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import accessinspector.Inventory.Axis;
import accessinspector.Inventory.Endpoint;
import accessinspector.Inventory.ValidationError;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InventoryCanonicalTest {
  @Test
  void canonicalBytes() {
    assertThat(Inventory.toCanonicalJson(load("canonical.input.json"))).isEqualTo(Samples.text("canonical.json"));
  }

  @Test
  void canonicalBytesEmpty() {
    assertThat(Inventory.toCanonicalJson(load("canonical-empty.json"))).isEqualTo(Samples.text("canonical-empty.json"));
  }

  @Test
  void sortsByPathThenMethodThenHandlerByCodePoint() {
    var shuffled = List.of(
        endpoint("GET", "/a/b"),
        endpoint("POST", "/a", "Z.create"),
        endpoint("DELETE", "/a"),
        endpoint("POST", "/a", "A.create"),
        endpoint("ANY", "/a"),
        endpoint("GET", "/😀"),
        endpoint("GET", "/～"));
    var lines = Inventory.toCanonicalJson(withEndpoints(load("canonical.input.json"), shuffled)).split("\n");
    int start = Arrays.asList(lines).indexOf("  \"endpoints\": [") + 1;
    assertThat(Arrays.stream(lines, start, lines.length - 2).map(l -> l.replaceAll(".*\"method\": \"(\\w+)\", \"path\": \"([^\"]*)\", \"handler\": \"([^\"]*)\".*", "$1 $2 $3")).toList())
        .containsExactly(
            "ANY /a com.acme.ShopController.list",
            "DELETE /a com.acme.ShopController.list",
            "POST /a A.create",
            "POST /a Z.create",
            "GET /a/b com.acme.ShopController.list",
            "GET /～ com.acme.ShopController.list",
            "GET /😀 com.acme.ShopController.list");
  }

  @Test
  void acceptsTheCanonicalSample() {
    Inventory.validate(load("canonical.input.json"));
  }

  private static void invalid(Endpoint endpoint, String message) {
    assertThatThrownBy(() -> Inventory.validate(withEndpoints(load("canonical.input.json"), List.of(endpoint))))
        .isInstanceOf(ValidationError.class)
        .hasMessageContaining(message);
  }

  private static Endpoint with(Axis authentication) {
    var e = endpoint("GET", "/orders/");
    return new Endpoint(e.method(), e.path(), e.handler(), authentication, e.authorization(), e.dimensions(), e.unknownReason(), e.acknowledged());
  }

  @Test
  void rejectsInvalidEndpoints() {
    var e = endpoint("GET", "/orders/");
    invalid(endpoint("TRACE", "/orders/"), "method \"TRACE\"");
    invalid(endpoint("GET", "orders/"), "path must start with /");
    invalid(with(new Axis("sso", null, null, "builtin:x", null)), "outside the Core Classification");
    invalid(with(new Axis("anonymous", "view", null, "builtin:x", null)), "layer \"view\"");
    invalid(with(new Axis("unknown", null, null, "builtin:x", null)), "unknown value has no rule");
    invalid(with(new Axis("required", null, null, "recognition:x", null)), "evidence is set exactly");
    invalid(with(new Axis("anonymous", null, null, "builtin:no_chain", "a.java:1")), "evidence is set exactly");
    invalid(new Endpoint(e.method(), e.path(), e.handler(), e.authentication(), e.authorization(), e.dimensions(), "custom", false), "unknown_reason must");
    invalid(new Endpoint(e.method(), e.path(), e.handler(), e.authentication(), e.authorization(), e.dimensions(), null, true), "acknowledged endpoint carries");
    invalid(e.withDimensions(Map.of("access_tier", "partner")), "access_tier=\"partner\" is not declared");
    invalid(e.withDimensions(Map.of("access_tier", "public", "team", "sales")), "GET /orders/ (com.acme.ShopController.list): dimensions");
  }

  @Test
  void rejectsADuplicate() {
    var twice = List.of(endpoint("GET", "/orders/"), endpoint("GET", "/orders/"));
    assertThatThrownBy(() -> Inventory.validate(withEndpoints(load("canonical.input.json"), twice)))
        .hasMessage("duplicate endpoint GET /orders/ (com.acme.ShopController.list)");
  }

  @Test
  void bestEffortNeedsANote() {
    var i = load("canonical.input.json");
    var bestEffort = new Inventory(i.schemaVersion(), i.stack(), i.discoveryMode(), "best-effort", null, i.baseScript(), i.bootEnvironment(), i.projectDimensions(), i.expectedAccess(), i.endpoints());
    assertThatThrownBy(() -> Inventory.validate(bestEffort)).hasMessageContaining("requires a coverage_note");
  }

  @Test
  void expectedAccessNamesDeclaredValues() {
    var i = load("canonical.input.json");
    var expected = Map.of("access_tier", Map.of("partner", new Inventory.Expected(List.of("required"), List.of("none"))));
    var wrong = new Inventory(i.schemaVersion(), i.stack(), i.discoveryMode(), i.coverage(), i.coverageNote(), i.baseScript(), i.bootEnvironment(), i.projectDimensions(), expected, i.endpoints());
    assertThatThrownBy(() -> Inventory.validate(wrong)).hasMessageContaining("access_tier=\"partner\" is not a declared");
  }
}
