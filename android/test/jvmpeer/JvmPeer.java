import com.mysuite.mycash.net.Json;
import com.mysuite.mycash.net.SyncNode;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Desktop-JVM harness for the Android sync code: same JSON-lines protocol as desktop/cmd/mycash-peer. */
public class JvmPeer {
    public static void main(String[] a) throws Exception {
        String dir = null, name = "JVM peer"; int port = SyncNode.DEFAULT_PORT;
        for (int i = 0; i + 1 < a.length; i += 2) {
            if (a[i].equals("-dir")) dir = a[i + 1]; else if (a[i].equals("-name")) name = a[i + 1]; else if (a[i].equals("-port")) port = Integer.parseInt(a[i + 1]);
        }
        final PrintStream out = new PrintStream(System.out, true, "UTF-8");
        final SyncNode n = new SyncNode(new File(dir), "android", "0.0.1", name, port);
        n.setListener(new SyncNode.Listener() {
            public void onChange() { synchronized (out) { out.println("{\"ev\":\"change\"}"); } }
            public void onPair() { synchronized (out) { out.println("{\"ev\":\"pair\"}"); } }
        });
        n.start();
        synchronized (out) { out.println("{\"ev\":\"ready\",\"info\":" + Json.write(n.info()) + "}"); }
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            final Map<String, Object> req;
            try { req = Json.obj(line); } catch (RuntimeException e) { continue; }
            new Thread(new Runnable() { public void run() {
                Object args = req.get("a");
                String r = n.call(Json.getStr(req, "m"), args instanceof List ? Json.write(args) : "[]");
                synchronized (out) { out.println("{\"id\":" + Json.getLong(req, "id") + ",\"r\":" + r + "}"); }
            }}).start();
        }
        n.stop();
        System.exit(0);
    }
}
