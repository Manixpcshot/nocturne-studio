package studio.nocturne.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.util.Log;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;

import org.json.JSONArray;
import org.json.JSONObject;

final class Studio {
    private static Studio instance;
    static Studio get(Context context) {
        if (instance == null) instance = new Studio(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    final File models, gallery;
    private final Map<String, Model> catalog = new LinkedHashMap<>();
    private final HashSet<String> gpuFailures = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Messenger replies = new Messenger(new Handler(Looper.getMainLooper(), this::engineReply));
    private final java.util.concurrent.ExecutorService work = Executors.newSingleThreadExecutor();
    private Runnable listener;
    private String gpu = "";
    private String selected;
    private String selectedText;
    private JSONObject chat = new JSONObject();
    private String chatAnswer;
    private String preferred;
    private String runningMode = "cpu";
    private int request;
    private boolean usingFallback;
    private final boolean gpuAvailable;
    private JSONObject download = new JSONObject();
    private JSONObject generation = new JSONObject();
    private ModelDownload.Control transfer;
    private boolean downloading, generating, bound, cancelling;
    private long generationStarted;
    private String activeDownload = "";
    private Messenger engine;
    private File output;
    private JSONObject metadata;
    private JSONArray photos = new JSONArray();
    private boolean galleryReady;
    private String initError = "";

    private Studio(Context context) {
        this.context = context;
        gpuAvailable = Hardware.gpuEngine(context);
        models = new File(context.getNoBackupFilesDir(), "models");
        gallery = new File(context.getNoBackupFilesDir(), "gallery");
        models.mkdirs();
        gallery.mkdirs();
        try (var stream = context.getAssets().open("models.json")) {
            var bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            var list = new JSONArray(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            for (int i = 0; i < list.length(); i++) {
                var model = new Model(list.getJSONObject(i));
                catalog.put(model.id(), model);
            }
        } catch (Exception error) {
            Log.e("Nocturne", "Could not load the model catalog", error);
            initError = "catalog";
        }
        selected = context.getSharedPreferences("studio", 0).getString("selected", "");
        selectedText = context.getSharedPreferences("studio", 0).getString("selectedText", "");
        preferred = context.getSharedPreferences("studio", 0).getString("engine", "auto");
        work.execute(() -> {
            // An interrupted native write is never treated as an image.
            File[] leftovers = gallery.listFiles((dir, name) -> name.endsWith(".tmp"));
            if (leftovers != null) for (File file : leftovers) file.delete();
            JSONArray initial = readGallery();
            String renderer = "";
            try { renderer = Hardware.renderer(); }
            catch (RuntimeException error) { Log.w("Nocturne", "GPU details unavailable", error); }
            String value = renderer;
            main.post(() -> {
                var known = new HashSet<String>();
                for (int i = 0; i < photos.length(); i++) known.add(photos.optJSONObject(i).optString("id"));
                for (int i = 0; i < initial.length(); i++) {
                    var photo = initial.optJSONObject(i);
                    String id = photo.optString("id");
                    if (known.add(id) && image(id) != null) photos.put(photo);
                }
                galleryReady = true;
                gpu = value;
                changed();
            });
        });
    }

    void listen(Runnable callback) { listener = callback; }
    void updateChanged() { main.post(this::changed); }
    boolean generating() { return generating; }
    private void changed() { if (listener != null) listener.run(); }

    JSONObject state() {
        JSONArray entries = new JSONArray();
        long memory = Hardware.memory(context).totalMem;
        long free = models.getUsableSpace();
        for (Model model : catalog.values()) {
            try {
                JSONObject entry = new JSONObject(model.entry().toString());
                entry.remove("sha256");
                entry.remove("revision");
                entry.remove("file");
                entry.remove("parts");
                entry.put("components", model.assets().size());
                entry.put("bytes", model.bytes());
                entry.put("installed", model.installed(models));
                long received = model.received(models);
                long required = ModelDownload.requiredSpace(model.bytes(), received);
                entry.put("partial", received);
                entry.put("requiredSpace", required);
                entry.put("spaceOk", free >= required);
                entry.put("fits", Hardware.fits(memory, model.ram()));
                entries.put(entry);
            } catch (Exception error) { Log.e("Nocturne", "Catalog entry unavailable", error); }
        }
        JSONObject state = json("models", entries, "selected", selected, "photos", photos, "selectedText", selectedText, "chat", chat,
                "appUpdate", AppUpdates.get(context).state(),
                "download", download, "generation", generation, "generating", generating,
                "downloading", downloading, "initError", initError, "preferred", preferred,
                "gpuAvailable", gpuAvailable, "galleryReady", galleryReady, "generationStarted", generationStarted);
        try { state.put("hardware", Hardware.read(context, models, gpu)); }
        catch (Exception error) { Log.w("Nocturne", "Could not collect hardware details", error); }
        return state;
    }

    void select(String id) {
        var model = catalog.get(id);
        if (generating || model == null || !model.installed(models)) return;
        if (model.text()) selectedText = id;
        else selected = id;
        context.getSharedPreferences("studio", 0).edit()
                .putString(model.text() ? "selectedText" : "selected", id).apply();
        changed();
    }

    void chooseEngine(String mode) {
        if (generating || mode == null || !mode.matches("auto|cpu|fast|vulkan|hybrid")) return;
        if (!gpuAvailable && ("vulkan".equals(mode) || "hybrid".equals(mode))) return;
        preferred = mode;
        context.getSharedPreferences("studio", 0).edit().putString("engine", mode).apply();
        changed();
    }

    void download(String id) {
        var model = catalog.get(id);
        if (model == null || model.installed(models) || downloading) return;
        if (!Hardware.fits(Hardware.memory(context).totalMem, model.ram())) {
            download = json("id", id, "phase", "error", "error", "ram");
            changed();
            return;
        }
        var control = new ModelDownload.Control();
        transfer = control;
        downloading = true;
        activeDownload = id;
        download = json("id", id, "phase", "connecting", "received", model.received(models));
        changed();
        work.execute(() -> {
            String message = "";
            try {
                ModelDownload.run(model, models, (phase, received, rate, component) -> main.post(() -> {
                    if (control != transfer || control.paused()) return;
                    download = json("id", id, "phase", phase, "received", received, "rate", rate,
                            "component", component);
                    changed();
                }), control);
            } catch (Exception error) {
                Log.w("Nocturne", "Model download interrupted: " + id, error);
                message = error.getMessage();
            }
            String error = message == null ? "network" : message;
            main.post(() -> {
                boolean installed = model.installed(models);
                downloading = false;
                transfer = null;
                activeDownload = "";
                download = json("id", id, "phase", installed ? "ready" : control.paused() ? "paused" : "error",
                        "received", model.received(models), "error", error);
                if (installed && (model.text() ? selectedText : selected).isEmpty()) select(id);
                changed();
            });
        });
    }

    void pauseDownload() {
        if (transfer == null || transfer.paused()) return;
        transfer.pause();
        download = json("id", activeDownload, "phase", "pausing", "received", download.optLong("received"));
        changed();
    }

    void removeModel(String id) {
        var model = catalog.get(id);
        if (model == null || activeDownload.equals(id) || (generating && metadata.optString("modelId").equals(id))) return;
        try {
            for (Model.Asset asset : model.assets()) {
                Files.deleteIfExists(asset.ready(models).toPath());
                Files.deleteIfExists(asset.partial(models).toPath());
            }
            if (selectedText.equals(id)) {
                selectedText = "";
                context.getSharedPreferences("studio", 0).edit().remove("selectedText").apply();
            }
            if (selected.equals(id)) {
                selected = "";
                context.getSharedPreferences("studio", 0).edit().remove("selected").apply();
            }
            if (download.optString("id").equals(id)) download = new JSONObject();
        } catch (IOException error) {
            download = json("id", id, "phase", "error", "error", "remove");
        }
        changed();
    }

    void generate(String prompt) {
        if (generating || prompt == null || prompt.trim().isEmpty() || prompt.length() > 1500) return;
        Model model = catalog.get(selected);
        var memory = Hardware.memory(context);
        if (model == null || !model.installed(models)) { generationError("model"); return; }
        if (!Hardware.fits(memory.totalMem, model.ram()) || memory.lowMemory
                || memory.availMem < 1.2 * Hardware.GIB) { generationError("memory"); return; }
        if (gallery.getUsableSpace() < 16L * 1024 * 1024) { generationError("disk"); return; }

        String id = UUID.randomUUID().toString();
        int seed = ThreadLocalRandom.current().nextInt(Integer.MAX_VALUE);
        output = new File(gallery, id + ".png");
        metadata = json("id", id, "modelId", model.id(), "model", model.name(), "prompt", prompt.trim(),
                "seed", seed, "size", model.size(), "date", System.currentTimeMillis());
        generating = true;
        generationStarted = System.currentTimeMillis();
        cancelling = false;
        usingFallback = false;
        pending = new Bundle();
        pending.putBundle("components", model.paths(models));
        pending.putString("output", output.getAbsolutePath());
        pending.putString("prompt", prompt.trim());
        pending.putString("sampler", model.sampler());
        pending.putInt("size", model.size());
        pending.putInt("steps", model.steps());
        pending.putInt("seed", seed);
        pending.putBoolean("turbo", model.turbo());
        pending.putFloat("cfg", model.cfg());
        pending.putInt("threads", Math.max(1, Math.min(6, Runtime.getRuntime().availableProcessors() - 1)));
        String mode = preferred;
        if ("auto".equals(mode)) {
            boolean tryGpu = gpuAvailable && !gpuFailures.contains(model.id());
            mode = tryGpu ? (model.ram() >= 8 ? "hybrid" : "vulkan") : "cpu";
        }
        if (("fast".equals(mode) && !model.fast()) || (usesGpu(mode) && !gpuAvailable)) mode = "cpu";
        startEngine(mode);
    }

    void chat(String prompt) {
        if (generating || prompt == null || prompt.trim().isEmpty() || prompt.length() > 1500) return;
        Model model = catalog.get(selectedText);
        if (model == null || !model.installed(models)) {
            chat = json("error", "model", "prompt", prompt);
            changed();
            return;
        }
        var memory = Hardware.memory(context);
        if (memory.lowMemory || !Hardware.fits(memory.totalMem, model.ram()) || memory.availMem < 768L * 1024 * 1024) {
            chat = json("error", "memory", "prompt", prompt);
            changed();
            return;
        }
        output = null;
        chatAnswer = null;
        chat = json("prompt", prompt.trim(), "working", true);
        metadata = json("modelId", model.id());
        generating = true;
        generationStarted = System.currentTimeMillis();
        cancelling = false;
        usingFallback = false;
        pending = new Bundle();
        pending.putBundle("components", model.paths(models));
        pending.putString("prompt", prompt.trim());
        pending.putInt("threads", Math.max(1, Math.min(6, Runtime.getRuntime().availableProcessors() - 1)));
        startEngine("text");
    }

    private Bundle pending;
    private ServiceConnection connection;

    private static boolean usesGpu(String mode) { return "vulkan".equals(mode) || "hybrid".equals(mode); }

    private void startEngine(String mode) {
        runningMode = mode;
        pending.putString("mode", mode);
        if (!"text".equals(mode)) generation = json("phase", usingFallback ? "fallback" : "loading", "mode", mode);
        changed();
        final int thisRequest = ++request;
        connection = new ServiceConnection() {
            public void onServiceConnected(ComponentName name, IBinder binder) {
                if (connection != this || !generating) return;
                if (cancelling) { finish(false, true, ""); return; }
                engine = new Messenger(binder);
                Message message = Message.obtain(null, EngineService.START, thisRequest, 0);
                message.setData(pending);
                message.replyTo = replies;
                try { engine.send(message); }
                catch (RemoteException error) { finishOrRetry(false, false, "engine"); }
            }

            public void onServiceDisconnected(ComponentName name) {
                if (connection == this && generating) finishOrRetry(output != null && output.isFile(), cancelling, "engineStopped");
            }

            public void onBindingDied(ComponentName name) { onServiceDisconnected(name); }
            public void onNullBinding(ComponentName name) {
                if (connection == this && generating) finishOrRetry(false, false, "engine");
            }
        };
        Class<?> service = "text".equals(mode) ? TextEngineService.class :
                usesGpu(mode) ? VulkanEngineService.class : EngineService.class;
        try { bound = context.bindService(new Intent(context, service), connection, Context.BIND_AUTO_CREATE); }
        catch (SecurityException error) { bound = false; }
        if (!bound) finishOrRetry(false, false, "engine");
        else main.postDelayed(() -> {
            if (generating && request == thisRequest && engine == null) finishOrRetry(false, false, "engine");
        }, 12000);
    }

    private void disconnect() {
        if (bound && connection != null) context.unbindService(connection);
        bound = false;
        connection = null;
        engine = null;
    }

    private void finishOrRetry(boolean success, boolean cancelled, String error) {
        if (!generating) return;
        if (!success && !cancelled && !cancelling && !usingFallback && !"text".equals(runningMode) && !"cpu".equals(runningMode)) {
            Log.w("Nocturne", runningMode + " failed. Retrying on CPU: " + error);
            if (usesGpu(runningMode)) gpuFailures.add(metadata.optString("modelId"));
            usingFallback = true;
            disconnect();
            if (output != null) new File(output.getPath() + ".tmp").delete();
            startEngine("cpu");
            return;
        }
        finish(success, cancelled || cancelling, error);
    }

    private boolean engineReply(Message message) {
        if (!generating || message.arg1 != request) return true;
        Bundle data = message.getData();
        if (message.what == EngineService.PROGRESS && !cancelling) {
            generation = json("phase", "working", "stage", data.getString("stage"), "mode", runningMode,
                    "completed", data.getLong("completed"), "total", data.getLong("total"));
            changed();
        }
        if (message.what == EngineService.RESULT) {
            if ("text".equals(runningMode)) chatAnswer = data.getString("answer");
            finishOrRetry(data.getBoolean("ok"), data.getBoolean("cancelled"), data.getString("error", "engine"));
        }
        return true;
    }

    void stop() {
        if (!generating || cancelling) return;
        cancelling = true;
        if (!"text".equals(runningMode)) generation = json("phase", "stopping");
        changed();
        if (engine == null) { finish(false, true, ""); return; }
        try { engine.send(Message.obtain(null, EngineService.CANCEL, request, 0)); }
        catch (RemoteException error) { finish(false, true, ""); }
    }

    private void finish(boolean success, boolean cancelled, String error) {
        if (!generating) return;
        generating = false;
        disconnect();
        pending = null;
        if ("text".equals(runningMode)) {
            String prompt = chat.optString("prompt");
            chat = success ? json("prompt", prompt, "answer", chatAnswer)
                    : json("prompt", prompt, "error", cancelled ? "cancelled" : "engine");
            changed();
            return;
        }
        if (success) {
            try { metadata.put("engine", runningMode); }
            catch (org.json.JSONException errorInfo) { Log.w("Nocturne", "Could not save engine details", errorInfo); }
            String id = metadata.optString("id");
            File info = new File(gallery, id + ".json");
            File tmp = new File(info.getPath() + ".tmp");
            try {
                Files.write(tmp.toPath(), metadata.toString().getBytes(StandardCharsets.UTF_8));
                Files.move(tmp.toPath(), info.toPath(), StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException failure) {
                Log.w("Nocturne", "Image metadata could not be saved", failure);
                tmp.delete();
            }
            var updated = new JSONArray().put(metadata);
            for (int i = 0; i < photos.length(); i++) updated.put(photos.optJSONObject(i));
            photos = updated;
            generation = json("phase", "ready", "id", id, "mode", runningMode);
        } else {
            if (output != null) new File(output.getPath() + ".tmp").delete();
            generation = cancelled ? json("phase", "cancelled") : json("phase", "error", "error", error);
        }
        changed();
    }

    private void generationError(String error) {
        generation = json("phase", "error", "error", error);
        changed();
    }

    private JSONArray readGallery() {
        var all = new JSONArray();
        var files = gallery.listFiles((dir, name) -> name.matches("[a-f0-9-]{36}\\.png"));
        if (files == null) return all;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        for (File file : files) {
            String id = file.getName().substring(0, 36);
            File info = new File(gallery, id + ".json");
            try { all.put(new JSONObject(new String(Files.readAllBytes(info.toPath()), StandardCharsets.UTF_8))); }
            catch (Exception error) { all.put(json("id", id, "date", file.lastModified())); }
        }
        return all;
    }

    File image(String id) {
        if (id != null && id.matches("[a-f0-9-]{36}")) {
            File file = new File(gallery, id + ".png");
            if (file.isFile()) return file;
        }
        return null;
    }

    void deleteImage(String id) {
        File file = image(id);
        if (file == null || !file.delete()) return;
        new File(gallery, id + ".json").delete();
        var kept = new JSONArray();
        for (int i = 0; i < photos.length(); i++) {
            var photo = photos.optJSONObject(i);
            if (!id.equals(photo.optString("id"))) kept.put(photo);
        }
        photos = kept;
        if (id.equals(generation.optString("id"))) generation = new JSONObject();
        changed();
    }

    static JSONObject json(Object... values) {
        var data = new JSONObject();
        try {
            for (int i = 0; i < values.length; i += 2) data.put((String) values[i], values[i + 1]);
        } catch (Exception error) { throw new IllegalArgumentException(error); }
        return data;
    }
}
