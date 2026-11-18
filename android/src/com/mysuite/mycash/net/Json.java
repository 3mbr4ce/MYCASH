package com.mysuite.mycash.net;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Tiny JSON reader/writer (objects -> LinkedHashMap, arrays -> ArrayList, numbers -> Long or Double). No regex. */
public final class Json {
    private final String s;
    private int i;

    private Json(String s) { this.s = s; }

    public static Object parse(String text) {
        Json j = new Json(text);
        j.ws();
        Object v = j.value();
        j.ws();
        if (j.i != j.s.length()) throw new IllegalArgumentException("trailing data");
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(String text) {
        Object o = parse(text);
        if (!(o instanceof Map)) throw new IllegalArgumentException("object expected");
        return (Map<String, Object>) o;
    }

    public static boolean valid(String text) {
        try { parse(text); return true; } catch (RuntimeException e) { return false; }
    }

    private void ws() { while (i < s.length() && s.charAt(i) <= ' ') i++; }

    private Object value() {
        if (i >= s.length()) throw new IllegalArgumentException("unexpected end");
        char c = s.charAt(i);
        if (c == '{') {
            i++; Map<String, Object> m = new LinkedHashMap<>(); ws();
            if (peek('}')) { i++; return m; }
            while (true) {
                ws(); String k = str(); ws(); expect(':'); ws(); m.put(k, value()); ws();
                if (peek(',')) { i++; continue; }
                expect('}'); return m;
            }
        }
        if (c == '[') {
            i++; List<Object> l = new ArrayList<>(); ws();
            if (peek(']')) { i++; return l; }
            while (true) {
                ws(); l.add(value()); ws();
                if (peek(',')) { i++; continue; }
                expect(']'); return l;
            }
        }
        if (c == '"') return str();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int st = i; boolean dbl = false;
        while (i < s.length()) {
            char d = s.charAt(i);
            if ((d >= '0' && d <= '9') || d == '-' || d == '+') i++;
            else if (d == '.' || d == 'e' || d == 'E') { dbl = true; i++; }
            else break;
        }
        if (st == i) throw new IllegalArgumentException("bad value at " + i);
        String n = s.substring(st, i);
        if (!dbl) { try { return Long.parseLong(n); } catch (NumberFormatException e) { /* fall through */ } }
        return Double.parseDouble(n);
    }

    private boolean peek(char c) { return i < s.length() && s.charAt(i) == c; }
    private void expect(char c) { if (!peek(c)) throw new IllegalArgumentException("expected " + c + " at " + i); i++; }

    private String str() {
        expect('"');
        StringBuilder b = new StringBuilder();
        while (true) {
            if (i >= s.length()) throw new IllegalArgumentException("unterminated string");
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                default: b.append(e);
            }
        }
    }

    public static String quote(String v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder(v.length() + 2).append('"');
        for (int k = 0; k < v.length(); k++) {
            char c = v.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) { String h = Integer.toHexString(c); b.append("\\u"); for (int z = h.length(); z < 4; z++) b.append('0'); b.append(h); }
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    @SuppressWarnings("unchecked")
    public static String write(Object v) {
        if (v == null) return "null";
        if (v instanceof String) return quote((String) v);
        if (v instanceof Boolean || v instanceof Long || v instanceof Integer) return v.toString();
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return Long.toString((long) d);
            return Double.toString(d);
        }
        if (v instanceof Raw) return ((Raw) v).json;
        StringBuilder b = new StringBuilder();
        if (v instanceof Map) {
            b.append('{'); boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) v).entrySet()) {
                if (!first) b.append(','); first = false;
                b.append(quote(e.getKey())).append(':').append(write(e.getValue()));
            }
            return b.append('}').toString();
        }
        if (v instanceof List) {
            b.append('['); boolean first = true;
            for (Object o : (List<Object>) v) { if (!first) b.append(','); first = false; b.append(write(o)); }
            return b.append(']').toString();
        }
        return quote(v.toString());
    }

    /** Already-encoded JSON to embed as is. */
    public static final class Raw { final String json; public Raw(String j) { json = j; } }

    public static String getStr(Map<String, Object> m, String k) { Object o = m.get(k); return o == null ? "" : o.toString(); }
    public static long getLong(Map<String, Object> m, String k) { Object o = m.get(k); return o instanceof Number ? ((Number) o).longValue() : 0; }
    public static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int k = 0; k + 1 < kv.length; k += 2) m.put((String) kv[k], kv[k + 1]);
        return m;
    }
}
