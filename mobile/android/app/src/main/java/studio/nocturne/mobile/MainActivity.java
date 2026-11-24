package studio.nocturne.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "nocturne.local";
    private static final int SAVE_IMAGE = 20;
    private static final Map<String, String> ASSETS = new HashMap<>();
    static {
        ASSETS.put("/index.html", "text/html");
        ASSETS.put("/studio.css", "text/css");
        ASSETS.put("/studio.js", "text/javascript");
        ASSETS.put("/cover.webp", "image/webp");
        ASSETS.put("/brand.svg", "image/svg+xml");
        ASSETS.put("/fa.woff2", "font/woff2");
        ASSETS.put("/latin.woff2", "font/woff2");
    }
    private WebView web;
    private Studio studio;
    private String pendingExport;
    private boolean renderQueued, keyboardVisible;
    private final Runnable update = this::render;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        studio = Studio.get(this);
        if (saved != null) pendingExport = saved.getString("export");
        getWindow().setStatusBarColor(Color.rgb(10, 16, 27));
        getWindow().setNavigationBarColor(Color.rgb(10, 16, 27));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(10, 16, 27));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "Nocturne");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl()) || !"/index.html".equals(request.getUrl().getPath());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!local(uri) || !"GET".equals(request.getMethod())) return unavailable();
                String path = uri.getPath();
                if (path == null) return unavailable();
                try {
                    if (ASSETS.containsKey(path)) {
                        String mime = ASSETS.get(path);
                        return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null,
                                getAssets().open(path.substring(1)));
                    }
                    if (path.startsWith("/photo/")) {
                        File photo = studio.image(path.substring(7));
                        if (photo != null) return new WebResourceResponse("image/png", null, new FileInputStream(photo));
                    }
                } catch (IOException ignored) { }
                return unavailable();
            }

            @Override public void onPageFinished(WebView view, String url) { render(); }
        });
        var frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(10, 16, 27));
        frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                var bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                var keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                boolean visible = insets.isVisible(WindowInsets.Type.ime());
                if (keyboardVisible != visible) {
                    keyboardVisible = visible;
                    render();
                }
                return WindowInsets.CONSUMED;
            });
        } else {
            frame.setFitsSystemWindows(true);
        }
        setContentView(frame);
        frame.requestApplyInsets();
        web.loadUrl("https://" + ORIGIN + "/index.html");
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && ORIGIN.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }

    @Override public void onResume() {
        super.onResume();
        studio.listen(update);
        render();
    }

    @Override public void onPause() {
        studio.listen(null);
        super.onPause();
    }

    private void render() {
        if (web == null || isFinishing()) return;
        if (studio.generating()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (renderQueued) return;
        renderQueued = true;
        web.postOnAnimation(() -> {
            renderQueued = false;
            if (web == null || isFinishing()) return;
            web.evaluateJavascript("window.nocturneState && window.nocturneState(" + studio.state() + ");"
                    + "window.nocturneKeyboard && window.nocturneKeyboard(" + keyboardVisible + ")", null);
        });
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.nocturneBack && window.nocturneBack()", value -> {
            if (!"true".equals(value)) super.onBackPressed();
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("export", pendingExport);
    }

    @Override protected void onDestroy() {
        web.removeJavascriptInterface("Nocturne");
        web.destroy();
        web = null;
        super.onDestroy();
    }

    private void chooseDestination(String image) {
        if (pendingExport != null || studio.image(image) == null) return;
        var intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("image/png").putExtra(Intent.EXTRA_TITLE, "Nocturne-" + image.substring(0, 8) + ".png");
        pendingExport = image;
        try { startActivityForResult(intent, SAVE_IMAGE); }
        catch (android.content.ActivityNotFoundException error) {
            pendingExport = null;
            exportNotice(false);
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request != SAVE_IMAGE) return;
        File source = studio.image(pendingExport);
        pendingExport = null;
        if (result != RESULT_OK) return;
        if (intent == null || intent.getData() == null || source == null) { exportNotice(false); return; }
        Uri destination = intent.getData();
        new Thread(() -> {
            boolean success = false;
            try (var input = new FileInputStream(source); var out = getContentResolver().openOutputStream(destination, "wt")) {
                if (out == null) throw new IOException();
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
                success = true;
            } catch (IOException | SecurityException ignored) { success = false; }
            boolean saved = success;
            runOnUiThread(() -> exportNotice(saved));
        }, "Nocturne export").start();
    }

    private void exportNotice(boolean success) {
        if (web != null) web.evaluateJavascript("window.nocturneNotice && window.nocturneNotice(" + success + ")", null);
        else if (!success) Toast.makeText(this, R.string.export_failed, Toast.LENGTH_SHORT).show();
    }

    private final class Bridge {
        @JavascriptInterface public void refresh() {
            runOnUiThread(MainActivity.this::render);
        }
        @JavascriptInterface public void download(String id) { runOnUiThread(() -> studio.download(id)); }
        @JavascriptInterface public void pauseDownload() { runOnUiThread(studio::pauseDownload); }
        @JavascriptInterface public void select(String id) { runOnUiThread(() -> studio.select(id)); }
        @JavascriptInterface public void engine(String mode) { runOnUiThread(() -> studio.chooseEngine(mode)); }
        @JavascriptInterface public void remove(String id) { runOnUiThread(() -> studio.removeModel(id)); }
        @JavascriptInterface public void generate(String prompt) { runOnUiThread(() -> studio.generate(prompt)); }
        @JavascriptInterface public void stop() { runOnUiThread(studio::stop); }
        @JavascriptInterface public void export(String id) { runOnUiThread(() -> chooseDestination(id)); }
        @JavascriptInterface public void deleteImage(String id) { runOnUiThread(() -> studio.deleteImage(id)); }
    }
}
