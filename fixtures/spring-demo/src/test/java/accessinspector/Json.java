package accessinspector;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** JSON as the inventory needs it: objects keep their key order, numbers keep their text. */
final class Json {
  private Json() {}

  /** A number, kept as written so it serialises back to the same text. */
  record Num(String text) {}

  /** JSON with ", " and ": " separators; non-ASCII and / unescaped, as Python's json.dumps(ensure_ascii=False). */
  static String compact(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) return quote(s);
    if (value instanceof Boolean || value instanceof Number) return value.toString();
    if (value instanceof Num n) return n.text();
    if (value instanceof Map<?, ?> map) {
      return map.entrySet().stream()
          .map(e -> quote((String) e.getKey()) + ": " + compact(e.getValue()))
          .collect(Collectors.joining(", ", "{", "}"));
    }
    if (value instanceof List<?> list) return list.stream().map(Json::compact).collect(Collectors.joining(", ", "[", "]"));
    throw new IllegalArgumentException("not a JSON value: " + value.getClass().getName());
  }

  static String quote(String s) {
    var out = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> out.append(c < 0x20 ? String.format("\\u%04x", (int) c) : String.valueOf(c));
      }
    }
    return out.append('"').toString();
  }

  static Object parse(String text) {
    var parser = new Parser(text);
    Object value = parser.value();
    parser.space();
    if (parser.at < text.length()) throw parser.error();
    return value;
  }

  private static final class Parser {
    private final String text;
    private int at;

    Parser(String text) {
      this.text = text;
    }

    IllegalArgumentException error() {
      return new IllegalArgumentException("invalid JSON at offset " + at);
    }

    void space() {
      while (at < text.length() && " \t\r\n".indexOf(text.charAt(at)) >= 0) at++;
    }

    boolean take(String token) {
      space();
      if (!text.startsWith(token, at)) return false;
      at += token.length();
      return true;
    }

    void expect(String token) {
      if (!take(token)) throw error();
    }

    Object value() {
      space();
      if (at >= text.length()) throw error();
      char c = text.charAt(at);
      if (c == '{') return object();
      if (c == '[') return array();
      if (c == '"') return string();
      if (take("true")) return true;
      if (take("false")) return false;
      if (take("null")) return null;
      return number();
    }

    Map<String, Object> object() {
      expect("{");
      var map = new LinkedHashMap<String, Object>();
      if (take("}")) return map;
      do {
        space();
        String key = string();
        expect(":");
        map.put(key, value());
      } while (take(","));
      expect("}");
      return map;
    }

    List<Object> array() {
      expect("[");
      var list = new ArrayList<>();
      if (take("]")) return list;
      do list.add(value());
      while (take(","));
      expect("]");
      return list;
    }

    String string() {
      if (at >= text.length() || text.charAt(at) != '"') throw error();
      at++;
      var out = new StringBuilder();
      while (at < text.length()) {
        char c = text.charAt(at++);
        if (c == '"') return out.toString();
        if (c < 0x20) throw error();
        if (c != '\\') {
          out.append(c);
          continue;
        }
        if (at >= text.length()) throw error();
        char e = text.charAt(at++);
        switch (e) {
          case '"', '\\', '/' -> out.append(e);
          case 'b' -> out.append('\b');
          case 'f' -> out.append('\f');
          case 'n' -> out.append('\n');
          case 'r' -> out.append('\r');
          case 't' -> out.append('\t');
          case 'u' -> {
            if (at + 4 > text.length()) throw error();
            try {
              out.append((char) Integer.parseInt(text.substring(at, at + 4), 16));
            } catch (NumberFormatException x) {
              throw error();
            }
            at += 4;
          }
          default -> throw error();
        }
      }
      throw error();
    }

    Num number() {
      int start = at;
      var m = java.util.regex.Pattern.compile("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?").matcher(text).region(at, text.length());
      if (!m.lookingAt()) throw error();
      at = m.end();
      return new Num(text.substring(start, at));
    }
  }
}
