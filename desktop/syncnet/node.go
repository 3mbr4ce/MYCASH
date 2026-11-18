package syncnet

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"rsc.io/qr"
)

// Peer is a paired device.
type Peer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Key      string `json:"key"` // base64, 32 bytes
	Addr     string `json:"addr"`
	Port     int    `json:"port"`
	PairedAt int64  `json:"pairedAt"`
	LastSync int64  `json:"lastSync"`
}

type identity struct {
	DeviceID string  `json:"deviceId"`
	Name     string  `json:"name"`
	Peers    []*Peer `json:"peers"`
}

type pairSession struct {
	pid, secret, code string
	state             string // waiting | code | done | failed
	peerID, peerName  string
	peerKind          string
	tries             int
	expires           time.Time
	err               string
}

type joinState struct {
	addrs                      []string
	port                       int
	pid, secret                string
	hostID, hostName, hostKind string
	addr                       string // the address that answered
}

// Node is one device: its data file, its identity/peers and the sync server.
type Node struct {
	Dir      string
	Kind     string // "windows", "android", "linux"
	Version  string
	Port     int
	OnChange func() // the document was replaced by a peer
	OnPair   func() // pairing state changed

	mu      sync.Mutex
	id      identity
	etag    string
	ln      net.Listener
	listErr string
	sess    *pairSession
	join    *joinState
}

func NewNode(dir, kind, version, defaultName string, port int) (*Node, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	n := &Node{Dir: dir, Kind: kind, Version: version, Port: port, etag: randHex(8)}
	if b, err := os.ReadFile(filepath.Join(dir, "sync.json")); err == nil {
		_ = json.Unmarshal(b, &n.id)
	}
	if n.id.DeviceID == "" {
		n.id.DeviceID = randHex(8)
		n.id.Name = defaultName
		if err := n.saveIdentity(); err != nil {
			return nil, err
		}
	}
	return n, nil
}

func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (n *Node) saveIdentity() error {
	b, _ := json.MarshalIndent(&n.id, "", " ")
	return atomicWrite(filepath.Join(n.Dir, "sync.json"), b)
}

func (n *Node) dataPath() string { return filepath.Join(n.Dir, "data.json") }

// Load returns the stored document ("" when none yet).
func (n *Node) Load() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.loadLocked()
}

func (n *Node) loadLocked() string {
	b, err := os.ReadFile(n.dataPath())
	if err != nil {
		if b2, err2 := os.ReadFile(n.dataPath() + ".bak"); err2 == nil {
			return string(b2)
		}
		return ""
	}
	return string(b)
}

// Save stores the document (atomic write, previous version kept as data.json.bak) and returns the new etag.
func (n *Node) Save(doc string) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.saveLocked(doc)
}

func (n *Node) saveLocked(doc string) (string, error) {
	if !json.Valid([]byte(doc)) {
		return n.etag, errors.New("invalid document")
	}
	p := n.dataPath()
	if old, err := os.ReadFile(p); err == nil && len(old) > 0 {
		_ = atomicWrite(p+".bak", old)
	}
	if err := atomicWrite(p, []byte(doc)); err != nil {
		return n.etag, err
	}
	n.etag = randHex(8)
	return n.etag, nil
}

// ---- server -------------------------------------------------------------

// Start listens on all interfaces (the port is fixed so a paired device can find this one again).
func (n *Node) Start() error {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", n.Port))
	if err != nil {
		n.mu.Lock()
		n.listErr = err.Error()
		n.mu.Unlock()
		return err
	}
	n.mu.Lock()
	n.ln, n.listErr = ln, ""
	n.mu.Unlock()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go n.serve(c)
		}
	}()
	return nil
}

func (n *Node) Stop() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.ln != nil {
		n.ln.Close()
		n.ln = nil
	}
}

func remoteIP(c net.Conn) string {
	h, _, err := net.SplitHostPort(c.RemoteAddr().String())
	if err != nil {
		return ""
	}
	return h
}

func (n *Node) serve(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(ioTimeout))
	var req envelope
	if err := readFrame(c, &req); err != nil {
		return
	}
	resp, notify := n.handle(req, remoteIP(c))
	_ = writeFrame(c, resp)
	if notify == "change" && n.OnChange != nil {
		n.OnChange()
	} else if notify == "pair" && n.OnPair != nil {
		n.OnPair()
	}
}

func fail(msg string) envelope { return envelope{OK: false, Err: msg} }

func reply(key []byte, op, tag string, v interface{}) envelope {
	b, _ := json.Marshal(v)
	iv, ct, err := seal(key, "resp|"+op+"|"+tag, b)
	if err != nil {
		return fail("internal error")
	}
	return envelope{OK: true, IV: iv, CT: ct}
}

type helloMsg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Port int    `json:"port"`
}

type pairReply struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Port int    `json:"port"`
	Key  string `json:"key,omitempty"`
}

type getReq struct {
	Port int    `json:"port"`
	Name string `json:"name"`
}

type docReply struct {
	Doc  string `json:"doc"`
	Etag string `json:"etag"`
	Name string `json:"name"`
}

type putReq struct {
	Port int    `json:"port"`
	Name string `json:"name"`
	Doc  string `json:"doc"`
	Base string `json:"base"`
}

type etagReply struct {
	Etag string `json:"etag"`
}

func (n *Node) handle(req envelope, ip string) (envelope, string) {
	if req.V != ProtoVersion {
		return fail("unsupported version"), ""
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	switch req.Op {
	case "hello", "pair":
		s := n.sess
		if s == nil || s.pid != req.Pid || time.Now().After(s.expires) || s.state == "failed" || s.state == "done" {
			return fail("no pairing in progress"), ""
		}
		if req.Op == "hello" {
			key := deriveKey("MYCASH-hello", s.secret)
			p, err := open(key, "hello|"+req.Pid, req.IV, req.CT)
			var m helloMsg
			if err != nil || json.Unmarshal(p, &m) != nil || m.ID == "" {
				return fail("bad pairing request"), ""
			}
			if s.state == "code" && s.peerID != m.ID {
				return fail("another device is pairing"), ""
			}
			s.state, s.peerID, s.peerName, s.peerKind = "code", m.ID, m.Name, m.Kind
			return reply(key, "hello", req.Pid, pairReply{ID: n.id.DeviceID, Name: n.id.Name, Kind: n.Kind, Port: n.Port}), "pair"
		}
		if s.state != "code" {
			return fail("say hello first"), ""
		}
		key := deriveKey("MYCASH-pair", s.secret, s.code)
		p, err := open(key, "pair|"+req.Pid, req.IV, req.CT)
		var m helloMsg
		if err != nil || json.Unmarshal(p, &m) != nil || m.ID != s.peerID {
			s.tries++
			if s.tries >= maxCodeTries {
				s.state, s.err = "failed", "Wrong code entered too often"
				return fail("wrong code, pairing cancelled"), "pair"
			}
			return fail("wrong code"), "pair"
		}
		k := randB64(32)
		kb, _ := base64.RawURLEncoding.DecodeString(k)
		peer := &Peer{ID: m.ID, Name: m.Name, Kind: m.Kind, Key: base64.StdEncoding.EncodeToString(kb), Addr: ip, Port: m.Port, PairedAt: time.Now().UnixMilli()}
		n.addPeerLocked(peer)
		s.state = "done"
		return reply(key, "pair", req.Pid, pairReply{ID: n.id.DeviceID, Name: n.id.Name, Kind: n.Kind, Port: n.Port, Key: peer.Key}), "pair"
	case "get", "put":
		peer := n.peerLocked(req.From)
		if peer == nil {
			return fail("not paired"), ""
		}
		key, _ := base64.StdEncoding.DecodeString(peer.Key)
		p, err := open(key, req.Op+"|"+req.From, req.IV, req.CT)
		if err != nil {
			return fail("not paired"), ""
		}
		if req.Op == "get" {
			var g getReq
			_ = json.Unmarshal(p, &g)
			n.notePeerLocked(peer, ip, g.Port, g.Name)
			return reply(key, "get", req.From, docReply{Doc: n.loadLocked(), Etag: n.etag, Name: n.id.Name}), ""
		}
		var u putReq
		if json.Unmarshal(p, &u) != nil {
			return fail("bad request"), ""
		}
		n.notePeerLocked(peer, ip, u.Port, u.Name)
		if u.Base != n.etag {
			return fail("conflict"), ""
		}
		et, err := n.saveLocked(u.Doc)
		if err != nil {
			return fail("could not save"), ""
		}
		peer.LastSync = time.Now().UnixMilli()
		_ = n.saveIdentity()
		return reply(key, "put", req.From, etagReply{Etag: et}), "change"
	}
	return fail("unknown request"), ""
}

func (n *Node) peerLocked(id string) *Peer {
	for _, p := range n.id.Peers {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (n *Node) addPeerLocked(p *Peer) {
	out := n.id.Peers[:0]
	for _, q := range n.id.Peers {
		if q.ID != p.ID {
			out = append(out, q)
		}
	}
	n.id.Peers = append(out, p)
	_ = n.saveIdentity()
}

func (n *Node) notePeerLocked(p *Peer, ip string, port int, name string) {
	ch := false
	if ip != "" && ip != p.Addr {
		p.Addr, ch = ip, true
	}
	if port > 0 && port != p.Port {
		p.Port, ch = port, true
	}
	if name != "" && name != p.Name {
		p.Name, ch = name, true
	}
	if ch {
		_ = n.saveIdentity()
	}
}

// ---- local addresses / QR ------------------------------------------------

// LocalIPs lists the IPv4 LAN addresses of this device, private ranges first.
func LocalIPs() []string {
	var priv, other []string
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || ip[0] == 169 && ip[1] == 254 {
				continue
			}
			if ip.IsPrivate() {
				priv = append(priv, ip.String())
			} else {
				other = append(other, ip.String())
			}
		}
	}
	return append(priv, other...)
}

// QRMatrix returns the QR code for text as rows of '0'/'1'.
func QRMatrix(text string) map[string]interface{} {
	c, err := qr.Encode(text, qr.M)
	if err != nil {
		return map[string]interface{}{"n": 0, "rows": []string{}}
	}
	rows := make([]string, c.Size)
	for y := 0; y < c.Size; y++ {
		b := make([]byte, c.Size)
		for x := 0; x < c.Size; x++ {
			if c.Black(x, y) {
				b[x] = '1'
			} else {
				b[x] = '0'
			}
		}
		rows[y] = string(b)
	}
	return map[string]interface{}{"n": c.Size, "rows": rows}
}

// ---- API used by the UI (same names and results on Android) -------------

func (n *Node) Info() map[string]interface{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	return map[string]interface{}{"deviceId": n.id.DeviceID, "name": n.id.Name, "kind": n.Kind, "version": n.Version,
		"port": n.Port, "ips": LocalIPs(), "listening": n.ln != nil, "listenError": n.listErr}
}

func (n *Node) SetName(name string) map[string]interface{} {
	name = strings.TrimSpace(name)
	if len(name) > 40 {
		name = name[:40]
	}
	if name != "" {
		n.mu.Lock()
		n.id.Name = name
		_ = n.saveIdentity()
		n.mu.Unlock()
	}
	return n.Info()
}

// PairStart opens a pairing window and returns the QR text.
func (n *Node) PairStart() map[string]interface{} {
	n.mu.Lock()
	ips := LocalIPs()
	s := &pairSession{pid: randHex(6), secret: randB64(18), code: randCode(), state: "waiting", expires: time.Now().Add(pairLifetime)}
	n.sess = s
	n.mu.Unlock()
	// MYCASH1;ip1,ip2;port;pid;secret   (simple ';' split, no URL/regex parsing needed)
	text := QRPrefix + ";" + strings.Join(ips, ",") + ";" + strconv.Itoa(n.Port) + ";" + s.pid + ";" + s.secret
	return map[string]interface{}{"qr": text, "matrix": QRMatrix(text), "expiresIn": int(pairLifetime / time.Second), "ips": ips}
}

func (n *Node) PairStatus() map[string]interface{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	s := n.sess
	if s == nil {
		return map[string]interface{}{"state": "idle"}
	}
	st := s.state
	if (st == "waiting" || st == "code") && time.Now().After(s.expires) {
		st, s.state, s.err = "failed", "failed", "Pairing timed out"
	}
	out := map[string]interface{}{"state": st, "peerName": s.peerName, "peerKind": s.peerKind, "error": s.err, "tries": s.tries}
	if st == "code" {
		out["code"] = s.code
	}
	return out
}

func (n *Node) PairCancel() {
	n.mu.Lock()
	n.sess = nil
	n.join = nil
	n.mu.Unlock()
}

func result(ok bool, err error, extra map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{"ok": ok}
	if err != nil {
		out["error"] = friendly(err)
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func friendly(err error) string {
	var re *RemoteError
	if errors.As(err, &re) {
		return re.Msg
	}
	if errors.Is(err, errDecrypt) {
		return "could not decrypt the answer"
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "device not reachable (timeout)"
	}
	s := err.Error()
	if strings.Contains(s, "refused") {
		return "device not reachable (is MYCASH open on it?)"
	}
	if strings.Contains(s, "unreachable") || strings.Contains(s, "no route") {
		return "device not reachable (same network?)"
	}
	return s
}

// ParseQR splits "MYCASH1;ips;port;pid;secret".
func ParseQR(text string) (*joinState, error) {
	parts := strings.Split(strings.TrimSpace(text), ";")
	if len(parts) != 5 || parts[0] != QRPrefix {
		return nil, errors.New("not a MYCASH pairing code")
	}
	port, err := strconv.Atoi(parts[2])
	if err != nil || port <= 0 || port > 65535 {
		return nil, errors.New("bad port in pairing code")
	}
	var addrs []string
	for _, a := range strings.Split(parts[1], ",") {
		if a = strings.TrimSpace(a); a != "" {
			addrs = append(addrs, a)
		}
	}
	if len(addrs) == 0 || parts[3] == "" || len(parts[4]) < 16 {
		return nil, errors.New("incomplete pairing code")
	}
	return &joinState{addrs: addrs, port: port, pid: parts[3], secret: parts[4]}, nil
}

// PairJoin is step 1 on the scanning device: contact the host; the host then shows the confirmation code.
func (n *Node) PairJoin(text string) map[string]interface{} {
	j, err := ParseQR(text)
	if err != nil {
		return result(false, err, nil)
	}
	n.mu.Lock()
	me := helloMsg{ID: n.id.DeviceID, Name: n.id.Name, Kind: n.Kind, Port: n.Port}
	n.mu.Unlock()
	key := deriveKey("MYCASH-hello", j.secret)
	var lastErr error
	for _, a := range j.addrs {
		addr := net.JoinHostPort(a, strconv.Itoa(j.port))
		var r pairReply
		if err := request(addr, "hello", j.pid, true, key, me, &r); err != nil {
			lastErr = err
			var re *RemoteError
			if errors.As(err, &re) {
				break
			}
			continue
		}
		j.addr, j.hostID, j.hostName, j.hostKind = addr, r.ID, r.Name, r.Kind
		if r.ID == me.ID {
			return result(false, errors.New("this is the same device"), nil)
		}
		n.mu.Lock()
		n.join = j
		n.mu.Unlock()
		return result(true, nil, map[string]interface{}{"hostName": r.Name, "hostKind": r.Kind})
	}
	return result(false, lastErr, nil)
}

// PairConfirm is step 2: send the code shown on the host; on success both sides store each other.
func (n *Node) PairConfirm(code string) map[string]interface{} {
	code = strings.TrimSpace(strings.ReplaceAll(code, " ", ""))
	n.mu.Lock()
	j := n.join
	me := helloMsg{ID: n.id.DeviceID, Name: n.id.Name, Kind: n.Kind, Port: n.Port}
	n.mu.Unlock()
	if j == nil {
		return result(false, errors.New("scan the pairing code first"), nil)
	}
	if len(code) != 6 {
		return result(false, errors.New("the code has 6 digits"), nil)
	}
	key := deriveKey("MYCASH-pair", j.secret, code)
	var r pairReply
	if err := request(j.addr, "pair", j.pid, true, key, me, &r); err != nil {
		var re *RemoteError
		if errors.As(err, &re) && strings.Contains(re.Msg, "cancelled") {
			n.mu.Lock()
			n.join = nil
			n.mu.Unlock()
		}
		return result(false, err, nil)
	}
	if _, err := base64.StdEncoding.DecodeString(r.Key); err != nil || r.ID == "" {
		return result(false, errors.New("bad answer from the other device"), nil)
	}
	host, _, _ := net.SplitHostPort(j.addr)
	p := &Peer{ID: r.ID, Name: r.Name, Kind: r.Kind, Key: r.Key, Addr: host, Port: r.Port, PairedAt: time.Now().UnixMilli()}
	n.mu.Lock()
	n.addPeerLocked(p)
	n.join = nil
	n.mu.Unlock()
	return result(true, nil, map[string]interface{}{"peer": publicPeer(p)})
}

func publicPeer(p *Peer) map[string]interface{} {
	return map[string]interface{}{"id": p.ID, "name": p.Name, "kind": p.Kind, "addr": p.Addr, "port": p.Port, "pairedAt": p.PairedAt, "lastSync": p.LastSync}
}

func (n *Node) Peers() []map[string]interface{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	ps := append([]*Peer(nil), n.id.Peers...)
	sort.Slice(ps, func(i, k int) bool { return ps[i].PairedAt < ps[k].PairedAt })
	out := []map[string]interface{}{}
	for _, p := range ps {
		out = append(out, publicPeer(p))
	}
	return out
}

func (n *Node) RemovePeer(id string) []map[string]interface{} {
	n.mu.Lock()
	out := n.id.Peers[:0]
	for _, p := range n.id.Peers {
		if p.ID != id {
			out = append(out, p)
		}
	}
	n.id.Peers = out
	_ = n.saveIdentity()
	n.mu.Unlock()
	return n.Peers()
}

func (n *Node) peerReq(id string) (*Peer, []byte, helloMsg, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	p := n.peerLocked(id)
	if p == nil {
		return nil, nil, helloMsg{}, errors.New("unknown device")
	}
	cp := *p
	key, err := base64.StdEncoding.DecodeString(p.Key)
	return &cp, key, helloMsg{ID: n.id.DeviceID, Name: n.id.Name, Port: n.Port}, err
}

// Pull fetches the peer's document.
func (n *Node) Pull(id string) map[string]interface{} {
	p, key, me, err := n.peerReq(id)
	if err != nil {
		return result(false, err, nil)
	}
	var r docReply
	addr := net.JoinHostPort(p.Addr, strconv.Itoa(p.Port))
	if err := request(addr, "get", me.ID, false, key, getReq{Port: me.Port, Name: me.Name}, &r); err != nil {
		return result(false, err, nil)
	}
	n.mu.Lock()
	if q := n.peerLocked(id); q != nil && r.Name != "" && q.Name != r.Name {
		q.Name = r.Name
		_ = n.saveIdentity()
	}
	n.mu.Unlock()
	return result(true, nil, map[string]interface{}{"doc": r.Doc, "etag": r.Etag})
}

// Push sends the merged document; fails with "conflict" when the peer changed since Pull.
func (n *Node) Push(id, doc, base string) map[string]interface{} {
	p, key, me, err := n.peerReq(id)
	if err != nil {
		return result(false, err, nil)
	}
	var r etagReply
	addr := net.JoinHostPort(p.Addr, strconv.Itoa(p.Port))
	if err := request(addr, "put", me.ID, false, key, putReq{Port: me.Port, Name: me.Name, Doc: doc, Base: base}, &r); err != nil {
		return result(false, err, nil)
	}
	return result(true, nil, map[string]interface{}{"etag": r.Etag})
}

// Synced records a finished sync with a peer.
func (n *Node) Synced(id string) {
	n.mu.Lock()
	if p := n.peerLocked(id); p != nil {
		p.LastSync = time.Now().UnixMilli()
		_ = n.saveIdentity()
	}
	n.mu.Unlock()
}

// Call dispatches a UI call by name with JSON array arguments and returns the JSON result.
func (n *Node) Call(method string, argsJSON string) string {
	var args []json.RawMessage
	_ = json.Unmarshal([]byte(argsJSON), &args)
	str := func(i int) string {
		var v string
		if i < len(args) {
			if json.Unmarshal(args[i], &v) != nil {
				v = string(args[i])
			}
		}
		return v
	}
	var out interface{}
	switch method {
	case "info":
		out = n.Info()
	case "setName":
		out = n.SetName(str(0))
	case "load":
		out = n.Load()
	case "save":
		et, err := n.Save(str(0))
		out = result(err == nil, err, map[string]interface{}{"etag": et})
	case "pairStart":
		out = n.PairStart()
	case "pairStatus":
		out = n.PairStatus()
	case "pairCancel":
		n.PairCancel()
		out = map[string]interface{}{"ok": true}
	case "pairJoin":
		out = n.PairJoin(str(0))
	case "pairConfirm":
		out = n.PairConfirm(str(0))
	case "peers":
		out = n.Peers()
	case "removePeer":
		out = n.RemovePeer(str(0))
	case "pull":
		out = n.Pull(str(0))
	case "push":
		out = n.Push(str(0), str(1), str(2))
	case "synced":
		n.Synced(str(0))
		out = map[string]interface{}{"ok": true}
	case "qr":
		out = QRMatrix(str(0))
	default:
		log.Printf("unknown call %q", method)
		out = map[string]interface{}{"ok": false, "error": "unknown call " + method}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "null"
	}
	return string(b)
}
