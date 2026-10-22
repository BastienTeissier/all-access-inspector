package accessinspector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import accessinspector.Rules.Ack;
import accessinspector.Rules.Finding;
import accessinspector.Rules.Rule;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class RulesPrecedenceTest {
  private static final Finding CHAIN = Finding.of("authenticated", "global", "web: any request -> authenticated", "authenticated");
  private static final Finding ADMIN = Finding.of("@Secured({\"ROLE_ADMIN\"})", "method", "@Secured({\"ROLE_ADMIN\"})", "Secured");
  private static final Finding OPEN = Finding.of("permitAll", "global", "web: PathPattern [/open] -> permitAll", "permitAll");
  private static final Finding CUSTOM = Finding.of("@PreAuthorize(\"@perms.canRead(#id)\")", "method", "@PreAuthorize(\"@perms.canRead(#id)\")", null);
  private static final String EVIDENCE = "tests/accessinspector/RulesPrecedenceTest.java:1";

  private static Rules.Resolved resolve(List<Finding> findings, String method, List<Rule> rules, List<Ack> acks) {
    return Rules.resolveAccess(findings, method, "/cars/{id}", rules, acks);
  }

  @Test
  void theStrictestCheckWinsPerAxis() {
    var r = resolve(List.of(OPEN, ADMIN), "GET", List.of(), List.of());
    assertThat(r.authentication().value()).isEqualTo("required");
    assertThat(r.authentication().layer()).isEqualTo("method");
    assertThat(r.authorization().rule()).isEqualTo("builtin:Secured");
  }

  @Test
  void onATieTheCheckARequestMeetsFirstIsReported() {
    var r = resolve(List.of(CHAIN, Finding.of("isAuthenticated", "class", "@PreAuthorize(\"isAuthenticated()\")", "isAuthenticated")), "GET", List.of(), List.of());
    assertThat(r.authentication().layer()).isEqualTo("global");
    assertThat(r.authorization().value()).isEqualTo("none");
  }

  @Test
  void anUnreadCheckIsUnknownAndOutranksARule() {
    var r = resolve(List.of(CHAIN, CUSTOM), "GET", List.of(), List.of());
    assertThat(r.authorization()).isEqualTo(new Inventory.Axis("unknown", "method", CUSTOM.raw(), null, null));
    assertThat(r.authentication().value()).isEqualTo("required");
    assertThat(r.reason()).isNull();
  }

  @Test
  void aRecognitionRuleReadsTheConstructItNames() {
    var rule = Rule.construct("can_read", EVIDENCE, CUSTOM.construct(), "required", "rule");
    var r = resolve(List.of(CHAIN, CUSTOM), "GET", List.of(rule), List.of());
    assertThat(r.authorization()).isEqualTo(new Inventory.Axis("rule", "method", CUSTOM.raw(), "recognition:can_read", EVIDENCE));
  }

  @Test
  void aRecognitionRuleOverridesABuiltin() {
    var rule = Rule.construct("open_is_tenant", EVIDENCE, "permitAll", "required", "none").raw("tenant header");
    var r = resolve(List.of(OPEN), "POST", List.of(rule), List.of());
    assertThat(r.authentication()).isEqualTo(new Inventory.Axis("required", "global", "tenant header", "recognition:open_is_tenant", EVIDENCE));
  }

  @Test
  void aPathPrefixRuleAddsACheckAtItsLayerAndSafeMethodsTakeTheSafeValue() {
    var rule = Rule.pathPrefix("partner", EVIDENCE, "/cars/", "global", "required", "rule").safe("optional", "none");
    assertThat(resolve(List.of(OPEN), "POST", List.of(rule), List.of()).authorization().rule()).isEqualTo("recognition:partner");
    var get = resolve(List.of(OPEN), "GET", List.of(rule), List.of());
    assertThat(get.authentication().value()).isEqualTo("optional");
    assertThat(get.authorization().value()).isEqualTo("none");
    assertThat(get.authorization().rule()).isEqualTo("recognition:partner");
  }

  @Test
  void anAcknowledgedUnknownGivesItsReason() {
    var byConstruct = resolve(List.of(CHAIN, CUSTOM), "GET", List.of(), List.of(Ack.construct("ownership is checked by the service", CUSTOM.construct())));
    assertThat(byConstruct.reason()).isEqualTo("ownership is checked by the service");
    assertThat(byConstruct.acknowledged()).isTrue();
    var byPath = resolve(List.of(CHAIN, CUSTOM), "GET", List.of(), List.of(Ack.path("out of scope", "/cars/{id}")));
    assertThat(byPath.acknowledged()).isTrue();
    var unrelated = resolve(List.of(CHAIN, ADMIN), "GET", List.of(), List.of(Ack.path("out of scope", "/cars/{id}")));
    assertThat(unrelated.reason()).isNull();
  }

  @Test
  void aCheckTheScriptCannotReadCarriesItsReason() {
    var broken = new Finding("spring-security", "global", "web: any request", null, "Spring Security internals changed: x");
    var r = resolve(List.of(broken, ADMIN), "GET", List.of(), List.of());
    assertThat(r.authentication().value()).isEqualTo("required");
    assertThat(r.authorization().value()).isEqualTo("unknown");
    assertThat(r.reason()).isEqualTo("Spring Security internals changed: x");
  }

  @Test
  void anAnyEndpointIsSplitOnlyWhenItsMethodsDiffer() {
    assertThat(Rules.methods(m -> List.of(CHAIN), "ANY", "/x", List.of())).containsExactly("ANY");
    assertThat(Rules.methods(m -> List.of(m.equals("GET") ? OPEN : CHAIN), "ANY", "/x", List.of()))
        .containsExactly("DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT");
    assertThat(Rules.methods(m -> List.of(CHAIN), "GET", "/x", List.of())).containsExactly("GET");
  }

  @Test
  void aMalformedRuleOrEvidenceOutsideTheProjectIsRefused() {
    Path root = Path.of("").toAbsolutePath();
    Rules.checkRules(List.of(Rule.construct("ok", EVIDENCE, "x", "required", "none")), root);
    assertThatThrownBy(() -> Rules.checkRules(List.of(new Rule("both", EVIDENCE, "x", "/a", "global", "required", "none", null, null, null)), root))
        .hasMessage("rule both: set exactly one of construct or pathPrefix");
    assertThatThrownBy(() -> Rules.checkRules(List.of(new Rule("p", EVIDENCE, null, "/a", null, "required", "none", null, null, null)), root))
        .hasMessage("rule p: a pathPrefix rule needs a layer");
    assertThatThrownBy(() -> Rules.checkRules(List.of(Rule.construct("v", EVIDENCE, "x", "sso", "none")), root))
        .hasMessage("rule v: 'sso' is not one of required, unknown, optional, anonymous");
    assertThatThrownBy(() -> Rules.checkRules(List.of(Rule.construct("e", "src/Missing.java:3", "x", "required", "none")), root))
        .hasMessage("rule e: evidence src/Missing.java:3 does not exist");
    assertThatThrownBy(() -> Rules.checkRules(List.of(Rule.construct("e", "pom.xml:100000", "x", "required", "none")), root))
        .hasMessage("rule e: evidence pom.xml:100000 is past the end of the file");
    assertThatThrownBy(() -> Rules.checkRules(List.of(Rule.construct("e", "../../VERSION:1", "x", "required", "none")), root))
        .hasMessage("rule e: evidence ../../VERSION:1 does not exist");
  }

  @Test
  void onlyABuiltinCallWithLiteralArgumentsIsABuiltinExpression() {
    assertThat(Rules.expression("permitAll()")).isEqualTo("permitAll");
    assertThat(Rules.expression(" isAuthenticated() ")).isEqualTo("isAuthenticated");
    assertThat(Rules.expression("hasAnyRole('USER', 'ADMIN')")).isEqualTo("hasAnyRole");
    assertThat(Rules.expression("hasRole(ADMIN)")).isNull(); // a property of the root object, not a role name
    assertThat(Rules.expression("hasRole('ADMIN') or isAuthenticated()")).isNull();
    assertThat(Rules.expression("@permissionEvaluator.canRead(#id)")).isNull();
    assertThat(Rules.expression("hasPermission(#id, 'car', 'read')")).isNull();
  }

  @Test
  void pathsTakeTheInventoryFormAndSamplesMatchThem() {
    assertThat(Discovery.path("webclient/v3/cars/{carsId}/details")).isEqualTo("/webclient/v3/cars/{carsId}/details");
    assertThat(Discovery.path("/files/{id:\\d{3}}/{*rest}")).isEqualTo("/files/{id}/{rest}");
    assertThat(Discovery.path("/actuator/health/**")).isEqualTo("/actuator/health/{wildcard}");
    assertThat(Discovery.path("")).isEqualTo("/");
    assertThat(Discovery.sample("/files/{id:\\d{3}}/{*rest}")).isEqualTo("/files/1/1");
    assertThat(Discovery.sample("/actuator/health/**")).isEqualTo("/actuator/health/1");
  }
}
