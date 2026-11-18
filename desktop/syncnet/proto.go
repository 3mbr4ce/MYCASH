// Package syncnet is MYCASH's device-to-device sync over the local network (no internet, no cloud, no relay).
//
// Wire format (shared with the Android app, see android/src/com/mysuite/mycash/net/SyncNode.java and docs/SYNC.md):
// one TCP connection per request; each side sends one frame = 4-byte big-endian length + UTF-8 JSON.
// Request  {"v":1,"op":"hello|pair|get|put","pid":<pairing id>,"from":<device id>,"iv":b64,"ct":b64}
// Response {"ok":true,"iv":b64,"ct":b64} or {"ok":false,"err":"..."}
// Payloads are AES-256-GCM encrypted (12-byte IV, 16-byte tag appended, AAD = op + "|" + pid-or-from, responses
// AAD = "resp|" + op + "|" + pid-or-from). Keys: hello SHA256("MYCASH-hello|"+S), pair SHA256("MYCASH-pair|"+S+"|"+code)
// with S the secret from the QR code and code the 6-digit confirmation code; get/put use the 32-byte key exchanged
// during pairing.
package syncnet

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"time"
)

const (
	DefaultPort  = 47870
	maxFrame     = 16 << 20
	ProtoVersion = 1
	QRPrefix     = "MYCASH1"
	ioTimeout    = 15 * time.Second
	connTimeout  = 3 * time.Second
	pairLifetime = 10 * time.Minute
	maxCodeTries = 3
)

type envelope struct {
	V    int    `json:"v,omitempty"`
	Op   string `json:"op,omitempty"`
	Pid  string `json:"pid,omitempty"`
	From string `json:"from,omitempty"`
	OK   bool   `json:"ok,omitempty"`
	Err  string `json:"err,omitempty"`
	IV   string `json:"iv,omitempty"`
	CT   string `json:"ct,omitempty"`
}

func writeFrame(c net.Conn, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var h [4]byte
	binary.BigEndian.PutUint32(h[:], uint32(len(b)))
	if _, err := c.Write(h[:]); err != nil {
		return err
	}
	_, err = c.Write(b)
	return err
}

func readFrame(c net.Conn, v interface{}) error {
	var h [4]byte
	if _, err := io.ReadFull(c, h[:]); err != nil {
		return err
	}
	n := binary.BigEndian.Uint32(h[:])
	if n == 0 || n > maxFrame {
		return errors.New("bad frame size")
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(c, b); err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func deriveKey(parts ...string) []byte {
	h := sha256.New()
	for i, p := range parts {
		if i > 0 {
			h.Write([]byte("|"))
		}
		h.Write([]byte(p))
	}
	return h.Sum(nil)
}

func seal(key []byte, aad string, plain []byte) (iv, ct string, err error) {
	blk, err := aes.NewCipher(key)
	if err != nil {
		return "", "", err
	}
	g, err := cipher.NewGCM(blk)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	out := g.Seal(nil, nonce, plain, []byte(aad))
	return base64.StdEncoding.EncodeToString(nonce), base64.StdEncoding.EncodeToString(out), nil
}

var errDecrypt = errors.New("decrypt failed")

func open(key []byte, aad, iv, ct string) ([]byte, error) {
	nonce, err1 := base64.StdEncoding.DecodeString(iv)
	data, err2 := base64.StdEncoding.DecodeString(ct)
	if err1 != nil || err2 != nil || len(nonce) != 12 {
		return nil, errDecrypt
	}
	blk, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(blk)
	if err != nil {
		return nil, err
	}
	p, err := g.Open(nil, nonce, data, []byte(aad))
	if err != nil {
		return nil, errDecrypt
	}
	return p, nil
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	const hx = "0123456789abcdef"
	out := make([]byte, n*2)
	for i, c := range b {
		out[i*2], out[i*2+1] = hx[c>>4], hx[c&15]
	}
	return string(out)
}

func randB64(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func randCode() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	v := binary.BigEndian.Uint32(b) % 1000000
	s := []byte("000000")
	for i := 5; i >= 0; i-- {
		s[i] = byte('0' + v%10)
		v /= 10
	}
	return string(s)
}

// request sends one encrypted request and returns the decrypted response payload.
func request(addr, op, pidOrFrom string, isPid bool, key []byte, payload interface{}, out interface{}) error {
	c, err := net.DialTimeout("tcp", addr, connTimeout)
	if err != nil {
		return err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(ioTimeout))
	pb, _ := json.Marshal(payload)
	iv, ct, err := seal(key, op+"|"+pidOrFrom, pb)
	if err != nil {
		return err
	}
	env := envelope{V: ProtoVersion, Op: op, IV: iv, CT: ct}
	if isPid {
		env.Pid = pidOrFrom
	} else {
		env.From = pidOrFrom
	}
	if err := writeFrame(c, env); err != nil {
		return err
	}
	var resp envelope
	if err := readFrame(c, &resp); err != nil {
		return err
	}
	if !resp.OK {
		if resp.Err == "" {
			resp.Err = "refused"
		}
		return &RemoteError{resp.Err}
	}
	p, err := open(key, "resp|"+op+"|"+pidOrFrom, resp.IV, resp.CT)
	if err != nil {
		return err
	}
	return json.Unmarshal(p, out)
}

// RemoteError is an error reported by the other device.
type RemoteError struct{ Msg string }

func (e *RemoteError) Error() string { return e.Msg }
