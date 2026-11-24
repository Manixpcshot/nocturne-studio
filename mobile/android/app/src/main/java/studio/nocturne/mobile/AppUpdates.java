package studio.nocturne.mobile;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Pattern;

import org.json.JSONObject;

final class AppUpdates {
    private static final String REPO = "Manixpcshot/nocturne-studio";
    private static final String API = "https://api.github.com/repos/" + REPO + "/releases/latest";
    private static final Pattern APK = Pattern.compile("Nocturne-Mobile-(\\d{1,5}\\.\\d{1,5}\\.\\d{1,5})-Android-arm64\\.apk");
    private static final long MAX_BYTES = 250L * 1024 * 1024;
    private static AppUpdates instance;
    private final Context context;
    private final PackageInfo installed;
    private volatile JSONObject state = new JSONObject();
    private volatile File verified;
    private long checkedAt = -1;
    private boolean checking;

    static synchronized AppUpdates get(Context context) {
        if (instance == null) instance = new AppUpdates(context.getApplicationContext());
        return instance;
    }

    private AppUpdates(Context context) {
        this.context = context;
        try {
            installed = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException(error);
        }
    }

    JSONObject state() { return state; }
    File ready() { return verified; }

    synchronized void check(boolean now, Runnable refresh) {
        long elapsed = SystemClock.elapsedRealtime();
        long interval = "error".equals(state.optString("phase")) ? 60000L : 6 * 60 * 60 * 1000L;
        if (checking || (!now && checkedAt >= 0 && elapsed - checkedAt < interval)) return;
        checkedAt = elapsed;
        checking = true;
        publish(Studio.json("phase", "checking"), refresh);
        new Thread(() -> {
            try { find(refresh); }
            catch (Exception error) {
                Log.w("Nocturne", "App update check failed", error);
                publish(Studio.json("phase", verified == null ? "error" : "ready",
                        "version", state.optString("version")), refresh);
            } finally {
                synchronized (this) { checking = false; }
            }
        }, "Nocturne app update").start();
    }

    private void find(Runnable refresh) throws Exception {
        JSONArrayReader release = checkRelease();
        for (int i = 0; i < release.assets.length(); i++) {
            JSONObject asset = release.assets.getJSONObject(i);
            String name = asset.optString("name");
            var match = APK.matcher(name);
            if (!match.matches() || !newer(match.group(1), installed.versionName)) continue;
            String version = match.group(1);
            String digest = asset.optString("digest");
            long bytes = asset.optLong("size");
            if (!digest.matches("sha256:[a-f0-9]{64}") || bytes < 1 || bytes > MAX_BYTES) throw new IOException("Invalid APK metadata");
            File ready = new File(context.getCacheDir(), "nocturne-update.apk");
            verified = null;
            publish(Studio.json("phase", "downloading", "version", version, "total", bytes, "received", 0), refresh);
            if (!ready.isFile() || ready.length() != bytes || !digest.equals(sha256(ready)) || !trustedArchive(ready, version)) {
                File stage = new File(context.getCacheDir(), "nocturne-update.pending.apk");
                try {
                    // Construct the public URL from the trusted repository and strict version/name patterns.
                    String url = "https://github.com/" + REPO + "/releases/download/" + release.tag + "/" + name;
                    download(url, stage, version, bytes, refresh);
                    if (!digest.equals(sha256(stage)) || !trustedArchive(stage, version)) throw new IOException("APK verification failed");
                    Files.move(stage.toPath(), ready.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } finally { Files.deleteIfExists(stage.toPath()); }
            }
            verified = ready;
            publish(Studio.json("phase", "ready", "version", version), refresh);
            return;
        }
        verified = null;
        Files.deleteIfExists(new File(context.getCacheDir(), "nocturne-update.apk").toPath());
        publish(Studio.json("phase", "current"), refresh);
    }

    private static final class JSONArrayReader {
        final String tag;
        final org.json.JSONArray assets;
        JSONArrayReader(JSONObject json) throws Exception {
            tag = json.getString("tag_name");
            if (!tag.matches("v\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}")) throw new IOException("Invalid release tag");
            assets = json.getJSONArray("assets");
        }
    }

    private static JSONArrayReader checkRelease() throws Exception {
        var http = connect(API);
        try (var input = http.getInputStream(); var result = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (result.size() + read > 1024 * 1024) throw new IOException("Release metadata too large");
                result.write(buffer, 0, read);
            }
            return new JSONArrayReader(new JSONObject(new String(result.toByteArray(), StandardCharsets.UTF_8)));
        } finally { http.disconnect(); }
    }

    private void download(String url, File file, String version, long size, Runnable refresh) throws IOException {
        var http = connect(url);
        try (var input = http.getInputStream(); var stream = new FileOutputStream(file)) {
            if (!"https".equals(http.getURL().getProtocol())) throw new IOException("Untrusted download protocol");
            long received = 0;
            long sentAt = 0;
            var buffer = new byte[256 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                received += read;
                if (received > size) throw new IOException("APK exceeded its expected size");
                stream.write(buffer, 0, read);
                long now = SystemClock.elapsedRealtime();
                if (now - sentAt >= 500) {
                    publish(Studio.json("phase", "downloading", "version", version, "total", size, "received", received), refresh);
                    sentAt = now;
                }
            }
            if (received != size) throw new IOException("Incomplete APK");
            stream.getFD().sync();
        } finally { http.disconnect(); }
    }

    private static HttpURLConnection connect(String url) throws IOException {
        var http = (HttpURLConnection) new URL(url).openConnection();
        http.setConnectTimeout(8000);
        http.setReadTimeout(15000);
        http.setRequestProperty("Accept-Encoding", "identity");
        return http;
    }

    private static String sha256(File file) throws Exception {
        var hash = MessageDigest.getInstance("SHA-256");
        try (var stream = new FileInputStream(file)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = stream.read(buffer)) != -1) hash.update(buffer, 0, read);
        }
        StringBuilder value = new StringBuilder("sha256:");
        for (byte b : hash.digest()) {
            value.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
        }
        return value.toString();
    }

    private boolean trustedArchive(File file, String version) {
        var candidate = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        return candidate != null && installed.packageName.equals(candidate.packageName)
                && version.equals(candidate.versionName) && candidate.getLongVersionCode() > installed.getLongVersionCode()
                && installed.signingInfo != null && candidate.signingInfo != null
                && Arrays.equals(installed.signingInfo.getApkContentsSigners(), candidate.signingInfo.getApkContentsSigners());
    }

    private static boolean newer(String candidate, String current) {
        if (current == null || !current.matches("\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}")) return false;
        String[] left = candidate.split("\\."), right = current.split("\\.");
        for (int i = 0; i < left.length; i++) {
            int comparison = Integer.compare(Integer.parseInt(left[i]), Integer.parseInt(right[i]));
            if (comparison != 0) return comparison > 0;
        }
        return false;
    }

    private void publish(JSONObject info, Runnable refresh) {
        state = info;
        refresh.run();
    }
}
