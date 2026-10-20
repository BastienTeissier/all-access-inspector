package accessinspector;

import accessinspector.Rules.Finding;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationContext;
import org.springframework.expression.Expression;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.expression.WebExpressionAuthorizationManager;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcherEntry;

/**
 * The global layer: the first SecurityFilterChain matching the request, then the first authorizeHttpRequests entry
 * matching it, as Spring Security picks them. The entries are not public, so they are read by reflection, and a
 * Spring Security whose internals moved yields unknown on every endpoint, never a crash.
 */
final class FilterChainResolver {
  static final String INTERNALS_CHANGED = "Spring Security internals changed";

  private record Chain(String bean, SecurityFilterChain chain) {}

  /** The internals this script reads are not where it expects them. */
  static final class InternalsChanged extends RuntimeException {
    InternalsChanged(String message, Throwable cause) {
      super(message, cause);
    }
  }

  private final List<Chain> chains = new ArrayList<>();
  private final String mappings;

  FilterChainResolver(ApplicationContext context) {
    this(context, "mappings");
  }

  /** mappings: the private field holding the authorizeHttpRequests entries; a test names a missing one. */
  FilterChainResolver(ApplicationContext context, String mappings) {
    this.mappings = mappings;
    var names = new IdentityHashMap<SecurityFilterChain, String>();
    context.getBeansOfType(SecurityFilterChain.class).forEach((name, chain) -> names.put(chain, name));
    for (FilterChainProxy proxy : context.getBeansOfType(FilterChainProxy.class).values()) {
      for (SecurityFilterChain chain : proxy.getFilterChains()) chains.add(new Chain(names.getOrDefault(chain, "(web.ignoring)"), chain));
    }
  }

  /** The check the filter chain applies to one request; method is never ANY. */
  Finding resolve(String method, String path) {
    var request = new MockHttpServletRequest(method, path);
    request.setServletPath(path);
    for (Chain chain : chains) {
      if (!chain.chain().matches(request)) continue;
      try {
        return decide(chain, request);
      } catch (ReflectiveOperationException | RuntimeException e) {
        String reason = INTERNALS_CHANGED + ": " + e.getMessage();
        return new Finding("spring-security", "global", chain.bean() + ": " + describe(chain.chain()), null, reason);
      }
    }
    return Finding.of("no_chain", "framework-default", null, "no_chain");
  }

  private Finding decide(Chain chain, MockHttpServletRequest request) throws ReflectiveOperationException {
    String where = chain.bean() + ": ";
    var filter = chain.chain().getFilters().stream().filter(AuthorizationFilter.class::isInstance).map(AuthorizationFilter.class::cast).findFirst();
    if (filter.isEmpty()) return Finding.of("no_authorization", "global", where + describe(chain.chain()) + " -> no authorizeHttpRequests", "no_authorization");
    Object manager = unwrap(filter.get().getAuthorizationManager());
    if (!(manager instanceof RequestMatcherDelegatingAuthorizationManager delegating)) {
      return finding(where + describe(chain.chain()), manager);
    }
    for (RequestMatcherEntry<?> entry : entries(delegating)) {
      RequestMatcher matcher = entry.getRequestMatcher();
      if (matcher.matches(request)) return finding(where + describe(matcher), entry.getEntry());
    }
    // no entry matches: RequestMatcherDelegatingAuthorizationManager denies
    return Finding.of("denyAll", "global", where + "no matching authorizeHttpRequests entry -> denyAll", "denyAll");
  }

  @SuppressWarnings("unchecked")
  private List<RequestMatcherEntry<?>> entries(Object manager) throws ReflectiveOperationException {
    return (List<RequestMatcherEntry<?>>) field(manager, mappings);
  }

  /** Observation decorates every manager when an ObservationRegistry is present. */
  private static Object unwrap(Object manager) throws ReflectiveOperationException {
    while (manager.getClass().getName().equals("org.springframework.security.authorization.ObservationAuthorizationManager")) {
      manager = field(manager, "delegate");
    }
    return manager;
  }

  private static Finding finding(String matched, Object manager) throws ReflectiveOperationException {
    manager = unwrap(manager);
    String construct;
    String builtin;
    if (manager.getClass().getName().equals("org.springframework.security.authorization.SingleResultAuthorizationManager")) {
      @SuppressWarnings("unchecked")
      AuthorizationResult result = ((AuthorizationManager<Object>) manager).authorize(() -> null, new Object());
      construct = result != null && result.isGranted() ? "permitAll" : "denyAll";
      builtin = construct;
    } else if (manager instanceof AuthenticatedAuthorizationManager<?>) {
      String strategy = field(manager, "authorizationStrategy").getClass().getSimpleName();
      construct = switch (strategy) {
        case "AuthenticatedAuthorizationStrategy" -> "authenticated";
        case "FullyAuthenticatedAuthorizationStrategy" -> "fullyAuthenticated";
        case "RememberMeAuthorizationStrategy" -> "rememberMe";
        case "AnonymousAuthorizationStrategy" -> "anonymous";
        default -> throw new InternalsChanged("AuthenticatedAuthorizationManager strategy " + strategy, null);
      };
      builtin = Rules.BUILTIN.containsKey(construct) ? construct : null;
    } else if (manager instanceof AuthorityAuthorizationManager<?>) {
      var authorities = ((java.util.Collection<?>) field(manager, "authorities")).stream().map(String::valueOf).sorted();
      construct = authorities.map(a -> "'" + a + "'").collect(Collectors.joining(", ", "hasAnyAuthority(", ")"));
      builtin = "hasAnyAuthority";
    } else if (manager instanceof WebExpressionAuthorizationManager) {
      String expression = ((Expression) field(manager, "expression")).getExpressionString();
      construct = "access(" + Json.quote(expression) + ")";
      builtin = Rules.expression(expression);
    } else {
      construct = name(manager.getClass());
      builtin = null;
    }
    return Finding.of(construct, "global", matched + " -> " + construct, builtin);
  }

  private static Object field(Object target, String name) throws ReflectiveOperationException {
    for (Class<?> type = target.getClass(); type != null; type = type.getSuperclass()) {
      try {
        Field field = type.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
      } catch (NoSuchFieldException e) {
        // look in the superclass
      }
    }
    throw new NoSuchFieldException(target.getClass().getName() + "." + name);
  }

  /** toString when it is stable text; a lambda or an object without its own toString by its class. */
  private static String describe(Object value) {
    String text = value instanceof DefaultSecurityFilterChain chain ? String.valueOf(chain.getRequestMatcher()) : String.valueOf(value);
    return text.contains("$$Lambda") || text.matches("(?s).*@[0-9a-f]{4,}.*") ? name(value.getClass()) : text;
  }

  /** A class name without the run-dependent suffix of a lambda. */
  private static String name(Class<?> type) {
    String name = type.getName();
    int lambda = name.indexOf("$$Lambda");
    return lambda >= 0 ? "lambda in " + name.substring(0, lambda) : name;
  }
}
