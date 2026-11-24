package studio.nocturne.mobile;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.FeatureInfo;
import android.content.pm.PackageManager;
import android.opengl.EGL14;
import android.opengl.GLES20;
import android.os.Build;
import java.io.File;
import org.json.JSONException;
import org.json.JSONObject;

final class Hardware {
    static final long GIB = 1024L * 1024 * 1024;

    static ActivityManager.MemoryInfo memory(Context context) {
        var info = new ActivityManager.MemoryInfo();
        context.getSystemService(ActivityManager.class).getMemoryInfo(info);
        return info;
    }

    static boolean fits(long ram, int nominalGiB) {
        // Memory reserved by Android and firmware is excluded from totalMem.
        return ram >= (nominalGiB - 0.85) * GIB;
    }

    static int vulkanVersion(Context context) {
        for (FeatureInfo feature : context.getPackageManager().getSystemAvailableFeatures()) {
            if (PackageManager.FEATURE_VULKAN_HARDWARE_VERSION.equals(feature.name)) return feature.version;
        }
        return 0;
    }

    static boolean gpuEngine(Context context) {
        int version = vulkanVersion(context);
        int major = (version >>> 22) & 127;
        int minor = (version >>> 12) & 1023;
        return (major > 1 || (major == 1 && minor >= 2))
                && new File(context.getApplicationInfo().nativeLibraryDir, "libnocturne_vulkan.so").isFile();
    }

    static JSONObject read(Context context, File storage, String gpu) throws JSONException {
        var info = memory(context);
        String tier = fits(info.totalMem, 8) ? "power" : fits(info.totalMem, 6) ? "balanced" : "light";
        int vulkan = vulkanVersion(context);
        String chip = Build.VERSION.SDK_INT >= 31 && !Build.UNKNOWN.equals(Build.SOC_MODEL)
                ? Build.SOC_MODEL : Build.HARDWARE;
        return new JSONObject().put("device", Build.MANUFACTURER + " " + Build.MODEL)
                .put("chip", chip).put("gpu", gpu).put("android", Build.VERSION.RELEASE)
                .put("cores", Runtime.getRuntime().availableProcessors())
                .put("abi", String.join(", ", Build.SUPPORTED_ABIS))
                .put("ram", info.totalMem).put("available", info.availMem).put("lowMemory", info.lowMemory)
                .put("free", storage.getUsableSpace()).put("disk", storage.getTotalSpace())
                .put("vulkan", vulkan == 0 ? "" : ((vulkan >> 22) & 127) + "." + ((vulkan >> 12) & 1023))
                .put("tier", tier);
    }

    static String renderer() {
        var display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        if (display.equals(EGL14.EGL_NO_DISPLAY) || !EGL14.eglInitialize(display, null, 0, null, 0)) return "";
        var surface = EGL14.EGL_NO_SURFACE;
        var context = EGL14.EGL_NO_CONTEXT;
        try {
            var configs = new android.opengl.EGLConfig[1];
            var count = new int[1];
            int[] attributes = {EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                    EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE};
            if (!EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) || count[0] == 0) return "";
            context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT,
                    new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE}, 0);
            surface = EGL14.eglCreatePbufferSurface(display, configs[0],
                    new int[]{EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE}, 0);
            if (!EGL14.eglMakeCurrent(display, surface, surface, context)) return "";
            String result = GLES20.glGetString(GLES20.GL_RENDERER);
            return result == null ? "" : result;
        } finally {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            if (!surface.equals(EGL14.EGL_NO_SURFACE)) EGL14.eglDestroySurface(display, surface);
            if (!context.equals(EGL14.EGL_NO_CONTEXT)) EGL14.eglDestroyContext(display, context);
            EGL14.eglTerminate(display);
        }
    }
}
