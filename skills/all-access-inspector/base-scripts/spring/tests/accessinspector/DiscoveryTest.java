package accessinspector;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.web.HttpRequestHandler;
import org.springframework.web.servlet.function.RouterFunctions;
import org.springframework.web.servlet.function.ServerResponse;
import org.springframework.web.servlet.function.support.RouterFunctionMapping;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

class DiscoveryTest {
  private static String note(Consumer<GenericApplicationContext> beans) {
    var context = new GenericApplicationContext();
    beans.accept(context);
    context.refresh();
    return Discovery.discover(context).note();
  }

  private static Consumer<GenericApplicationContext> urls(Map<String, Object> handlers) {
    return context -> context.registerBean(SimpleUrlHandlerMapping.class, () -> new SimpleUrlHandlerMapping(handlers));
  }

  @Test
  void staticAssetsAloneKeepTheCoverageComplete() {
    assertThat(note(urls(Map.of("/webjars/**", new ResourceHttpRequestHandler())))).isNull();
  }

  @Test
  void aUrlMappedHandlerIsNamedInTheNote() {
    HttpRequestHandler page = (request, response) -> {};
    assertThat(note(urls(Map.of("/login-page", page, "/assets/**", new ResourceHttpRequestHandler()))))
        .isEqualTo("URL-mapped handlers are not listed: /login-page");
  }

  @Test
  void functionalRoutesAreNamedInTheNote() {
    var routes = RouterFunctions.route().GET("/fn", request -> ServerResponse.ok().build()).build();
    assertThat(note(context -> context.registerBean(RouterFunctionMapping.class, () -> new RouterFunctionMapping(routes))))
        .isEqualTo("functional routes (RouterFunction beans) are not listed");
  }
}
