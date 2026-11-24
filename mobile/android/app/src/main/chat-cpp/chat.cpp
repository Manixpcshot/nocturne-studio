#include <jni.h>
#include <llama.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

static std::atomic<bool> cancelled{false};

extern "C" JNIEXPORT void JNICALL
Java_studio_nocturne_mobile_EngineService_prepareNative(JNIEnv *, jobject) {
    cancelled = false;
}

extern "C" JNIEXPORT void JNICALL
Java_studio_nocturne_mobile_EngineService_cancelNative(JNIEnv *, jobject) {
    cancelled = true;
}

static bool should_abort(void *) { return cancelled; }

static std::string reply(const char *path, const std::string &prompt, int threads) {
    static const bool initialized = [] { llama_backend_init(); return true; }();
    (void) initialized;
    auto model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    model_params.progress_callback = [](float, void *) { return !cancelled.load(); };
    const std::unique_ptr<llama_model, decltype(&llama_model_free)> model(
        llama_model_load_from_file(path, model_params), llama_model_free);
    if (!model || cancelled) return {};

    auto params = llama_context_default_params();
    params.n_ctx = 2048;
    params.n_batch = 256;
    params.n_threads = threads;
    params.n_threads_batch = threads;
    params.abort_callback = should_abort;
    const std::unique_ptr<llama_context, decltype(&llama_free)> context(
        llama_init_from_model(model.get(), params), llama_free);
    if (!context) return {};

    const char *chat_template = llama_model_chat_template(model.get(), nullptr);
    if (!chat_template) return {};
    const llama_chat_message message{"user", prompt.c_str()};
    const int length = llama_chat_apply_template(chat_template, &message, 1, true, nullptr, 0);
    if (length <= 0 || length > 32768) return {};
    std::string formatted(length + 1, '\0');
    if (llama_chat_apply_template(chat_template, &message, 1, true, formatted.data(), formatted.size()) != length) return {};
    const auto *vocab = llama_model_get_vocab(model.get());
    std::vector<llama_token> tokens(1792);
    const int count = llama_tokenize(vocab, formatted.data(), length, tokens.data(), tokens.size(), true, true);
    if (count <= 0) return {};
    for (int offset = 0; offset < count && !cancelled; offset += 256) {
        const int size = count - offset < 256 ? count - offset : 256;
        if (llama_decode(context.get(), llama_batch_get_one(tokens.data() + offset, size)) != 0) return {};
    }

    const std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
        llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_min_p(0.05f, 1));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(0.7f));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    std::string answer;
    for (int i = 0; i < 256 && !cancelled; ++i) {
        llama_token token = llama_sampler_sample(sampler.get(), context.get(), -1);
        if (llama_vocab_is_eog(vocab, token)) break;
        std::vector<char> piece(256);
        int size = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
        if (size < 0) {
            piece.resize(-size);
            size = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
        }
        if (size < 0) return {};
        answer.append(piece.data(), size);
        if (i < 255 && llama_decode(context.get(), llama_batch_get_one(&token, 1)) != 0) return {};
    }
    return cancelled ? std::string() : answer;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_studio_nocturne_mobile_EngineService_chatNative(
        JNIEnv *env, jobject, jstring source, jbyteArray input, jint threads) {
    if (!source || !input) return nullptr;
    const char *path = env->GetStringUTFChars(source, nullptr);
    if (!path) return nullptr;
    std::string answer;
    try {
        std::string prompt(env->GetArrayLength(input), '\0');
        env->GetByteArrayRegion(input, 0, prompt.size(), reinterpret_cast<jbyte *>(prompt.data()));
        if (!env->ExceptionCheck()) answer = reply(path, prompt, threads);
    } catch (const std::exception &) {
        answer.clear();
    }
    env->ReleaseStringUTFChars(source, path);
    if (answer.empty()) return nullptr;
    jbyteArray bytes = env->NewByteArray(answer.size());
    if (bytes) env->SetByteArrayRegion(bytes, 0, answer.size(), reinterpret_cast<const jbyte *>(answer.data()));
    return bytes;
}
