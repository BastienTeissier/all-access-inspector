package accessinspector;

import static accessinspector.Samples.load;
import static accessinspector.Samples.withEndpoints;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import accessinspector.Inventory.Axis;
import accessinspector.Inventory.Endpoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CheckDiffTest {
  private static String label(Endpoint e) {
    return e.method() + " " + e.path() + " (" + e.handler() + ")";
  }

  private static Endpoint authentication(Endpoint e, Axis a) {
    return new Endpoint(e.method(), e.path(), e.handler(), a, e.authorization(), e.dimensions(), e.unknownReason(), e.acknowledged());
  }

  @Test
  void ignoresOrderingAndWhitespace() {
    assertThat(Inventory.check(load("canonical.input.json"), load("canonical.json"))).isEmpty();
  }

  @Test
  void threeWayDiff() {
    var committed = load("canonical.json");
    var gone = committed.endpoints().get(0);
    var kept = committed.endpoints().get(1);
    var a = kept.authentication();
    var changed = authentication(kept, new Axis("optional", a.layer(), a.raw(), a.rule(), a.evidence()));
    var unknown = new Axis("unknown", null, null, null, null);
    var added = new Endpoint(gone.method(), "/hooks/", gone.handler(), unknown, unknown, gone.dimensions(), "custom hook", false);
    var current = new ArrayList<>(List.of(changed, added));
    current.addAll(committed.endpoints().subList(2, committed.endpoints().size()));
    var diff = Inventory.check(committed, withEndpoints(committed, current));
    assertThat(diff).containsExactlyInAnyOrder(
        "- " + label(gone),
        "+ " + label(added) + " authentication=unknown authorization=unknown [unknown]",
        "~ " + label(kept) + " authentication.value: " + a.value() + " -> optional");
  }

  @Test
  void headerChange() {
    var committed = load("canonical.json");
    var current = new Inventory(committed.schemaVersion(), committed.stack(), committed.discoveryMode(), committed.coverage(), committed.coverageNote(), committed.baseScript(), committed.bootEnvironment(), Map.of("access_tier", List.of("public")), Map.of(), List.of());
    var committedNoExpected = new Inventory(committed.schemaVersion(), committed.stack(), committed.discoveryMode(), committed.coverage(), committed.coverageNote(), committed.baseScript(), committed.bootEnvironment(), committed.projectDimensions(), Map.of(), List.of());
    assertThat(Inventory.check(committedNoExpected, current))
        .containsExactly("~ project_dimensions: {\"access_tier\": [\"public\", \"customer\", \"staff\"]} -> {\"access_tier\": [\"public\"]}");
  }

  @Test
  void nullToText() {
    var committed = load("canonical.json");
    var first = committed.endpoints().get(0);
    var z = first.authorization();
    var reasoned = new Endpoint(first.method(), first.path(), first.handler(), first.authentication(), new Axis(z.value(), z.layer(), "is_staff (overridden)", z.rule(), z.evidence()), first.dimensions(), first.unknownReason(), first.acknowledged());
    var plain = new Endpoint(first.method(), first.path(), first.handler(), first.authentication(), new Axis(z.value(), z.layer(), null, z.rule(), z.evidence()), first.dimensions(), first.unknownReason(), first.acknowledged());
    assertThat(Inventory.check(withEndpoints(committed, List.of(plain)), withEndpoints(committed, List.of(reasoned))))
        .containsExactly("~ " + label(first) + " authorization.raw: null -> is_staff (overridden)");
  }

  @Test
  void flagsADuplicatedCommittedEntry() {
    var current = load("canonical.json");
    var first = current.endpoints().get(0);
    var twice = new ArrayList<>(List.of(first));
    twice.addAll(current.endpoints());
    assertThat(Inventory.check(withEndpoints(current, twice), current)).containsExactly("- " + label(first) + " (duplicate entry)");
  }

  @Test
  void aMalformedCommittedInventoryThrowsBeforeAnyDiff() {
    assertThatThrownBy(() -> Inventory.fromJson("{\"schema_version\": \"1\"}")).hasMessage("missing key");
    assertThatThrownBy(() -> Inventory.fromJson("<<<<<<< HEAD\n")).hasMessageContaining("invalid JSON");
  }
}
