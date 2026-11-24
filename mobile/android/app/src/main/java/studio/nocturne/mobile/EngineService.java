package studio.nocturne.mobile;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class EngineService extends Service {
    static final int START = 1, CANCEL = 2, PROGRESS = 3, RESULT = 4;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Messenger reply;
    private volatile boolean cancelling;
    private volatile boolean loaded;
    private int request;
    private final Handler watchdog = new Handler(Looper.getMainLooper());

    private native void prepareNative();
    private native void cancelNative();
    private native int[] generateNative(String[] keys, String[] paths, byte[] prompt, String sampler,
                                        String mode, int size, int steps, int seed, int threads, float cfg, boolean turbo);

    private native byte[] chatNative(String path, byte[] prompt, int threads);

    String library() { return "nocturne_engine"; }

    private final Messenger commands = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        if (message.what == CANCEL && reply != null && message.arg1 == request) {
            cancelling = true;
            int cancelledRequest = request;
            watchdog.postDelayed(() -> {
                // This service process is dedicated to inference. A stuck driver cannot hold the app open.
                if (reply != null && request == cancelledRequest && cancelling) {
                    android.os.Process.killProcess(android.os.Process.myPid());
                }
            }, 8000);
            if (loaded) cancelNative();
            return true;
        }
        if (message.what != START || message.replyTo == null || reply != null) return false;
        request = message.arg1;
        cancelling = false;
        reply = message.replyTo;
        Bundle input = message.getData();
        worker.execute(() -> generate(input));
        return true;
    }));

    @Override public IBinder onBind(Intent intent) { return commands.getBinder(); }
    @Override public void onDestroy() { worker.shutdown(); super.onDestroy(); }

    private void generate(Bundle input) {
        String output = input.getString("output");
        File target = output == null ? null : new File(output);
        File part = target == null ? null : new File(target.getPath() + ".tmp");
        Bundle result = new Bundle();
        int activeRequest = request;
        try {
            if (!loaded) {
                System.loadLibrary(library());
                loaded = true;
            }
            prepareNative();
            if (cancelling) cancelNative();
            int size = input.getInt("size");
            String mode = input.getString("mode");
            Bundle components = input.getBundle("components");
            if ("text".equals(mode)) {
                byte[] answer = chatNative(components.getString("model_path"), utf8(input.getString("prompt")), input.getInt("threads"));
                if (cancelling) result.putBoolean("cancelled", true);
                else if (answer == null || answer.length == 0) throw new IOException("The text engine returned no tokens.");
                else {
                    result.putString("answer", new String(answer, StandardCharsets.UTF_8));
                    result.putBoolean("ok", true);
                }
                return;
            }
            if ("fast".equals(mode)) components.putString("taesd_path", fastDecoder().getAbsolutePath());
            String[] keys = components.keySet().toArray(new String[0]);
            String[] paths = new String[keys.length];
            for (int i = 0; i < keys.length; i++) paths[i] = components.getString(keys[i]);
            int[] pixels = generateNative(keys, paths, utf8(input.getString("prompt")), input.getString("sampler"),
                    mode, size, input.getInt("steps"), input.getInt("seed"), input.getInt("threads"),
                    input.getFloat("cfg"), input.getBoolean("turbo"));
            if (cancelling) {
                result.putBoolean("cancelled", true);
            } else if (pixels == null) {
                throw new IOException("The engine returned no image.");
            } else {
                onNativeProgress("saving", 0, 0);
                Bitmap bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888);
                try (var stream = new FileOutputStream(part)) {
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new IOException("PNG encoding failed.");
                    stream.getFD().sync();
                } finally {
                    bitmap.recycle();
                }
                if (cancelling) result.putBoolean("cancelled", true);
                else {
                    Files.move(part.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE);
                    result.putBoolean("ok", true);
                }
            }
        } catch (Exception | LinkageError | OutOfMemoryError error) {
            result.putBoolean("cancelled", cancelling);
            result.putString("error", error instanceof OutOfMemoryError ? "memory" : error.getMessage());
        } finally {
            if (part != null) part.delete();
            Messenger client = reply;
            reply = null;
            send(client, RESULT, activeRequest, result);
        }
    }

    private static byte[] utf8(String value) { return value.getBytes(StandardCharsets.UTF_8); }

    private File fastDecoder() throws IOException {
        File decoder = new File(getNoBackupFilesDir(), "taesd-v2.safetensors");
        if (decoder.isFile() && decoder.length() == 9793292) return decoder;
        File part = new File(decoder.getPath() + ".tmp");
        try (var input = getAssets().open("taesd.weights")) {
            Files.copy(input, part.toPath(), StandardCopyOption.REPLACE_EXISTING);
            Files.move(part.toPath(), decoder.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            part.delete();
        }
        return decoder;
    }

    @SuppressWarnings("unused") // Called by JNI.
    private void onNativeProgress(String stage, long completed, long total) {
        Bundle progress = new Bundle();
        progress.putString("stage", stage);
        progress.putLong("completed", completed);
        progress.putLong("total", total);
        send(reply, PROGRESS, request, progress);
    }

    private static void send(Messenger receiver, int what, int request, Bundle bundle) {
        if (receiver == null) return;
        Message message = Message.obtain(null, what);
        message.arg1 = request;
        message.setData(bundle);
        try { receiver.send(message); }
        catch (RemoteException ignored) { }
    }
}
