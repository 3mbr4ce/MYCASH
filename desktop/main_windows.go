//go:build windows

// MYCASH for Windows (part of MYSUITE): debt registry + monthly cash-flow planner. The UI is the shared web UI
// (web/ in the repo, embedded as ui/index.html) in a frameless WebView2 window; LAN sync lives in syncnet.
package main

import (
	_ "embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"mycash/syncnet"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

//go:embed ui/index.html
var indexHTML string

const (
	appName    = "MYCASH"
	appVersion = "0.0.1"
)

func init() { runtime.LockOSThread() } // all Win32 / WebView2 calls happen on the window's thread

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	procReleaseCapture  = user32.NewProc("ReleaseCapture")
	procPostMessageW    = user32.NewProc("PostMessageW")
	procSendMessageW    = user32.NewProc("SendMessageW")
	procShowWindow      = user32.NewProc("ShowWindow")
	procSetWindowPos    = user32.NewProc("SetWindowPos")
	procGetWindowRect   = user32.NewProc("GetWindowRect")
	procMonitorFromWin  = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW = user32.NewProc("GetMonitorInfoW")
	procGetDpiForSystem = user32.NewProc("GetDpiForSystem")
	procMessageBoxW     = user32.NewProc("MessageBoxW")
	procLoadImageW      = user32.NewProc("LoadImageW")
	procGetSystemMetric = user32.NewProc("GetSystemMetrics")
	procFindWindowW     = user32.NewProc("FindWindowW")
	procSetForeground   = user32.NewProc("SetForegroundWindow")
	procIsIconic        = user32.NewProc("IsIconic")
	dwmapi              = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmSetWindowAtt = dwmapi.NewProc("DwmSetWindowAttribute")
)

type rect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

func messageBox(text string) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(appName)
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10|0x40000)
}

func systemScale() float64 {
	if procGetDpiForSystem.Find() == nil {
		if dpi, _, _ := procGetDpiForSystem.Call(); dpi >= 96 {
			return float64(dpi) / 96.0
		}
	}
	return 1
}

func hasArg(name string) bool {
	for _, a := range os.Args[1:] {
		if strings.EqualFold(a, name) {
			return true
		}
	}
	return false
}

// maximize/restore for the frameless (WS_POPUP) window: fill the monitor's work area (taskbar stays visible).
type winState struct {
	hwnd  uintptr
	max   bool
	saved rect
}

func (s *winState) toggleMax() {
	if s.max {
		r := s.saved
		procSetWindowPos.Call(s.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x0004|0x0040)
		s.max = false
		return
	}
	procGetWindowRect.Call(s.hwnd, uintptr(unsafe.Pointer(&s.saved)))
	mon, _, _ := procMonitorFromWin.Call(s.hwnd, 2) // MONITOR_DEFAULTTONEAREST
	mi := monitorInfo{CbSize: uint32(unsafe.Sizeof(monitorInfo{}))}
	procGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))
	r := mi.RcWork
	procSetWindowPos.Call(s.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x0004|0x0040)
	s.max = true
}

func main() {
	if hasArg("--selftest") { // headless check (no window): storage + pairing + sync on loopback
		out := os.Stdout
		path := filepath.Join(os.TempDir(), "mycash-selftest.txt")
		if f, err := os.Create(path); err == nil {
			out = f
			defer f.Close()
		}
		okk := syncnet.SelfTest(out, 47960)
		if out != os.Stdout {
			out.Close()
		}
		if okk {
			os.Exit(0)
		}
		os.Exit(1)
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		local = os.TempDir()
	}
	base := filepath.Join(local, appName)
	_ = os.MkdirAll(base, 0o700)
	if f, err := os.OpenFile(filepath.Join(base, "mycash.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
		log.SetOutput(f)
		defer f.Close()
	}
	log.Printf("MYCASH %s starting", appVersion)

	// single instance: bring the running window to the front instead
	mxName, _ := windows.UTF16PtrFromString(`Local\MYCASH.single-instance`)
	mxh, _, mxErr := windows.NewLazySystemDLL("kernel32.dll").NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(mxName)))
	if mxh != 0 && mxErr == windows.ERROR_ALREADY_EXISTS {
		t, _ := windows.UTF16PtrFromString("MYCASH")
		if h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(t))); h != 0 {
			if ic, _, _ := procIsIconic.Call(h); ic != 0 {
				procShowWindow.Call(h, 9) // SW_RESTORE
			}
			procSetForeground.Call(h)
		}
		return
	}

	host, _ := os.Hostname()
	if host == "" {
		host = "Windows PC"
	}
	node, err := syncnet.NewNode(filepath.Join(base, "data"), "windows", appVersion, host, syncnet.DefaultPort)
	if err != nil {
		messageBox("Could not open the MYCASH data folder:\n" + err.Error())
		return
	}
	if err := node.Start(); err != nil {
		log.Printf("sync listener: %v", err) // the UI shows "Sync is off"
	}
	defer node.Stop()

	scale := systemScale()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     hasArg("--debug"),
		AutoFocus: true,
		DataPath:  filepath.Join(base, "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:     appName,
			Width:     uint(1200 * scale),
			Height:    uint(800 * scale),
			Center:    true,
			Frameless: true,
		},
	})
	if w == nil {
		messageBox("Could not start the Microsoft Edge WebView2 Runtime.\n\nIt ships with Windows 10/11; if it is missing, install it from\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703")
		return
	}
	defer w.Destroy()
	hwnd := uintptr(w.Window())
	ws := &winState{hwnd: hwnd}
	webview2.SetMinSize(w, int32(760*scale), int32(520*scale))

	var hinst windows.Handle
	if err := windows.GetModuleHandleEx(0, nil, &hinst); err == nil {
		name, _ := windows.UTF16PtrFromString("APP")
		for i, sm := range []uintptr{11, 49} { // SM_CXICON, SM_CXSMICON
			sz, _, _ := procGetSystemMetric.Call(sm)
			if ico, _, _ := procLoadImageW.Call(uintptr(hinst), uintptr(unsafe.Pointer(name)), 1, sz, sz, 0); ico != 0 {
				procSendMessageW.Call(hwnd, 0x0080, uintptr(1-i), ico) // WM_SETICON
			}
		}
	}
	if procDwmSetWindowAtt.Find() == nil {
		pref := int32(2) // DWMWCP_ROUND (Windows 11)
		procDwmSetWindowAtt.Call(hwnd, 33, uintptr(unsafe.Pointer(&pref)), 4)
		dark := int32(1) // DWMWA_USE_IMMERSIVE_DARK_MODE
		procDwmSetWindowAtt.Call(hwnd, 20, uintptr(unsafe.Pointer(&dark)), 4)
	}
	chromium := webview2.Chromium(w)
	if c2 := chromium.GetController().GetICoreWebView2Controller2(); c2 != nil {
		_ = c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 255, R: 0x12, G: 0x12, B: 0x14})
	}
	if s, err := chromium.GetSettings(); err == nil {
		_ = s.PutIsStatusBarEnabled(false)
		_ = s.PutIsZoomControlEnabled(false)
		if !hasArg("--debug") {
			_ = s.PutAreDevToolsEnabled(false)
		}
	}

	eval := func(js string) { w.Dispatch(func() { w.Eval(js) }) }
	node.OnChange = func() { eval("window.MC_event && window.MC_event('change')") }
	node.OnPair = func() { eval("window.MC_event && window.MC_event('pair')") }

	// mcCall(id, method, argsJSON): runs off the UI thread, answers through window.MC_done(id, result)
	_ = w.Bind("mcCall", func(id int64, method, args string) {
		if method == "exit" {
			w.Dispatch(func() { webview2.ForceClose(w) })
			return
		}
		go func() {
			res := node.Call(method, args)
			eval(fmt.Sprintf("window.MC_done && window.MC_done(%d, %s)", id, res))
		}()
	})
	_ = w.Bind("mcWin", func(op string, arg int) {
		switch op {
		case "drag":
			if ws.max {
				return
			}
			procReleaseCapture.Call()
			procPostMessageW.Call(hwnd, 0x00A1, 2, 0) // WM_NCLBUTTONDOWN, HTCAPTION
		case "resize":
			if arg >= 10 && arg <= 17 && !ws.max {
				procReleaseCapture.Call()
				procPostMessageW.Call(hwnd, 0x00A1, uintptr(arg), 0)
			}
		case "min":
			procShowWindow.Call(hwnd, 6) // SW_MINIMIZE
		case "max":
			w.Dispatch(ws.toggleMax)
		case "close":
			w.Dispatch(func() { webview2.ForceClose(w) })
		}
	})
	w.SetHtml(indexHTML)
	log.Printf("window up")
	w.Run()
	log.Printf("exit")
	time.Sleep(50 * time.Millisecond)
}
