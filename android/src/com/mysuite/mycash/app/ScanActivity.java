package com.mysuite.mycash.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.hardware.Camera;
import android.os.Bundle;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

import java.util.EnumMap;
import java.util.Map;

/** Minimal QR scanner (ZXing core) for the MYCASH pairing code (adapted from MYYT). */
@SuppressWarnings("deprecation")
public class ScanActivity extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {
    Camera cam;
    volatile boolean busy = false, done = false;
    final QRCodeReader reader = new QRCodeReader();
    final Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        FrameLayout f = new FrameLayout(this);
        SurfaceView sv = new SurfaceView(this);
        f.addView(sv);
        TextView t = new TextView(this);
        t.setText("Point the camera at the QR code shown in MYCASH on your other device (Sync → Show pairing code)");
        t.setTextColor(Color.WHITE);
        t.setBackgroundColor(0x99000000);
        t.setPadding(32, 32, 32, 32);
        t.setGravity(Gravity.CENTER);
        f.addView(t, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(f);
        sv.getHolder().addCallback(this);
    }

    @Override public void surfaceCreated(SurfaceHolder h) {
        try {
            cam = Camera.open();
            if (cam == null) { finish(); return; }
            cam.setDisplayOrientation(90);
            Camera.Parameters p = cam.getParameters();
            if (p.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            cam.setParameters(p);
            cam.setPreviewDisplay(h);
            cam.setPreviewCallback(this);
            cam.startPreview();
        } catch (Exception e) { finish(); }
    }

    @Override public void surfaceChanged(SurfaceHolder h, int f, int w, int hh) {}

    @Override public void surfaceDestroyed(SurfaceHolder h) { release(); }

    void release() { if (cam != null) { try { cam.setPreviewCallback(null); cam.stopPreview(); cam.release(); } catch (Exception ignored) {} cam = null; } }

    @Override protected void onPause() { super.onPause(); release(); if (!done) finish(); }

    @Override public void onPreviewFrame(final byte[] data, Camera c) {
        if (busy || done || cam == null) return;
        busy = true;
        final Camera.Size s = c.getParameters().getPreviewSize();
        new Thread(new Runnable() { public void run() {
            try {
                PlanarYUVLuminanceSource src = new PlanarYUVLuminanceSource(data, s.width, s.height, 0, 0, s.width, s.height, false);
                Result r = reader.decode(new BinaryBitmap(new HybridBinarizer(src)), hints);
                final String text = r.getText();
                if (text != null && text.startsWith("MYCASH1;")) {
                    done = true;
                    runOnUiThread(new Runnable() { public void run() { setResult(RESULT_OK, new Intent().putExtra("link", text)); finish(); } });
                }
            } catch (Exception ignored) {
            } finally { reader.reset(); busy = false; }
        }}).start();
    }
}
