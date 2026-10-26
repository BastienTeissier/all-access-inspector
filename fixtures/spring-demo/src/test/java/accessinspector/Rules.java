package accessinspector;

import accessinspector.Inventory.Axis;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** Built-in Rules, Recognition Rules and Acknowledged Unknowns; turns findings into the Core Classification. */
final class Rules {
  private Rules() {}

  static final List<String> SAFE_METHODS = List.of("GET", "HEAD", "OPTIONS");
  static final List<String> AUTHENTICATION_STRICTNESS = List.of("required", "unknown", "optional", "anonymous");
  static final List<String> AUTHORIZATION_STRICTNESS = List.of("unknown", "rule", "none");

  /**
   * One check a request meets, read from the filter chain or a method security annotation. construct is the check as
   * a Recognition Rule names it; builtin the Built-in Rule that reads it, or null; reason is set when the script
   * cannot read the check at all.
   */
  record Finding(String construct, String layer, String raw, String builtin, String reason) {
    static Finding of(String construct, String layer, String raw, String builtin) {
      return new Finding(construct, layer, raw, builtin, null);
    }
  }

  record Builtin(String authn, String authz) {}

  /** A Recognition Rule: maps a check, or every path under a prefix, onto the Core Classification. */
  record Rule(
      String name,
      String evidence, // "relative/path.java:line" of the construct the rule interprets
      String construct,
      String pathPrefix,
      String layer, // defaults to the finding's layer; required with pathPrefix
      String authn,
      String authz,
      String safeAuthn, // value for GET/HEAD/OPTIONS when it differs, as for a Built-in Rule
      String safeAuthz,
      String raw) {

    static Rule construct(String name, String evidence, String construct, String authn, String authz) {
      return new Rule(name, evidence, construct, null, null, authn, authz, null, null, null);
    }

    static Rule pathPrefix(String name, String evidence, String pathPrefix, String layer, String authn, String authz) {
      return new Rule(name, evidence, null, pathPrefix, layer, authn, authz, null, null, null);
    }

    Rule safe(String safeAuthn, String safeAuthz) {
      return new Rule(name, evidence, construct, pathPrefix, layer, authn, authz, safeAuthn, safeAuthz, raw);
    }

    Rule raw(String raw) {
      return new Rule(name, evidence, construct, pathPrefix, layer, authn, authz, safeAuthn, safeAuthz, raw);
    }
  }

  /** An Acknowledged Unknown: the written reason an unknown endpoint stays unknown. */
  record Ack(String reason, String construct, String path) {
    static Ack construct(String reason, String construct) {
      return new Ack(reason, construct, null);
    }

    static Ack path(String reason, String path) {
      return new Ack(reason, null, path);
    }
  }

  /** The two axes of one endpoint; acknowledged when an Acknowledged Unknown gave the reason. */
  record Resolved(Axis authentication, Axis authorization, String reason, boolean acknowledged) {}

  static final class RuleError extends RuntimeException {
    RuleError(String message) {
      super(message);
    }
  }

  static final Map<String, Builtin> BUILTIN = Map.ofEntries(
      // the filter chain
      Map.entry("no_chain", new Builtin("anonymous", "none")),
      Map.entry("no_authorization", new Builtin("anonymous", "none")),
      Map.entry("permitAll", new Builtin("anonymous", "none")),
      Map.entry("denyAll", new Builtin("required", "rule")),
      Map.entry("authenticated", new Builtin("required", "none")),
      Map.entry("fullyAuthenticated", new Builtin("required", "none")),
      Map.entry("rememberMe", new Builtin("required", "none")),
      Map.entry("hasAnyAuthority", new Builtin("required", "rule")),
      // SpEL, in access() or a method security annotation
      Map.entry("isAuthenticated", new Builtin("required", "none")),
      Map.entry("isFullyAuthenticated", new Builtin("required", "none")),
      Map.entry("hasRole", new Builtin("required", "rule")),
      Map.entry("hasAnyRole", new Builtin("required", "rule")),
      Map.entry("hasAuthority", new Builtin("required", "rule")),
      // annotations
      Map.entry("Secured", new Builtin("required", "rule")),
      Map.entry("RolesAllowed", new Builtin("required", "rule")),
      Map.entry("PermitAll", new Builtin("anonymous", "none")),
      Map.entry("DenyAll", new Builtin("required", "rule")));

  private static final Pattern EXPRESSION = Pattern.compile(
      "(permitAll|denyAll|isAuthenticated|isFullyAuthenticated)\\(\\)"
          + "|(hasRole|hasAnyRole|hasAuthority|hasAnyAuthority)\\(\\s*'[^'@#()]+'\\s*(?:,\\s*'[^'@#()]+'\\s*)*\\)");

  /** The Built-in Rule of a SpEL expression that is one built-in call with literal arguments, else null. */
  static String expression(String text) {
    var m = EXPRESSION.matcher(text.strip());
    if (!m.matches()) return null;
    return m.group(1) != null ? m.group(1) : m.group(2);
  }

  // --- project ---
  // Recognition Rules. Each cites the file and line of the construct it interprets; construct is the check exactly as
  // --unknowns shows it after "-> " in raw (filter chain) or as raw (annotation). For one construct the first rule wins:
  // Rule.construct("can_read", "src/main/java/com/acme/security/Permissions.java:14",
  //     "@PreAuthorize(\"@permissions.canRead(#id)\")", "required", "rule"),
  // Rule.pathPrefix("partner_key", "src/main/java/com/acme/PartnerKeyFilter.java:22", "/partner/", "global", "required", "none"),
  static final List<Rule> RECOGNITION = List.of(
      Rule.construct("can_read", "src/main/java/com/theodo/ms/security/PermissionEvaluator.java:10",
          "@PreAuthorize(\"@permissionEvaluator.canRead(#id)\")", "required", "rule"));

  // Acknowledged Unknowns, e.g.:
  // Ack.path("GraphQL operations are out of scope; authorization is enforced per resolver", "/graphql"),
  static final List<Ack> ACKNOWLEDGED = List.of(
      Ack.construct("the export is reachable from the office network only, which the firewall enforces as well",
          "access(\"hasIpAddress('10.0.0.0/8')\")"));
  // --- end project ---

  /**
   * All checks apply: per axis the strictest component wins, and the first one holding that value is reported.
   * Components are in request order (path rules, then findings: filter chain, class, method), so on a tie the check a
   * request meets first is the one reported.
   */
  static Resolved resolveAccess(List<Finding> findings, String method, String path, List<Rule> recognition, List<Ack> acknowledged) {
    var own = findings.stream().map(f -> component(f, method, recognition)).toList();
    var components = Stream.concat(
            recognition.stream()
                .filter(r -> r.pathPrefix() != null && path.startsWith(r.pathPrefix()))
                .map(r -> recognised(r, method, r.layer(), r.raw())),
            own.stream())
        .toList();
    if (components.isEmpty()) throw new RuleError(method + " " + path + ": no finding to classify");
    Axis authn = strictest(components.stream().map(c -> c[0]).toList(), AUTHENTICATION_STRICTNESS);
    Axis authz = strictest(components.stream().map(c -> c[1]).toList(), AUTHORIZATION_STRICTNESS);
    if (!authn.value().equals("unknown") && !authz.value().equals("unknown")) return new Resolved(authn, authz, null, false);
    var unknown = new HashSet<String>();
    for (int i = 0; i < findings.size(); i++) {
      if (own.get(i)[0].value().equals("unknown") || own.get(i)[1].value().equals("unknown")) unknown.add(findings.get(i).construct());
    }
    for (Ack ack : acknowledged) {
      if (path.equals(ack.path()) || (ack.construct() != null && unknown.contains(ack.construct()))) return new Resolved(authn, authz, ack.reason(), true);
    }
    String reason = findings.stream().filter(f -> f.reason() != null && unknown.contains(f.construct())).map(Finding::reason).findFirst().orElse(null);
    return new Resolved(authn, authz, reason, false);
  }

  static Resolved resolveAccess(List<Finding> findings, String method, String path) {
    return resolveAccess(findings, method, path, RECOGNITION, ACKNOWLEDGED);
  }

  /** An ANY endpoint whose checks differ between methods is split into one row per method. */
  static List<String> methods(Function<String, List<Finding>> findings, String method, String path, List<Rule> recognition) {
    if (!method.equals("ANY")) return List.of(method);
    var concrete = Inventory.METHODS.stream().filter(m -> !m.equals("ANY")).toList();
    var first = resolveAccess(findings.apply(concrete.get(0)), concrete.get(0), path, recognition, List.of());
    for (String m : concrete) {
      if (!resolveAccess(findings.apply(m), m, path, recognition, List.of()).equals(first)) return concrete;
    }
    return List.of(method);
  }

  /** Every Recognition Rule targets one thing and cites a file and line that exist. */
  static void checkRules(List<Rule> recognition, Path root) {
    for (Rule rule : recognition) {
      if ((rule.construct() == null) == (rule.pathPrefix() == null)) {
        throw new RuleError("rule " + rule.name() + ": set exactly one of construct or pathPrefix");
      }
      if (rule.pathPrefix() != null && rule.layer() == null) throw new RuleError("rule " + rule.name() + ": a pathPrefix rule needs a layer");
      if (rule.layer() != null && !Inventory.LAYERS.contains(rule.layer())) {
        throw new RuleError("rule " + rule.name() + ": layer '" + rule.layer() + "' is not one of global, class, method, framework-default");
      }
      checkValue(rule, rule.authn(), AUTHENTICATION_STRICTNESS, false);
      checkValue(rule, rule.safeAuthn(), AUTHENTICATION_STRICTNESS, true);
      checkValue(rule, rule.authz(), AUTHORIZATION_STRICTNESS, false);
      checkValue(rule, rule.safeAuthz(), AUTHORIZATION_STRICTNESS, true);
      checkEvidence("rule " + rule.name(), rule.evidence(), root);
    }
  }

  private static void checkValue(Rule rule, String value, List<String> allowed, boolean optional) {
    if (value == null ? !optional : !allowed.contains(value)) {
      throw new RuleError("rule " + rule.name() + ": '" + value + "' is not one of " + String.join(", ", allowed));
    }
  }

  private static void checkEvidence(String owner, String evidence, Path root) {
    int at = evidence == null ? -1 : evidence.lastIndexOf(':');
    String file = at > 0 ? evidence.substring(0, at) : "";
    String line = at > 0 ? evidence.substring(at + 1) : "";
    Path source = root.resolve(file).normalize();
    if (file.isEmpty() || !line.matches("\\d+") || !source.startsWith(root) || !Files.isRegularFile(source)) {
      throw new RuleError(owner + ": evidence " + evidence + " does not exist");
    }
    long count;
    try {
      String text = Files.readString(source);
      count = text.split("\n", -1).length - (text.endsWith("\n") ? 1 : 0);
    } catch (IOException e) {
      throw new RuleError(owner + ": evidence " + evidence + " cannot be read");
    }
    if (Long.parseLong(line) < 1 || Long.parseLong(line) > count) throw new RuleError(owner + ": evidence " + evidence + " is past the end of the file");
  }

  private static Axis[] component(Finding finding, String method, List<Rule> recognition) {
    for (Rule rule : recognition) {
      if (finding.construct().equals(rule.construct())) {
        return recognised(rule, method, rule.layer() != null ? rule.layer() : finding.layer(), rule.raw() != null ? rule.raw() : finding.raw());
      }
    }
    Builtin builtin = finding.reason() == null && finding.builtin() != null ? BUILTIN.get(finding.builtin()) : null;
    if (builtin == null) {
      Axis unknown = axis("unknown", finding.layer(), finding.raw(), null, null);
      return new Axis[] {unknown, unknown};
    }
    String tag = "builtin:" + finding.builtin();
    return new Axis[] {axis(builtin.authn(), finding.layer(), finding.raw(), tag, null), axis(builtin.authz(), finding.layer(), finding.raw(), tag, null)};
  }

  private static Axis[] recognised(Rule rule, String method, String layer, String raw) {
    boolean safe = SAFE_METHODS.contains(method);
    String authn = safe && rule.safeAuthn() != null ? rule.safeAuthn() : rule.authn();
    String authz = safe && rule.safeAuthz() != null ? rule.safeAuthz() : rule.authz();
    String tag = "recognition:" + rule.name();
    return new Axis[] {axis(authn, layer, raw, tag, rule.evidence()), axis(authz, layer, raw, tag, rule.evidence())};
  }

  private static Axis axis(String value, String layer, String raw, String rule, String evidence) {
    boolean unknown = value.equals("unknown");
    return new Axis(value, layer, raw, unknown ? null : rule, unknown ? null : evidence);
  }

  private static Axis strictest(List<Axis> axes, List<String> order) {
    int winner = axes.stream().mapToInt(a -> order.indexOf(a.value())).min().orElseThrow();
    return axes.stream().filter(a -> order.indexOf(a.value()) == winner).findFirst().orElseThrow();
  }
}
