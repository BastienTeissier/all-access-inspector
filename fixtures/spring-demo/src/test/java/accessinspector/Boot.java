package accessinspector;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

import accessinspector.Inventory.BootEnvironment;
import accessinspector.Inventory.Pin;
import accessinspector.Inventory.Stub;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.security.access.PermissionEvaluator;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.stereotype.Controller;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.util.ClassUtils;

/** The pinned Boot Environment: application class, profile, stubbed beans and pinned properties, each with its reason. */
// --- project ---
// The application class production runs (classes = com.acme.Application.class) and the profile it runs with.
@SpringBootTest(classes = com.theodo.ms.SampleApplication.class, webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@ActiveProfiles("prod")
class Boot {
  static final String PROFILE_REASON = "production profile";

  // Properties overriding application.yml and the environment, production values only, e.g.:
  // new Pin("spring.datasource.url", "jdbc:postgresql://inventory-placeholder/app", "database unreachable outside production"),
  static final List<Pin> PINNED = List.of(
      new Pin("app.jwt-secret", "inventory-placeholder", "secret required at boot by src/main/java/com/theodo/ms/security/SecurityConfig.java:19"));

  // Toward production only: beans reaching secrets, databases and external services, never a SecurityFilterChain, an
  // AuthorizationManager, a PermissionEvaluator, a controller or the application class, e.g.:
  // @MockitoBean @Reason("SMTP server unreachable outside production") JavaMailSender mail;
  @MockitoBean @Reason("payment gateway reachable from production only") com.theodo.ms.payments.PaymentClient payments;
  // --- end project ---

  /** Why a @MockitoBean stub is there. */
  @Retention(RUNTIME)
  @Target(FIELD)
  @interface Reason {
    String value();
  }

  static final class BootError extends RuntimeException {
    BootError(String message, Throwable cause) {
      super(message, cause);
    }
  }

  private static final List<Class<?>> SHAPING = List.of(SecurityFilterChain.class, AuthorizationManager.class, PermissionEvaluator.class);

  @Autowired ApplicationContext context;

  @DynamicPropertySource
  static void pin(DynamicPropertyRegistry registry) {
    for (Pin pin : PINNED) registry.add(pin.setting(), pin::value);
  }

  /** Every @MockitoBean field, by type; an access-shaping bean may not be stubbed. */
  static List<Stub> stubs() {
    var stubs = new ArrayList<Stub>();
    for (Field field : Boot.class.getDeclaredFields()) {
      if (!field.isAnnotationPresent(MockitoBean.class)) continue;
      Class<?> type = field.getType();
      boolean shaping = SHAPING.stream().anyMatch(s -> s.isAssignableFrom(type))
          || AnnotatedElementUtils.hasAnnotation(type, Controller.class)
          || AnnotatedElementUtils.hasAnnotation(type, SpringBootConfiguration.class);
      if (shaping) throw new BootError("access-shaping bean " + type.getName() + " may not be stubbed", null);
      Reason reason = field.getAnnotation(Reason.class);
      if (reason == null || reason.value().isBlank()) throw new BootError("stub " + type.getName() + " needs a @Reason", null);
      stubs.add(new Stub(type.getName(), reason.value()));
    }
    stubs.sort(Comparator.comparing(Stub::target));
    return stubs;
  }

  static void checkPins(List<Pin> pins) {
    var settings = new HashSet<String>();
    for (Pin pin : pins) {
      if (pin.setting() == null || pin.setting().isBlank()) throw new BootError("a pinned property needs a name", null);
      if (pin.setting().equals("spring.profiles.active")) throw new BootError("set the profile with @ActiveProfiles, not a pinned property", null);
      if (!settings.add(pin.setting())) throw new BootError("property " + pin.setting() + " is pinned twice", null);
      if (pin.reason() == null || pin.reason().isBlank()) throw new BootError("pinned property " + pin.setting() + " needs a reason", null);
    }
  }

  /** The application class as @SpringBootTest names it, for a boot that fails before there is a context. */
  static String target() {
    var test = AnnotatedElementUtils.findMergedAnnotation(Boot.class, SpringBootTest.class);
    var classes = test == null ? new Class<?>[0] : test.classes();
    return classes.length == 0
        ? "the @SpringBootConfiguration above package accessinspector"
        : Arrays.stream(classes).map(Class::getName).collect(Collectors.joining(", "));
  }

  static BootEnvironment environment(ApplicationContext context) {
    String entry = Arrays.stream(context.getBeanNamesForAnnotation(SpringBootConfiguration.class))
        .map(name -> ClassUtils.getUserClass(context.getType(name)).getName())
        .sorted()
        .collect(Collectors.joining(", "));
    String[] active = context.getEnvironment().getActiveProfiles();
    var pinned = new ArrayList<Pin>();
    pinned.add(new Pin("spring.profiles.active", active.length == 0 ? "default" : String.join(",", active), PROFILE_REASON));
    pinned.addAll(PINNED);
    return new BootEnvironment(entry, List.of(), stubs(), pinned);
  }
}
