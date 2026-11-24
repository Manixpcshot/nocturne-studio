#include <jni.h>
#include <android/log.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include "stable-diffusion.h"

namespace {
std::mutex activeMutex;
sd_ctx_t* activeContext = nullptr;
std::atomic<bool> cancelled{false};

struct JavaProgress {
    JavaVM* vm;
    jobject service;
    jmethodID report;
};

void reportProgress(const sd_generation_progress_t* event, void* userdata) {
    auto* target = static_cast<JavaProgress*>(userdata);
    JNIEnv* env = nullptr;
    const auto status = target->vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    const bool attach = status == JNI_EDETACHED;
    if (attach && target->vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
    if (!env) return;
    auto stage = env->NewStringUTF(event->stage ? event->stage : "");
    if (stage) {
        env->CallVoidMethod(target->service, target->report, stage,
                            static_cast<jlong>(event->completed), static_cast<jlong>(event->total));
        env->DeleteLocalRef(stage);
    }
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (attach) target->vm->DetachCurrentThread();
}

std::string utf8(JNIEnv* env, jbyteArray value) {
    std::string bytes(env->GetArrayLength(value), '\0');
    env->GetByteArrayRegion(value, 0, bytes.size(), reinterpret_cast<jbyte*>(bytes.data()));
    return bytes;
}

std::string nativeString(JNIEnv* env, jstring value) {
    const char* chars = value ? env->GetStringUTFChars(value, nullptr) : nullptr;
    if (!chars) return {};
    std::string text(chars);
    env->ReleaseStringUTFChars(value, chars);
    return text;
}

std::vector<float> turboSchedule(int steps) {
    // Both Turbo checkpoints use the SD scaled-linear beta schedule with trailing timesteps.
    constexpr int trainSteps = 1000;
    const double firstBetaRoot = std::sqrt(0.00085);
    const double lastBetaRoot = std::sqrt(0.012);
    std::vector<float> schedule(steps + 1, 0.0f);
    double alpha = 1.0;
    int index = steps - 1;
    for (int timestep = 0; timestep < trainSteps && index >= 0; timestep++) {
        const double root = firstBetaRoot + timestep * (lastBetaRoot - firstBetaRoot) / (trainSteps - 1);
        alpha *= 1.0 - root * root;
        const auto target = std::lround(trainSteps - index * trainSteps / static_cast<double>(steps)) - 1;
        if (timestep == target) schedule[index--] = std::sqrt((1.0 - alpha) / alpha);
    }
    return schedule;
}

void fail(JNIEnv* env, const char* fallback) {
    if (env->ExceptionCheck()) return;
    const char* error = sd_get_last_error();
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error && *error ? error : fallback);
}
} // namespace

extern "C" JNIEXPORT void JNICALL
Java_studio_nocturne_mobile_EngineService_prepareNative(JNIEnv*, jobject) {
    cancelled.store(false);
}

extern "C" JNIEXPORT void JNICALL
Java_studio_nocturne_mobile_EngineService_cancelNative(JNIEnv*, jobject) {
    cancelled.store(true);
    std::lock_guard<std::mutex> lock(activeMutex);
    if (activeContext) sd_cancel_generation(activeContext, SD_CANCEL_ALL);
}

extern "C" JNIEXPORT jintArray JNICALL
Java_studio_nocturne_mobile_EngineService_generateNative(
    JNIEnv* env, jobject service, jobjectArray keys, jobjectArray paths, jbyteArray prompt, jstring sampler,
    jstring engineMode, jint size, jint steps, jint seed, jint threads, jfloat cfg, jboolean turbo) {
    try {
        const auto text = utf8(env, prompt);
        const auto method = nativeString(env, sampler);
        const auto mode = nativeString(env, engineMode);
        if (env->ExceptionCheck()) return nullptr;
        sd_set_log_callback([](sd_log_level_t level, const char* message, void*) {
            if (level >= SD_LOG_WARN) __android_log_write(ANDROID_LOG_WARN, "NocturneEngine", message);
        }, nullptr);

        auto ok = [](sd_status_t status) { return status == SD_STATUS_OK; };
        std::unique_ptr<sd_opt_t, decltype(&sd_opt_free)> contextOptions(sd_ctx_opt_create(), sd_opt_free);
        if (!contextOptions) { fail(env, "Could not allocate the engine"); return nullptr; }
        const bool gpu = mode == "vulkan" || mode == "hybrid";
        if (gpu) {
            std::string devices(sd_list_devices(nullptr, 0) + 1, '\0');
            sd_list_devices(devices.data(), devices.size());
            if (devices.find("Vulkan0\t") == std::string::npos && devices.find("vulkan0\t") == std::string::npos) {
                fail(env, "The Vulkan driver did not expose a usable device");
                return nullptr;
            }
        }
        for (jsize i = 0; i < env->GetArrayLength(keys); i++) {
            auto key = static_cast<jstring>(env->GetObjectArrayElement(keys, i));
            auto path = static_cast<jstring>(env->GetObjectArrayElement(paths, i));
            const auto role = nativeString(env, key);
            const auto file = nativeString(env, path);
            env->DeleteLocalRef(key);
            env->DeleteLocalRef(path);
            if (file.empty() || !ok(sd_opt_set_string(contextOptions.get(), role.c_str(), file.c_str()))) {
                fail(env, "Invalid model component");
                return nullptr;
            }
        }
        const char* backend = mode == "hybrid" ? "diffusion=vulkan0,te=cpu,vae=cpu" : gpu ? "vulkan0" : "cpu";
        sd_ctx_t* rawContext = nullptr;
        if (!ok(sd_opt_set_string(contextOptions.get(), "backend", backend)) ||
            !ok(sd_opt_set_int(contextOptions.get(), "n_threads", threads)) ||
            !ok(sd_opt_set_bool(contextOptions.get(), "enable_mmap", true)) ||
            !ok(sd_ctx_create(contextOptions.get(), &rawContext))) {
            fail(env, "Could not open the model");
            return nullptr;
        }
        std::unique_ptr<sd_ctx_t, decltype(&sd_ctx_free)> context(rawContext, sd_ctx_free);
        std::unique_ptr<sd_opt_t, decltype(&sd_opt_free)> imageOptions(sd_img_gen_opt_create(), sd_opt_free);
        auto* options = imageOptions.get();
        if (!options ||
            !ok(sd_opt_set_string(options, "prompt", text.c_str())) ||
            !ok(sd_opt_set_int(options, "width", size)) ||
            !ok(sd_opt_set_int(options, "height", size)) ||
            !ok(sd_opt_set_int(options, "seed", seed)) ||
            !ok(sd_opt_set_int(options, "sample.steps", steps)) ||
            !ok(sd_opt_set_string(options, "sample.method", method.c_str())) ||
            !ok(sd_opt_set_float(options, "sample.guidance.txt_cfg", cfg)) ||
            !ok(sd_opt_set_bool(options, "vae_tiling.enabled", true))) {
            fail(env, "Could not set up image generation");
            return nullptr;
        }
        if (turbo) {
            const auto schedule = turboSchedule(steps);
            if (!ok(sd_opt_set_floats(options, "sample.sigmas", schedule.data(), schedule.size()))) {
                fail(env, "Could not set the Turbo schedule");
                return nullptr;
            }
        }

        JavaProgress progress{};
        env->GetJavaVM(&progress.vm);
        progress.service = env->NewGlobalRef(service);
        auto clazz = env->FindClass("studio/nocturne/mobile/EngineService");
        if (!clazz) { env->DeleteGlobalRef(progress.service); return nullptr; }
        progress.report = env->GetMethodID(clazz, "onNativeProgress", "(Ljava/lang/String;JJ)V");
        env->DeleteLocalRef(clazz);
        if (!progress.service || !progress.report) {
            if (progress.service) env->DeleteGlobalRef(progress.service);
            return nullptr;
        }
        sd_set_generation_progress_callback(context.get(), reportProgress, &progress);

        {
            std::lock_guard<std::mutex> lock(activeMutex);
            if (!cancelled.load()) activeContext = context.get();
        }
        sd_result_t* rawResult = nullptr;
        auto generated = cancelled.load() ? SD_STATUS_CANCELLED
                                          : sd_generate_image(context.get(), options, &rawResult);
        {
            std::lock_guard<std::mutex> lock(activeMutex);
            activeContext = nullptr;
        }
        env->DeleteGlobalRef(progress.service);
        std::unique_ptr<sd_result_t, decltype(&sd_result_free)> result(rawResult, sd_result_free);
        if (cancelled.load() || generated == SD_STATUS_CANCELLED) return nullptr;
        if (!ok(generated) || !result) {
            fail(env, "Image generation failed");
            return nullptr;
        }

        const auto* image = sd_result_get_image(result.get(), 0);
        if (!image || sd_tensor_rank(image) != 3 || sd_tensor_type(image) != SD_TENSOR_U8 ||
            sd_tensor_dim(image, 0) != 3 || sd_tensor_dim(image, 1) != size || sd_tensor_dim(image, 2) != size ||
            sd_tensor_byte_size(image) != static_cast<size_t>(size) * size * 3) {
            fail(env, "The engine returned an unexpected image");
            return nullptr;
        }
        const auto* rgb = static_cast<const unsigned char*>(sd_tensor_data(image));
        std::vector<jint> argb(size * size);
        unsigned char low[3] = {255, 255, 255};
        unsigned char high[3] = {};
        for (size_t i = 0; i < argb.size(); i++) {
            const auto* pixel = rgb + 3 * i;
            for (int channel = 0; channel < 3; channel++) {
                low[channel] = std::min(low[channel], pixel[channel]);
                high[channel] = std::max(high[channel], pixel[channel]);
            }
            argb[i] = static_cast<jint>(0xff000000u | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]);
        }
        if (high[0] - low[0] < 2 && high[1] - low[1] < 2 && high[2] - low[2] < 2) {
            fail(env, "The model returned a blank image. Try another model or prompt.");
            return nullptr;
        }
        auto output = env->NewIntArray(argb.size());
        if (output) env->SetIntArrayRegion(output, 0, argb.size(), argb.data());
        return output;
    } catch (const std::exception& error) {
        fail(env, error.what());
        return nullptr;
    }
}
