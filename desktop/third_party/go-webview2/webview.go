//go:build windows
// +build windows

package webview2

import (
	"encoding/json"
	"errors"
	"log"
	"reflect"
	"strconv"
	"sync"
	"unsafe"

	"github.com/jchv/go-webview2/internal/w32"
	"github.com/jchv/go-webview2/pkg/edge"

	"golang.org/x/sys/windows"
)

var (
	windowContext     = map[uintptr]interface{}{}
	windowContextSync sync.RWMutex
)

func getWindowContext(wnd uintptr) interface{} {
	windowContextSync.RLock()
	defer windowContextSync.RUnlock()
	return windowContext[wnd]
}

func setWindowContext(wnd uintptr, data interface{}) {
	windowContextSync.Lock()
	defer windowContextSync.Unlock()
	windowContext[wnd] = data
}

type browser interface {
	Embed(hwnd uintptr) bool
	Resize()
	Navigate(url string)
	NavigateToString(htmlContent string)
	Init(script string)
	Eval(script string)
	NotifyParentWindowPositionChanged() error
	Focus()
}

type webview struct {
	hwnd       uintptr
	mainthread uintptr
	browser    browser
	autofocus  bool
	maxsz      w32.Point
	minsz      w32.Point
	m          sync.Mutex
	bindings   map[string]interface{}
	dispatchq  []func()
	frameless  bool
	aspectW    int32 // yt-popuper: locked client aspect ratio (0 = off)
	aspectH    int32
	onClose    func() // yt-popuper: called once on the first WM_CLOSE instead of destroying
	closing    bool
	hideClose  bool
}

type WindowOptions struct {
	Title  string
	Width  uint
	Height uint
	IconId uint
	Center bool

	// yt-popuper fork additions:
	// Frameless creates a WS_POPUP|WS_THICKFRAME window whose client area
	// covers the whole window (no caption, no visible border).
	Frameless bool
	// TopMost makes the window always-on-top (WS_EX_TOPMOST).
	TopMost bool
	// MYYT 0.0.2: secondary windows (the docked remote panel).
	Owner       uintptr // owner window (stays above it, no own taskbar button with ToolWindow)
	ToolWindow  bool    // WS_EX_TOOLWINDOW
	Hidden      bool    // create without showing
	HideOnClose bool    // WM_CLOSE hides the window; WM_DESTROY does not quit the app
}

// MYYT 0.0.2: one dispatch queue for all webviews of the UI thread (the message loop of the main
// window runs the queued functions of every window, e.g. the remote panel).
var (
	globalQM sync.Mutex
	globalQ  []func()
)

type WebViewOptions struct {
	Window unsafe.Pointer
	Debug  bool

	// DataPath specifies the datapath for the WebView2 runtime to use for the
	// browser instance.
	DataPath string

	// EnvironmentOptions: optional raw ICoreWebView2EnvironmentOptions COM
	// pointer (yt-popuper fork addition).
	EnvironmentOptions uintptr

	// AutoFocus will try to keep the WebView2 widget focused when the window
	// is focused.
	AutoFocus bool

	// WindowOptions customizes the window that is created to embed the
	// WebView2 widget.
	WindowOptions WindowOptions
}

// New creates a new webview in a new window.
func New(debug bool) WebView { return NewWithOptions(WebViewOptions{Debug: debug}) }

// NewWindow creates a new webview using an existing window.
//
// Deprecated: Use NewWithOptions.
func NewWindow(debug bool, window unsafe.Pointer) WebView {
	return NewWithOptions(WebViewOptions{Debug: debug, Window: window})
}

// NewWithOptions creates a new webview using the provided options.
func NewWithOptions(options WebViewOptions) WebView {
	w := &webview{}
	w.bindings = map[string]interface{}{}
	w.autofocus = options.AutoFocus

	chromium := edge.NewChromium()
	chromium.MessageCallback = w.msgcb
	chromium.DataPath = options.DataPath
	chromium.EnvironmentOptions = options.EnvironmentOptions
	chromium.SetPermission(edge.CoreWebView2PermissionKindClipboardRead, edge.CoreWebView2PermissionStateAllow)

	w.browser = chromium
	w.mainthread, _, _ = w32.Kernel32GetCurrentThreadID.Call()
	if !w.CreateWithOptions(options.WindowOptions) {
		return nil
	}

	settings, err := chromium.GetSettings()
	if err != nil {
		log.Fatal(err)
	}
	// disable context menu
	err = settings.PutAreDefaultContextMenusEnabled(options.Debug)
	if err != nil {
		log.Fatal(err)
	}
	// disable developer tools
	err = settings.PutAreDevToolsEnabled(options.Debug)
	if err != nil {
		log.Fatal(err)
	}

	return w
}

type rpcMessage struct {
	ID     int               `json:"id"`
	Method string            `json:"method"`
	Params []json.RawMessage `json:"params"`
}

func jsString(v interface{}) string { b, _ := json.Marshal(v); return string(b) }

func (w *webview) msgcb(msg string) {
	d := rpcMessage{}
	if err := json.Unmarshal([]byte(msg), &d); err != nil {
		log.Printf("invalid RPC message: %v", err)
		return
	}

	id := strconv.Itoa(d.ID)
	if res, err := w.callbinding(d); err != nil {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].reject(" + jsString(err.Error()) + "); window._rpc[" + id + "] = undefined")
		})
	} else if b, err := json.Marshal(res); err != nil {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].reject(" + jsString(err.Error()) + "); window._rpc[" + id + "] = undefined")
		})
	} else {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].resolve(" + string(b) + "); window._rpc[" + id + "] = undefined")
		})
	}
}

func (w *webview) callbinding(d rpcMessage) (interface{}, error) {
	w.m.Lock()
	f, ok := w.bindings[d.Method]
	w.m.Unlock()
	if !ok {
		return nil, nil
	}

	v := reflect.ValueOf(f)
	isVariadic := v.Type().IsVariadic()
	numIn := v.Type().NumIn()
	if (isVariadic && len(d.Params) < numIn-1) || (!isVariadic && len(d.Params) != numIn) {
		return nil, errors.New("function arguments mismatch")
	}
	args := []reflect.Value{}
	for i := range d.Params {
		var arg reflect.Value
		if isVariadic && i >= numIn-1 {
			arg = reflect.New(v.Type().In(numIn - 1).Elem())
		} else {
			arg = reflect.New(v.Type().In(i))
		}
		if err := json.Unmarshal(d.Params[i], arg.Interface()); err != nil {
			return nil, err
		}
		args = append(args, arg.Elem())
	}

	errorType := reflect.TypeOf((*error)(nil)).Elem()
	res := v.Call(args)
	switch len(res) {
	case 0:
		// No results from the function, just return nil
		return nil, nil

	case 1:
		// One result may be a value, or an error
		if res[0].Type().Implements(errorType) {
			if res[0].Interface() != nil {
				return nil, res[0].Interface().(error)
			}
			return nil, nil
		}
		return res[0].Interface(), nil

	case 2:
		// Two results: first one is value, second is error
		if !res[1].Type().Implements(errorType) {
			return nil, errors.New("second return value must be an error")
		}
		if res[1].Interface() == nil {
			return res[0].Interface(), nil
		}
		return res[0].Interface(), res[1].Interface().(error)

	default:
		return nil, errors.New("unexpected number of return values")
	}
}

func wndproc(hwnd, msg, wp, lp uintptr) uintptr {
	if w, ok := getWindowContext(hwnd).(*webview); ok {
		switch msg {
		case w32.WMMove, w32.WMMoving:
			_ = w.browser.NotifyParentWindowPositionChanged()
		case w32.WMNCLButtonDown:
			_, _, _ = w32.User32SetFocus.Call(w.hwnd)
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case w32.WMSize:
			w.browser.Resize()
		case w32.WMActivate:
			if wp == w32.WAInactive {
				break
			}
			if w.autofocus {
				w.browser.Focus()
			}
		case 0x0083: // WM_NCCALCSIZE
			if w.frameless && wp != 0 {
				// Client area == window area: removes caption and border while
				// keeping WS_THICKFRAME semantics (resizable, snap, shadow).
				return 0
			}
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case 0x0214: // WM_SIZING: keep the aspect ratio while the user drags an edge/corner
			if w.aspectW > 0 && w.aspectH > 0 && lp != 0 {
				constrainSizing(wp, (*w32.Rect)(unsafe.Pointer(lp)), w.aspectW, w.aspectH, w.minsz)
				return 1
			}
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case 0x0046: // WM_WINDOWPOSCHANGING: guard against any other size change (Aero Snap, etc.)
			if w.aspectW > 0 && w.aspectH > 0 && lp != 0 {
				constrainWindowPos(hwnd, (*windowPos)(unsafe.Pointer(lp)), w.aspectW, w.aspectH)
			}
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case w32.WMClose:
			if w.hideClose {
				_, _, _ = w32.User32ShowWindow.Call(hwnd, 0 /*SW_HIDE*/)
				if w.onClose != nil {
					w.onClose()
				}
				return 0
			}
			if w.onClose != nil && !w.closing {
				// Give the page a chance to flush state; it (or a timeout) closes for real.
				w.closing = true
				w.onClose()
				return 0
			}
			_, _, _ = w32.User32DestroyWindow.Call(hwnd)
		case w32.WMDestroy:
			if !w.hideClose {
				w.Terminate()
			}
		case w32.WMGetMinMaxInfo:
			lpmmi := (*w32.MinMaxInfo)(unsafe.Pointer(lp))
			if w.maxsz.X > 0 && w.maxsz.Y > 0 {
				lpmmi.PtMaxSize = w.maxsz
				lpmmi.PtMaxTrackSize = w.maxsz
			}
			if w.minsz.X > 0 && w.minsz.Y > 0 {
				lpmmi.PtMinTrackSize = w.minsz
			}
		default:
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		}
		return 0
	}
	r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
	return r
}

func (w *webview) Create(debug bool, window unsafe.Pointer) bool {
	// This function signature stopped making sense a long time ago.
	// It is but legacy cruft at this point.
	return w.CreateWithOptions(WindowOptions{})
}

func (w *webview) CreateWithOptions(opts WindowOptions) bool {
	var hinstance windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &hinstance)

	var icon uintptr
	if opts.IconId == 0 {
		// load default icon
		icow, _, _ := w32.User32GetSystemMetrics.Call(w32.SystemMetricsCxIcon)
		icoh, _, _ := w32.User32GetSystemMetrics.Call(w32.SystemMetricsCyIcon)
		icon, _, _ = w32.User32LoadImageW.Call(uintptr(hinstance), 32512, icow, icoh, 0)
	} else {
		// load icon from resource
		icon, _, _ = w32.User32LoadImageW.Call(uintptr(hinstance), uintptr(opts.IconId), 1, 0, 0, w32.LR_DEFAULTSIZE|w32.LR_SHARED)
	}

	className, _ := windows.UTF16PtrFromString("webview")
	wc := w32.WndClassExW{
		CbSize:        uint32(unsafe.Sizeof(w32.WndClassExW{})),
		HInstance:     hinstance,
		LpszClassName: className,
		HIcon:         windows.Handle(icon),
		HIconSm:       windows.Handle(icon),
		LpfnWndProc:   windows.NewCallback(wndproc),
	}
	_, _, _ = w32.User32RegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	windowName, _ := windows.UTF16PtrFromString(opts.Title)

	windowWidth := opts.Width
	if windowWidth == 0 {
		windowWidth = 640
	}
	windowHeight := opts.Height
	if windowHeight == 0 {
		windowHeight = 480
	}

	var posX, posY uint
	if opts.Center {
		// get screen size
		screenWidth, _, _ := w32.User32GetSystemMetrics.Call(w32.SM_CXSCREEN)
		screenHeight, _, _ := w32.User32GetSystemMetrics.Call(w32.SM_CYSCREEN)
		// calculate window position
		posX = (uint(screenWidth) - windowWidth) / 2
		posY = (uint(screenHeight) - windowHeight) / 2
	} else {
		// use default position
		posX = w32.CW_USEDEFAULT
		posY = w32.CW_USEDEFAULT
	}

	var style uintptr = 0xCF0000 // WS_OVERLAPPEDWINDOW
	var exStyle uintptr
	if opts.Frameless {
		// WS_POPUP | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX
		style = 0x80000000 | 0x00040000 | 0x00080000 | 0x00020000
		w.frameless = true
	}
	if opts.TopMost {
		exStyle |= 0x00000008 // WS_EX_TOPMOST
	}
	if opts.ToolWindow {
		exStyle |= 0x00000080 // WS_EX_TOOLWINDOW
	}
	w.hideClose = opts.HideOnClose
	w.hwnd, _, _ = w32.User32CreateWindowExW.Call(
		exStyle,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowName)),
		style,
		uintptr(posX),
		uintptr(posY),
		uintptr(windowWidth),
		uintptr(windowHeight),
		opts.Owner,
		0,
		uintptr(hinstance),
		0,
	)
	setWindowContext(w.hwnd, w)
	if w.frameless {
		// Re-run WM_NCCALCSIZE now that the window context is registered.
		_, _, _ = w32.User32SetWindowPos.Call(w.hwnd, 0, 0, 0, 0, 0,
			w32.SWPNoZOrder|w32.SWPNoActivate|w32.SWPNoMove|0x0001 /*SWP_NOSIZE*/|w32.SWPFrameChanged)
	}

	if !opts.Hidden {
		_, _, _ = w32.User32ShowWindow.Call(w.hwnd, w32.SWShow)
		_, _, _ = w32.User32UpdateWindow.Call(w.hwnd)
		_, _, _ = w32.User32SetFocus.Call(w.hwnd)
	}

	if !w.browser.Embed(w.hwnd) {
		return false
	}
	w.browser.Resize()
	return true
}

func (w *webview) Destroy() {
	_, _, _ = w32.User32PostMessageW.Call(w.hwnd, w32.WMClose, 0, 0)
}

func (w *webview) Run() {
	var msg w32.Msg
	for {
		_, _, _ = w32.User32GetMessageW.Call(
			uintptr(unsafe.Pointer(&msg)),
			0,
			0,
			0,
		)
		if msg.Message == w32.WMApp {
			globalQM.Lock()
			q := globalQ
			globalQ = nil
			globalQM.Unlock()
			for _, v := range q {
				v()
			}
		} else if msg.Message == w32.WMQuit {
			return
		}
		r, _, _ := w32.User32GetAncestor.Call(uintptr(msg.Hwnd), w32.GARoot)
		r, _, _ = w32.User32IsDialogMessage.Call(r, uintptr(unsafe.Pointer(&msg)))
		if r != 0 {
			continue
		}
		_, _, _ = w32.User32TranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		_, _, _ = w32.User32DispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (w *webview) Terminate() {
	_, _, _ = w32.User32PostQuitMessage.Call(0)
}

func (w *webview) Window() unsafe.Pointer {
	return unsafe.Pointer(w.hwnd)
}

func (w *webview) Navigate(url string) {
	w.browser.Navigate(url)
}

func (w *webview) SetHtml(html string) {
	w.browser.NavigateToString(html)
}

func (w *webview) SetTitle(title string) {
	_title, err := windows.UTF16FromString(title)
	if err != nil {
		_title, _ = windows.UTF16FromString("")
	}
	_, _, _ = w32.User32SetWindowTextW.Call(w.hwnd, uintptr(unsafe.Pointer(&_title[0])))
}

func (w *webview) SetSize(width int, height int, hints Hint) {
	index := w32.GWLStyle
	style := w32.GetWindowLong(w.hwnd, index)
	if hints == HintFixed {
		style &^= (w32.WSThickFrame | w32.WSMaximizeBox)
	} else {
		style |= (w32.WSThickFrame | w32.WSMaximizeBox)
	}
	w32.SetWindowLong(w.hwnd, index, style)

	if hints == HintMax {
		w.maxsz.X = int32(width)
		w.maxsz.Y = int32(height)
	} else if hints == HintMin {
		w.minsz.X = int32(width)
		w.minsz.Y = int32(height)
	} else {
		r := w32.Rect{}
		r.Left = 0
		r.Top = 0
		r.Right = int32(width)
		r.Bottom = int32(height)
		_, _, _ = w32.User32AdjustWindowRect.Call(uintptr(unsafe.Pointer(&r)), w32.WSOverlappedWindow, 0)
		_, _, _ = w32.User32SetWindowPos.Call(
			w.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			w32.SWPNoZOrder|w32.SWPNoActivate|w32.SWPNoMove|w32.SWPFrameChanged)
		w.browser.Resize()
	}
}

func (w *webview) Init(js string) {
	w.browser.Init(js)
}

func (w *webview) Eval(js string) {
	w.browser.Eval(js)
}

func (w *webview) Dispatch(f func()) {
	globalQM.Lock()
	globalQ = append(globalQ, f)
	globalQM.Unlock()
	_, _, _ = w32.User32PostThreadMessageW.Call(w.mainthread, w32.WMApp, 0, 0)
}

func (w *webview) Bind(name string, f interface{}) error {
	v := reflect.ValueOf(f)
	if v.Kind() != reflect.Func {
		return errors.New("only functions can be bound")
	}
	if n := v.Type().NumOut(); n > 2 {
		return errors.New("function may only return a value or a value+error")
	}
	w.m.Lock()
	w.bindings[name] = f
	w.m.Unlock()

	w.Init("(function() { var name = " + jsString(name) + ";" + `
		var RPC = window._rpc = (window._rpc || {nextSeq: 1});
		window[name] = function() {
		  var seq = RPC.nextSeq++;
		  var promise = new Promise(function(resolve, reject) {
			RPC[seq] = {
			  resolve: resolve,
			  reject: reject,
			};
		  });
		  window.external.invoke(JSON.stringify({
			id: seq,
			method: name,
			params: Array.prototype.slice.call(arguments),
		  }));
		  return promise;
		}
	})()`)

	return nil
}

// Chromium returns the underlying edge.Chromium of a WebView (yt-popuper fork addition).
func Chromium(w WebView) *edge.Chromium {
	if wv, ok := w.(*webview); ok {
		if c, ok := wv.browser.(*edge.Chromium); ok {
			return c
		}
	}
	return nil
}

// SetMinSize sets the minimum tracking size in physical pixels without
// touching the window style (yt-popuper fork addition).
func SetMinSize(w WebView, width, height int32) {
	if wv, ok := w.(*webview); ok {
		wv.minsz.X = width
		wv.minsz.Y = height
	}
}

// SetAspectRatio locks the window (== client area, the window is frameless)
// to aw:ah while resizing (yt-popuper fork addition).
func SetAspectRatio(w WebView, aw, ah int32) {
	if wv, ok := w.(*webview); ok {
		wv.aspectW, wv.aspectH = aw, ah
	}
}

type windowPos struct {
	Hwnd            uintptr
	HwndInsertAfter uintptr
	X, Y, Cx, Cy    int32
	Flags           uint32
}

var procIsIconic = windows.NewLazySystemDLL("user32.dll").NewProc("IsIconic")

// constrainSizing adjusts the drag rectangle of WM_SIZING so that
// width:height == aw:ah, moving only the edge(s) the user is dragging.
func constrainSizing(edge uintptr, r *w32.Rect, aw, ah int32, minsz w32.Point) {
	width, height := r.Right-r.Left, r.Bottom-r.Top
	if minsz.X > 0 && width < minsz.X {
		width = minsz.X
	}
	if minsz.Y > 0 && height < minsz.Y {
		height = minsz.Y
	}
	const (
		left, right, top, topLeft, topRight, bottom, bottomLeft, bottomRight = 1, 2, 3, 4, 5, 6, 7, 8
	)
	// Snap to whole multiples of aw x ah so the ratio is EXACT (e.g. 16:9 ->
	// 1280x720, 1296x729 ...): no sub-pixel black lines.
	var k int32
	switch edge {
	case left, right:
		k = (width + aw/2) / aw
	case top, bottom:
		k = (height + ah/2) / ah
	default:
		// corner: follow whichever dimension the pointer moved further
		if width*ah >= height*aw {
			k = (width + aw/2) / aw
		} else {
			k = (height + ah/2) / ah
		}
	}
	if minsz.X > 0 && k*aw < minsz.X {
		k = (minsz.X + aw - 1) / aw
	}
	if minsz.Y > 0 && k*ah < minsz.Y {
		k = (minsz.Y + ah - 1) / ah
	}
	width, height = k*aw, k*ah
	switch edge {
	case left, bottomLeft, topLeft:
		r.Left = r.Right - width
	default:
		r.Right = r.Left + width
	}
	switch edge {
	case top, topLeft, topRight:
		r.Top = r.Bottom - height
	default:
		r.Bottom = r.Top + height
	}
}

func constrainWindowPos(hwnd uintptr, wp *windowPos, aw, ah int32) {
	const swpNoSize = 0x0001
	if wp.Flags&swpNoSize != 0 || wp.Cx <= 0 || wp.Cy <= 0 || wp.X <= -32000 {
		return
	}
	if ic, _, _ := procIsIconic.Call(hwnd); ic != 0 {
		return
	}
	if wp.Cx*ah == wp.Cy*aw && wp.Cx%aw == 0 {
		return // already exact
	}
	// Largest exact aw:ah size that fits in the proposed rect.
	k := wp.Cx / aw
	if kh := wp.Cy / ah; kh < k {
		k = kh
	}
	if k < 1 {
		k = 1
	}
	wp.Cx, wp.Cy = k*aw, k*ah
}

// SetCloseHandler installs a hook for the first WM_CLOSE (Alt+F4, taskbar
// close, Destroy()). The hook must eventually call ForceClose (yt-popuper fork addition).
func SetCloseHandler(w WebView, f func()) {
	if wv, ok := w.(*webview); ok {
		wv.onClose = f
	}
}

// ForceClose destroys the window without calling the close hook again.
func ForceClose(w WebView) {
	if wv, ok := w.(*webview); ok {
		wv.closing = true
		_, _, _ = w32.User32PostMessageW.Call(wv.hwnd, w32.WMClose, 0, 0)
	}
}
