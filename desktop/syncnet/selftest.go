package syncnet

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// SelfTest runs a headless check of storage, pairing and sync between two in-process nodes on the loopback
// interface (used by "MYCASH.exe --selftest" and the Wine smoke test). It never touches the user's data.
func SelfTest(w io.Writer, basePort int) bool {
	ok := true
	check := func(name string, cond bool, extra ...interface{}) {
		if cond {
			fmt.Fprintf(w, "ok   %s\n", name)
		} else {
			ok = false
			fmt.Fprintf(w, "FAIL %s %v\n", name, extra)
		}
	}
	tmp, err := os.MkdirTemp("", "mycash-selftest-")
	if err != nil {
		fmt.Fprintf(w, "FAIL temp dir: %v\n", err)
		return false
	}
	defer os.RemoveAll(tmp)
	a, err1 := NewNode(tmp+string(os.PathSeparator)+"a", "windows", "selftest", "Host", basePort)
	b, err2 := NewNode(tmp+string(os.PathSeparator)+"b", "windows", "selftest", "Client", basePort+1)
	check("create nodes", err1 == nil && err2 == nil, err1, err2)
	if !ok {
		return false
	}
	check("host listens", a.Start() == nil)
	check("client listens", b.Start() == nil)
	defer a.Stop()
	defer b.Stop()
	call := func(n *Node, m string, args ...interface{}) map[string]interface{} {
		j, _ := json.Marshal(args)
		var out map[string]interface{}
		_ = json.Unmarshal([]byte(n.Call(m, string(j))), &out)
		if out == nil {
			out = map[string]interface{}{}
		}
		return out
	}
	et := call(a, "save", `{"format":"mycash","schema":1,"records":{"d1":{"id":"d1","type":"debt","ts":1,"name":"Bank","start":500000,"startMonth":"2026-11"}}}`)
	check("save document", et["ok"] == true, et)
	check("load document", strings.Contains(a.Load(), `"Bank"`))
	ps := a.PairStart()
	qr := ps["qr"].(string)
	parts := strings.Split(qr, ";")
	check("pairing text", len(parts) == 5 && parts[0] == QRPrefix, qr)
	parts[1] = "127.0.0.1"
	j := call(b, "pairJoin", strings.Join(parts, ";"))
	check("join", j["ok"] == true, j)
	st := a.PairStatus()
	code, _ := st["code"].(string)
	check("code shown on host", st["state"] == "code" && len(code) == 6, st)
	c := call(b, "pairConfirm", code)
	check("confirm code", c["ok"] == true, c)
	aid := a.Info()["deviceId"].(string)
	p := call(b, "pull", aid)
	check("pull over TCP + AES-GCM", p["ok"] == true && strings.Contains(fmt.Sprint(p["doc"]), "Bank"), p)
	r := call(b, "push", aid, `{"format":"mycash","schema":1,"records":{}}`, p["etag"])
	check("push", r["ok"] == true, r)
	r = call(b, "push", aid, `{"format":"mycash","schema":1,"records":{}}`, "stale")
	check("stale push refused", r["ok"] == false && r["error"] == "conflict", r)
	t0 := time.Now()
	for i := 0; i < 20; i++ {
		call(b, "pull", aid)
	}
	fmt.Fprintf(w, "info 20 pulls in %v\n", time.Since(t0).Round(time.Millisecond))
	fmt.Fprintf(w, "info local addresses %v\n", LocalIPs())
	if ok {
		fmt.Fprintln(w, "SELFTEST PASS")
	} else {
		fmt.Fprintln(w, "SELFTEST FAIL")
	}
	return ok
}
