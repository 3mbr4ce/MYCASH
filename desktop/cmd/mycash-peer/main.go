// mycash-peer: a headless MYCASH sync node for tests (Linux/Windows). It speaks JSON lines on stdin/stdout:
//   in:  {"id":1,"m":"pairStart","a":[...]}      out: {"id":1,"r":<result>}
//   events: {"ev":"change"} / {"ev":"pair"}
// The methods are the same as the app's native bridge (see syncnet.Node.Call).
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sync"

	"mycash/syncnet"
)

func main() {
	dir := flag.String("dir", "", "data directory")
	name := flag.String("name", "Test peer", "device name")
	port := flag.Int("port", syncnet.DefaultPort, "TCP port")
	kind := flag.String("kind", "linux", "device kind")
	self := flag.Bool("selftest", false, "run the headless self test and exit")
	flag.Parse()
	if *self {
		if syncnet.SelfTest(os.Stdout, 47960) {
			os.Exit(0)
		}
		os.Exit(1)
	}
	if *dir == "" {
		fmt.Fprintln(os.Stderr, "-dir is required")
		os.Exit(2)
	}
	n, err := syncnet.NewNode(*dir, *kind, "0.0.1", *name, *port)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var mu sync.Mutex
	out := bufio.NewWriter(os.Stdout)
	emit := func(v interface{}) {
		b, _ := json.Marshal(v)
		mu.Lock()
		out.Write(b)
		out.WriteByte('\n')
		out.Flush()
		mu.Unlock()
	}
	n.OnChange = func() { emit(map[string]string{"ev": "change"}) }
	n.OnPair = func() { emit(map[string]string{"ev": "pair"}) }
	if err := n.Start(); err != nil {
		emit(map[string]string{"ev": "error", "error": err.Error()})
	}
	emit(map[string]interface{}{"ev": "ready", "info": n.Info()})
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 32<<20)
	for sc.Scan() {
		var req struct {
			ID int64             `json:"id"`
			M  string            `json:"m"`
			A  []json.RawMessage `json:"a"`
		}
		if json.Unmarshal(sc.Bytes(), &req) != nil {
			continue
		}
		a, _ := json.Marshal(req.A)
		go func(id int64, m string, a string) {
			emit(map[string]interface{}{"id": id, "r": json.RawMessage(n.Call(m, a))})
		}(req.ID, req.M, string(a))
	}
	n.Stop()
}
