package accessinspector;

import accessinspector.Inventory.Axis;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/** Fixed-width terminal table rendered from an inventory; never written to disk. */
final class Table {
  private Table() {}

  private static final List<String> HEADER = List.of("", "METHOD", "PATH", "AUTHENTICATION", "AUTHORIZATION", "HANDLER", "DIMENSIONS");

  static String render(Inventory inventory) {
    var rows = new ArrayList<List<String>>();
    rows.add(HEADER);
    for (var e : inventory.endpoints().stream().sorted(Inventory.ORDER).toList()) {
      String dimensions = e.dimensions().entrySet().stream().map(d -> d.getKey() + "=" + d.getValue()).collect(Collectors.joining(" "));
      rows.add(List.of(Inventory.isUnknown(e) ? "?" : "", e.method(), e.path(), axis(e.authentication()), axis(e.authorization()), e.handler(), dimensions));
    }
    int[] widths = new int[HEADER.size()];
    for (var row : rows) for (int i = 0; i < widths.length; i++) widths[i] = Math.max(widths[i], length(row.get(i)));
    return rows.stream()
        .map(row -> {
          var line = new StringBuilder();
          for (int i = 0; i < widths.length; i++) {
            if (i > 0) line.append("  ");
            line.append(row.get(i)).append(" ".repeat(widths[i] - length(row.get(i))));
          }
          return line.toString().stripTrailing();
        })
        .collect(Collectors.joining("\n"));
  }

  private static int length(String s) {
    return s.codePointCount(0, s.length());
  }

  private static String axis(Axis a) {
    return a.layer() != null ? a.value() + "@" + a.layer() : a.value();
  }
}
