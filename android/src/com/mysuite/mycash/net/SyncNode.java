package com.mysuite.mycash.net;

import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.google.zxing.qrcode.encoder.ByteMatrix;
import com.google.zxing.qrcode.encoder.Encoder;
import com.google.zxing.qrcode.encoder.QRCode;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * MYCASH LAN sync node (pure Java, no Android APIs, so it also runs on a desktop JVM for tests).
 * Same wire protocol and same call API as the Windows app (desktop/syncnet, docs/SYNC.md).
 */
public final class SyncNode {
    public static final int DEFAULT_PORT = 47870;
    static final int PROTO = 1, MAX_FRAME = 16 << 20, IO_TIMEOUT = 15000, CONN_TIMEOUT = 3000, MAX_TRIES = 3;
    static final long PAIR_LIFETIME = 10 * 60 * 1000L;
    static final String QR_PREFIX = "MYCASH1";

    public interface Listener { void onChange(); void onPair(); }

    final File dir;
    final String kind, version;
    final int port;
    volatile Listener listener;
    final SecureRandom rnd = new SecureRandom();
    final ExecutorService pool = Executors.newCachedThreadPool();

    // identity
    String deviceId, name;
    final List<Map<String, Object>> peers = new ArrayList<>();
    String etag;
    ServerSocket server;
    String listenError = "";
    // pairing (host side)
    String sPid, sSecret, sCode, sState, sPeerId = "", sPeerName = "", sPeerKind = "", sErr = "";
    int sTries; long sExpires;
    // pairing (joining side)
    String jPid, jSecret, jAddr, jHostId;

    public SyncNode(File dir, String kind, String version, String defaultName, int port) throws IOException {
        this.dir = dir; this.kind = kind; this.version = version; this.port = port;
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
        etag = randHex(8);
        File f = new File(dir, "sync.json");
        if (f.exists()) {
            try {
                Map<String, Object> m = Json.obj(read(f));
                deviceId = Json.getStr(m, "deviceId"); name = Json.getStr(m, "name");
                Object ps = m.get("peers");
                if (ps instanceof List) for (Object o : (List<?>) ps) if (o instanceof Map) peers.add(castMap(o));
            } catch (RuntimeException e) { deviceId = null; }
        }
        if (deviceId == null || deviceId.isEmpty()) { deviceId = randHex(8); name = defaultName; saveIdentity(); }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> castMap(Object o) { return (Map<String, Object>) o; }

    public void setListener(Listener l) { listener = l; }

    // ---------- files ----------
    static String read(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return new String(b.toByteArray(), StandardCharsets.UTF_8);
        } finally { in.close(); }
    }

    static void atomicWrite(File f, String data) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        try { out.write(data.getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); } finally { out.close(); }
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) throw new IOException("rename failed"); }
    }

    synchronized void saveIdentity() {
        try { atomicWrite(new File(dir, "sync.json"), Json.write(Json.map("deviceId", deviceId, "name", name, "peers", peers))); }
        catch (IOException ignored) {}
    }

    File dataFile() { return new File(dir, "data.json"); }

    public synchronized String load() {
        try { return read(dataFile()); } catch (IOException e) {
            try { return read(new File(dir, "data.json.bak")); } catch (IOException e2) { return ""; }
        }
    }

    public synchronized String save(String doc) throws IOException {
        if (!Json.valid(doc)) throw new IOException("invalid document");
        File f = dataFile();
        if (f.exists()) { try { String old = read(f); if (!old.isEmpty()) atomicWrite(new File(dir, "data.json.bak"), old); } catch (IOException ignored) {} }
        atomicWrite(f, doc);
        etag = randHex(8);
        return etag;
    }

    // ---------- crypto ----------
    static byte[] deriveKey(String... parts) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (int k = 0; k < parts.length; k++) {
                if (k > 0) md.update((byte) '|');
                md.update(parts[k].getBytes(StandardCharsets.UTF_8));
            }
            return md.digest();
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    String[] seal(byte[] key, String aad, String plain) throws Exception {
        byte[] iv = new byte[12]; rnd.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return new String[]{Base64.getEncoder().encodeToString(iv), Base64.getEncoder().encodeToString(ct)};
    }

    static String open(byte[] key, String aad, String iv, String ct) {
        try {
            byte[] n = Base64.getDecoder().decode(iv), d = Base64.getDecoder().decode(ct);
            if (n.length != 12) return null;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, n));
            c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            return new String(c.doFinal(d), StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }

    String randHex(int n) {
        byte[] b = new byte[n]; rnd.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) { s.append("0123456789abcdef".charAt((x >> 4) & 15)).append("0123456789abcdef".charAt(x & 15)); }
        return s.toString();
    }
    String randB64(int n) { byte[] b = new byte[n]; rnd.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    String randCode() { int v = rnd.nextInt(1000000); String s = "00000" + v; return s.substring(s.length() - 6); }

    // ---------- frames ----------
    static void writeFrame(Socket s, String json) throws IOException {
        byte[] b = json.getBytes(StandardCharsets.UTF_8);
        DataOutputStream o = new DataOutputStream(s.getOutputStream());
        o.writeInt(b.length); o.write(b); o.flush();
    }

    static Map<String, Object> readFrame(Socket s) throws IOException {
        DataInputStream in = new DataInputStream(s.getInputStream());
        int n = in.readInt();
        if (n <= 0 || n > MAX_FRAME) throw new IOException("bad frame size");
        byte[] b = new byte[n]; in.readFully(b);
        try { return Json.obj(new String(b, StandardCharsets.UTF_8)); } catch (RuntimeException e) { throw new IOException("bad frame"); }
    }

    static final class RemoteError extends Exception { RemoteError(String m) { super(m); } }

    Map<String, Object> request(String host, int p, String op, String tag, boolean isPid, byte[] key, Map<String, Object> payload) throws Exception {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, p), CONN_TIMEOUT);
            s.setSoTimeout(IO_TIMEOUT);
            String[] enc = seal(key, op + "|" + tag, Json.write(payload));
            Map<String, Object> env = Json.map("v", (long) PROTO, "op", op, isPid ? "pid" : "from", tag, "iv", enc[0], "ct", enc[1]);
            writeFrame(s, Json.write(env));
            Map<String, Object> r = readFrame(s);
            if (!Boolean.TRUE.equals(r.get("ok"))) { String e = Json.getStr(r, "err"); throw new RemoteError(e.isEmpty() ? "refused" : e); }
            String plain = open(key, "resp|" + op + "|" + tag, Json.getStr(r, "iv"), Json.getStr(r, "ct"));
            if (plain == null) throw new IOException("could not decrypt the answer");
            return Json.obj(plain);
        } finally { try { s.close(); } catch (IOException ignored) {} }
    }

    // ---------- server ----------
    public synchronized void start() {
        if (server != null) return;
        try {
            ServerSocket ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(port));
            server = ss; listenError = "";
            final ServerSocket fss = ss;
            Thread t = new Thread(new Runnable() { public void run() {
                while (!fss.isClosed()) {
                    try { final Socket c = fss.accept(); pool.execute(new Runnable() { public void run() { serve(c); } }); }
                    catch (IOException e) { if (fss.isClosed()) return; }
                }
            }}, "mycash-sync");
            t.setDaemon(true); t.start();
        } catch (IOException e) { listenError = e.getMessage() == null ? "listen failed" : e.getMessage(); }
    }

    public synchronized void stop() {
        if (server != null) { try { server.close(); } catch (IOException ignored) {} server = null; }
    }

    void serve(Socket c) {
        String notify = "";
        try {
            c.setSoTimeout(IO_TIMEOUT);
            Map<String, Object> req = readFrame(c);
            String ip = c.getInetAddress() == null ? "" : c.getInetAddress().getHostAddress();
            String[] out = new String[1];
            notify = handle(req, ip, out);
            writeFrame(c, out[0]);
        } catch (IOException ignored) {
        } finally { try { c.close(); } catch (IOException ignored) {} }
        Listener l = listener;
        if (l != null) { if ("change".equals(notify)) l.onChange(); else if ("pair".equals(notify)) l.onPair(); }
    }

    static String fail(String m) { return Json.write(Json.map("ok", Boolean.FALSE, "err", m)); }

    String reply(byte[] key, String op, String tag, Map<String, Object> v) {
        try { String[] e = seal(key, "resp|" + op + "|" + tag, Json.write(v)); return Json.write(Json.map("ok", Boolean.TRUE, "iv", e[0], "ct", e[1])); }
        catch (Exception ex) { return fail("internal error"); }
    }

    synchronized String handle(Map<String, Object> req, String ip, String[] out) {
        if (Json.getLong(req, "v") != PROTO) { out[0] = fail("unsupported version"); return ""; }
        String op = Json.getStr(req, "op"), iv = Json.getStr(req, "iv"), ct = Json.getStr(req, "ct");
        if (op.equals("hello") || op.equals("pair")) {
            String pid = Json.getStr(req, "pid");
            if (sPid == null || !sPid.equals(pid) || System.currentTimeMillis() > sExpires || "failed".equals(sState) || "done".equals(sState)) {
                out[0] = fail("no pairing in progress"); return "";
            }
            if (op.equals("hello")) {
                byte[] key = deriveKey("MYCASH-hello", sSecret);
                String p = open(key, "hello|" + pid, iv, ct);
                Map<String, Object> m = p == null ? null : safeObj(p);
                if (m == null || Json.getStr(m, "id").isEmpty()) { out[0] = fail("bad pairing request"); return ""; }
                if ("code".equals(sState) && !sPeerId.equals(Json.getStr(m, "id"))) { out[0] = fail("another device is pairing"); return ""; }
                sState = "code"; sPeerId = Json.getStr(m, "id"); sPeerName = Json.getStr(m, "name"); sPeerKind = Json.getStr(m, "kind");
                out[0] = reply(key, "hello", pid, Json.map("id", deviceId, "name", name, "kind", kind, "port", (long) port));
                return "pair";
            }
            if (!"code".equals(sState)) { out[0] = fail("say hello first"); return ""; }
            byte[] key = deriveKey("MYCASH-pair", sSecret, sCode);
            String p = open(key, "pair|" + pid, iv, ct);
            Map<String, Object> m = p == null ? null : safeObj(p);
            if (m == null || !sPeerId.equals(Json.getStr(m, "id"))) {
                sTries++;
                if (sTries >= MAX_TRIES) { sState = "failed"; sErr = "Wrong code entered too often"; out[0] = fail("wrong code, pairing cancelled"); }
                else out[0] = fail("wrong code");
                return "pair";
            }
            byte[] kb = new byte[32]; rnd.nextBytes(kb);
            String k = Base64.getEncoder().encodeToString(kb);
            Map<String, Object> peer = Json.map("id", sPeerId, "name", Json.getStr(m, "name"), "kind", Json.getStr(m, "kind"), "key", k,
                    "addr", ip, "port", Json.getLong(m, "port"), "pairedAt", System.currentTimeMillis(), "lastSync", 0L);
            addPeer(peer);
            sState = "done";
            out[0] = reply(key, "pair", pid, Json.map("id", deviceId, "name", name, "kind", kind, "port", (long) port, "key", k));
            return "pair";
        }
        if (op.equals("get") || op.equals("put")) {
            String from = Json.getStr(req, "from");
            Map<String, Object> peer = peer(from);
            if (peer == null) { out[0] = fail("not paired"); return ""; }
            byte[] key = Base64.getDecoder().decode(Json.getStr(peer, "key"));
            String p = open(key, op + "|" + from, iv, ct);
            Map<String, Object> m = p == null ? null : safeObj(p);
            if (m == null) { out[0] = fail("not paired"); return ""; }
            notePeer(peer, ip, Json.getLong(m, "port"), Json.getStr(m, "name"));
            if (op.equals("get")) {
                out[0] = reply(key, "get", from, Json.map("doc", load(), "etag", etag, "name", name));
                return "";
            }
            if (!etag.equals(Json.getStr(m, "base"))) { out[0] = fail("conflict"); return ""; }
            try {
                String et = save(Json.getStr(m, "doc"));
                peer.put("lastSync", System.currentTimeMillis()); saveIdentity();
                out[0] = reply(key, "put", from, Json.map("etag", et));
                return "change";
            } catch (IOException e) { out[0] = fail("could not save"); return ""; }
        }
        out[0] = fail("unknown request");
        return "";
    }

    /** Plain character split (no regex). */
    static String[] splitChar(String s, char sep) {
        List<String> out = new ArrayList<>();
        int st = 0;
        for (int k = 0; k <= s.length(); k++) if (k == s.length() || s.charAt(k) == sep) { out.add(s.substring(st, k)); st = k + 1; }
        return out.toArray(new String[0]);
    }

    static String stripSpaces(String s) {
        StringBuilder b = new StringBuilder();
        for (int k = 0; k < s.length(); k++) { char c = s.charAt(k); if (c > ' ' && c != '\u00a0') b.append(c); }
        return b.toString();
    }

    static Map<String, Object> safeObj(String s) { try { return Json.obj(s); } catch (RuntimeException e) { return null; } }

    Map<String, Object> peer(String id) { for (Map<String, Object> p : peers) if (id.equals(Json.getStr(p, "id"))) return p; return null; }

    synchronized void addPeer(Map<String, Object> p) {
        String id = Json.getStr(p, "id");
        for (int k = peers.size() - 1; k >= 0; k--) if (id.equals(Json.getStr(peers.get(k), "id"))) peers.remove(k);
        peers.add(p); saveIdentity();
    }

    void notePeer(Map<String, Object> p, String ip, long prt, String nm) {
        boolean ch = false;
        if (!ip.isEmpty() && !ip.equals(Json.getStr(p, "addr"))) { p.put("addr", ip); ch = true; }
        if (prt > 0 && prt != Json.getLong(p, "port")) { p.put("port", prt); ch = true; }
        if (!nm.isEmpty() && !nm.equals(Json.getStr(p, "name"))) { p.put("name", nm); ch = true; }
        if (ch) saveIdentity();
    }

    // ---------- addresses / QR ----------
    public static List<String> localIPs() {
        List<String> priv = new ArrayList<>(), other = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces();
            if (e != null) for (NetworkInterface ni : Collections.list(e)) {
                try { if (!ni.isUp() || ni.isLoopback()) continue; } catch (Exception x) { continue; }
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress() || a.isLinkLocalAddress()) continue;
                    if (a.isSiteLocalAddress()) priv.add(a.getHostAddress()); else other.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {}
        priv.addAll(other);
        return priv;
    }

    public static Map<String, Object> qrMatrix(String text) {
        List<Object> rows = new ArrayList<>();
        try {
            QRCode q = Encoder.encode(text, ErrorCorrectionLevel.M);
            ByteMatrix m = q.getMatrix();
            for (int y = 0; y < m.getHeight(); y++) {
                StringBuilder b = new StringBuilder();
                for (int x = 0; x < m.getWidth(); x++) b.append(m.get(x, y) == 1 ? '1' : '0');
                rows.add(b.toString());
            }
            return Json.map("n", (long) m.getWidth(), "rows", rows);
        } catch (Exception e) { return Json.map("n", 0L, "rows", rows); }
    }

    // ---------- API (same as the desktop app) ----------
    public synchronized Map<String, Object> info() {
        List<Object> ips = new ArrayList<Object>(localIPs());
        return Json.map("deviceId", deviceId, "name", name, "kind", kind, "version", version, "port", (long) port, "ips", ips,
                "listening", server != null, "listenError", listenError);
    }

    public synchronized Map<String, Object> setName(String n) {
        n = n.trim(); if (n.length() > 40) n = n.substring(0, 40);
        if (!n.isEmpty()) { name = n; saveIdentity(); }
        return info();
    }

    public Map<String, Object> pairStart() {
        List<String> ips = localIPs();
        synchronized (this) {
            sPid = randHex(6); sSecret = randB64(18); sCode = randCode(); sState = "waiting"; sPeerId = ""; sPeerName = ""; sPeerKind = "";
            sErr = ""; sTries = 0; sExpires = System.currentTimeMillis() + PAIR_LIFETIME;
        }
        StringBuilder a = new StringBuilder();
        for (String ip : ips) { if (a.length() > 0) a.append(','); a.append(ip); }
        String text = QR_PREFIX + ";" + a + ";" + port + ";" + sPid + ";" + sSecret;
        return Json.map("qr", text, "matrix", qrMatrix(text), "expiresIn", PAIR_LIFETIME / 1000, "ips", new ArrayList<Object>(ips));
    }

    public synchronized Map<String, Object> pairStatus() {
        if (sPid == null) return Json.map("state", "idle");
        if (("waiting".equals(sState) || "code".equals(sState)) && System.currentTimeMillis() > sExpires) { sState = "failed"; sErr = "Pairing timed out"; }
        Map<String, Object> m = Json.map("state", sState, "peerName", sPeerName, "peerKind", sPeerKind, "error", sErr, "tries", (long) sTries);
        if ("code".equals(sState)) m.put("code", sCode);
        return m;
    }

    public synchronized void pairCancel() { sPid = null; sState = null; jPid = null; }

    static Map<String, Object> res(boolean ok, String err) {
        Map<String, Object> m = Json.map("ok", ok);
        if (err != null) m.put("error", err);
        return m;
    }

    static String friendly(Exception e) {
        if (e instanceof RemoteError) return e.getMessage();
        if (e instanceof SocketTimeoutException) return "device not reachable (timeout)";
        String m = e.getMessage() == null ? e.toString() : e.getMessage();
        if (m.contains("refused")) return "device not reachable (is MYCASH open on it?)";
        if (m.contains("unreachable") || m.contains("No route")) return "device not reachable (same network?)";
        return m;
    }

    public Map<String, Object> pairJoin(String text) {
        String[] parts = splitChar(text.trim(), ';');
        if (parts.length != 5 || !QR_PREFIX.equals(parts[0])) return res(false, "not a MYCASH pairing code");
        int p;
        try { p = Integer.parseInt(parts[2]); } catch (NumberFormatException e) { return res(false, "bad port in pairing code"); }
        if (p <= 0 || p > 65535) return res(false, "bad port in pairing code");
        List<String> addrs = new ArrayList<>();
        for (String a : splitChar(parts[1], ',')) if (!a.trim().isEmpty()) addrs.add(a.trim());
        if (addrs.isEmpty() || parts[3].isEmpty() || parts[4].length() < 16) return res(false, "incomplete pairing code");
        Map<String, Object> me;
        synchronized (this) { me = Json.map("id", deviceId, "name", name, "kind", kind, "port", (long) port); }
        byte[] key = deriveKey("MYCASH-hello", parts[4]);
        String last = "device not reachable";
        for (String a : addrs) {
            try {
                Map<String, Object> r = request(a, p, "hello", parts[3], true, key, me);
                if (deviceId.equals(Json.getStr(r, "id"))) return res(false, "this is the same device");
                synchronized (this) { jPid = parts[3]; jSecret = parts[4]; jAddr = a + ":" + p; jHostId = Json.getStr(r, "id"); }
                Map<String, Object> ok = res(true, null);
                ok.put("hostName", Json.getStr(r, "name")); ok.put("hostKind", Json.getStr(r, "kind"));
                return ok;
            } catch (RemoteError e) { return res(false, e.getMessage());
            } catch (Exception e) { last = friendly(e); }
        }
        return res(false, last);
    }

    public Map<String, Object> pairConfirm(String code) {
        code = stripSpaces(code);
        String pid, secret, addr; Map<String, Object> me;
        synchronized (this) { pid = jPid; secret = jSecret; addr = jAddr; me = Json.map("id", deviceId, "name", name, "kind", kind, "port", (long) port); }
        if (pid == null) return res(false, "scan the pairing code first");
        if (code.length() != 6) return res(false, "the code has 6 digits");
        int c = addr.lastIndexOf(':');
        String host = addr.substring(0, c); int p = Integer.parseInt(addr.substring(c + 1));
        try {
            Map<String, Object> r = request(host, p, "pair", pid, true, deriveKey("MYCASH-pair", secret, code), me);
            String k = Json.getStr(r, "key");
            if (Json.getStr(r, "id").isEmpty() || Base64.getDecoder().decode(k).length != 32) return res(false, "bad answer from the other device");
            Map<String, Object> peer = Json.map("id", Json.getStr(r, "id"), "name", Json.getStr(r, "name"), "kind", Json.getStr(r, "kind"), "key", k,
                    "addr", host, "port", Json.getLong(r, "port"), "pairedAt", System.currentTimeMillis(), "lastSync", 0L);
            addPeer(peer);
            synchronized (this) { jPid = null; }
            Map<String, Object> ok = res(true, null); ok.put("peer", publicPeer(peer));
            return ok;
        } catch (RemoteError e) {
            if (e.getMessage().contains("cancelled")) synchronized (this) { jPid = null; }
            return res(false, e.getMessage());
        } catch (Exception e) { return res(false, friendly(e)); }
    }

    static Map<String, Object> publicPeer(Map<String, Object> p) {
        return Json.map("id", Json.getStr(p, "id"), "name", Json.getStr(p, "name"), "kind", Json.getStr(p, "kind"), "addr", Json.getStr(p, "addr"),
                "port", Json.getLong(p, "port"), "pairedAt", Json.getLong(p, "pairedAt"), "lastSync", Json.getLong(p, "lastSync"));
    }

    public synchronized List<Object> peerList() {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> p : peers) out.add(publicPeer(p));
        return out;
    }

    public synchronized List<Object> removePeer(String id) {
        for (int k = peers.size() - 1; k >= 0; k--) if (id.equals(Json.getStr(peers.get(k), "id"))) peers.remove(k);
        saveIdentity();
        return peerList();
    }

    public Map<String, Object> pull(String id) {
        String host, myName; long p; byte[] key;
        synchronized (this) {
            Map<String, Object> peer = peer(id);
            if (peer == null) return res(false, "unknown device");
            host = Json.getStr(peer, "addr"); p = Json.getLong(peer, "port"); key = Base64.getDecoder().decode(Json.getStr(peer, "key")); myName = name;
        }
        try {
            Map<String, Object> r = request(host, (int) p, "get", deviceId, false, key, Json.map("port", (long) port, "name", myName));
            synchronized (this) { Map<String, Object> peer = peer(id); String nm = Json.getStr(r, "name"); if (peer != null && !nm.isEmpty() && !nm.equals(Json.getStr(peer, "name"))) { peer.put("name", nm); saveIdentity(); } }
            Map<String, Object> ok = res(true, null); ok.put("doc", Json.getStr(r, "doc")); ok.put("etag", Json.getStr(r, "etag"));
            return ok;
        } catch (Exception e) { return res(false, friendly(e)); }
    }

    public Map<String, Object> push(String id, String doc, String base) {
        String host, myName; long p; byte[] key;
        synchronized (this) {
            Map<String, Object> peer = peer(id);
            if (peer == null) return res(false, "unknown device");
            host = Json.getStr(peer, "addr"); p = Json.getLong(peer, "port"); key = Base64.getDecoder().decode(Json.getStr(peer, "key")); myName = name;
        }
        try {
            Map<String, Object> r = request(host, (int) p, "put", deviceId, false, key, Json.map("port", (long) port, "name", myName, "doc", doc, "base", base));
            Map<String, Object> ok = res(true, null); ok.put("etag", Json.getStr(r, "etag"));
            return ok;
        } catch (Exception e) { return res(false, friendly(e)); }
    }

    public synchronized void synced(String id) {
        Map<String, Object> p = peer(id);
        if (p != null) { p.put("lastSync", System.currentTimeMillis()); saveIdentity(); }
    }

    /** Dispatches a UI call (JSON array args) and returns the JSON result, like syncnet.Node.Call. */
    public String call(String method, String argsJson) {
        List<?> args;
        try { Object o = Json.parse(argsJson == null || argsJson.isEmpty() ? "[]" : argsJson); args = o instanceof List ? (List<?>) o : new ArrayList<>(); }
        catch (RuntimeException e) { args = new ArrayList<>(); }
        String a0 = args.size() > 0 && args.get(0) != null ? args.get(0).toString() : "";
        String a1 = args.size() > 1 && args.get(1) != null ? args.get(1).toString() : "";
        String a2 = args.size() > 2 && args.get(2) != null ? args.get(2).toString() : "";
        Object out;
        switch (method) {
            case "info": out = info(); break;
            case "setName": out = setName(a0); break;
            case "load": out = load(); break;
            case "save":
                try { out = Json.map("ok", Boolean.TRUE, "etag", save(a0)); } catch (IOException e) { out = res(false, e.getMessage()); }
                break;
            case "pairStart": out = pairStart(); break;
            case "pairStatus": out = pairStatus(); break;
            case "pairCancel": pairCancel(); out = res(true, null); break;
            case "pairJoin": out = pairJoin(a0); break;
            case "pairConfirm": out = pairConfirm(a0); break;
            case "peers": out = peerList(); break;
            case "removePeer": out = removePeer(a0); break;
            case "pull": out = pull(a0); break;
            case "push": out = push(a0, a1, a2); break;
            case "synced": synced(a0); out = res(true, null); break;
            case "qr": out = qrMatrix(a0); break;
            default: out = res(false, "unknown call " + method);
        }
        return Json.write(out);
    }
}
