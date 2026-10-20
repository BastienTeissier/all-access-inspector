package accessinspector;

import accessinspector.Discovery.Mapped;
import accessinspector.Inventory.Endpoint;
import accessinspector.Rules.Finding;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.TestContextManager;

/**
 * Adapted Script harness: inspect.sh runs this single test through the project's own build, which gives it the
 * project's classpath. The result travels through files, since a build only passes or fails.
 */
class AccessInspectorRun {
  static final Path ROOT = Path.of("").toAbsolutePath(); // Maven and Gradle run tests from the project directory
  static final String HERE = "tools/access-inspector";
  static final String COMMITTED = HERE + "/inventory.json";
  static final String COMMAND = HERE + "/inspect.sh";
  static final Path OUTPUT = ROOT.resolve(COMMITTED);

  static Inventory build(ApplicationContext context) throws IOException {
    var resolver = new FilterChainResolver(context);
    var discovered = Discovery.discover(context);
    var endpoints = new ArrayList<Endpoint>();
    for (Mapped mapped : discovered.endpoints()) {
      var annotations = MethodSecurity.findings(context, mapped.handlerMethod());
      Function<String, List<Finding>> findings =
          method -> Stream.concat(Stream.of(resolver.resolve(method, mapped.sample())), annotations.stream()).toList();
      for (String method : Rules.methods(findings, mapped.method(), mapped.path(), Rules.RECOGNITION)) {
        // an ANY kept whole classifies the same for every method
        var resolved = Rules.resolveAccess(findings.apply(method.equals("ANY") ? "GET" : method), method, mapped.path());
        var endpoint = new Endpoint(method, mapped.path(), mapped.handler(), resolved.authentication(), resolved.authorization(), Map.of(), resolved.reason(), resolved.acknowledged());
        endpoints.add(endpoint.withDimensions(Dimensions.assign(endpoint)));
      }
    }
    String version = Files.readString(ROOT.resolve(HERE).resolve("VERSION")).strip();
    return new Inventory(
        Inventory.SCHEMA_VERSION,
        "spring",
        "runtime",
        discovered.note() == null ? "complete" : "best-effort",
        discovered.note(),
        new Inventory.BaseScript("spring", version),
        Boot.environment(context),
        Dimensions.DIMENSIONS,
        Dimensions.EXPECTED,
        endpoints.stream().sorted(Inventory.ORDER).toList());
  }

  /** Boot the application as production runs it, through the test context so @MockitoBean stubs apply. */
  static ApplicationContext boot() {
    Boot.checkPins(Boot.PINNED);
    Boot.stubs();
    var booted = new Boot();
    try {
      new TestContextManager(Boot.class).prepareTestInstance(booted);
    } catch (Exception e) {
      Throwable cause = e;
      while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
      throw new Boot.BootError("cannot boot " + Boot.target() + ": " + cause.getClass().getSimpleName() + ": " + cause.getMessage(), e);
    }
    return booted.context;
  }

  static int main(String mode, List<String> out, List<String> err) {
    Inventory before = null;
    if (mode.equals("check")) {
      // an unusable Committed Inventory fails before paying for the boot
      if (!Files.exists(OUTPUT)) {
        err.add("access-inspector: " + COMMITTED + " not found; generate it first with `" + COMMAND + "` and commit it");
        return 2;
      }
      try {
        before = Inventory.fromJson(Files.readString(OUTPUT));
      } catch (IOException | RuntimeException e) {
        err.add("access-inspector: cannot read " + COMMITTED + ": " + e);
        return 2;
      }
    }
    Inventory result;
    try {
      Rules.checkRules(Rules.RECOGNITION, ROOT);
      ApplicationContext context = boot();
      try {
        result = build(context);
      } finally {
        if (context instanceof ConfigurableApplicationContext closable) closable.close();
      }
      Inventory.validate(result);
    } catch (Rules.RuleError | Dimensions.MissingDimension | Inventory.ValidationError e) {
      err.add("access-inspector: " + e.getMessage());
      return 2;
    } catch (Exception e) {
      Throwable cause = e instanceof Boot.BootError && e.getCause() != null ? e.getCause() : e;
      var trace = new StringWriter();
      cause.printStackTrace(new PrintWriter(trace));
      err.add(trace.toString().stripTrailing());
      err.add("access-inspector: " + e.getMessage());
      return 2;
    }
    if (before != null) {
      var diff = Inventory.check(before, result);
      if (diff.isEmpty()) {
        out.add("inventory up to date");
        return 0;
      }
      out.add(String.join("\n", diff));
      out.add("\n" + COMMITTED + " differs from the endpoints this code serves."
          + "\nIf the change is intended, run `" + COMMAND + "` and commit " + COMMITTED + ".");
      return 1;
    }
    try {
      switch (mode) {
        case "table" -> out.add(Table.render(result));
        case "unknowns" -> Inventory.unknowns(result).forEach(e -> out.add(Inventory.compact(e, result)));
        default -> {
          Path temporary = OUTPUT.resolveSibling("inventory.json.tmp");
          Files.writeString(temporary, Inventory.toCanonicalJson(result));
          Files.move(temporary, OUTPUT, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        }
      }
    } catch (IOException e) {
      err.add("access-inspector: cannot write " + COMMITTED + ": " + e.getMessage());
      return 2;
    }
    return 0;
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "ACCESS_INSPECTOR_OUT", matches = ".+") // run by inspect.sh, skipped by the project's own test run
  void run() throws IOException {
    Path dir = Path.of(System.getenv("ACCESS_INSPECTOR_OUT"));
    var out = new ArrayList<String>();
    var err = new ArrayList<String>();
    String mode = System.getenv().getOrDefault("ACCESS_INSPECTOR_MODE", "write");
    int status = main(mode, out, err);
    Function<List<String>, String> lines = xs -> xs.stream().map(x -> x + "\n").collect(Collectors.joining());
    Files.writeString(dir.resolve("stdout"), lines.apply(out));
    Files.writeString(dir.resolve("stderr"), lines.apply(err));
    Files.writeString(dir.resolve("status"), String.valueOf(status));
  }
}
