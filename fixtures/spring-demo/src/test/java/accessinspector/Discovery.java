package accessinspector;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.TreeMap;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.function.support.RouterFunctionMapping;
import org.springframework.web.servlet.handler.AbstractHandlerMethodMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;

/** Every request mapping the DispatcherServlet serves, actuator and /error included, as Spring resolved it. */
final class Discovery {
  private Discovery() {}

  /** One method and path of a handler; sample is a concrete request path the pattern matches. */
  record Mapped(String method, String path, String sample, String handler, HandlerMethod handlerMethod) {}

  /** note is set when some routes are served but not listed. */
  record Discovered(List<Mapped> endpoints, String note) {}

  static Discovered discover(ApplicationContext context) {
    var found = new LinkedHashMap<List<String>, Mapped>();
    var implicitHead = new HashSet<List<String>>();
    var declaredHead = new HashSet<String>();
    // by bean name, so the walk is the same on every run
    var mappings = new TreeMap<>(context.getBeansOfType(HandlerMapping.class));
    for (HandlerMapping mapping : mappings.values()) {
      if (!(mapping instanceof AbstractHandlerMethodMapping<?> methods)) continue;
      methods.getHandlerMethods().forEach((info, handlerMethod) -> {
        if (!(info instanceof RequestMappingInfo request)) return;
        String handler = handlerMethod.getBeanType().getName() + "." + handlerMethod.getMethod().getName();
        boolean declaresHead = request.getMethodsCondition().getMethods().contains(RequestMethod.HEAD);
        for (String pattern : request.getPatternValues()) {
          if (declaresHead) declaredHead.add(path(pattern));
          for (String method : methods(request)) {
            var mapped = new Mapped(method, path(pattern), sample(pattern), handler, handlerMethod);
            var key = List.of(mapped.method(), mapped.path(), handler);
            found.putIfAbsent(key, mapped);
            if (method.equals("HEAD") && !declaresHead) implicitHead.add(key);
          }
        }
      });
    }
    // a handler declaring HEAD outranks the GET handler's implicit one: Spring sends every HEAD there
    found.keySet().removeIf(key -> implicitHead.contains(key) && declaredHead.contains(key.get(1)));
    boolean functional = context.getBeansOfType(RouterFunctionMapping.class).values().stream().anyMatch(m -> m.getRouterFunction() != null);
    return new Discovered(new ArrayList<>(found.values()), functional ? "functional routes (RouterFunction beans) are not listed" : null);
  }

  /** The declared methods, HEAD beside GET as Spring serves it; none declared is ANY. */
  private static List<String> methods(RequestMappingInfo info) {
    var declared = info.getMethodsCondition().getMethods().stream().map(RequestMethod::name).sorted().toList();
    if (declared.isEmpty()) return List.of("ANY");
    var methods = new ArrayList<>(declared);
    if (methods.contains("GET") && !methods.contains("HEAD")) methods.add("HEAD");
    return methods;
  }

  /** Inventory path format: leading /, variables as {name} (regex and catch-all marks dropped), wildcards as {wildcard}. */
  static String path(String pattern) {
    return slash(rewrite(pattern, "{wildcard}", false));
  }

  /** A request path the pattern matches: every variable and wildcard filled with 1. */
  static String sample(String pattern) {
    return slash(rewrite(pattern, "1", true));
  }

  private static String slash(String path) {
    return path.startsWith("/") ? path : "/" + path;
  }

  private static String rewrite(String pattern, String wildcard, boolean fill) {
    var out = new StringBuilder();
    for (int i = 0; i < pattern.length(); i++) {
      char c = pattern.charAt(i);
      if (c == '{') {
        int depth = 0;
        int end = i;
        for (; end < pattern.length(); end++) {
          if (pattern.charAt(end) == '{') depth++;
          else if (pattern.charAt(end) == '}' && --depth == 0) break;
        }
        String inside = pattern.substring(i + 1, Math.min(end, pattern.length()));
        String name = inside.replaceFirst("^\\*", "").split(":", 2)[0];
        out.append(fill ? "1" : "{" + name + "}");
        i = end;
      } else if (c == '*') {
        while (i + 1 < pattern.length() && pattern.charAt(i + 1) == '*') i++;
        out.append(wildcard);
      } else {
        out.append(c);
      }
    }
    return out.toString();
  }
}
