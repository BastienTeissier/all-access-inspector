package accessinspector;

import accessinspector.Rules.Finding;
import java.lang.reflect.AnnotatedElement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.annotation.AnnotationAttributes;
import org.springframework.web.method.HandlerMethod;

/** The method security annotations a handler runs: per family, the method's or else its class's, as Spring applies them. */
final class MethodSecurity {
  private MethodSecurity() {}

  /** One interceptor's annotations; it runs only when @EnableMethodSecurity registered its bean. */
  private record Family(String interceptor, List<String> annotations) {}

  private static final List<Family> FAMILIES = List.of(
      new Family("preAuthorizeAuthorizationMethodInterceptor", List.of("org.springframework.security.access.prepost.PreAuthorize")),
      new Family("postAuthorizeAuthorizationMethodInterceptor", List.of("org.springframework.security.access.prepost.PostAuthorize")),
      new Family("securedAuthorizationMethodInterceptor", List.of("org.springframework.security.access.annotation.Secured")),
      new Family("jsr250AuthorizationMethodInterceptor", List.of(
          "jakarta.annotation.security.RolesAllowed", "jakarta.annotation.security.PermitAll", "jakarta.annotation.security.DenyAll")));

  static List<Finding> findings(ApplicationContext context, HandlerMethod handler) {
    var findings = new ArrayList<Finding>();
    for (Family family : FAMILIES) {
      if (!context.containsBean(family.interceptor())) continue;
      // the method, its overridden and interface declarations included, before the class
      var found = find(handler.getMethod(), family, "method");
      if (found == null) found = find(handler.getBeanType(), family, "class");
      if (found != null) findings.add(found);
    }
    return findings;
  }

  private static Finding find(AnnotatedElement element, Family family, String layer) {
    for (String name : family.annotations()) {
      AnnotationAttributes attributes = AnnotatedElementUtils.findMergedAnnotationAttributes(element, name, false, false);
      if (attributes != null) return finding(name.substring(name.lastIndexOf('.') + 1), attributes, layer);
    }
    return null;
  }

  private static Finding finding(String annotation, AnnotationAttributes attributes, String layer) {
    return switch (annotation) {
      case "PreAuthorize", "PostAuthorize" -> {
        String expression = attributes.getString("value");
        String raw = "@" + annotation + "(" + Json.quote(expression) + ")";
        yield Finding.of(raw, layer, raw, Rules.expression(expression));
      }
      case "Secured", "RolesAllowed" -> {
        String raw = "@" + annotation + Arrays.stream(attributes.getStringArray("value")).map(Json::quote).collect(Collectors.joining(", ", "({", "})"));
        yield Finding.of(raw, layer, raw, annotation);
      }
      default -> Finding.of("@" + annotation, layer, "@" + annotation, annotation);
    };
  }
}
