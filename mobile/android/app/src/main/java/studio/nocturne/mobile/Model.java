package studio.nocturne.mobile;

import android.os.Bundle;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

final class Model {
    private final JSONObject entry;
    private final List<Asset> assets = new ArrayList<>();

    Model(JSONObject entry) {
        this.entry = entry;
        var parts = entry.optJSONArray("parts");
        if (parts == null) assets.add(new Asset(entry, id() + ".gguf", "model_path"));
        else for (int i = 0; i < parts.length(); i++) {
            var part = parts.optJSONObject(i);
            if (part == null) throw new IllegalArgumentException("Invalid component");
            String role = part.optString("role");
            if (!role.matches("diffusion_model_path|llm_path|vae_path")) throw new IllegalArgumentException(role);
            String extension = part.optString("file").endsWith(".safetensors") ? ".safetensors" : ".gguf";
            assets.add(new Asset(part, id() + "-" + role + extension, role));
        }
        if (assets.isEmpty()) throw new IllegalArgumentException("Missing model files");
    }

    JSONObject entry() { return entry; }
    String id() { return entry.optString("id"); }
    boolean text() { return "text".equals(entry.optString("task")); }
    String name() { return entry.optString("name"); }
    int ram() { return entry.optInt("ram"); }
    int size() { return entry.optInt("size"); }
    int steps() { return entry.optInt("steps"); }
    String sampler() { return entry.optString("sampler", "euler"); }
    boolean turbo() { return entry.optBoolean("turbo"); }
    boolean fast() { return entry.optBoolean("fast"); }
    float cfg() { return (float) entry.optDouble("cfg", turbo() ? 1.0 : 7.0); }
    List<Asset> assets() { return assets; }
    long bytes() { return assets.stream().mapToLong(Asset::bytes).sum(); }
    long received(File directory) { return assets.stream().mapToLong(asset -> asset.received(directory)).sum(); }
    boolean installed(File directory) { return assets.stream().allMatch(asset -> asset.installed(directory)); }

    Bundle paths(File directory) {
        var result = new Bundle();
        for (Asset asset : assets) result.putString(asset.role, asset.ready(directory).getAbsolutePath());
        return result;
    }

    static final class Asset {
        private final JSONObject info;
        private final String filename;
        private final String role;

        Asset(JSONObject info, String filename, String role) {
            this.info = info;
            this.filename = filename;
            this.role = role;
            if (!filename.matches("[a-z0-9_.-]+") || bytes() <= 0 || !sha256().matches("[a-f0-9]{64}"))
                throw new IllegalArgumentException("Invalid model asset");
        }

        long bytes() { return info.optLong("bytes"); }
        String sha256() { return info.optString("sha256"); }
        String url() {
            return "https://huggingface.co/" + info.optString("repo") + "/resolve/"
                    + info.optString("revision") + "/" + info.optString("file") + "?download=true";
        }
        File ready(File directory) { return new File(directory, filename); }
        File partial(File directory) {
            // Keep the existing partial-file names for the models shipped in 0.1.
            return new File(directory, filename.substring(0, filename.lastIndexOf('.')) + ".part");
        }
        boolean installed(File directory) {
            File file = ready(directory);
            return file.isFile() && file.length() == bytes();
        }
        long received(File directory) {
            long partial = partial(directory).length();
            return installed(directory) ? bytes() : partial <= bytes() ? partial : 0;
        }
    }
}
