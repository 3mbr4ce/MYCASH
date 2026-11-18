package com.mysuite.mycash.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.mysuite.mycash.R;

/** MYSUITE: the app's own short start screen (~1 s) after the system splash: icon (5a proportions) and the tag
 *  "MYSUITE · MYCASH v<version>" ("MYSUITE" in Frosted Blue, the rest muted). Adapted from MYYT. */
final class StartScreen {
    static final int BG = Color.parseColor("#121214"), DOT = Color.parseColor("#8be5f3"), MUTED = Color.parseColor("#949BA4");

    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    static CharSequence tag(Context c) {
        SpannableStringBuilder b = new SpannableStringBuilder("MYSUITE");
        b.setSpan(new ForegroundColorSpan(DOT), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        int s = b.length();
        b.append(" · MYCASH v").append(version(c));
        b.setSpan(new ForegroundColorSpan(MUTED), s, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    static void show(Activity a, final ViewGroup root) {
        float dp = a.getResources().getDisplayMetrics().density;
        final FrameLayout over = new FrameLayout(a);
        over.setBackgroundColor(BG);
        over.setClickable(true);
        over.setContentDescription("MYCASH start screen");
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView icon = new ImageView(a);
        icon.setImageResource(R.drawable.start_icon);
        int is = (int) (96 * dp);
        col.addView(icon, new LinearLayout.LayoutParams(is, is));
        TextView t = new TextView(a);
        t.setText(tag(a));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setLetterSpacing(0.04f);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = (int) (20 * dp);
        col.addView(t, tp);
        over.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.addView(over, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        over.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            boolean started;
            public boolean onPreDraw() {
                if (started) return true;
                started = true;
                over.getViewTreeObserver().removeOnPreDrawListener(this);
                over.postDelayed(new Runnable() { public void run() {
                    over.animate().alpha(0f).setDuration(200).withEndAction(new Runnable() { public void run() { root.removeView(over); } }).start();
                }}, 1000);
                return true;
            }
        });
    }

    private StartScreen() {}
}
