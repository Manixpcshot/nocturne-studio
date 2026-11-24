package studio.nocturne.mobile;

import android.os.SystemClock;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

final class ModelDownload {
    interface Events {
        void update(String phase, long received, long bytesPerSecond, int component);
    }

    private static final long RESERVED = 192L * 1024 * 1024;
    private static final Pattern RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)");

    static final class Control {
        private final AtomicBoolean paused = new AtomicBoolean();
        private final AtomicReference<HttpURLConnection> active = new AtomicReference<>();

        boolean paused() { return paused.get(); }

        void pause() {
            if (!paused.compareAndSet(false, true)) return;
            var connection = active.getAndSet(null);
            // A provider may block while closing its stream. Keep that work off the UI thread.
            if (connection != null) new Thread(connection::disconnect, "Nocturne pause").start();
        }

        boolean track(HttpURLConnection connection) {
            active.set(connection);
            return !paused();
        }

        void close(HttpURLConnection connection) {
            if (active.compareAndSet(connection, null)) connection.disconnect();
        }
    }

    static long requiredSpace(long bytes, long received) {
        return Math.max(0, bytes - received) + RESERVED;
    }

    static void run(Model model, File dir, Events events, Control control) throws Exception {
        if (control.paused()) return;
        if (dir.getUsableSpace() < requiredSpace(model.bytes(), model.received(dir))) throw new IOException("disk");
        long complete = 0;
        int index = 0;
        for (Model.Asset asset : model.assets()) {
            index++;
            if (control.paused()) return;
            if (!asset.installed(dir)) {
                final long offset = complete;
                final int component = index;
                install(asset, dir, (phase, received, rate, unused) ->
                        events.update(phase, offset + received, rate, component), control);
            }
            complete += asset.bytes();
        }
    }

    private static void install(Model.Asset model, File dir, Events events, Control control) throws Exception {
        File part = model.partial(dir);
        if (part.length() > model.bytes()) Files.delete(part.toPath());

        int attempt = 0;
        while (!control.paused() && part.length() < model.bytes()) {
            try {
                transfer(model, part, events, control);
                attempt = 0;
            } catch (IOException failure) {
                if (control.paused()) return;
                if (dir.getUsableSpace() < RESERVED) throw new Permanent("disk");
                if (failure instanceof Permanent || ++attempt >= 4) throw failure;
                events.update("retrying", part.length(), 0, 0);
                long delay = 1000L << attempt;
                for (long elapsed = 0; elapsed < delay && !control.paused(); elapsed += 200) Thread.sleep(200);
            }
        }
        if (control.paused()) return;
        events.update("verifying", part.length(), 0, 0);
        var sha = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[512 * 1024];
        try (var input = new FileInputStream(part)) {
            int count;
            while (!control.paused() && (count = input.read(buffer)) != -1) sha.update(buffer, 0, count);
        }
        if (control.paused()) return;

        var actual = new StringBuilder();
        for (byte value : sha.digest()) {
            actual.append(Character.forDigit((value >>> 4) & 15, 16));
            actual.append(Character.forDigit(value & 15, 16));
        }
        if (!model.sha256().contentEquals(actual)) {
            Files.deleteIfExists(part.toPath());
            throw new Permanent("checksum");
        }
        Files.move(part.toPath(), model.ready(dir).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private static void transfer(Model.Asset model, File part, Events events, Control control) throws IOException {
        long offset = part.length();
        var connection = (HttpURLConnection) new URL(model.url()).openConnection();
        try {
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
            if (!control.track(connection)) return;
            int status = connection.getResponseCode();
            long end = model.bytes();
            if (status == 206) {
                String header = connection.getHeaderField("Content-Range");
                var range = RANGE.matcher(header == null ? "" : header);
                if (!range.matches() || Long.parseLong(range.group(1)) != offset
                        || Long.parseLong(range.group(3)) != model.bytes()) throw new Permanent("range");
                long lastByte = Long.parseLong(range.group(2));
                if (lastByte < offset || lastByte >= model.bytes()) throw new Permanent("range");
                end = lastByte + 1;
            } else if (status == 200 && offset == 0) {
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != model.bytes()) throw new Permanent("size");
            } else {
                // Keep the prefix even if the server currently ignores the Range request.
                if (status == 200 || status == 416) throw new Permanent("range");
                if (status == 401 || status == 403 || status == 404) throw new Permanent("http" + status);
                throw new IOException("http" + status);
            }
            events.update("downloading", offset, 0, 0);
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                    RandomAccessFile output = new RandomAccessFile(part, "rw")) {
                output.seek(offset);
                byte[] buffer = new byte[256 * 1024];
                long current = offset;
                long lastBytes = offset;
                long lastTime = SystemClock.elapsedRealtime();
                while (!control.paused() && current < end) {
                    int count = input.read(buffer, 0, (int) Math.min(buffer.length, end - current));
                    if (count < 0) throw new IOException("network");
                    output.write(buffer, 0, count);
                    current += count;
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastTime >= 350) {
                        events.update("downloading", current, (current - lastBytes) * 1000 / (now - lastTime), 0);
                        lastBytes = current;
                        lastTime = now;
                    }
                }
                output.getFD().sync();
            }
        } finally {
            control.close(connection);
        }
    }

    private static final class Permanent extends IOException {
        Permanent(String code) { super(code); }
    }
}
