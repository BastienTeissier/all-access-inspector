package accessinspector;

import static org.assertj.core.api.Assertions.assertThat;

import accessinspector.Rules.Finding;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.security.access.annotation.Secured;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.web.method.HandlerMethod;

class MethodSecurityTest {
  static class Controller {
    @PreAuthorize("isAuthenticated()")
    @Secured("ROLE_ADMIN")
    public void handle() {}
  }

  @EnableMethodSecurity
  static class Config {}

  private static List<Finding> findings(Consumer<GenericApplicationContext> beans) throws NoSuchMethodException {
    var context = new GenericApplicationContext();
    beans.accept(context);
    context.refresh();
    return MethodSecurity.findings(context, new HandlerMethod(new Controller(), Controller.class.getMethod("handle")));
  }

  @Test
  void anAnnotationWhoseInterceptorRunsIsRead() throws NoSuchMethodException {
    assertThat(findings(context -> context.registerBean("preAuthorizeAuthorizationMethodInterceptor", Object.class)))
        .containsExactly(Finding.of("@PreAuthorize(\"isAuthenticated()\")", "method", "@PreAuthorize(\"isAuthenticated()\")", "isAuthenticated"));
  }

  @Test
  void anAnnotationNoEnableMethodSecurityTurnsOnIsInert() throws NoSuchMethodException {
    assertThat(findings(context -> {})).isEmpty();
  }

  @Test
  void anEnabledFamilyWithoutItsInterceptorIsUnknownNeverDropped() throws NoSuchMethodException {
    var findings = findings(context -> context.registerBean(Config.class));
    assertThat(findings).hasSize(1);
    assertThat(findings.get(0).builtin()).isNull();
    assertThat(findings.get(0).reason()).isEqualTo(FilterChainResolver.INTERNALS_CHANGED
        + ": @EnableMethodSecurity enables @PreAuthorize(\"isAuthenticated()\") but no bean preAuthorizeAuthorizationMethodInterceptor runs it");
  }
}
