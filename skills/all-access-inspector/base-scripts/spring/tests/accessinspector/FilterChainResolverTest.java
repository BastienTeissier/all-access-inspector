package accessinspector;

import static org.assertj.core.api.Assertions.assertThat;

import accessinspector.Rules.Finding;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.SingleResultAuthorizationManager;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.access.expression.WebExpressionAuthorizationManager;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;

class FilterChainResolverTest {
  private static FilterChainResolver resolver(String mappings) {
    AuthorizationManager<RequestAuthorizationContext> custom = (authentication, context) -> new AuthorizationDecision(true);
    var manager = RequestMatcherDelegatingAuthorizationManager.builder()
        .add(PathPatternRequestMatcher.pathPattern("/open/**"), SingleResultAuthorizationManager.permitAll())
        .add(PathPatternRequestMatcher.pathPattern("/closed"), SingleResultAuthorizationManager.denyAll())
        .add(PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/cars"), AuthorityAuthorizationManager.hasAnyRole("USER", "ADMIN"))
        .add(PathPatternRequestMatcher.pathPattern("/net"), new WebExpressionAuthorizationManager("hasIpAddress('10.0.0.0/8')"))
        .add(PathPatternRequestMatcher.pathPattern("/admin"), new WebExpressionAuthorizationManager("hasRole('ADMIN')"))
        .add(PathPatternRequestMatcher.pathPattern("/custom"), custom)
        .add(PathPatternRequestMatcher.pathPattern("/api/**"), AuthenticatedAuthorizationManager.authenticated())
        .build();
    var api = new DefaultSecurityFilterChain(PathPatternRequestMatcher.pathPattern("/**"), new AuthorizationFilter(manager));
    var context = new GenericApplicationContext();
    context.registerBean("api", DefaultSecurityFilterChain.class, () -> api);
    context.registerBean(FilterChainProxy.class, () -> new FilterChainProxy(api));
    context.refresh();
    return new FilterChainResolver(context, mappings);
  }

  private static final FilterChainResolver RESOLVER = resolver("mappings");

  @Test
  void eachManagerKindReadsAsItsBuiltin() {
    assertThat(RESOLVER.resolve("GET", "/open/x")).isEqualTo(Finding.of("permitAll", "global", "api: PathPattern [/open/**] -> permitAll", "permitAll"));
    assertThat(RESOLVER.resolve("GET", "/closed").builtin()).isEqualTo("denyAll");
    assertThat(RESOLVER.resolve("POST", "/cars")).isEqualTo(Finding.of(
        "hasAnyAuthority('ROLE_ADMIN', 'ROLE_USER')", "global", "api: PathPattern [POST /cars] -> hasAnyAuthority('ROLE_ADMIN', 'ROLE_USER')", "hasAnyAuthority"));
    assertThat(RESOLVER.resolve("GET", "/api/x").builtin()).isEqualTo("authenticated");
    assertThat(RESOLVER.resolve("GET", "/admin")).isEqualTo(Finding.of("access(\"hasRole('ADMIN')\")", "global", "api: PathPattern [/admin] -> access(\"hasRole('ADMIN')\")", "hasRole"));
  }

  @Test
  void anExpressionOrManagerOutsideTheBuiltinsIsUnread() {
    assertThat(RESOLVER.resolve("GET", "/net").builtin()).isNull();
    assertThat(RESOLVER.resolve("GET", "/net").construct()).isEqualTo("access(\"hasIpAddress('10.0.0.0/8')\")");
    assertThat(RESOLVER.resolve("GET", "/custom").construct()).isEqualTo("lambda in accessinspector.FilterChainResolverTest");
  }

  @Test
  void aRequestNoEntryMatchesIsDenied() {
    assertThat(RESOLVER.resolve("POST", "/elsewhere").builtin()).isEqualTo("denyAll");
  }

  @Test
  void noChainMatchingIsTheFrameworkDefault() {
    var context = new GenericApplicationContext();
    context.refresh();
    assertThat(new FilterChainResolver(context).resolve("GET", "/x")).isEqualTo(Finding.of("no_chain", "framework-default", null, "no_chain"));
  }

  @Test
  void aChainWithoutAuthorizationLetsEveryRequestThrough() {
    var chain = new DefaultSecurityFilterChain(AnyRequestMatcher.INSTANCE);
    var context = new GenericApplicationContext();
    context.registerBean("open", DefaultSecurityFilterChain.class, () -> chain);
    context.registerBean(FilterChainProxy.class, () -> new FilterChainProxy(chain));
    context.refresh();
    assertThat(new FilterChainResolver(context).resolve("GET", "/x").builtin()).isEqualTo("no_authorization");
  }

  @Test
  void movedInternalsReadAsUnknownWithTheirReasonNeverACrash() {
    var finding = resolver("renamedMappings").resolve("GET", "/open/x");
    assertThat(finding.builtin()).isNull();
    assertThat(finding.layer()).isEqualTo("global");
    assertThat(finding.reason()).startsWith(FilterChainResolver.INTERNALS_CHANGED + ": NoSuchFieldException: ");
    var resolved = Rules.resolveAccess(java.util.List.of(finding), "GET", "/open/x");
    assertThat(resolved.authentication().value()).isEqualTo("unknown");
    assertThat(resolved.reason()).startsWith("Spring Security internals changed");
  }
}
