package syncnet

import (
	"encoding/json"
	"strings"
	"testing"
)

func call(t *testing.T, n *Node, m string, args ...interface{}) map[string]interface{} {
	t.Helper()
	a, _ := json.Marshal(args)
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(n.Call(m, string(a))), &out); err != nil {
		t.Fatalf("%s: %v", m, err)
	}
	return out
}

func loopQR(qr string) string { // replace the LAN addresses with loopback for the test
	p := strings.Split(qr, ";")
	p[1] = "127.0.0.1"
	return strings.Join(p, ";")
}

func newPair(t *testing.T) (*Node, *Node) {
	a, err := NewNode(t.TempDir(), "windows", "0.0.1", "PC", 47990)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewNode(t.TempDir(), "android", "0.0.1", "Phone", 47991)
	if err := a.Start(); err != nil {
		t.Fatal(err)
	}
	if err := b.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Stop(); b.Stop() })
	return a, b
}

func pair(t *testing.T, host, client *Node) {
	ps := call(t, host, "pairStart")
	if st := call(t, host, "pairStatus"); st["state"] != "waiting" || st["code"] != nil {
		t.Fatalf("status before hello: %v", st)
	}
	j := call(t, client, "pairJoin", loopQR(ps["qr"].(string)))
	if j["ok"] != true || j["hostName"] != host.Info()["name"] {
		t.Fatalf("join: %v", j)
	}
	st := call(t, host, "pairStatus")
	if st["state"] != "code" || len(st["code"].(string)) != 6 {
		t.Fatalf("status: %v", st)
	}
	c := call(t, client, "pairConfirm", st["code"])
	if c["ok"] != true {
		t.Fatalf("confirm: %v", c)
	}
	if call(t, host, "pairStatus")["state"] != "done" {
		t.Fatal("host not done")
	}
}

func TestPairAndSync(t *testing.T) {
	a, b := newPair(t)
	pair(t, a, b)
	if len(a.Peers()) != 1 || len(b.Peers()) != 1 || a.Peers()[0]["id"] != b.Info()["deviceId"] {
		t.Fatalf("peers %v %v", a.Peers(), b.Peers())
	}
	changes := 0
	a.OnChange = func() { changes++ }
	call(t, a, "save", `{"format":"mycash","records":{"x":1}}`)
	aid := a.Info()["deviceId"].(string)
	p := call(t, b, "pull", aid)
	if p["ok"] != true || !strings.Contains(p["doc"].(string), `"x":1`) {
		t.Fatalf("pull %v", p)
	}
	// conflicting push (A changed in between) is refused
	call(t, a, "save", `{"format":"mycash","records":{"x":2}}`)
	if r := call(t, b, "push", aid, `{"format":"mycash","records":{"x":3}}`, p["etag"]); r["ok"] != false || r["error"] != "conflict" {
		t.Fatalf("expected conflict: %v", r)
	}
	p = call(t, b, "pull", aid)
	if r := call(t, b, "push", aid, `{"format":"mycash","records":{"x":4}}`, p["etag"]); r["ok"] != true {
		t.Fatalf("push %v", r)
	}
	if !strings.Contains(a.Load(), `"x":4`) || changes != 1 {
		t.Fatalf("host doc %s changes %d", a.Load(), changes)
	}
	// the other direction works too (A learned B's address and port from the requests)
	bid := b.Info()["deviceId"].(string)
	call(t, b, "save", `{"format":"mycash","records":{"y":1}}`)
	if r := call(t, a, "pull", bid); r["ok"] != true || !strings.Contains(r["doc"].(string), `"y":1`) {
		t.Fatalf("reverse pull %v", r)
	}
	// removed peer can no longer sync
	a.RemovePeer(bid)
	if r := call(t, b, "pull", aid); r["ok"] != false || r["error"] != "not paired" {
		t.Fatalf("after remove: %v", r)
	}
}

func TestWrongCode(t *testing.T) {
	a, b := newPair(t)
	ps := call(t, a, "pairStart")
	call(t, b, "pairJoin", loopQR(ps["qr"].(string)))
	code := call(t, a, "pairStatus")["code"].(string)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := 0; i < 2; i++ {
		if r := call(t, b, "pairConfirm", wrong); r["ok"] != false || r["error"] != "wrong code" {
			t.Fatalf("try %d: %v", i, r)
		}
	}
	if r := call(t, b, "pairConfirm", wrong); r["ok"] != false || !strings.Contains(r["error"].(string), "cancelled") {
		t.Fatalf("third: %v", r)
	}
	if r := call(t, b, "pairConfirm", code); r["ok"] != false {
		t.Fatalf("after cancel the right code must not work: %v", r)
	}
	if len(a.Peers()) != 0 || len(b.Peers()) != 0 {
		t.Fatal("no peers expected")
	}
	// a fresh session with a wrong secret fails at hello
	ps = call(t, a, "pairStart")
	q := strings.Split(loopQR(ps["qr"].(string)), ";")
	q[4] = "AAAAAAAAAAAAAAAAAAAAAAAA"
	if r := call(t, b, "pairJoin", strings.Join(q, ";")); r["ok"] != false {
		t.Fatalf("bad secret accepted: %v", r)
	}
}

func TestParseQR(t *testing.T) {
	j, err := ParseQR("MYCASH1;192.168.1.5,10.0.0.2;47870;abc123;0123456789abcdefghij")
	if err != nil || len(j.addrs) != 2 || j.port != 47870 {
		t.Fatal(j, err)
	}
	for _, bad := range []string{"", "MYCASH1;;47870;a;0123456789abcdefghij", "MYYT;1;2;3;4", "MYCASH1;1.2.3.4;x;a;0123456789abcdefghij", "MYCASH1;1.2.3.4;47870;a;short"} {
		if _, err := ParseQR(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestSaveKeepsBackup(t *testing.T) {
	n, _ := NewNode(t.TempDir(), "linux", "0.0.1", "X", 0)
	n.Save(`{"a":1}`)
	n.Save(`{"a":2}`)
	if n.Load() != `{"a":2}` {
		t.Fatal(n.Load())
	}
	if _, err := n.Save("not json"); err == nil {
		t.Fatal("invalid doc accepted")
	}
	n2, _ := NewNode(n.Dir, "linux", "0.0.1", "Y", 0)
	if n2.Info()["deviceId"] != n.Info()["deviceId"] || n2.Info()["name"] != "X" {
		t.Fatal("identity not persisted")
	}
}
