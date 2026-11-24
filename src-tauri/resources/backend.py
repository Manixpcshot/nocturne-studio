import base64
import contextlib
import gc
import hashlib
import io
import importlib.util
import importlib.metadata
import inspect
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import zipfile
import wave
import socket
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import tempfile
import atexit
from functools import lru_cache
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "45")

import requests
from huggingface_hub import HfApi, get_token, hf_hub_download, hf_hub_url, scan_cache_dir
from PIL import Image, ImageOps

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_MODEL = "Lykon/dreamshaper-8"
FEATURED_LORA = "chatrlabs/Qwen-Image-2.1-Uncensored-Omni-LoRA-v0.1"
SUPPORTED_VIDEO_CLASSES = {
    "CogVideoXPipeline", "WanPipeline", "LTXPipeline", "MochiPipeline",
    "HunyuanVideoPipeline", "AllegroPipeline", "HunyuanVideo15Pipeline",
    "LTX2Pipeline", "CosmosTextToWorldPipeline", "Cosmos2_5_PredictBasePipeline",
}
OUTPUT_DIR = Path(os.environ.get("NOCTURNE_IMAGES_DIR", "generated_images"))
TEMP_IMAGES = Path(tempfile.mkdtemp(prefix="nocturne-images-"))
atexit.register(lambda: shutil.rmtree(TEMP_IMAGES, ignore_errors=True))
WEB_LOCK = threading.RLock()
WEB_SERVER = None
WEB_THREAD = None
WEB_PUBLIC_IP = ""
WEB_TUNNEL = None
WEB_TUNNEL_URL = ""
WEB_TUNNEL_CONNECTED = False
WEB_TUNNEL_ERROR = ""
WEB_SESSIONS = {}
WEB_LOGIN_ATTEMPTS = {}
ORIGINAL_HF_HOME = Path(os.environ.get("NOCTURNE_ORIGINAL_HF_HOME", str(Path.home() / ".cache/huggingface")))
MODEL_HOME = Path(os.environ.get("HF_HOME", str(ORIGINAL_HF_HOME)))
WEB_CONFIG = Path(os.environ.get("NOCTURNE_APP_DIR", str(MODEL_HOME))) / ".nocturne-web-users.json"
APP_DIR = WEB_CONFIG.parent
MODEL_CACHE = MODEL_HOME / "hub"
SDCPP_ROOT = MODEL_HOME / "nocturne-sdcpp"
CHECKPOINT_ROOT = MODEL_HOME / "nocturne-checkpoints"
SDCPP_RELEASE = "master-1050-58bb3c1"
SDCPP_ASSETS = {
    "cpu": [("sd-master-58bb3c1-bin-win-cpu-x64.zip", 18097818,
             "b1d1384e9e6434dff9b59d2f2969c5fcfde8cfd4ecf3f3e43aa811899452f161")],
    "cuda": [("sd-master-58bb3c1-bin-win-cuda12-x64.zip", 362112011,
              "2767f24655b7bbd1290f7cb307e05c988cda388108b7d83b502cf95276df3b50"),
             ("cudart-sd-bin-win-cu12-x64.zip", 563452046,
              "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d")],
}
FLUX2_MODELS = {
    "city96/FLUX.2-dev-gguf": "flux2_dev",
    "leejet/FLUX.2-klein-4B-GGUF": "flux2_klein_4b",
    "leejet/FLUX.2-klein-base-4B-GGUF": "flux2_base_4b",
    "leejet/FLUX.2-klein-9B-GGUF": "flux2_klein_9b",
    "leejet/FLUX.2-klein-base-9B-GGUF": "flux2_base_9b",
}
SDCPP_EDIT_RECIPES = {"flux_kontext", *FLUX2_MODELS.values()}
SDCPP_RECIPES = {
    **FLUX2_MODELS,
    "QuantStack/FLUX.1-Kontext-dev-GGUF": "flux_kontext",
    "city96/FLUX.1-schnell-gguf": "flux_schnell",
    "city96/FLUX.1-dev-gguf": "flux_dev",
    "leejet/FLUX.1-schnell-gguf": "flux_schnell",
    "leejet/FLUX.1-dev-gguf": "flux_dev",
    "AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF": "qwen_encoder",
    "TechnoBaptist/Qwen-Image-2.1-Turbo-Uncensored-GGUF": "qwen_encoder",
    "Noctaluna/Noct-Q-Uncensored-Qwen-Image-2.1": "qwen_denoiser",
    "Noctaluna/Noct-Q-Anime-Uncensored-Qwen-Image-2.1": "qwen_denoiser",
    "KasugaiSakura/Qwen-Image-2.1-Uncensored-Abenzerps-GGUF": "qwen_gguf",
    "Quiho/Krea2_NSFW_Uncensored_Complete": "krea_complete",
    "Noctaluna/Krea2-Noct-Uncensored": "krea_denoiser",
}
pipe = None
active_model = None
active_kind = "image"
loaded_pipelines = {}
keep_loaded = False
selected_device = "cuda:0"
translator = None
translator_tokenizer = None
tts_loaded = {}
translation_cache = {}
progress_lock = threading.Lock()


def emit_event(event, data):
    with progress_lock:
        print(json.dumps({"event": event, "data": data}, ensure_ascii=False), file=sys.__stdout__, flush=True)


TRANSFER_LIMIT = threading.local()


def emit_progress(data):
    if data.get("phase") == "retrying":
        data.setdefault("retry_in", min(max(1, data.get("attempt", 2) - 1) * 3, 20))
    if getattr(TRANSFER_LIMIT, "job_id", None):
        data["job_id"] = TRANSFER_LIMIT.job_id
    emit_event("download-progress", data)


MINIMAX_IMAGE_CLASS = "MiniMaxH3ImageModularPipeline"
MINIMAX_IMAGE_BLOCKS = "MiniMaxH3ImageBlocks"
MINIMAX_DIFFUSERS = "0.43.0"


def is_minimax_image(config):
    return isinstance(config, dict) and config.get("_class_name") == MINIMAX_IMAGE_CLASS and config.get("_blocks_class_name") == MINIMAX_IMAGE_BLOCKS


def component_folders(config):
    parts = {}
    modular = is_minimax_image(config)
    for key, value in config.items():
        if key.startswith("_") or not isinstance(value, list) or len(value) < 2 or not all(isinstance(item, str) for item in value[:2]):
            continue
        name = (value[2].get("subfolder") or key) if modular and len(value) > 2 and isinstance(value[2], dict) else key
        if modular and (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_]+", name)):
            raise ValueError("Invalid modular component folder.")
        parts[name] = value
    return parts


def all_minimax_shards_present(folder, parts):
    for name, _ in parts:
        for index in (folder / name).glob("*.safetensors.index.json"):
            shards = json.loads(index.read_text(encoding="utf-8")).get("weight_map", {}).values()
            if not shards or not all(Path(shard).name == shard and (index.parent / shard).is_file() for shard in shards):
                return False
    return True


def local_pipeline_index(root):
    modular = root / "modular_model_index.json"
    if modular.is_file() and is_minimax_image(json.loads(modular.read_text(encoding="utf-8"))):
        return modular
    standard = root / "model_index.json"
    return standard if standard.is_file() else root / "merged-model" / "model_index.json"


def remote_pipeline_index(model_id, names, revision):
    if "modular_model_index.json" in names:
        path = hf_hub_download(model_id, "modular_model_index.json", revision=revision, cache_dir=MODEL_CACHE, etag_timeout=20)
        if is_minimax_image(json.loads(Path(path).read_text(encoding="utf-8"))):
            return "modular_model_index.json", path
    index = "model_index.json" if "model_index.json" in names else "merged-model/model_index.json"
    if index not in names:
        raise RuntimeError("No supported pipeline index was found.")
    return index, hf_hub_download(model_id, index, revision=revision, cache_dir=MODEL_CACHE, etag_timeout=20)


def minimax_engine_ready(diffusers):
    from packaging.version import Version
    return Version(diffusers.__version__) >= Version(MINIMAX_DIFFUSERS) and all(
        hasattr(diffusers, name) for name in ("ModularPipeline", "ComponentsManager", "MiniMaxH3ImageTransformer2DModel")
    )


class MiniMaxImageEngine:
    def __init__(self, folder, device):
        import torch
        import diffusers
        if not minimax_engine_ready(diffusers):
            raise RuntimeError(f"MiniMax H3 Image needs Diffusers {MINIMAX_DIFFUSERS} or newer. Update the engine in Model Library.")
        self.manager = diffusers.ComponentsManager()
        if device.startswith("cuda"):
            self.manager.enable_auto_cpu_offload(device=device)
        self.pipeline = diffusers.ModularPipeline.from_pretrained(
            folder, components_manager=self.manager, local_files_only=True, trust_remote_code=False)
        self.pipeline.load_components(dtype=torch.bfloat16, pretrained_model_name_or_path=folder, local_files_only=True)

    def __call__(self, prompt, height, width, image=None):
        options = {"image": image} if image is not None else {}
        images = self.pipeline(prompt=prompt, height=height, width=width, output="images", **options)
        return SimpleNamespace(images=images)


def complete_models(kind=None):
    def complete_component(folder, key, value):
        part = folder / key
        if not part.is_dir():
            return False
        name = str(value[1]).lower() if len(value) > 1 else ""
        if any(x in name for x in ("tokenizer", "scheduler", "processor", "extractor", "guidance", "guider")):
            return any(part.iterdir())
        return any(p.is_file() and p.suffix in (".safetensors", ".bin") for p in part.rglob("*"))

    result = {}
    caches = []
    for folder in (ORIGINAL_HF_HOME / "hub", MODEL_CACHE):
        if folder not in caches and folder.is_dir():
            caches.append(folder)
    for repo in (repo for folder in caches for repo in scan_cache_dir(cache_dir=folder).repos):
        if repo.repo_type != "model":
            continue
        for revision in repo.revisions:
            root = revision.snapshot_path
            try:
                index = local_pipeline_index(root)
                if not index.is_file():
                    continue
                folder = index.parent
                config = json.loads(index.read_text(encoding="utf-8"))
                if config.get("_class_name") == "MiniMaxH3ImagePipeline":
                    continue
                parts = [(key, value) for key, value in component_folders(config).items() if key != "safety_checker"]
                if index.name == "modular_model_index.json" and not all_minimax_shards_present(folder, parts):
                    continue
                if parts and all(complete_component(folder, k, v) for k, v in parts):
                    model_kind = model_type(config.get("_class_name", ""))
                    if (kind is None or kind == model_kind) and (model_kind != "video" or config.get("_class_name") in SUPPORTED_VIDEO_CLASSES):
                        result[repo.repo_id] = str(folder)
            except (OSError, ValueError, TypeError):
                pass
    return result


def downloaded_adapters():
    result = {}
    for cache in (ORIGINAL_HF_HOME / "hub", MODEL_CACHE):
        if not cache.is_dir():
            continue
        for repo in scan_cache_dir(cache_dir=cache).repos:
            if repo.repo_type != "model":
                continue
            for revision in repo.revisions:
                folder = revision.snapshot_path
                if (folder / "model_index.json").exists():
                    continue
                weights = list(folder.glob("*.safetensors"))
                if weights and "lora" in repo.repo_id.lower():
                    result[repo.repo_id] = str(folder)
    return result


def sdcpp_models():
    result = {}
    root = SDCPP_ROOT / "models"
    if not root.is_dir():
        return result
    for manifest in root.glob("*/manifest.json"):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            valid_weights = all(Path(path).is_file() and Path(path).stat().st_size == data["sizes"][role]
                                for role, path in data["weights"].items())
            if valid_weights and Path(data["engine"]).is_file() and (Path(data["engine"]).parent / ".ready").is_file():
                result[data["id"]] = data
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return result


def checkpoint_models():
    result = {}
    if not CHECKPOINT_ROOT.is_dir():
        return result
    for manifest in CHECKPOINT_ROOT.glob("*/manifest.json"):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            path = Path(data["file"])
            if path.is_file() and path.stat().st_size == data["size"] and data["family"] in ("sd", "sdxl"):
                result[data["id"]] = data
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return result


def checkpoint_candidate(info):
    if bool(info.gated):
        return None
    label = " ".join((info.id, " ".join(info.tags or []))).lower()
    family = "sdxl" if any(word in label for word in ("sdxl", "sd-xl", "stable-diffusion-xl", "juggernaut-xl")) else (
        "sd" if any(word in label for word in ("stable-diffusion-v1", "stable-diffusion-1", "sd-1.5", "sd15")) else None)
    if not family or "lora" in label:
        return None
    candidates = [s for s in info.siblings or [] if "/" not in s.rfilename and
                  s.rfilename.lower().endswith(".safetensors") and (s.size or 0) >= 1024**3 and
                  not any(word in s.rfilename.lower() for word in ("lora", "vae", "unet", "text_encoder", "refiner"))]
    return max(candidates, key=lambda s: s.size or 0) if candidates else None


def model_type(class_name):
    name = class_name.lower()
    return "video" if class_name in SUPPORTED_VIDEO_CLASSES or any(x in name for x in ("video", "cogvideo", "wanpipeline", "ltxpipeline", "mochipipeline", "allegropipeline", "texttoworld", "predictbase")) else "image"


def project_id(value):
    if value and (not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value)):
        raise ValueError("Invalid project identifier.")
    return value or ""


def image_context(payload):
    result = {"project_id": project_id(payload.get("project_id"))}
    parent = payload.get("parent_image")
    if isinstance(parent, str) and parent == Path(parent).name and parent.lower().endswith(".png"):
        result["parent_image"] = parent
    return result


def project_reference(id_, image=None, reference_id="", name=""):
    id_ = project_id(id_)
    if not id_:
        raise ValueError("Select a project first.")
    references = APP_DIR / "project-references" / id_
    if image is not None:
        header, separator, encoded = image.partition(",")
        if not separator or header not in ("data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64") or len(encoded) > 28 * 1024**2:
            raise ValueError("Use a PNG, JPEG or WebP file up to 20 MB.")
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 20 * 1024**2:
            raise ValueError("The reference file exceeds 20 MB.")
        with Image.open(io.BytesIO(raw)) as ref:
            if ref.format not in ("PNG", "JPEG", "WEBP"):
                raise ValueError("The reference image format is not supported.")
            ref.load()
        key = hashlib.sha256(raw).hexdigest()[:32]
        references.mkdir(parents=True, exist_ok=True)
        path = references / (key + ".image")
        temp = path.with_suffix(".part")
        temp.write_bytes(image.encode("ascii"))
        temp.replace(path)
        label = Path(str(name)).name[:160] or key
        label_path = references / (key + ".txt")
        label_part = label_path.with_suffix(".label-part")
        label_part.write_text(label, encoding="utf-8")
        label_part.replace(label_path)
        return {"id": key, "name": label}
    if reference_id:
        path = references / (project_id(reference_id) + ".image")
        return {"image": path.read_text(encoding="ascii")}
    items = []
    for label in references.glob("*.txt"):
        if label.with_suffix(".image").is_file():
            items.append({"id": label.stem, "name": label.read_text(encoding="utf-8")})
    return {"references": sorted(items, key=lambda item: item["name"].casefold())}


def gallery():
    if not OUTPUT_DIR.exists():
        return []
    items = []
    for path in sorted(OUTPUT_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            metadata = {}
            metadata_file = path.with_suffix(".json")
            if metadata_file.is_file():
                try:
                    value = json.loads(metadata_file.read_text(encoding="utf-8"))
                    metadata = value if isinstance(value, dict) else {}
                except (OSError, ValueError):
                    pass
            with Image.open(path) as image:
                image.thumbnail((240, 240))
                buffer = io.BytesIO()
                image.save(buffer, "JPEG", quality=74)
            items.append({"name": path.name, "thumbnail": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode(),
                          "date": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                          "prompt": metadata.get("prompt", ""), "original_prompt": metadata.get("original_prompt", ""),
                          "model": metadata.get("model", ""), "aspect_ratio": metadata.get("aspect_ratio"),
                          "project_id": metadata.get("project_id", ""), "parent_image": metadata.get("parent_image", ""),
                          "mode": metadata.get("mode"), "strength": metadata.get("strength")})
        except OSError:
            pass
    return items


def image_data(name):
    path = OUTPUT_DIR / Path(name).name
    if not path.is_file():
        raise FileNotFoundError("عکس پیدا نشد")
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def save_temporary_image(name):
    source = TEMP_IMAGES / Path(name).name
    if not source.is_file():
        raise FileNotFoundError("عکس موقت پیدا نشد؛ شاید برنامه بسته شده باشد.")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_DIR / source.name
    shutil.copy2(source, target)
    metadata = source.with_suffix(".json")
    if metadata.is_file():
        shutil.copy2(metadata, target.with_suffix(".json"))
    return {"name": target.name}


def translate_prompt(text, torch):
    global translator, translator_tokenizer
    if not re.search(r"[\u0600-\u06FF]", text):
        return text, False
    if text in translation_cache:
        return translation_cache[text], False
    try:
        from deep_translator import GoogleTranslator
        translated = GoogleTranslator(source="auto", target="en").translate(text)
        if translated and translated.strip():
            translation_cache[text] = translated.strip()
            return translated.strip(), False
    except Exception:
        pass
    try:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        model_id = "facebook/nllb-200-distilled-600M"
        if translator is None:
            translator_tokenizer = AutoTokenizer.from_pretrained(model_id, src_lang="pes_Arab", local_files_only=True)
            translator = AutoModelForSeq2SeqLM.from_pretrained(model_id, local_files_only=True).to("cpu")
        inputs = translator_tokenizer(text, return_tensors="pt", truncation=True)
        with torch.inference_mode():
            tokens = translator.generate(**inputs, forced_bos_token_id=translator_tokenizer.convert_tokens_to_ids("eng_Latn"), max_new_tokens=128)
        translated = translator_tokenizer.batch_decode(tokens, skip_special_tokens=True)[0]
        translation_cache[text] = translated
        return translated, False
    except Exception:
        return text, True


def devices():
    import torch
    return [{"id": "cpu", "name": "پردازندهٔ اصلی (CPU)"}] + [
        {"id": f"cuda:{index}", "name": torch.cuda.get_device_name(index)}
        for index in range(torch.cuda.device_count())
    ]


def choose_device(device):
    global selected_device, pipe, active_model
    if device not in {item["id"] for item in devices()}:
        raise RuntimeError("این پردازنده در دسترس نیست.")
    if device != selected_device:
        pipe = None
        active_model = None
        loaded_pipelines.clear()
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    selected_device = device
    return {"device": selected_device}


def loaded_models():
    return [{"id": model_id, "kind": kind, "active": model_id == active_model and kind == active_kind}
            for kind, model_id in loaded_pipelines]


def set_cache_mode(enabled):
    global keep_loaded
    keep_loaded = bool(enabled)
    if not keep_loaded:
        for key in list(loaded_pipelines):
            if key != (active_kind, active_model):
                del loaded_pipelines[key]
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    return {"enabled": keep_loaded, "loaded_models": loaded_models()}


def unload_model(model_id, kind="image"):
    global pipe, active_model
    key = (kind, model_id)
    if key == (active_kind, active_model):
        pipe = None
        active_model = None
    loaded_pipelines.pop(key, None)
    gc.collect()
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"active": active_model, "loaded_models": loaded_models()}


def ensure_package(package, module):
    def installed():
        try:
            return importlib.util.find_spec(module) is not None
        except ModuleNotFoundError:
            return False

    if installed():
        return
    for index in (None, "https://pypi.tuna.tsinghua.edu.cn/simple"):
        command = [sys.executable, "-m", "pip", "install", "--timeout", "20", "--retries", "0"]
        if index:
            command.extend(["--index-url", index])
        command.append(package)
        subprocess.run(command, stdout=sys.stderr, stderr=sys.stderr, check=False)
        importlib.invalidate_caches()
        if installed():
            return
    raise RuntimeError(f"نصب {package} ناموفق بود. این دستور را اجرا کنید: \"{sys.executable}\" -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple {package}")


def pretrained_options(model_folder, model_id, dtype):
    folder = Path(model_folder)
    options = {"torch_dtype": dtype, "local_files_only": True}
    if model_id == DEFAULT_MODEL:
        options["safety_checker"] = None
    config = json.loads((folder / "model_index.json").read_text(encoding="utf-8"))
    weight_names = []
    for part, value in component_folders(config).items():
        if part.startswith("_") or not isinstance(value, list) or not value or value[0] is None:
            continue
        component = folder / part
        if component.is_dir():
            weight_names.extend(p.name for p in component.glob("*")
                                if p.is_file() and p.suffix in (".safetensors", ".bin"))
    if weight_names and all(re.search(r"\.fp16(?:\.|-)", name) for name in weight_names):
        options["variant"] = "fp16"
    return options


def requires_sdnq(folder):
    folder = Path(folder)
    for file in [folder / "config.json", *folder.glob("*/config.json")]:
        if not file.is_file():
            continue
        try:
            config = json.loads(file.read_text(encoding="utf-8"))
            quant = config.get("quantization_config") or {}
            if isinstance(quant, dict) and str(quant.get("quant_method", "")).lower() == "sdnq":
                return True
        except (OSError, ValueError):
            continue
    return False


def load_model(model_id, kind="image"):
    global pipe, active_model, active_kind
    if kind == "sdcpp":
        installed = sdcpp_models().get(model_id)
        if not installed:
            raise RuntimeError("مدل و موتور آن کامل نصب نشده‌اند.")
        if installed["device"].split(":")[0] != selected_device.split(":")[0]:
            raise RuntimeError("این مدل برای دستگاه دیگری نصب شده است؛ از بخش جست‌وجو نصب را برای دستگاه فعلی ادامه دهید.")
        if pipe is not None:
            old_key = (active_kind, active_model)
            if isinstance(pipe, MiniMaxImageEngine):
                loaded_pipelines.pop(old_key, None)
            elif keep_loaded and active_kind in ("image", "checkpoint") and selected_device.startswith("cuda"):
                pipe.to("cpu")
            elif not keep_loaded:
                loaded_pipelines.pop(old_key, None)
            pipe = None
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        active_model = model_id
        active_kind = "sdcpp"
        return {"model": model_id, "device": selected_device, "kind": "sdcpp", "loaded_models": loaded_models()}
    import torch
    key = (kind, model_id)
    if key == (active_kind, active_model) and pipe is not None:
        return {"model": model_id, "device": selected_device, "kind": kind, "loaded_models": loaded_models()}
    if key not in loaded_pipelines:
        models = checkpoint_models() if kind == "checkpoint" else complete_models(kind)
        if model_id not in models:
            raise RuntimeError("این مدل کامل دانلود نشده است.")
        if kind != "checkpoint" and requires_sdnq(models[model_id]):
            from packaging.version import Version
            try:
                ready = Version(importlib.metadata.version("sdnq")) >= Version("0.2.2")
            except importlib.metadata.PackageNotFoundError:
                ready = False
            if not ready:
                raise RuntimeError("این مدل به SDNQ>=0.2.2 نیاز دارد. برنامه را کامل ببندید و نسخهٔ تازه را باز کنید تا راه‌اندازی اولیه آن را در Python برنامه نصب کند.")
    from diffusers import DiffusionPipeline
    if kind == "video" and key not in loaded_pipelines:
        ensure_package("protobuf", "google.protobuf")
        ensure_package("tiktoken", "tiktoken")
    if pipe is not None:
        old_key = (active_kind, active_model)
        old_is_modular = isinstance(pipe, MiniMaxImageEngine)
        if old_is_modular:
            loaded_pipelines.pop(old_key, None)
        elif keep_loaded:
            if active_kind in ("image", "checkpoint") and selected_device.startswith("cuda"):
                with contextlib.redirect_stdout(sys.stderr):
                    pipe.to("cpu")
        else:
            loaded_pipelines.pop(old_key, None)
        pipe = None
        active_model = None
        if not keep_loaded or old_is_modular:
            gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    if key in loaded_pipelines:
        loaded = loaded_pipelines[key]
        if kind in ("image", "checkpoint") and selected_device.startswith("cuda") and not isinstance(loaded, MiniMaxImageEngine) and "flux" not in type(loaded).__name__.lower():
            with contextlib.redirect_stdout(sys.stderr):
                loaded = loaded.to(selected_device)
    else:
        dtype = torch.float32 if selected_device == "cpu" else (torch.bfloat16 if any(x in model_id.lower() for x in ("z-image", "flux", "wan", "ltx", "mochi", "hunyuan", "qwen-image", "cosmos")) else torch.float16)
        with contextlib.redirect_stdout(sys.stderr):
            if kind == "checkpoint":
                from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline
                manifest = models[model_id]
                pipeline_class = StableDiffusionXLPipeline if manifest["family"] == "sdxl" else StableDiffusionPipeline
                loaded = pipeline_class.from_single_file(manifest["file"], torch_dtype=dtype)
            elif local_pipeline_index(Path(models[model_id])).name == "modular_model_index.json":
                loaded = MiniMaxImageEngine(models[model_id], selected_device)
            else:
                options = pretrained_options(models[model_id], model_id, dtype)
                loaded = DiffusionPipeline.from_pretrained(models[model_id], **options)
            if not isinstance(loaded, MiniMaxImageEngine):
                if (kind == "video" or "flux" in type(loaded).__name__.lower()) and selected_device.startswith("cuda") and hasattr(loaded, "enable_model_cpu_offload"):
                    loaded.enable_model_cpu_offload(gpu_id=int(selected_device.split(":")[1]))
                else:
                    loaded = loaded.to(selected_device)
        if hasattr(loaded, "enable_vae_slicing"):
            loaded.enable_vae_slicing()
        if kind == "video" and hasattr(loaded, "vae") and hasattr(loaded.vae, "enable_tiling"):
            loaded.vae.enable_tiling()
        loaded_pipelines[key] = loaded
    pipe = loaded
    active_model = model_id
    active_kind = kind
    return {"model": model_id, "device": selected_device, "kind": kind, "loaded_models": loaded_models()}


ASPECT_RATIOS = {"1:1": (1, 1), "16:9": (16, 9), "9:16": (9, 16),
                 "4:3": (4, 3), "3:4": (3, 4), "3:2": (3, 2), "2:3": (2, 3)}


def aspect_dimensions(aspect_ratio, base):
    if aspect_ratio not in ASPECT_RATIOS:
        raise RuntimeError("نسبت تصویر نامعتبر است.")
    wide, high = ASPECT_RATIOS[aspect_ratio]
    width = max(256, round(base * (wide / high) ** .5 / 64) * 64)
    height = max(256, round(base * (high / wide) ** .5 / 64) * 64)
    return width, height


def image_settings(pipeline, model_id, aspect_ratio="1:1"):
    name = type(pipeline).__name__.lower()
    if isinstance(pipeline, MiniMaxImageEngine):
        settings = dict(width=1024, height=1024)
    elif "flux2" in name:
        quick = "klein" in name and "base" not in model_id.lower()
        settings = dict(num_inference_steps=4 if quick else 24, guidance_scale=1.0 if quick else 4.0, width=1024, height=1024)
    elif "fluxfill" in name or "fluxcontrol" in name:
        settings = dict(num_inference_steps=35, guidance_scale=30.0, width=1024, height=1024)
    elif "kontext" in name:
        settings = dict(num_inference_steps=28, guidance_scale=2.5, width=768, height=768)
    elif "zimage" in name:
        settings = dict(num_inference_steps=9, guidance_scale=0.0, width=768, height=768)
    elif "flux" in name:
        schnell = "schnell" in model_id.lower() or "turbo" in model_id.lower()
        settings = dict(num_inference_steps=4 if schnell else 28, guidance_scale=0.0 if schnell else 3.5, width=768, height=768)
    elif "qwenimage21" in name:
        settings = dict(num_inference_steps=40, true_cfg_scale=1.0, width=1024, height=1024)
    elif "qwenimage" in name:
        settings = dict(num_inference_steps=30, true_cfg_scale=4.0, width=1024, height=1024)
    elif "stablediffusion3" in name:
        settings = dict(num_inference_steps=28, guidance_scale=7.0, width=1024, height=1024)
    elif "sana" in name or "cosmos2texttoimage" in name:
        settings = dict(num_inference_steps=25, guidance_scale=4.5, width=1024, height=1024)
    elif "turbo" in model_id.lower():
        settings = dict(num_inference_steps=4, guidance_scale=0.0, width=512, height=512)
    elif "xl" in name:
        settings = dict(num_inference_steps=25, guidance_scale=7.0, width=768, height=768)
    else:
        settings = dict(num_inference_steps=25, guidance_scale=7.5, width=512, height=512)
    settings["width"], settings["height"] = aspect_dimensions(aspect_ratio, settings["width"])
    supported = inspect.signature(pipeline.__call__).parameters
    return {key: value for key, value in settings.items() if key in supported}


def image_paths(temporary, filename):
    destination = TEMP_IMAGES if temporary else OUTPUT_DIR
    staging = destination / ".nocturne-pending"
    staging.mkdir(parents=True, exist_ok=True)
    return staging / filename, destination / filename


def commit_image(staged, output, translated, original, model_id, ratio, metadata=None):
    details = {"prompt": translated, "original_prompt": original or translated, "model": model_id,
               "aspect_ratio": ratio, **(metadata or {})}
    sidecar = staged.with_suffix(".json")
    sidecar.write_text(json.dumps(details, ensure_ascii=False), encoding="utf-8")
    sidecar.replace(output.with_suffix(".json"))
    # A visible PNG marks the commit, including after the app stops before a progress event.
    staged.replace(output)


def create_image(pipeline, model_id, translated, device, include_image=True, original_prompt=None, aspect_ratio="1:1", temporary=False, metadata=None, filename=None):
    import torch
    if device.startswith("cuda"):
        torch.cuda.empty_cache()
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        image = pipeline(prompt=translated, **image_settings(pipeline, model_id, aspect_ratio)).images[0]
    if all(high <= 1 for low, high in image.convert("RGB").getextrema()):
        raise RuntimeError("خروجی مدل کاملاً سیاه شد. یک پرامپت دیگر یا مدل دیگری را امتحان کنید.")
    filename = filename or f"image_{datetime.now():%Y%m%d_%H%M%S_%f}.png"
    staged, image_path = image_paths(temporary, filename)
    image.save(staged)
    commit_image(staged, image_path, translated, original_prompt, model_id, aspect_ratio, metadata)
    result = {"name": filename, "translated": translated, "model": model_id, "temporary": temporary}
    if include_image:
        result["image"] = "data:image/png;base64," + base64.b64encode(image_path.read_bytes()).decode()
    return result


def generate(prompt, translated_override=None, warning_override=False, include_image=True, aspect_ratio="1:1", temporary=False, metadata=None):
    import torch
    if pipe is None or active_kind not in ("image", "checkpoint"):
        raise RuntimeError("اول یک مدل را انتخاب کنید.")
    translated, translation_warning = (translated_override, warning_override) if translated_override is not None else translate_prompt(prompt.strip(), torch)
    if not translated:
        raise RuntimeError("پرامپت خالی است.")
    if re.search(r"flux(?:fill|control|kontext)", type(pipe).__name__.lower()):
        raise RuntimeError("Open Edit and attach the required reference image for this FLUX model.")
    result = create_image(pipe, active_model, translated, selected_device, include_image, original_prompt=prompt, aspect_ratio=aspect_ratio, temporary=temporary, metadata=metadata)
    result["translation_warning"] = translation_warning
    return result


def image_input_capability():
    if isinstance(pipe, MiniMaxImageEngine):
        return {"supported": True, "reason": "MiniMax H3 Image · Modular Diffusers"}
    if active_kind == "sdcpp":
        supports = sdcpp_models().get(active_model, {}).get("recipe") in SDCPP_EDIT_RECIPES
        return {"supported": supports, "reason": "stable-diffusion.cpp · Reference image" if supports else "این مدل ورودی عکس ندارد."}
    if pipe is None or active_kind not in ("image", "checkpoint"):
        return {"supported": False, "reason": "مدل فعال Diffusers نیست؛ بااین‌حال می‌توانید تلاش دستی کنید."}
    try:
        from diffusers import AutoPipelineForImage2Image
        converted = AutoPipelineForImage2Image.from_pipe(pipe)
        return {"supported": True, "reason": f"موتور ویرایش {type(converted).__name__} آماده است."}
    except Exception as error:
        import inspect
        if {"image", "control_image"} & set(inspect.signature(pipe.__call__).parameters):
            return {"supported": True, "reason": f"کلاس {type(pipe).__name__} مستقیماً ورودی عکس می‌گیرد؛ ویرایش آزمایشی است."}
        return {"supported": False, "reason": f"ویرایش خودکار برای {type(pipe).__name__} تأیید نشد: {str(error)[:180]}"}


def edit_image(prompt, image_data_url, strength=0.65, aspect_ratio="1:1", temporary=False, metadata=None, mask_data_url=None):
    import torch
    from diffusers import AutoPipelineForImage2Image
    if active_kind not in ("image", "checkpoint", "sdcpp") or (active_kind != "sdcpp" and pipe is None):
        raise RuntimeError("یک مدل سازگار با ورودی عکس انتخاب کنید.")
    if not 0.05 <= float(strength) <= 0.95:
        raise RuntimeError("شدت ویرایش باید بین ۰٫۰۵ و ۰٫۹۵ باشد.")
    if not isinstance(image_data_url, str) or not image_data_url.startswith("data:image/") or "," not in image_data_url:
        raise RuntimeError("فرمت عکس ورودی معتبر نیست.")
    raw = base64.b64decode(image_data_url.split(",", 1)[1], validate=True)
    if len(raw) > 20 * 1024**2:
        raise RuntimeError("حجم عکس ورودی باید کمتر از ۲۰ مگابایت باشد.")
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            opened.verify()
        with Image.open(io.BytesIO(raw)) as opened:
            source = ImageOps.exif_transpose(opened).convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise RuntimeError("عکس ورودی قابل خواندن نیست.") from error
    if active_kind == "sdcpp":
        with tempfile.TemporaryDirectory(prefix="nocturne-edit-") as folder:
            reference = Path(folder) / "reference.png"
            source.save(reference)
            return generate_sdcpp(prompt, aspect_ratio=aspect_ratio, temporary=temporary,
                                  metadata={**(metadata or {}), "mode": "edit", "strength": strength}, reference=reference)
    translated, warning = translate_prompt(prompt.strip(), torch)
    if not translated:
        raise RuntimeError("توضیح ویرایش خالی است.")
    original_parameters = inspect.signature(pipe.__call__).parameters
    native_reference = isinstance(pipe, MiniMaxImageEngine) or "mask_image" in original_parameters or "control_image" in original_parameters or "flux2" in type(pipe).__name__.lower()
    if native_reference:
        editor = pipe
    else:
        try:
            editor = AutoPipelineForImage2Image.from_pipe(pipe)
        except Exception as error:
            if "image" not in original_parameters:
                raise RuntimeError(f"این مدل با موتور ویرایش فعلی قابل تبدیل نیست: {str(error)[:240]}") from error
            editor = pipe
    settings = image_settings(editor, active_model, aspect_ratio)
    target_size = (settings.get("width", source.width), settings.get("height", source.height))
    fitted = ImageOps.pad(source, target_size, color=(24, 24, 24))
    parameters = inspect.signature(editor.__call__).parameters
    arguments = dict(prompt=translated, strength=float(strength), **settings)
    if "control_image" in parameters and "fluxcontrol" in type(editor).__name__.lower():
        arguments["control_image"] = fitted
    else:
        arguments["image"] = fitted
    if "mask_image" in parameters:
        if not isinstance(mask_data_url, str) or "," not in mask_data_url:
            raise RuntimeError("Attach a black-and-white mask in Edit. White marks the area to repaint.")
        _, encoded = mask_data_url.split(",", 1)
        if len(encoded) > 28 * 1024**2:
            raise ValueError("Mask exceeds 20 MB.")
        mask = base64.b64decode(encoded, validate=True)
        if len(mask) > 20 * 1024**2:
            raise ValueError("Mask exceeds 20 MB.")
        with Image.open(io.BytesIO(mask)) as opened:
            if opened.size != source.size:
                raise ValueError("Mask dimensions must match the input image.")
            arguments["mask_image"] = ImageOps.pad(opened.convert("L"), target_size,
                                                   method=Image.Resampling.NEAREST, color=0)
    if not any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):
        arguments = {key: value for key, value in arguments.items() if key in parameters}
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        edited = editor(**arguments).images[0]
    if all(high <= 1 for low, high in edited.convert("RGB").getextrema()):
        raise RuntimeError("خروجی ویرایش کاملاً سیاه شد.")
    name = f"edit_{datetime.now():%Y%m%d_%H%M%S_%f}.png"
    staged, path = image_paths(temporary, name)
    edited.save(staged)
    commit_image(staged, path, translated, prompt, active_model, aspect_ratio,
                 {**(metadata or {}), "mode": "edit", "strength": strength})
    return {"name": name, "image": "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode(),
            "translated": translated, "model": active_model, "temporary": temporary, "translation_warning": warning}


def generate_sdcpp(prompt, translated_override=None, warning_override=False, include_image=True, aspect_ratio="1:1", temporary=False, metadata=None, filename=None, reference=None):
    import torch
    manifest = sdcpp_models().get(active_model)
    if not manifest or active_kind != "sdcpp":
        raise RuntimeError("ابتدا مدل تک‌فایل را انتخاب کنید.")
    translated, translation_warning = (translated_override, warning_override) if translated_override is not None else translate_prompt(prompt.strip(), torch)
    if not translated:
        raise RuntimeError("پرامپت خالی است.")
    filename = filename or f"image_{datetime.now():%Y%m%d_%H%M%S_%f}.png"
    staged, output = image_paths(temporary, filename)
    staged.unlink(missing_ok=True)
    weights = manifest["weights"]
    recipe = manifest["recipe"]
    turbo = recipe in ("qwen_encoder", "qwen_turbo_generic", "krea_complete", "krea_denoiser")
    width, height = aspect_dimensions(aspect_ratio, 1024)
    flux = recipe in ("flux_schnell", "flux_dev", "flux_kontext")
    flux2 = recipe.startswith("flux2")
    if reference and recipe not in SDCPP_EDIT_RECIPES:
        raise RuntimeError("مدل انتخاب‌شده ورودی عکس ندارد.")
    if recipe == "flux_kontext" and reference is None:
        raise RuntimeError("برای FLUX Kontext در حالت ویرایش یک تصویر مرجع انتخاب کنید.")
    encoders = (["--clip_l", weights["clip_l"], "--t5xxl", weights["t5xxl"]] if flux else
                ["--llm", weights["llm"]])
    steps = "4" if recipe == "flux_schnell" or recipe.startswith("flux2_klein") else "20" if recipe.startswith(("flux_dev", "flux2")) else "8" if turbo else "28"
    command = [manifest["engine"], "--diffusion-model", weights["diffusion"],
               *encoders, "--vae", weights["vae"],
               "-p", translated, "--steps", steps,
               "--cfg-scale", "4.0" if recipe.startswith("flux2_base") else "1.0" if flux or flux2 or turbo else "6.0", "--sampling-method", "euler",
               "-W", str(width), "-H", str(height), "-o", str(staged)]
    if reference:
        command.extend(["-r", str(reference)])
    if flux:
        command.extend(["--clip-on-cpu", "--guidance", "0" if recipe == "flux_schnell" else "3.5"])
    if recipe in ("qwen_encoder", "qwen_turbo_generic"):
        command.extend(["--sigmas", "1.0,0.978453,0.95418,0.926626,0.89508,0.845148,0.704534,0.414568,0.0"])
    if selected_device.startswith("cuda"):
        command.append("--offload-to-cpu")
    env = os.environ.copy()
    env["PATH"] = str(Path(manifest["engine"]).parent) + os.pathsep + env.get("PATH", "")
    creationflags = 0x08000000 if os.name == "nt" else 0
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", env=env,
                               creationflags=creationflags, timeout=3600)
    if completed.returncode != 0 or not staged.is_file():
        raise RuntimeError("ساخت تصویر با موتور تک‌فایل ناموفق بود: " + completed.stdout[-1800:])
    with Image.open(staged) as image:
        if all(high <= 1 for low, high in image.convert("RGB").getextrema()):
            raise RuntimeError("خروجی مدل کاملاً سیاه شد.")
    commit_image(staged, output, translated, prompt, active_model, aspect_ratio, metadata)
    result = {"name": filename, "translated": translated, "model": active_model,
              "translation_warning": translation_warning, "temporary": temporary}
    if include_image:
        result["image"] = "data:image/png;base64," + base64.b64encode(output.read_bytes()).decode()
    return result


def batch_generate(topic, count, split_cpu=False, aspect_ratio="1:1", metadata=None):
    import torch
    count = int(count)
    if count < 1:
        raise RuntimeError("تعداد عکس باید حداقل ۱ باشد.")
    if active_kind not in ("image", "checkpoint", "sdcpp") or (active_kind in ("image", "checkpoint") and pipe is None) or (active_kind == "sdcpp" and active_model not in sdcpp_models()):
        raise RuntimeError("اول یک مدل عکس‌ساز را انتخاب کنید.")
    if split_cpu and isinstance(pipe, MiniMaxImageEngine):
        raise RuntimeError("Use a single device for MiniMax H3 Image batches; the model uses its own component offloading.")
    if split_cpu and active_kind in ("sdcpp", "checkpoint"):
        raise RuntimeError("تقسیم CPU/GPU برای موتورهای تک‌فایلی فعلاً پشتیبانی نمی‌شود؛ تیک تقسیم کار را بردارید.")
    if split_cpu and not selected_device.startswith("cuda"):
        raise RuntimeError("برای تقسیم کار، یک کارت گرافیک انتخاب کنید.")
    topic = topic.strip()
    if not topic:
        raise RuntimeError("موضوع را بنویسید.")
    translated, warning = translate_prompt(topic, torch)
    if active_kind == "sdcpp":
        variations = ["cinematic lighting", "soft morning light", "dramatic shadows", "vibrant colors",
                      "minimal composition", "detailed background", "warm golden light", "cool blue tones",
                      "wide angle view", "close-up view", "dreamy atmosphere", "natural light"]
        names = []
        for index in range(count):
            result = generate_sdcpp(topic, f"{translated}, {variations[index % len(variations)]}", warning, False, aspect_ratio, metadata=metadata)
            names.append(result["name"])
            emit_event("batch-progress", {"completed": len(names), "total": count,
                       "name": result["name"], "device": selected_device, "translation_warning": warning})
        return {"completed": len(names), "names": names, "translation_warning": warning}
    variations = [
        "cinematic lighting", "soft morning light", "dramatic shadows", "vibrant colors",
        "minimal composition", "detailed background", "warm golden light", "cool blue tones",
        "wide angle view", "close-up view", "dreamy atmosphere", "natural light",
    ]
    names = []
    names_lock = threading.Lock()

    def make_one(index, pipeline, device):
        prompt = f"{translated}, {variations[index % len(variations)]}"
        result = create_image(pipeline, active_model, prompt, device, include_image=False, original_prompt=topic, aspect_ratio=aspect_ratio, metadata=metadata)
        with names_lock:
            names.append(result["name"])
            completed = len(names)
        emit_event("batch-progress", {"completed": completed, "total": count,
                   "name": result["name"], "device": device, "translation_warning": warning})

    cpu_count = count // 2 if split_cpu else 0
    gpu_count = count - cpu_count
    worker = None
    reader = None
    worker_result = {}
    if cpu_count:
        models = complete_models("image")
        worker = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "--batch-cpu-worker"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
                                  text=True, encoding="utf-8", bufsize=1,
                                  creationflags=0x08000000 if os.name == "nt" else 0)
        job = {"model_id": active_model, "model_path": models[active_model], "translated": translated, "topic": topic,
               "start": gpu_count, "count": count, "variations": variations, "aspect_ratio": aspect_ratio, "metadata": metadata}
        worker.stdin.write(json.dumps(job, ensure_ascii=False) + "\n")
        worker.stdin.close()

        def read_worker():
            try:
                for line in worker.stdout:
                    message = json.loads(line)
                    if message.get("event") == "batch-image":
                        name = message["data"]["name"]
                        with names_lock:
                            names.append(name)
                            completed = len(names)
                        emit_event("batch-progress", {"completed": completed, "total": count,
                                   "name": name, "device": "cpu", "translation_warning": warning})
                    elif "ok" in message:
                        worker_result.update(message)
            except Exception as exc:
                worker_result.update({"ok": False, "error": str(exc)})

        reader = threading.Thread(target=read_worker, name="nocturne-cpu-progress", daemon=True)
        reader.start()
    gpu_error = None
    try:
        for index in range(gpu_count):
            make_one(index, pipe, selected_device)
    except Exception as exc:
        gpu_error = exc
    if worker:
        reader.join()
        worker.wait()
        if worker.returncode != 0 or not worker_result.get("ok"):
            raise RuntimeError(f"پردازش CPU متوقف شد: {worker_result.get('error', 'خطای ناشناخته')}")
    if gpu_error:
        raise gpu_error
    return {"completed": len(names), "names": names, "translation_warning": warning}


@contextlib.contextmanager
def exclusive_file(path, conflict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as lock:
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError(conflict) from error
        yield



@contextlib.contextmanager
def lock_queue(run_id):
    if not run_id:
        yield
        return
    with exclusive_file(OUTPUT_DIR / ".nocturne-pending" / (run_id + ".lock"),
                        "This queue is still running in another process. Try again shortly."):
        yield


def batch_queue(topic, jobs, aspect_ratio="1:1", run_id="", metadata=None):
    run_id = project_id(run_id)
    with lock_queue(run_id):
        return run_batch_queue(topic, jobs, aspect_ratio, run_id, metadata)


def run_batch_queue(topic, jobs, aspect_ratio, run_id, metadata):
    import torch
    if not isinstance(topic, str):
        raise ValueError("The shared prompt must be text.")
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("Add at least one job to the queue.")
    available = {**complete_models("image"), **sdcpp_models(), **checkpoint_models()}
    ratios = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}
    prepared = []
    for row, job in enumerate(jobs, 1):
        if not isinstance(job, dict):
            raise ValueError(f"Job {row} is invalid.")
        model_id, count = job.get("model_id"), job.get("count")
        prompt = job.get("prompt", topic)
        ratio = job.get("aspect_ratio", aspect_ratio)
        variations = job.get("variations", True)
        if not isinstance(model_id, str) or not model_id:
            raise ValueError(f"Job {row}: select a fully downloaded image model.")
        if type(count) is not int or not 1 <= count <= 9007199254740991:
            raise ValueError(f"Job {row}: image count must be a positive whole number.")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"Job {row}: enter a prompt.")
        if not isinstance(ratio, str) or ratio not in ratios or type(variations) is not bool:
            raise ValueError(f"Job {row}: invalid aspect ratio or variation setting.")
        prepared.append((model_id, count, prompt.strip(), ratio, variations))
    total = sum(item[1] for item in prepared)
    if total > 9007199254740991:
        raise ValueError("The queue total exceeds the supported range.")
    styles = ["cinematic lighting", "soft morning light", "dramatic shadows", "vibrant colors",
              "minimal composition", "detailed background", "warm golden light", "cool blue tones",
              "wide angle view", "close-up view", "dreamy atmosphere", "natural light"]
    names, saved = [], {}
    if run_id:
        for path in OUTPUT_DIR.glob(f"queue_{run_id}_*.png"):
            match = re.fullmatch(rf"queue_{run_id}_(\d+)_(\d+)\.png", path.name)
            if match and path.with_suffix(".json").is_file() and path.stat().st_size:
                row, index = map(int, match.groups())
                if row < len(prepared) and index < prepared[row][1]:
                    saved.setdefault(row, set()).add(index)
    for row, (model_id, count, *_) in enumerate(prepared):
        if len(saved.get(row, ())) < count and model_id not in available:
            raise ValueError(f"Job {row + 1}: select a fully downloaded image model.")
    completed = sum(map(len, saved.values()))
    any_warning = False
    for row, (model_id, count, topic, ratio, variations) in enumerate(prepared):
        done = saved.get(row, set())
        row_completed = len(done)
        emit_event("queue-progress", {"phase": "loading" if row_completed < count else "complete", "row": row,
                   "model_id": model_id, "row_completed": row_completed, "row_total": count,
                   "completed": completed, "total": total})
        if row_completed == count:
            continue
        translated, warning = translate_prompt(topic, torch)
        any_warning = any_warning or warning
        kind = "sdcpp" if model_id in sdcpp_models() else ("checkpoint" if model_id in checkpoint_models() else "image")
        if active_model != model_id or active_kind != kind or (kind in ("image", "checkpoint") and pipe is None):
            load_model(model_id, kind)
        for index in range(count):
            if index in done:
                continue
            filename = f"queue_{run_id}_{row}_{index}.png" if run_id else None
            prompt = f"{translated}, {styles[index % len(styles)]}" if variations else translated
            result = (generate_sdcpp(topic, prompt, warning, False, ratio, metadata=metadata, filename=filename) if kind == "sdcpp" else
                      create_image(pipe, model_id, prompt, selected_device, include_image=False,
                                   original_prompt=topic, aspect_ratio=ratio, metadata=metadata, filename=filename))
            names.append(result["name"])
            completed += 1
            row_completed += 1
            emit_event("queue-progress", {"phase": "generating", "row": row, "model_id": model_id,
                       "row_completed": row_completed, "row_total": count, "completed": completed,
                       "total": total, "name": result["name"]})
    return {"completed": completed, "names": names, "translation_warning": any_warning,
            "active_model": active_model, "loaded_models": loaded_models()}


def run_cpu_batch_worker():
    import torch
    from diffusers import DiffusionPipeline
    job = json.loads(sys.stdin.readline())
    options = pretrained_options(job["model_path"], job["model_id"], torch.float32)
    with contextlib.redirect_stdout(sys.stderr):
        cpu_pipe = DiffusionPipeline.from_pretrained(job["model_path"], **options).to("cpu")
    cpu_pipe.set_progress_bar_config(disable=True)
    for index in range(job["start"], job["count"]):
        prompt = f"{job['translated']}, {job['variations'][index % len(job['variations'])]}"
        result = create_image(cpu_pipe, job["model_id"], prompt, "cpu", include_image=False, original_prompt=job["topic"], aspect_ratio=job.get("aspect_ratio", "1:1"), metadata=job.get("metadata"))
        emit_event("batch-image", {"name": result["name"]})
    return {"completed": job["count"] - job["start"]}


def video_settings(pipeline):
    name = type(pipeline).__name__.lower()
    fps = 8
    if "hunyuanvideo15" in name:
        settings = dict(num_frames=33, num_inference_steps=30, height=480, width=848)
    elif "ltx2" in name:
        settings = dict(num_frames=49, num_inference_steps=25, guidance_scale=3, height=512, width=768, frame_rate=24)
        fps = 24
    elif "cosmos2_5_predictbase" in name or "cosmos2_5" in name:
        settings = dict(num_frames=33, num_inference_steps=30, guidance_scale=7, height=480, width=832)
    elif "cosmostexttoworld" in name:
        settings = dict(num_frames=49, num_inference_steps=30, guidance_scale=7, height=480, width=832)
    elif "cogvideo" in name:
        settings = dict(num_frames=49, num_inference_steps=25, guidance_scale=6)
    elif "wan" in name:
        settings = dict(num_frames=33, num_inference_steps=25, guidance_scale=5, height=480, width=832)
    elif "ltx" in name:
        settings = dict(num_frames=49, num_inference_steps=25, guidance_scale=3, height=480, width=704)
    elif "mochi" in name:
        settings = dict(num_frames=19, num_inference_steps=30, guidance_scale=4.5, height=480, width=848)
    elif "hunyuanvideo" in name:
        settings = dict(num_frames=33, num_inference_steps=30, guidance_scale=6, height=480, width=848)
    elif "allegro" in name:
        settings = dict(num_frames=33, num_inference_steps=30, guidance_scale=7, height=480, width=848)
    else:
        raise RuntimeError("اجرای این خانوادهٔ ویدیو در نسخهٔ فعلی پشتیبانی نمی‌شود.")
    supported = inspect.signature(pipeline.__call__).parameters
    settings = {key: value for key, value in settings.items() if key in supported}
    return settings, fps


def generate_video(prompt):
    import torch
    from diffusers.utils import export_to_video
    if pipe is None or active_kind != "video":
        raise RuntimeError("اول یک مدل ویدیوساز را انتخاب کنید.")
    translated, translation_warning = translate_prompt(prompt.strip(), torch)
    if not translated:
        raise RuntimeError("پرامپت خالی است.")
    settings, fps = video_settings(pipe)
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        frames = pipe(prompt=translated, **settings).frames[0]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"video_{datetime.now():%Y%m%d_%H%M%S_%f}.mp4"
    export_to_video(frames, str(OUTPUT_DIR / filename), fps=fps)
    return {"name": filename, "translated": translated, "translation_warning": translation_warning}


def video_gallery():
    if not OUTPUT_DIR.exists():
        return []
    return [{"name": p.name, "date": datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in sorted(OUTPUT_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)[:120]]


def video_data(name):
    path = OUTPUT_DIR / Path(name).name
    if not path.is_file() or path.suffix.lower() != ".mp4":
        raise FileNotFoundError("ویدیو پیدا نشد")
    return "data:video/mp4;base64," + base64.b64encode(path.read_bytes()).decode()


def storage_info():
    model_bytes = 0
    seen = set()
    for folder in (ORIGINAL_HF_HOME / "hub", MODEL_CACHE):
        resolved = folder.resolve()
        if resolved in seen or not folder.is_dir():
            continue
        seen.add(resolved)
        try:
            model_bytes += scan_cache_dir(cache_dir=folder).size_on_disk
        except Exception:
            pass
    if SDCPP_ROOT.is_dir():
        model_bytes += sum(p.stat().st_size for p in SDCPP_ROOT.rglob("*") if p.is_file())
    if CHECKPOINT_ROOT.is_dir():
        model_bytes += sum(p.stat().st_size for p in CHECKPOINT_ROOT.rglob("*") if p.is_file())
    images = list(OUTPUT_DIR.glob("*.png")) if OUTPUT_DIR.is_dir() else []
    videos = list(OUTPUT_DIR.glob("*.mp4")) if OUTPUT_DIR.is_dir() else []
    return {"model_bytes": model_bytes,
            "image_bytes": sum(p.stat().st_size for p in images), "image_count": len(images),
            "video_bytes": sum(p.stat().st_size for p in videos), "video_count": len(videos),
            "output_folder": str(OUTPUT_DIR)}


def sdcpp_recipe(model_id, filenames):
    known = SDCPP_RECIPES.get(model_id)
    if known:
        return known
    title = model_id.lower().replace("_", "-")
    weights = [Path(name).name.lower() for name in filenames if name.lower().endswith(".gguf")]
    if not weights or "lora" in title:
        return None
    # Generic community recipes require the family on the repository and the model weight.
    if "flux" in title and not re.search(r"(?:^|[.-])kv(?:$|[.-])", title):
        descriptors = (
            ("flux2_base_4b", r"flux[.-]?2.*klein.*base.*4b"),
            ("flux2_base_9b", r"flux[.-]?2.*klein.*base.*9b"),
            ("flux2_klein_4b", r"flux[.-]?2.*klein.*4b"),
            ("flux2_klein_9b", r"flux[.-]?2.*klein.*9b"),
            ("flux2_dev", r"flux[.-]?2.*dev"),
            ("flux_kontext", r"flux[.-]?1.*kontext"),
            ("flux_schnell", r"flux[.-]?1.*schnell"),
            ("flux_dev", r"flux[.-]?1(?!.*(?:kontext|fill|canny|depth|redux)).*dev"),
        )
        for recipe, pattern in descriptors:
            if re.search(pattern, title) and any(re.search(pattern, weight) for weight in weights):
                return recipe
    if "qwen-image-2.1" in title:
        return "qwen_generic"
    return None


def search(query, kind="image", image_only=False):
    options = dict(search=query or None, full=True, sort="downloads", limit=800)
    if not query or image_only:
        options["pipeline_tag"] = "text-to-video" if kind == "video" else "text-to-image"
    api = HfApi()
    models = {item.id: item for item in api.list_models(**options)}
    normalized = re.sub(r"[-_\s]+", " ", query.strip().lower())
    if kind == "image" and normalized in ("flux", "flux gguf", "flux.1 gguf", "flux.2", "uncensored",
                                           "بدون سانسور", "flux uncensored"):
        terms = (["uncensored", "abliterated", "uncensor", "nsfw"] if "uncensored" in normalized or normalized == "بدون سانسور"
                 else ["FLUX.1", "FLUX.2", "FLUX Kontext", "FLUX klein"])
        for term in terms:
            for item in api.list_models(search=term, full=True, sort="downloads", limit=230):
                if item.pipeline_tag in ("text-to-image", "image-to-image", "inpainting", None) and (
                        not normalized.startswith("flux") or "flux" in item.id.lower()):
                    models.setdefault(item.id, item)
    results = []
    for m in models.values():
        names = {s.rfilename for s in (m.siblings or [])}
        tags = set(m.tags or [])
        is_lora = "lora" in tags or "lora" in m.id.lower()
        if kind == "image" and not is_lora and sdcpp_recipe(m.id, names):
            category = "sdcpp"
        elif any(name.lower().endswith(".gguf") for name in names):
            category = "gguf"
        elif "model_index.json" in names or "modular_model_index.json" in names:
            video_name = any(term in m.id.lower() for term in ("hunyuanvideo", "cogvideo", "text2world", "predict2.5", "ltx-2", "wan2", "mochi-1", "allegro"))
            category = "video" if m.pipeline_tag == "text-to-video" or video_name else "image"
        elif "merged-model/model_index.json" in names:
            category = "other"
        elif checkpoint_candidate(m):
            category = "checkpoint"
        elif is_lora and any(name.endswith(".safetensors") for name in names):
            category = "adapter"
        else:
            category = "other"
        results.append({"id": m.id, "downloads": m.downloads or 0, "likes": m.likes or 0,
                        "category": category, "pipeline_tag": m.pipeline_tag or "", "gated": bool(m.gated)})
    priority = ({"video": 0, "checkpoint": 1, "adapter": 2, "gguf": 3, "other": 4, "image": 5, "sdcpp": 5}
                if kind == "video" else
                {"image": 0, "sdcpp": 1, "checkpoint": 2, "adapter": 3, "gguf": 4, "other": 5, "video": 6})
    results.sort(key=lambda item: (priority.get(item["category"], 9), -(item["downloads"] or 0)))
    return results[:500]


def missing_pipeline_parts(names, config, prefix=""):
    missing = []
    for part, value in component_folders(config).items():
        if part.startswith("_") or part == "safety_checker" or not isinstance(value, list) or not value or value[0] is None:
            continue
        files = [name for name in names if name.startswith(prefix + part + "/")]
        if not files or (not any(word in (str(value[1]).lower() if len(value) > 1 else "") for word in ("tokenizer", "scheduler", "processor", "extractor", "guidance", "guider"))
                         and not any(name.endswith((".safetensors", ".bin")) for name in files)):
            missing.append(part)
    return missing


def download_bytes_left(size, target, part=None):
    try:
        if target.stat().st_size == size:
            return 0
    except OSError:
        pass
    try:
        partial = part if part is not None else Path(str(target) + ".part")
        return size - min(size, partial.stat().st_size)
    except OSError:
        return size


def describe_download_plan(plan, reserve=2 * 1024**3):
    entries = []
    for size, target, part in plan:
        remaining = download_bytes_left(size, target, part) if isinstance(size, int) else None
        parts = target.parts
        if "snapshots" in parts:
            name = "/".join(parts[parts.index("snapshots") + 2:])
        elif "weights" in parts:
            name = "/".join(parts[parts.index("weights") + 2:])
        else:
            name = target.name
        entries.append({"name": name, "size": size, "remaining": remaining})
    complete_sizes = bool(entries) and all(item["remaining"] is not None for item in entries)
    base = MODEL_HOME.resolve()
    probe = base
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        free = shutil.disk_usage(probe).free
    except OSError:
        free = None
    remaining = sum(item["remaining"] for item in entries) if complete_sizes else None
    return {"file_plan": entries, "folder": str(base), "free_bytes": free,
            "required_bytes": None if remaining is None else remaining + (reserve if remaining else 0)}


def checked_revisions(revisions):
    if not isinstance(revisions, dict) or any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value)
                                              for value in revisions.values()):
        raise ValueError("Invalid repository revision.")
    return revisions


def model_info(model_id, requested_kind=None, variant=None):
    revision = download_pin(model_id)
    info = retry_call(lambda: HfApi().model_info(model_id, revision=revision, files_metadata=True, timeout=20),
                      "بررسی مدل", model_id, attempts=2)
    names = [s.rfilename for s in (info.siblings or [])]
    total = sum(s.size or 0 for s in (info.siblings or []))
    size = info.used_storage or total
    lower = [name.lower() for name in names]
    has_index = "model_index.json" in names
    has_merged_index = "merged-model/model_index.json" in names
    has_gguf = any(name.endswith(".gguf") for name in lower)
    is_lora = "lora" in model_id.lower() or "lora" in (info.tags or [])
    download_kind = None
    image_input = None
    plan = []
    requirements = []
    variants = []
    upgrade = None
    revisions = {model_id: info.sha}
    if requested_kind != "checkpoint" and not is_lora and sdcpp_recipe(model_id, names):
        try:
            recipe, files, variants = sdcpp_weight_plan(model_id, revisions, variant, initial_info=info)
            revisions.update({file["repo"]: file["revision"] for file in files})
            engine_type = "cuda" if selected_device.startswith("cuda") else "cpu"
            engine_tag, assets = sdcpp_engine_assets(selected_device)
            engine_dir = SDCPP_ROOT / "engine" / engine_tag / engine_type
            ready = any((path.parent / ".ready").is_file()
                        for path in (SDCPP_ROOT / "engine").glob(f"*/{engine_type}/sd-cli.exe"))
            plan = [(file["size"], sdcpp_file_path(model_id, file), None) for file in files]
            if not ready and not (engine_dir / "sd-cli.exe").is_file():
                plan.extend((asset["size"], engine_dir / asset["name"], None) for asset in assets)
            requirements = ["stable-diffusion.cpp", "CUDA 12" if engine_type == "cuda" else "CPU"]
            image_input = recipe in SDCPP_EDIT_RECIPES
            download_kind = "sdcpp"
            compatibility, reason = "sdcpp", f"آمادهٔ نصب با موتور؛ {len(files)} فایل لازم بررسی شد"
        except Exception as error:
            compatibility, reason = "review", f"فایل‌های لازم برای موتور کامل نیستند: {error}"
    elif (has_index or has_merged_index or "modular_model_index.json" in names) and requested_kind != "checkpoint":
        try:
            import diffusers
            index_name, index_file = retry_call(lambda: remote_pipeline_index(model_id, names, info.sha),
                                                 "بررسی ساختار مدل", model_id, attempts=2)
            config = json.loads(Path(index_file).read_text(encoding="utf-8"))
            class_name = config.get("_class_name", "")
            image_input = class_name in ("StableDiffusionPipeline", "StableDiffusionXLPipeline", "FluxPipeline", "FluxKontextPipeline", "FluxFillPipeline", "FluxControlPipeline", "Flux2Pipeline", "Flux2KleinPipeline", "QwenImagePipeline", "QwenImage21Pipeline") or "Img2Img" in class_name
            kind = model_type(class_name)
            modular = is_minimax_image(config)
            image_input = image_input or modular
            prefix = "merged-model/" if index_name.startswith("merged-model/") else ""
            selected = files_for_pipeline(info.siblings, component_folders(config), prefix, index_name)
            has_weights = any(name.endswith((".safetensors", ".bin")) for name in selected)
            missing_parts = missing_pipeline_parts(names, config, prefix)
            if modular and not minimax_engine_ready(diffusers):
                reason = ""
                upgrade = {"installed": diffusers.__version__, "minimum": MINIMAX_DIFFUSERS, "profile": "minimax-h3"}
            elif class_name == "MiniMaxH3ImagePipeline":
                reason = "این مخزن قالب قدیمی H3 را دارد. مدل رسمی MiniMaxAI/MiniMax-H3-Image نسخهٔ Modular را دارد."
            elif not modular and not hasattr(diffusers, class_name):
                reason = f"کلاس {class_name or 'نامشخص'} در نسخهٔ فعلی Diffusers نصب نیست"
            elif "prior" in class_name.lower():
                reason = "این بستهٔ کمکی به یک مدل پایه و مسیر مخصوص ترکیب نیاز دارد"
            elif kind == "video" and class_name not in SUPPORTED_VIDEO_CLASSES:
                reason = f"موتور ویدیویی {class_name} هنوز در برنامه پشتیبانی نمی‌شود"
            elif missing_parts or not has_weights:
                reason = "اجزای مدل کامل نیست: " + ", ".join(missing_parts or ["weights"])
            else:
                download_kind = kind
                reason = "" if modular else f"آمادهٔ دانلود با موتور {class_name}؛ {len(selected)} فایل لازم"
                requirements = [f"Modular Diffusers ≥ {MINIMAX_DIFFUSERS}" if modular else "Diffusers", "PyTorch"]
                if "T5" in json.dumps(config) or "CogVideoX" in class_name:
                    requirements.append("SentencePiece")
                root = Path(index_file).parent.parent if index_name.startswith("merged-model/") else Path(index_file).parent
                part_root = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha
                sizes = {file.rfilename: file.size for file in info.siblings}
                plan = [(sizes[name], root / name, part_root / (name + ".part")) for name in selected]
            if upgrade and has_weights and not missing_parts:
                requirements = [f"Modular Diffusers ≥ {MINIMAX_DIFFUSERS}", "PyTorch"]
                root = Path(index_file).parent
                parts_path = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha
                sizes = {file.rfilename: file.size for file in info.siblings}
                plan = [(sizes[name], root / name, parts_path / (name + ".part")) for name in selected]
            compatibility = "diffusers" if download_kind else "review"
            checkpoint = checkpoint_candidate(info)
            if not download_kind and checkpoint:
                download_kind = "checkpoint"
                compatibility = "checkpoint"
                reason = f"ساختار پوشه‌ای آماده نیست؛ فایل کامل {checkpoint.rfilename} با موتور SD/SDXL قابل دریافت است"
        except Exception as error:
            compatibility, reason = "review", f"بررسی اجزای مدل کامل نشد: {error}"
            checkpoint = checkpoint_candidate(info)
            if checkpoint:
                download_kind = "checkpoint"
                compatibility = "checkpoint"
                reason = f"فایل کامل {checkpoint.rfilename} با موتور SD/SDXL قابل دریافت است"
    elif model_id == FEATURED_LORA:
        selected = next((file for file in info.siblings if file.rfilename.endswith(".safetensors")), None)
        if selected and selected.lfs:
            target = MODEL_CACHE / ("models--" + model_id.replace("/", "--")) / "snapshots" / info.sha / selected.rfilename
            part = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha / (selected.rfilename + ".part")
            plan = [(selected.size, target, part)]
            download_kind = "adapter"
        requirements = ["Diffusers", "Qwen/Qwen-Image-2.1"]
        compatibility, reason = "adapter", "LoRA نیازمند مدل پایه است"
    elif is_lora:
        compatibility, reason = "adapter", "LoRA است و برای اجرا به مدل پایهٔ سازگار نیاز دارد"
    elif has_gguf:
        compatibility, reason = "review", "فایل GGUF پیدا شد، ولی دستور اجرای این خانواده هنوز مشخص نیست"
    elif checkpoint_candidate(info):
        checkpoint = checkpoint_candidate(info)
        download_kind = "checkpoint"
        compatibility, reason = "checkpoint", f"فایل کامل {checkpoint.rfilename} با موتور SD/SDXL قابل دریافت است"
    else:
        compatibility, reason = "review", "ساختار قابل اجرای مستقیمی برای موتورهای فعلی پیدا نشد"
    if requested_kind == "checkpoint" and checkpoint_candidate(info):
        download_kind, compatibility, reason = "checkpoint", "checkpoint", "SD/SDXL single-file checkpoint"
    if download_kind == "checkpoint":
        checkpoint = checkpoint_candidate(info)
        if checkpoint and checkpoint.lfs and checkpoint.lfs.sha256:
            existing = cached_weight_path(model_id, checkpoint.rfilename, checkpoint.size)
            target = Path(existing) if existing else CHECKPOINT_ROOT / model_id.replace("/", "--") / checkpoint.rfilename
            plan = [(checkpoint.size, target, None)]
            requirements = ["Diffusers", "PyTorch", "SD/SDXL base configuration"]
            image_input = True
        else:
            download_kind = None
    download_bytes = remaining_bytes = None
    if plan and all(type(count) is int and count >= 0 for count, _, _ in plan):
        download_bytes = sum(count for count, _, _ in plan)
        remaining_bytes = sum(download_bytes_left(count, target, part) for count, target, part in plan)
    summary = describe_download_plan(plan, 2 * 1024**3 if download_kind != "checkpoint" else 1024**3)
    card = getattr(info, "card_data", None)
    params = getattr(card, "num_parameters", None) if card else None
    if not isinstance(params, (int, float)):
        params = None
    return {"id": model_id, "size_gb": round(size / 1024**3, 2) if size else None,
            "files": len(names), "parameters": params, "gated": bool(info.gated) and not bool(get_token()),
            "compatibility": compatibility, "download_kind": download_kind,
            "checkpoint_available": checkpoint_candidate(info) is not None,
            "image_input": image_input, "download_bytes": download_bytes,
            "remaining_bytes": remaining_bytes, "requirements": requirements,
            "variants": variants, "revisions": revisions, "upgrade": upgrade, **summary,
            "memory_gib": ([round(download_bytes / 1024**3 + overhead, 1) for overhead in (2, 8)]
                           if download_bytes and download_kind in ("image", "checkpoint", "sdcpp") else None),
            "reason": reason}


def files_for_pipeline(siblings, parts, prefix="", index_name=None):
    selected = {index_name or prefix + "model_index.json"}
    ignored_suffixes = (".ckpt", ".pt", ".pth", ".h5", ".onnx", ".msgpack", ".gguf")
    for part in parts:
        files = [s.rfilename for s in siblings if s.rfilename.startswith(prefix + part + "/")]
        safe_weights = [name for name in files if name.endswith(".safetensors")]
        binary_weights = [name for name in files if name.endswith(".bin")]
        weights = safe_weights if safe_weights else binary_weights
        names = set(weights)
        for name in weights:
            base = name.replace(".fp16.", ".").replace(".non_ema.", ".")
            if base != name and base in names:
                names.discard(name)
        for name in files:
            if name.endswith(ignored_suffixes):
                continue
            if name.endswith((".safetensors", ".bin")):
                if name in names:
                    selected.add(name)
            elif name.endswith(".index.json"):
                if (safe_weights and "safetensors" in name) or (not safe_weights and "bin" in name):
                    selected.add(name)
            else:
                selected.add(name)
    return sorted(selected)


def pinned_downloads():
    path = MODEL_CACHE / ".nocturne-downloads.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def download_pin_path(model_id):
    key = hashlib.sha256(model_id.casefold().encode()).hexdigest()
    return MODEL_CACHE / ".nocturne-pins" / key


def download_pin(model_id):
    path = download_pin_path(model_id)
    if path.is_file():
        return path.read_text(encoding="ascii").strip() or None
    return pinned_downloads().get(model_id)


def save_download_pin(model_id, revision):
    path = download_pin_path(model_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(revision or "", encoding="ascii")
    temporary.replace(path)


def permanent_download_error(error):
    status = getattr(getattr(error, "response", None), "status_code", None)
    if status in (401, 403, 404, 416):
        return True
    message = str(error).lower()
    return any(word in message for word in ("gated", "not found", "permission denied", "no space", "صحت فایل", "hash mismatch", "نپذیرفت"))


def retry_call(operation, label, model_id, attempts=6):
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as error:
            if attempt == attempts or permanent_download_error(error):
                raise RuntimeError(f"{label}: {error}") from error
            emit_progress({"model_id": model_id, "phase": "retrying", "file": label,
                           "attempt": attempt + 1, "error": str(error)[:220]})
            time.sleep(min(3 * attempt, 15))


def file_sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def valid_download(path, size, digest=None):
    try:
        return path.is_file() and path.stat().st_size == size and (not digest or file_sha256(path) == digest.lower())
    except OSError:
        return False


def download_resumable(url, part_path, destination, expected_size, expected_sha, progress, notify=None):
    part_path.parent.mkdir(parents=True, exist_ok=True)
    offset = part_path.stat().st_size if part_path.exists() else 0
    if offset > expected_size:
        part_path.unlink()
        offset = 0
        if notify:
            notify("restarting")
    while offset < expected_size:
        headers = {"Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        if urlsplit(url).hostname == "huggingface.co":
            token = get_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        with requests.get(url, headers=headers, stream=True, timeout=(15, 35)) as response:
            response.raise_for_status()
            mode = "ab"
            end = expected_size
            if response.status_code == 206:
                content_range = response.headers.get("Content-Range", "")
                match = re.fullmatch(rf"bytes {offset}-([0-9]{{1,19}})/{expected_size}", content_range)
                if not match or not offset <= int(match[1]) < expected_size:
                    raise RuntimeError("The server returned an invalid range; the partial file was kept.")
                end = int(match[1]) + 1
            elif response.status_code == 200:
                content_length = response.headers.get("Content-Length")
                if content_length is not None and content_length != str(expected_size):
                    raise RuntimeError("The server returned a file with an unexpected size.")
                if offset:
                    offset, mode = 0, "wb"
                    if notify:
                        notify("restarting")
            else:
                raise RuntimeError("Unexpected response for a model file.")
            rate = getattr(TRANSFER_LIMIT, "bytes_per_sec", 0)
            transferred, started = 0, time.monotonic()
            with part_path.open(mode, buffering=0) as output:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    if not chunk:
                        continue
                    if offset + len(chunk) > end:
                        raise RuntimeError("The server returned more data than expected for this range.")
                    output.write(chunk)
                    offset += len(chunk)
                    transferred += len(chunk)
                    if rate:
                        time.sleep(max(0, transferred / rate - (time.monotonic() - started)))
                    progress(offset, len(chunk))
            if offset != end:
                raise RuntimeError(f"Connection interrupted: {offset} of {expected_size} bytes.")
    if offset != expected_size:
        raise RuntimeError(f"Connection interrupted: {offset} of {expected_size} bytes.")
    if notify:
        notify("verifying")
    if file_sha256(part_path) != expected_sha.lower():
        # Keep other files. The next retry starts only this damaged file again.
        part_path.unlink()
        raise RuntimeError("File hash mismatch; retry to download this file again.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    part_path.replace(destination)


def download_featured_lora(model_id, revision=None):
    if model_id != FEATURED_LORA:
        raise RuntimeError("دانلود این LoRA هنوز در برنامه پشتیبانی نمی‌شود.")
    emit_progress({"model_id": model_id, "phase": "checking", "processed": 0, "received": 0, "total": 0, "speed": 0})
    api = HfApi()
    info = retry_call(lambda: api.model_info(model_id, revision=revision, files_metadata=True, timeout=30), "بررسی LoRA", model_id)
    weight_name = "chatrlabs-omni-lora-v0.1-bf16.safetensors"
    siblings = {s.rfilename: s for s in info.siblings}
    weight = siblings.get(weight_name)
    if not weight or not weight.size or not weight.lfs or not weight.lfs.sha256:
        raise RuntimeError("فایل LoRA یا اطلاعات صحت آن در مخزن پیدا نشد.")
    marker = "README.md" if "README.md" in siblings else ".gitattributes"
    marker_path = retry_call(lambda: hf_hub_download(model_id, marker, revision=info.sha,
                              cache_dir=MODEL_CACHE, etag_timeout=30), "دریافت مشخصات LoRA", model_id)
    destination = Path(marker_path).parent / weight_name
    part_path = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha / (weight_name + ".part")
    total = weight.size
    saved = total if destination.is_file() and destination.stat().st_size == total else min(part_path.stat().st_size, total) if part_path.is_file() else 0
    if saved < total and shutil.disk_usage(destination.parent).free < total - saved + 512 * 1024**2:
        raise RuntimeError("فضای کافی برای دانلود LoRA وجود ندارد.")
    started = time.monotonic()
    received = 0
    last_emit = 0.0
    def report(position, amount=0, phase="transferring", attempt=1):
        nonlocal received, last_emit
        received += amount
        now = time.monotonic()
        if now - last_emit >= 0.4 or position == total or phase != "transferring":
            last_emit = now
            emit_progress({"model_id": model_id, "phase": phase, "file": weight_name,
                           "attempt": attempt, "processed": position, "received": received,
                           "total": total, "speed": received / max(now - started, 0.001)})
    report(saved, phase="resuming" if saved else "starting")
    if saved < total:
        url = hf_hub_url(model_id, weight_name, revision=info.sha)
        for attempt in range(1, 13):
            try:
                download_resumable(url, part_path, destination, total, weight.lfs.sha256,
                                   lambda position, amount: report(position, amount, attempt=attempt))
                break
            except Exception as error:
                if attempt == 12 or permanent_download_error(error):
                    raise RuntimeError(f"دانلود LoRA متوقف شد؛ بخش دریافت‌شده حفظ شده است: {error}") from error
                report(min(part_path.stat().st_size, total) if part_path.is_file() else 0,
                       phase="retrying", attempt=attempt + 1)
                time.sleep(min(3 * attempt, 20))
    if model_id not in downloaded_adapters():
        raise RuntimeError("فایل LoRA دریافت شد ولی در حافظهٔ مدل‌ها پیدا نشد.")
    report(total, phase="complete")
    return {"id": model_id, "kind": "adapter", "base_model": "Qwen/Qwen-Image-2.1"}


def sdcpp_weight_plan(model_id, revisions=None, variant=None, initial_info=None):
    revisions = checked_revisions(revisions or {})
    api = HfApi()
    cache = {}
    if initial_info is not None:
        cache[model_id] = initial_info
    def repository(repo_id):
        if repo_id not in cache:
            cache[repo_id] = retry_call(lambda: api.model_info(repo_id, revision=revisions.get(repo_id), files_metadata=True, timeout=30),
                                        "بررسی فایل‌های مدل", model_id)
        return cache[repo_id]
    source = repository(model_id)
    recipe = sdcpp_recipe(model_id, (file.rfilename for file in source.siblings))
    if not recipe:
        raise RuntimeError("برای این مخزن هنوز ترکیب فایل‌های اجرایی مشخص نیست.")
    variants = []
    def choose(role, repo_id, filename):
        info = repository(repo_id)
        sibling = next((s for s in info.siblings if s.rfilename == filename), None)
        if not sibling or not sibling.size or not sibling.lfs or not sibling.lfs.sha256:
            raise RuntimeError(f"فایل لازم در مخزن پیدا نشد: {repo_id}/{filename}")
        return {"role": role, "repo": repo_id, "name": filename, "revision": info.sha,
                "size": sibling.size, "sha": sibling.lfs.sha256}
    comfy_qwen = "Comfy-Org/Qwen-Image-2.1"
    if recipe.startswith("flux"):
        folders = ("clip", "t5", "vae", "mmproj", "lora", "qwen", "mistral", "encoder")
        candidates = [file for file in source.siblings if file.rfilename.lower().endswith(".gguf")
                      and not any(word in file.rfilename.lower() for word in folders) and file.size and file.lfs]
        preferred = ("q4_k_s", "q4_k_m", "q4_k", "q4_0", "q5_k_m", "q8_0")
        candidates.sort(key=lambda file: (next((index for index, tag in enumerate(preferred)
                            if file.rfilename.lower().endswith("-"+tag+".gguf")), len(preferred)), file.size))
        variants = [{"name": file.rfilename, "size": file.size} for file in candidates]
        selected = next((file for file in candidates if file.rfilename == variant), None) if variant else next(iter(candidates), None)
        if not selected:
            raise RuntimeError("فایل GGUF انتخاب‌شده برای FLUX پیدا نشد.")
        files = [choose("diffusion", model_id, selected.rfilename)]
        if recipe.startswith("flux2"):
            files.append(choose("vae", "Comfy-Org/flux2-klein-4B", "split_files/vae/flux2-vae.safetensors"))
            if recipe == "flux2_dev":
                files.append(choose("llm", "unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF",
                                    "Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf"))
            else:
                size = "4b" if recipe.endswith("4b") else "8b"
                files.append(choose("llm", "Comfy-Org/flux2-klein-4B" if size == "4b" else "Comfy-Org/flux2-klein-9B",
                                    f"split_files/text_encoders/qwen_3_{size}.safetensors"))
        else:
            files.extend([choose("clip_l", "comfyanonymous/flux_text_encoders", "clip_l.safetensors"),
                          choose("t5xxl", "comfyanonymous/flux_text_encoders", "t5xxl_fp16.safetensors"),
                          choose("vae", "cocktailpeanut/xulf-dev", "ae.safetensors")])
    elif recipe == "qwen_encoder":
        name = "Qwen-Image-2.1-Turbo-Uncensored-AD-Q4_K.gguf" if model_id.startswith("AtomicChat/") else "Qwen-Image-2.1-Turbo-Abliterated-Uncensored-AD-Q4_K.gguf"
        files = [choose("llm", model_id, name),
                 choose("diffusion", "AtomicChat/Qwen-Image-2.1-Turbo-GGUF", "Qwen-Image-2.1-Turbo-AD-Q4_K.gguf"),
                 choose("vae", comfy_qwen, "vae/qwen_image_2.1_vae_bf16.safetensors")]
    elif recipe == "qwen_gguf":
        files = [choose("diffusion", model_id, "qwen-image-2.1-UC-Q4_K_M.gguf"),
                 choose("llm", model_id, "text_encoders/qwen3vl_8b_int8_convrot.safetensors"),
                 choose("vae", model_id, "vae/qwen_image_2.1_vae_bf16.safetensors")]
    elif recipe == "qwen_denoiser":
        name = "NoctQA_V1_int8_convrot.safetensors" if "Anime" in model_id else "NoctQ_V4_int8_convrot.safetensors"
        files = [choose("diffusion", model_id, name),
                 choose("llm", comfy_qwen, "text_encoders/qwen3vl_8b_int8_convrot.safetensors"),
                 choose("vae", comfy_qwen, "vae/qwen_image_2.1_vae_bf16.safetensors")]
    elif recipe == "krea_complete":
        files = [choose("diffusion", model_id, "moodyKrea2Mix_v3-Global-FP8.safetensors"),
                 choose("llm", model_id, "qwen3VL4BAbliteratedComfyui_FP8.safetensors"),
                 choose("vae", model_id, "qwenImageVAE_BF16.safetensors")]
    elif recipe == "qwen_generic":
        info = retry_call(lambda: api.model_info(model_id, files_metadata=True, timeout=30),
                          "بررسی فایل‌های GGUF", model_id)
        cache[model_id] = info
        ggufs = [s.rfilename for s in info.siblings if s.rfilename.lower().endswith(".gguf")]
        denoisers = [name for name in ggufs if not any(word in name.lower() for word in ("textencoder", "qwen3vl", "mmproj", "text_encoder"))]
        def select(names):
            preferred = [name for name in names if "q4_k_m" in name.lower()]
            preferred = preferred or [name for name in names if "q4_k" in name.lower() or "4bit" in name.lower()]
            return sorted(preferred, key=len)[0] if preferred else None
        denoiser = select(denoisers)
        if not denoiser:
            raise RuntimeError("این مخزن فایل تصویرساز GGUF با کیفیت Q4 ندارد؛ دانلود خودکار شروع نشد.")
        encoders = [name for name in ggufs if any(word in name.lower() for word in ("textencoder", "qwen3vl", "text_encoder"))]
        encoder = select(encoders)
        files = [choose("diffusion", model_id, denoiser)]
        files.append(choose("llm", model_id, encoder) if encoder else
                     choose("llm", comfy_qwen, "text_encoders/qwen3vl_8b_int8_convrot.safetensors"))
        vaes = [s.rfilename for s in info.siblings if s.rfilename.lower().endswith(".safetensors") and "vae" in s.rfilename.lower()]
        files.append(choose("vae", model_id, vaes[0]) if vaes else
                     choose("vae", comfy_qwen, "vae/qwen_image_2.1_vae_bf16.safetensors"))
        recipe = "qwen_turbo_generic" if "turbo" in model_id.lower() else "qwen_generic"
    else:
        comfy_krea = "Comfy-Org/Krea-2"
        files = [choose("diffusion", model_id, "KreaNoct_V4_int8_convrot.safetensors"),
                 choose("llm", comfy_krea, "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"),
                 choose("vae", comfy_krea, "vae/qwen_image_vae.safetensors")]
    return recipe, files, variants


def sdcpp_engine_assets(device):
    kind = "cuda" if device.startswith("cuda") else "cpu"
    assets = [{"name": name, "url": f"https://github.com/leejet/stable-diffusion.cpp/releases/download/{SDCPP_RELEASE}/{name}",
               "size": size, "sha": sha} for name, size, sha in SDCPP_ASSETS[kind]]
    return SDCPP_RELEASE, assets


@lru_cache(maxsize=128)
def cached_weight_path(repo_id, filename, size):
    for cache in (ORIGINAL_HF_HOME / "hub", MODEL_CACHE):
        if not cache.is_dir():
            continue
        try:
            repos = scan_cache_dir(cache_dir=cache).repos
            for repo in repos:
                if repo.repo_id != repo_id:
                    continue
                for revision in repo.revisions:
                    candidate = revision.snapshot_path / filename
                    if candidate.is_file() and candidate.stat().st_size == size:
                        return str(candidate)
        except (OSError, ValueError):
            pass
    return None


def sdcpp_file_path(model_id, file):
    existing = cached_weight_path(file["repo"], file["name"], file["size"])
    if existing:
        return Path(existing)
    repo = file["repo"].replace("/", "--")
    return SDCPP_ROOT / "weights" / repo / file["name"]


def safe_extract_zip(archive, target):
    target.mkdir(parents=True, exist_ok=True)
    root = target.resolve()
    with zipfile.ZipFile(archive) as package:
        for item in package.infolist():
            destination = (target / item.filename).resolve()
            if destination != root and root not in destination.parents:
                raise RuntimeError("فایل ZIP موتور مسیر نامعتبر دارد.")
        package.extractall(target)


def install_sdcpp(model_id, revisions=None, variant=None, repair=False):
    recipe, files, _ = sdcpp_weight_plan(model_id, revisions, variant)
    engine_type = "cuda" if selected_device.startswith("cuda") else "cpu"
    existing = sorted((path for path in (SDCPP_ROOT / "engine").glob(f"*/{engine_type}/sd-cli.exe")
                       if (path.parent / ".ready").is_file()), reverse=True)
    if existing:
        engine_exe = existing[0]
        engine_dir = engine_exe.parent
        assets = []
    else:
        engine_tag, assets = sdcpp_engine_assets(selected_device)
        engine_dir = SDCPP_ROOT / "engine" / engine_tag / engine_type
        engine_exe = engine_dir / "sd-cli.exe"
    tasks = []
    if not engine_exe.is_file():
        tasks.extend({"kind": "engine", "name": asset["name"], "url": asset["url"],
                      "size": asset["size"], "sha": asset["sha"],
                      "destination": engine_dir / asset["name"]} for asset in assets)
    tasks.extend({"kind": "weight", "name": file["name"],
                  "url": hf_hub_url(file["repo"], file["name"], revision=file["revision"]),
                  "size": file["size"], "sha": file["sha"],
                  "destination": sdcpp_file_path(model_id, file)} for file in files)
    total = sum(task["size"] for task in tasks)
    if repair:
        emit_progress({"model_id": model_id, "phase": "verifying"})
    for task in tasks:
        task["done"] = valid_download(task["destination"], task["size"], task["sha"] if repair else None)
    def current_size(task):
        destination = task["destination"]
        part = Path(str(destination) + ".part")
        if task["done"]:
            return task["size"]
        return min(part.stat().st_size, task["size"]) if part.is_file() else 0
    saved = sum(current_size(task) for task in tasks)
    if shutil.disk_usage(SDCPP_ROOT if SDCPP_ROOT.exists() else MODEL_HOME).free < total - saved + 2 * 1024**3:
        raise RuntimeError(f"فضای کافی نیست؛ حدود {(total - saved) / 1024**3:.1f} گیگابایت برای مدل و موتور لازم است.")
    started = time.monotonic()
    received = 0
    last_emit = 0.0
    def report(task, position, amount=0, phase="transferring", attempt=1):
        nonlocal received, last_emit
        received += amount
        now = time.monotonic()
        if now - last_emit >= .4 or phase != "transferring" or position == task["size"]:
            last_emit = now
            emit_progress({"model_id": model_id, "phase": phase, "file": task["name"],
                           "processed": position + sum(current_size(other) for other in tasks if other is not task), "received": received,
                           "total": total, "speed": received / max(now - started, .001), "attempt": attempt})
    for task in tasks:
        destination = task["destination"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        part = Path(str(destination) + ".part")
        size = current_size(task)
        report(task, size, phase="resuming" if size else "starting")
        if not task["done"]:
            for attempt in range(1, 13):
                try:
                    download_resumable(task["url"], part, destination, task["size"], task["sha"],
                                       lambda position, amount: report(task, position, amount, attempt=attempt),
                                       lambda phase: report(task, current_size(task), phase=phase, attempt=attempt))
                    break
                except Exception as error:
                    if attempt == 12 or permanent_download_error(error):
                        raise RuntimeError(f"دانلود {task['name']} متوقف شد؛ بخش دریافت‌شده حفظ شد: {error}") from error
                    report(task, current_size(task), phase="retrying", attempt=attempt + 1)
                    time.sleep(min(3 * attempt, 20))
        task["done"] = True
        report(task, task["size"])
    if assets:
        emit_progress({"model_id": model_id, "phase": "installing", "processed": total, "total": total})
        for asset in assets:
            safe_extract_zip(engine_dir / asset["name"], engine_dir)
    if not engine_exe.is_file():
        raise RuntimeError("فایل sd-cli.exe پس از نصب موتور پیدا نشد.")
    if assets or repair:
        try:
            test = subprocess.run([str(engine_exe), "--help"], cwd=engine_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  timeout=30, creationflags=0x08000000 if os.name == "nt" else 0)
            if b"--diffusion-model" not in test.stdout:
                raise RuntimeError("The engine could not start or its executable is incomplete.")
        except (OSError, subprocess.TimeoutExpired, RuntimeError) as error:
            (engine_dir / ".ready").unlink(missing_ok=True)
            # A failed executable must be fetched/extracted again; weights remain cached.
            engine_exe.unlink(missing_ok=True)
            raise RuntimeError(f"Engine installation failed: {error}") from error
    (engine_dir / ".ready").write_text("verified", encoding="utf-8")
    for asset in assets:
        (engine_dir / asset["name"]).unlink(missing_ok=True)
    manifest = {"id": model_id, "engine": str(engine_exe), "device": selected_device,
                "recipe": recipe, "weights": {f["role"]: str(sdcpp_file_path(model_id, f)) for f in files},
                "sizes": {f["role"]: f["size"] for f in files}}
    manifest_dir = SDCPP_ROOT / "models" / model_id.replace("/", "--")
    manifest_dir.mkdir(parents=True, exist_ok=True)
    pending_manifest = manifest_dir / "manifest.part"
    pending_manifest.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    pending_manifest.replace(manifest_dir / "manifest.json")
    emit_progress({"model_id": model_id, "phase": "complete", "processed": total,
                   "received": received, "total": total, "speed": received / max(time.monotonic()-started,.001)})
    return {"id": model_id, "kind": "sdcpp", "size_gb": round(total / 1024**3, 1)}


def download_checkpoint(model_id, revision=None, repair=False):
    info = retry_call(lambda: HfApi().model_info(model_id, revision=revision, files_metadata=True, timeout=30),
                      "بررسی فایل تک‌فایل", model_id, attempts=3)
    sibling = checkpoint_candidate(info)
    if not sibling or not sibling.size or not sibling.lfs or not sibling.lfs.sha256:
        raise RuntimeError("فایل کامل SD/SDXL با اندازه و شناسهٔ اعتبارسنجی در این مخزن پیدا نشد.")
    family = "sdxl" if any(word in " ".join((info.id, " ".join(info.tags or []))).lower()
                           for word in ("sdxl", "sd-xl", "stable-diffusion-xl", "juggernaut-xl")) else "sd"
    folder = CHECKPOINT_ROOT / model_id.replace("/", "--")
    existing = cached_weight_path(model_id, sibling.rfilename, sibling.size)
    destination = Path(existing) if existing else folder / sibling.rfilename
    part = Path(str(destination) + ".part")
    folder.mkdir(parents=True, exist_ok=True)
    saved = destination.stat().st_size if destination.is_file() else (part.stat().st_size if part.is_file() else 0)
    if shutil.disk_usage(folder).free < max(0, sibling.size - saved) + 1024**3:
        raise RuntimeError("فضای کافی برای فایل مدل و فضای کاری موجود نیست.")
    started = time.monotonic()
    received = 0
    def report(position, amount):
        nonlocal received
        received += amount
        emit_progress({"model_id": model_id, "phase": "transferring", "file": sibling.rfilename,
                       "processed": position, "received": received, "total": sibling.size,
                       "speed": received / max(time.monotonic() - started, .001)})
    emit_progress({"model_id": model_id, "phase": "starting", "file": sibling.rfilename,
                   "processed": min(saved, sibling.size), "received": 0, "total": sibling.size, "speed": 0})
    if repair:
        emit_progress({"model_id": model_id, "phase": "verifying", "file": sibling.rfilename})
    if not valid_download(destination, sibling.size, sibling.lfs.sha256 if repair else None):
        for attempt in range(1, 13):
            try:
                download_resumable(hf_hub_url(model_id, sibling.rfilename, revision=info.sha), part,
                                   destination, sibling.size, sibling.lfs.sha256, report,
                                   lambda phase: emit_progress({"model_id": model_id, "phase": phase, "file": sibling.rfilename}))
                break
            except Exception as error:
                if attempt == 12 or permanent_download_error(error):
                    raise RuntimeError(f"دانلود فایل مدل متوقف شد؛ بخش دریافت‌شده حفظ شد: {error}") from error
                emit_progress({"model_id": model_id, "phase": "retrying", "file": sibling.rfilename,
                               "processed": part.stat().st_size if part.is_file() else 0,
                               "received": received, "total": sibling.size, "speed": 0, "attempt": attempt + 1})
                time.sleep(min(attempt * 3, 20))
    manifest = {"id": model_id, "file": str(destination), "size": sibling.size, "family": family}
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    emit_progress({"model_id": model_id, "phase": "complete", "processed": sibling.size,
                   "received": received, "total": sibling.size, "speed": received / max(time.monotonic() - started, .001)})
    return {"id": model_id, "kind": "checkpoint", "size_gb": round(sibling.size / 1024**3, 2)}


def download(model_id, kind="image", revisions=None, variant=None, repair=False):
    revisions = checked_revisions(revisions or {})
    if kind == "adapter":
        return download_featured_lora(model_id, revisions.get(model_id))
    if kind == "sdcpp":
        return install_sdcpp(model_id, revisions, variant, repair)
    if kind == "checkpoint":
        return download_checkpoint(model_id, revisions.get(model_id), repair)
    import diffusers
    emit_progress({"model_id": model_id, "phase": "checking", "processed": 0, "received": 0, "total": 0, "speed": 0})
    api = HfApi()
    revision = revisions.get(model_id) or download_pin(model_id)
    info = retry_call(lambda: api.model_info(model_id, revision=revision, files_metadata=True, timeout=30), "بررسی مخزن", model_id)
    names = {s.rfilename for s in info.siblings}
    index_name, index_file = retry_call(lambda: remote_pipeline_index(model_id, names, info.sha),
                                         "دریافت مشخصات مدل", model_id)
    config = json.loads(Path(index_file).read_text(encoding="utf-8"))
    class_name = config.get("_class_name", "")
    if is_minimax_image(config):
        if not minimax_engine_ready(diffusers):
            raise RuntimeError(f"MiniMax H3 Image needs Modular Diffusers {MINIMAX_DIFFUSERS} or newer.")
    elif not hasattr(diffusers, class_name) or "prior" in class_name.lower():
        raise RuntimeError("این مدل با موتور مستقل فعلی سازگار نیست.")
    is_video = model_type(class_name) == "video"
    if (kind == "video") != is_video:
        raise RuntimeError("نوع این مدل با بخش انتخاب‌شده سازگار نیست.")
    if kind == "video" and class_name not in SUPPORTED_VIDEO_CLASSES:
        raise RuntimeError("این خانوادهٔ ویدیوساز هنوز در برنامه پشتیبانی نمی‌شود.")
    parts = component_folders(config)
    prefix = "merged-model/" if index_name.startswith("merged-model/") else ""
    selected_files = files_for_pipeline(info.siblings, parts, prefix, index_name)
    missing_parts = missing_pipeline_parts(names, config, prefix)
    if missing_parts:
        raise RuntimeError("این مدل پوشه‌های لازم را ندارد: " + ", ".join(missing_parts) + ". اگر فایل کامل Safetensors دارد، دکمهٔ بررسی را بزنید.")
    siblings = {s.rfilename: s for s in info.siblings}
    sizes = {name: siblings[name].size or 0 for name in selected_files}
    total = sum(sizes.values())
    snapshot_folder = Path(index_file).parent.parent if prefix else Path(index_file).parent
    part_root = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha

    damaged = set()
    if repair:
        emit_progress({"model_id": model_id, "phase": "verifying"})
        for name in selected_files:
            sibling = siblings[name]
            digest = sibling.lfs.sha256 if sibling.lfs else None
            if sizes[name] and not valid_download(snapshot_folder / name, sizes[name], digest):
                damaged.add(name)

    def completed(name):
        return name not in damaged and valid_download(snapshot_folder / name, sizes[name])

    def part_size(name):
        part = part_root / (name + ".part")
        return min(part.stat().st_size, sizes[name]) if part.is_file() else 0

    def saved_bytes():
        return sum(sizes[name] if completed(name) else part_size(name) for name in selected_files)

    missing_size = max(0, total - saved_bytes())
    if missing_size and shutil.disk_usage(snapshot_folder).free < missing_size + 2 * 1024**3:
        raise RuntimeError(f"فضای کافی نیست. برای فایل‌های باقی‌مانده حدود {missing_size / 1024**3:.1f} گیگابایت نیاز است.")
    save_download_pin(model_id, info.sha)
    started = time.monotonic()
    state = {"received": 0, "last_emit": 0.0, "file": ""}

    def report(phase="transferring", force=False, attempt=1):
        now = time.monotonic()
        if not force and now - state["last_emit"] < 0.4:
            return
        state["last_emit"] = now
        emit_progress({"model_id": model_id, "phase": phase, "file": state["file"],
                       "attempt": attempt, "processed": saved_bytes(), "received": state["received"],
                       "total": total, "speed": state["received"] / max(now - started, 0.001)})

    report("resuming" if saved_bytes() else "starting", True)
    for name in selected_files:
        state["file"] = name
        if completed(name):
            report(force=True)
            continue
        sibling = siblings[name]
        if sizes[name] and sibling.lfs and sibling.lfs.sha256:
            destination = snapshot_folder / name
            part_path = part_root / (name + ".part")
            url = hf_hub_url(model_id, name, revision=info.sha)
            for attempt in range(1, 13):
                try:
                    def on_chunk(position, amount):
                        state["received"] += amount
                        report(attempt=attempt)
                    download_resumable(url, part_path, destination, sizes[name], sibling.lfs.sha256, on_chunk,
                                       lambda phase: report(phase, True, attempt))
                    damaged.discard(name)
                    break
                except Exception as error:
                    if attempt == 12 or permanent_download_error(error):
                        raise RuntimeError(f"دانلود {name} متوقف شد؛ دادهٔ نیمه‌تمام حفظ شده است: {error}") from error
                    report("retrying", True, attempt + 1)
                    time.sleep(min(3 * attempt, 20))
        else:
            retry_call(lambda: hf_hub_download(model_id, name, revision=info.sha,
                       cache_dir=MODEL_CACHE, etag_timeout=30,
                       force_download=bool(sizes[name]) and (snapshot_folder / name).exists()), f"دانلود {name}", model_id)
            damaged.discard(name)
        report(force=True)
    report("verifying", True)
    if any(sizes[name] and not completed(name) for name in selected_files) or model_id not in complete_models(kind):
        raise RuntimeError("دانلود تمام شد ولی فایل‌های لازم برای اجرا کامل نیستند.")
    save_download_pin(model_id, None)
    report("complete", True)
    return {"id": model_id, "size_gb": round(total / 1024**3, 1)}


def tts_search(query):
    query = query.strip().lower()
    language_names = {"فارسی": "fas", "persian": "fas", "english": "eng", "انگلیسی": "eng",
                      "عربی": "ara", "arabic": "ara", "turkish": "tur", "ترکی": "tur",
                      "french": "fra", "فرانسوی": "fra", "german": "deu", "آلمانی": "deu"}
    code = language_names.get(query, query)
    api = HfApi()
    if query in ("فارسی", "persian", "farsi", "fas"):
        found = list(api.list_models(search="persian", filter="text-to-speech", sort="downloads", limit=100))
        found += list(api.list_models(search="farsi", filter="text-to-speech", sort="downloads", limit=200))
        found += list(api.list_models(search="mms-tts-fas", limit=10))
    elif query:
        found = list(api.list_models(search=query, filter="text-to-speech", sort="downloads", limit=200))
        if re.fullmatch(r"[a-z]{3}", code):
            found += list(api.list_models(search="mms-tts-" + code, limit=10))
    else:
        found = list(api.list_models(filter="text-to-speech", sort="downloads", limit=200))
        found += list(api.list_models(search="Qwen3-TTS-12Hz", limit=10))
    results = [{"id": item.id, "language": "فارسی" if any(word in item.id.lower() for word in ("persian", "farsi", "-fas")) else "متن به گفتار",
                "downloads": item.downloads or 0, "engine": "Qwen3-TTS" if item.id in QWEN_TTS_MODELS else
                "VITS" if "mms-tts" in item.id.lower() else "نیازمند بررسی"}
               for item in {item.id: item for item in found}.values() if item.pipeline_tag in ("text-to-speech", None)]
    return sorted(results, key=lambda item: (item["engine"] in ("VITS", "Qwen3-TTS"), item["downloads"]), reverse=True)[:200]


def tts_info(model_id):
    info = retry_call(lambda: HfApi().model_info(model_id, files_metadata=True, timeout=20),
                      "بررسی مدل صدا", model_id, attempts=2)
    size = info.used_storage or sum(s.size or 0 for s in info.siblings or [])
    if model_id in QWEN_TTS_MODELS:
        engine, reason = "Qwen3-TTS", "قابل نصب با موتور Qwen3-TTS"
    else:
        names = {s.rfilename for s in info.siblings or []}
        if not {"config.json", "vocab.json", "tokenizer_config.json", "model.safetensors"}.issubset(names):
            engine, reason = None, "فایل‌های موتور VITS در مخزن کامل نیست"
        else:
            config = json.loads(Path(hf_hub_download(model_id, "config.json", revision=info.sha,
                                                     cache_dir=MODEL_CACHE)).read_text(encoding="utf-8"))
            engine = "VITS" if config.get("model_type") == "vits" else None
            reason = "قابل نصب با موتور VITS" if engine else "این مدل موتور دیگری لازم دارد"
    files = []
    if engine:
        names = {"config.json", "vocab.json", "tokenizer_config.json", "model.safetensors", "special_tokens_map.json"}
        selected = [file for file in info.siblings if
                    (file.rfilename.endswith((".json", ".txt", ".safetensors")) if engine == "Qwen3-TTS" else file.rfilename in names)]
        snapshot = MODEL_CACHE / ("models--" + model_id.replace("/", "--")) / "snapshots" / info.sha
        parts = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha
        files = [(file.size, snapshot / file.rfilename, parts / (file.rfilename + ".part")) for file in selected]
    complete_sizes = files and all(isinstance(size, int) for size, _, _ in files)
    return {"engine": engine, "reason": reason, "size_gb": round(size / 1024**3, 2),
            "download_kind": "voice" if engine else None, "gated": bool(info.gated and not get_token()),
            "requirements": [engine] if engine else [], "revisions": {model_id: info.sha},
            "download_bytes": sum(size for size, _, _ in files) if complete_sizes else None,
            "remaining_bytes": sum(download_bytes_left(*file) for file in files) if complete_sizes else None,
            **describe_download_plan(files)}


QWEN_TTS_MODELS = ("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")


def tts_installed():
    return sorted({name for name, _ in tts_paths()})


def tts_paths():
    result = []
    for cache in (MODEL_CACHE, ORIGINAL_HF_HOME / "hub"):
        if cache.is_dir():
            for repo in cache.glob("models--*"):
                for path in (repo / "snapshots").glob("*"):
                    if all((path / name).is_file() for name in ("config.json", "vocab.json", "model.safetensors")) and (
                        "Qwen3-TTS" not in repo.name or (path / "speech_tokenizer" / "model.safetensors").is_file()):
                        try:
                            config = json.loads((path / "config.json").read_text(encoding="utf-8"))
                            if config.get("model_type") == "vits" or "Qwen3-TTS" in repo.name:
                                result.append((repo.name.removeprefix("models--").replace("--", "/", 1), path))
                        except (OSError, ValueError):
                            continue
    return result


def tts_download(model_id, revision=None):
    if model_id in QWEN_TTS_MODELS:
        return qwen_tts_download(model_id, revision)
    info = retry_call(lambda: HfApi().model_info(model_id, revision=revision, files_metadata=True, timeout=20),
                      "بررسی مدل صدا", model_id, attempts=3)
    files = {s.rfilename: s for s in info.siblings or []}
    config_path = hf_hub_download(model_id, "config.json", revision=info.sha, cache_dir=MODEL_CACHE)
    if json.loads(Path(config_path).read_text(encoding="utf-8")).get("model_type") != "vits":
        raise RuntimeError("این مدل با موتور VITS سازگار نیست.")
    required = ("config.json", "vocab.json", "tokenizer_config.json", "model.safetensors")
    if any(name not in files for name in required):
        raise RuntimeError("فایل‌های لازم برای موتور MMS-TTS در مخزن کامل نیست.")
    weight = files["model.safetensors"]
    if not weight.size or not weight.lfs or not weight.lfs.sha256:
        raise RuntimeError("اندازه یا شناسهٔ فایل مدل صدا مشخص نیست.")
    for name in required:
        if name != "model.safetensors":
            hf_hub_download(model_id, name, revision=info.sha, cache_dir=MODEL_CACHE)
    if "special_tokens_map.json" in files:
        hf_hub_download(model_id, "special_tokens_map.json", revision=info.sha, cache_dir=MODEL_CACHE)
    destination = Path(hf_hub_download(model_id, "config.json", revision=info.sha, cache_dir=MODEL_CACHE)).parent / "model.safetensors"
    part = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha / "model.safetensors.part"
    existing = cached_weight_path(model_id, "model.safetensors", weight.size)
    if existing:
        destination = Path(existing)
    else:
        started = time.monotonic()
        received = 0
        def report(position, amount):
            nonlocal received
            received += amount
            emit_progress({"model_id": model_id, "phase": "transferring", "file": "model.safetensors",
                           "processed": position, "received": received, "total": weight.size,
                           "speed": received / max(time.monotonic() - started, .001)})
        emit_progress({"model_id": model_id, "phase": "starting", "processed": 0, "received": 0,
                       "total": weight.size, "speed": 0})
        for attempt in range(1, 13):
            try:
                download_resumable(hf_hub_url(model_id, "model.safetensors", revision=info.sha), part,
                                   destination, weight.size, weight.lfs.sha256, report)
                break
            except Exception as error:
                if attempt == 12 or permanent_download_error(error):
                    raise RuntimeError(f"دانلود مدل صدا متوقف شد؛ بخش دریافت‌شده حفظ شد: {error}") from error
                emit_progress({"model_id": model_id, "phase": "retrying", "file": "model.safetensors",
                               "processed": part.stat().st_size if part.is_file() else 0,
                               "received": received, "total": weight.size, "speed": 0, "attempt": attempt + 1})
                time.sleep(min(attempt * 3, 20))
    emit_progress({"model_id": model_id, "phase": "complete", "processed": weight.size,
                   "received": 0, "total": weight.size, "speed": 0})
    return {"id": model_id}


def qwen_tts_download(model_id, revision=None):
    info = retry_call(lambda: HfApi().model_info(model_id, revision=revision, files_metadata=True, timeout=30),
                      "بررسی مدل Qwen3-TTS", model_id, attempts=3)
    selected = [s for s in info.siblings if s.rfilename.endswith((".json", ".txt", ".safetensors"))]
    total = sum(s.size or 0 for s in selected)
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    snapshot = MODEL_CACHE / ("models--" + model_id.replace("/", "--")) / "snapshots" / info.sha
    parts = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha
    remaining = sum(download_bytes_left(file.size or 0, snapshot / file.rfilename, parts / (file.rfilename + ".part"))
                    for file in selected)
    if remaining and shutil.disk_usage(MODEL_CACHE).free < remaining + 2 * 1024**3:
        raise RuntimeError(f"برای مدل Qwen3-TTS حدود {total / 1024**3:.1f} گیگابایت و فضای کاری بیشتر لازم است.")
    base = None
    received, done, started = 0, 0, time.monotonic()
    for sibling in selected:
        name = sibling.rfilename
        if name.endswith(".safetensors"):
            if not sibling.size or not sibling.lfs or not sibling.lfs.sha256:
                raise RuntimeError(f"اندازه یا شناسهٔ فایل {name} مشخص نیست.")
            if base is None:
                base = Path(hf_hub_download(model_id, "config.json", revision=info.sha, cache_dir=MODEL_CACHE)).parent
            destination = base / name
            part = MODEL_CACHE / ".nocturne-parts" / model_id / info.sha / (name + ".part")
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.is_file() or destination.stat().st_size != sibling.size:
                for attempt in range(1, 13):
                    try:
                        def report(position, amount):
                            nonlocal received
                            received += amount
                            emit_progress({"model_id": model_id, "phase": "transferring", "file": name,
                                           "processed": done + position, "received": received, "total": total,
                                           "speed": received / max(.001, time.monotonic() - started)})
                        download_resumable(hf_hub_url(model_id, name, revision=info.sha), part,
                                           destination, sibling.size, sibling.lfs.sha256, report,
                                           lambda phase: emit_progress({"model_id": model_id, "phase": phase, "file": name}))
                        break
                    except Exception as error:
                        if attempt == 12 or permanent_download_error(error):
                            raise RuntimeError(f"دانلود {name} متوقف شد؛ بخش دریافت‌شده حفظ شد: {error}") from error
                        emit_progress({"model_id": model_id, "phase": "retrying", "file": name, "attempt": attempt + 1})
                        time.sleep(min(attempt * 3, 20))
        else:
            hf_hub_download(model_id, name, revision=info.sha, cache_dir=MODEL_CACHE)
        done += sibling.size or 0
    emit_progress({"model_id": model_id, "phase": "complete", "processed": total,
                   "received": 0, "total": total, "speed": 0})
    return {"id": model_id}


def tts_generate(model_id, text):
    if not text.strip() or len(text) > 500:
        raise RuntimeError("متن صدا باید بین ۱ تا ۵۰۰ نویسه باشد.")
    if model_id in QWEN_TTS_MODELS:
        return qwen_tts_generate(model_id, text)
    request = json.dumps({"model_id": model_id, "text": text, "device": selected_device}, ensure_ascii=False)
    try:
        result = subprocess.run([sys.executable, "-u", str(Path(__file__).resolve()), "--vits-tts-worker"],
            input=request + "\n", text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=300, creationflags=0x08000000 if os.name == "nt" else 0)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("ساخت صدا پس از ۵ دقیقه متوقف شد. متن کوتاه‌تر یا CPU را امتحان کنید.") from error
    if result.returncode:
        raise RuntimeError("موتور صدا: " + result.stderr[-1400:])
    return json.loads(result.stdout.strip().splitlines()[-1])


def vits_generate(model_id, text):
    import torch
    import numpy as np
    if model_id in QWEN_TTS_MODELS:
        return qwen_tts_generate(model_id, text)
    from transformers import VitsModel, VitsTokenizer
    if model_id not in tts_installed():
        raise RuntimeError("ابتدا مدل زبان انتخاب‌شده را دانلود کنید.")
    if not text.strip():
        raise RuntimeError("متن صدا خالی است.")
    if len(text) > 500:
        raise RuntimeError("برای جلوگیری از توقف طولانی، متن را به بخش‌های کوتاه‌تر از ۵۰۰ نویسه تقسیم کنید.")
    if model_id not in tts_loaded:
        folder = next((str(path) for name, path in tts_paths() if name == model_id), None)
        if not folder:
            raise RuntimeError("فایل مدل صدا در کش پیدا نشد.")
        tokenizer = VitsTokenizer.from_pretrained(folder, local_files_only=True)
        if tokenizer.is_uroman:
            ensure_package("uroman", "uroman")
        model = VitsModel.from_pretrained(folder, local_files_only=True).to(selected_device).eval()
        tts_loaded[model_id] = (tokenizer, model)
    tokenizer, model = tts_loaded[model_id]
    inputs = tokenizer(text.strip(), return_tensors="pt").to(model.device)
    with torch.inference_mode():
        waveform = model(**inputs).waveform[0].detach().float().cpu().numpy()
    samples = (np.clip(waveform, -1, 1) * 32767).astype("<i2")
    folder = OUTPUT_DIR / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"voice_{datetime.now():%Y%m%d_%H%M%S_%f}.wav"
    path = folder / name
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(model.config.sampling_rate)
        file.writeframes(samples.tobytes())
    path.with_suffix(".json").write_text(json.dumps({"text": text, "model": model_id}, ensure_ascii=False), encoding="utf-8")
    return {"name": name, "model": model_id}


def qwen_tts_generate(model_id, text):
    if not text.strip():
        raise RuntimeError("متن صدا خالی است.")
    if len(text) > 500:
        raise RuntimeError("برای ساخت صدا متن را به بخش‌های کوتاه‌تر از ۵۰۰ نویسه تقسیم کنید.")
    runtime = MODEL_HOME / "nocturne-qwen-runtime"
    python = runtime / "Scripts" / "python.exe"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", "--system-site-packages", str(runtime)],
                       stdout=sys.stderr, stderr=sys.stderr, check=True)
    probe = subprocess.run([str(python), "-c", "import qwen_tts, transformers; assert transformers.__version__ == '4.57.3'"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    if probe.returncode != 0:
        subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "qwen-tts==0.1.1", "transformers==4.57.3"],
                       stdout=sys.stderr, stderr=sys.stderr, check=True)
    request = json.dumps({"model_id": model_id, "text": text, "device": selected_device,
                          "original_home": str(ORIGINAL_HF_HOME),
                          "model_home": str(MODEL_HOME), "output_dir": str(OUTPUT_DIR)}, ensure_ascii=False)
    try:
        result = subprocess.run([str(python), "-u", str(Path(__file__).resolve()), "--qwen-tts-worker"],
                                input=request + "\n", text=True, encoding="utf-8", errors="replace",
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
                                creationflags=0x08000000 if os.name == "nt" else 0)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("ساخت صدا بیش از ۵ دقیقه طول کشید و متوقف شد. متن کوتاه‌تری وارد کنید.") from error
    if result.returncode != 0:
        raise RuntimeError("موتور Qwen3-TTS: " + result.stderr[-1800:])
    return json.loads(result.stdout.strip().splitlines()[-1])


def run_qwen_tts_worker():
    import torch
    import numpy as np
    from qwen_tts import Qwen3TTSModel
    request = json.loads(sys.stdin.readline())
    model_id, text = request["model_id"], request["text"]
    device = request["device"]
    if not text.strip():
        raise RuntimeError("متن صدا خالی است.")
    if not device.startswith("cuda"):
        raise RuntimeError("برای Qwen3-TTS کارت گرافیک NVIDIA را انتخاب کنید.")
    cache = Path(request["model_home"]) / "hub"
    caches = [cache, Path(request.get("original_home", request["model_home"])) / "hub"]
    folder = next((str(path) for candidate in caches for path in (candidate / ("models--" + model_id.replace("/", "--")) / "snapshots").glob("*")
                   if (path / "model.safetensors").is_file() and (path / "speech_tokenizer" / "model.safetensors").is_file()), None)
    if not folder:
        raise RuntimeError("مدل Qwen3-TTS کامل دانلود نشده است.")
    model = Qwen3TTSModel.from_pretrained(folder, device_map=device, dtype=torch.bfloat16,
                                          attn_implementation="sdpa")
    wavs, sample_rate = model.generate_custom_voice(text=text.strip(), speaker="Ryan", language="Auto",
                                                    max_new_tokens=384)
    samples = (np.clip(wavs[0], -1, 1) * 32767).astype("<i2")
    folder_out = Path(request["output_dir"]) / "audio"
    folder_out.mkdir(parents=True, exist_ok=True)
    name = f"voice_{datetime.now():%Y%m%d_%H%M%S_%f}.wav"
    path = folder_out / name
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(sample_rate)
        file.writeframes(samples.tobytes())
    path.with_suffix(".json").write_text(json.dumps({"text": text, "model": model_id}, ensure_ascii=False), encoding="utf-8")
    return {"name": name, "model": model_id}


def tts_gallery():
    folder = OUTPUT_DIR / "audio"
    if not folder.is_dir():
        return []
    result = []
    for path in sorted(folder.glob("*.wav"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            metadata = json.loads(path.with_suffix(".json").read_text(encoding="utf-8")) if path.with_suffix(".json").is_file() else {}
            with wave.open(str(path), "rb") as file:
                duration = round(file.getnframes() / file.getframerate(), 1)
            result.append({"name": path.name, "text": metadata.get("text", ""),
                           "model": metadata.get("model", ""), "duration": duration})
        except (OSError, ValueError, wave.Error):
            pass
    return result


def tts_audio(name):
    path = OUTPUT_DIR / "audio" / Path(name).name
    if not path.is_file():
        raise FileNotFoundError("فایل صدا پیدا نشد.")
    return "data:audio/wav;base64," + base64.b64encode(path.read_bytes()).decode()


def web_config():
    try:
        data = json.loads(WEB_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data.setdefault("users", {})
    data.setdefault("min_free_ram_gb", 2)
    return data


def save_web_config(data):
    WEB_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    part = WEB_CONFIG.with_suffix(".tmp")
    part.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    part.replace(WEB_CONFIG)


def web_status():
    global WEB_TUNNEL, WEB_TUNNEL_URL
    if WEB_TUNNEL and WEB_TUNNEL.poll() is not None:
        WEB_TUNNEL, WEB_TUNNEL_URL = None, ""
    host = "127.0.0.1"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("1.1.1.1", 80))
            host = sock.getsockname()[0]
    except OSError:
        pass
    port = WEB_SERVER.server_port if WEB_SERVER else None
    return {"running": WEB_SERVER is not None, "local_url": f"http://{host}:{port}" if port else "",
            "private_ip": host, "public_ip": WEB_PUBLIC_IP, "public_url": "",
            "tunnel_url": WEB_TUNNEL_URL if WEB_TUNNEL_CONNECTED else "",
            "tunnel_error": WEB_TUNNEL_ERROR,
            "gallery_folder": str(WEB_CONFIG.parent / "web_gallery"),
            "port": port, "users": len(web_config()["users"]),
            "min_free_ram_gb": web_config()["min_free_ram_gb"]}


def web_create_user(name, password, quota):
    name = name.strip()
    if not 1 <= len(name) <= 40 or any(c in name for c in "/\\\x00") or not 1 <= int(quota) <= 10000:
        raise RuntimeError("نام کاربر یا سهمیه نامعتبر است.")
    if len(password) < 8:
        raise RuntimeError("رمز باید دست‌کم ۸ نویسه داشته باشد.")
    with WEB_LOCK:
        data = web_config()
        if name in data["users"]:
            raise RuntimeError("این نام کاربری وجود دارد.")
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
        data["users"][name] = {"password_salt": salt.hex(), "password_hash": digest.hex(),
                               "quota": int(quota), "used": 0, "day": datetime.now().date().isoformat()}
        save_web_config(data)
    return {"name": name}


def web_revoke_user(name):
    with WEB_LOCK:
        data = web_config()
        data["users"].pop(name, None)
        for token, session in list(WEB_SESSIONS.items()):
            if session[0] == name:
                WEB_SESSIONS.pop(token, None)
        save_web_config(data)
    return web_users()


def web_users():
    return [{"name": name, "quota": value["quota"], "used": value.get("used", 0)}
            for name, value in web_config()["users"].items()]


def web_set_password(name, password):
    if len(password) < 8:
        raise RuntimeError("رمز باید دست‌کم ۸ نویسه داشته باشد.")
    with WEB_LOCK:
        data = web_config()
        if name not in data["users"]:
            raise RuntimeError("کاربر پیدا نشد.")
        salt = secrets.token_bytes(16)
        user = data["users"][name]
        user.pop("token_hash", None)
        user["password_salt"] = salt.hex()
        user["password_hash"] = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000).hex()
        for token, session in list(WEB_SESSIONS.items()):
            if session[0] == name:
                WEB_SESSIONS.pop(token, None)
        save_web_config(data)
    return web_users()


def web_loaded_models():
    items = [item for item in loaded_models() if item["kind"] in ("image", "checkpoint")]
    if active_kind == "sdcpp" and active_model:
        items.append({"id": active_model, "kind": "sdcpp", "active": True})
    return items


def web_gallery_folder(name):
    return WEB_CONFIG.parent / "web_gallery" / hashlib.sha256(name.encode("utf-8")).hexdigest()[:20]


def web_gallery():
    root = WEB_CONFIG.parent / "web_gallery"
    result = []
    if root.is_dir():
        for folder in root.iterdir():
            if not folder.is_dir() or not (folder / "owner.txt").is_file():
                continue
            user = (folder / "owner.txt").read_text(encoding="utf-8")
            for path in folder.glob("*.png"):
                try:
                    meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    meta = {}
                result.append({"user": user, "name": path.name, "prompt": meta.get("original_prompt", ""),
                               "model": meta.get("model", ""), "date": datetime.fromtimestamp(path.stat().st_mtime).isoformat()})
    result.sort(key=lambda item: item["date"], reverse=True)
    return {"folders": sorted(set(web_config()["users"]) | {item["user"] for item in result}), "images": result[:300]}


WEB_PAGE = Path(__file__).with_name("web_page.html").read_text(encoding="utf-8")


class WebHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def authenticated_user(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not 20 <= len(token) <= 200:
            return None
        session = WEB_SESSIONS.get(hashlib.sha256(token.encode()).hexdigest())
        if not session or session[1] < time.time():
            return None
        return session[0] if session[0] in web_config()["users"] else None

    def send_json(self, status, value):
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/healthz":
            return self.send_json(200, {"ok": True})
        if self.path.startswith("/api/"):
            name = self.authenticated_user()
            if not name:
                return self.send_json(401, {"error": "ابتدا وارد شوید"})
            if self.path == "/api/models":
                return self.send_json(200, {"models": web_loaded_models()})
            if self.path == "/api/gallery":
                return self.send_json(200, web_gallery())
            if self.path.startswith("/api/image?"):
                from urllib.parse import parse_qs, urlsplit
                query = parse_qs(urlsplit(self.path).query)
                user = query.get("user", [""])[0]
                filename = query.get("name", [""])[0]
                if filename != Path(filename).name or not filename.endswith(".png"):
                    return self.send_json(400, {"error": "نام فایل نامعتبر است"})
                folder = web_gallery_folder(user)
                if not (folder / "owner.txt").is_file() or (folder / "owner.txt").read_text(encoding="utf-8") != user:
                    return self.send_json(404, {"error": "پوشه پیدا نشد"})
                image = folder / filename
                if not image.is_file():
                    return self.send_json(404, {"error": "عکس پیدا نشد"})
                content = image.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "private, no-store")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                return self.wfile.write(content)
            return self.send_json(404, {"error": "پیدا نشد"})
        if self.path != "/":
            return self.send_json(404, {"error": "پیدا نشد"})
        content = WEB_PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self' data: 'unsafe-inline'")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path not in ("/api/login", "/api/generate"):
            return self.send_json(404, {"error": "پیدا نشد"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"error": "اندازهٔ درخواست نامعتبر است"})
        if not 0 < length <= 16384:
            return self.send_json(400, {"error": "اندازهٔ درخواست نامعتبر است"})
        try:
            request = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "دادهٔ درخواست نامعتبر است"})
        if self.path == "/api/login":
            address = self.client_address[0]
            now = time.monotonic()
            attempts = [stamp for stamp in WEB_LOGIN_ATTEMPTS.get(address, []) if now - stamp < 300]
            if len(attempts) >= 5:
                return self.send_json(429, {"error": "تلاش‌های ورود زیاد است؛ چند دقیقه صبر کنید"})
            username = str(request.get("username", ""))
            password = str(request.get("password", ""))
            user = web_config()["users"].get(username)
            valid = False
            if user and user.get("password_salt") and user.get("password_hash"):
                digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(user["password_salt"]), 200_000)
                valid = secrets.compare_digest(digest.hex(), user["password_hash"])
            if not valid:
                WEB_LOGIN_ATTEMPTS[address] = attempts + [now]
                return self.send_json(401, {"error": "نام کاربری یا رمز اشتباه است"})
            WEB_LOGIN_ATTEMPTS.pop(address, None)
            token = secrets.token_urlsafe(32)
            WEB_SESSIONS[hashlib.sha256(token.encode()).hexdigest()] = (username, time.time() + 24 * 3600)
            return self.send_json(200, {"session": token, "name": username})
        username = self.authenticated_user()
        if not username:
            return self.send_json(401, {"error": "ابتدا وارد شوید"})
        if not WEB_LOCK.acquire(blocking=False):
            return self.send_json(429, {"error": "سرور مشغول ساخت تصویر دیگری است"})
        try:
            data = web_config()
            user = data["users"].get(username)
            if not user:
                return self.send_json(401, {"error": "حساب کاربری فعال نیست"})
            today = datetime.now().date().isoformat()
            if user.get("day") != today:
                user["day"], user["used"] = today, 0
            if user["used"] >= user["quota"]:
                return self.send_json(429, {"error": "سهمیهٔ روزانه تمام شده است"})
            try:
                import psutil
                if psutil.virtual_memory().available < float(data["min_free_ram_gb"]) * 1024**3:
                    return self.send_json(503, {"error": "رم آزاد سیستم کمتر از حد تنظیم‌شده است"})
            except ImportError:
                return self.send_json(503, {"error": "ابزار بررسی رم نصب نیست؛ راه‌اندازی اولیه را دوباره اجرا کنید"})
            try:
                prompt = str(request.get("prompt", "")).strip()
                if not 1 <= len(prompt) <= 1500:
                    raise RuntimeError("پرامپت باید بین ۱ تا ۱۵۰۰ نویسه باشد")
                aspect = request.get("aspect_ratio", "1:1")
                if aspect not in ASPECT_RATIOS:
                    raise RuntimeError("نسبت تصویر نامعتبر است")
                choice = str(request.get("model", ""))
                available = {item["kind"] + ":" + item["id"]: item for item in web_loaded_models()}
                if choice not in available:
                    raise RuntimeError("مدل انتخابی در حافظهٔ سرور آماده نیست")
                item = available[choice]
                previous = (active_kind, active_model)
                try:
                    if (item["kind"], item["id"]) != previous:
                        load_model(item["id"], item["kind"])
                    result = generate_sdcpp(prompt, aspect_ratio=aspect, temporary=True) if active_kind == "sdcpp" else generate(prompt, aspect_ratio=aspect, temporary=True)
                finally:
                    if previous[1] and previous != (active_kind, active_model):
                        load_model(previous[1], previous[0])
                folder = web_gallery_folder(username)
                folder.mkdir(parents=True, exist_ok=True)
                (folder / "owner.txt").write_text(username, encoding="utf-8")
                source = TEMP_IMAGES / result["name"]
                shutil.move(str(source), str(folder / result["name"]))
                metadata = source.with_suffix(".json")
                if metadata.is_file():
                    shutil.move(str(metadata), str(folder / metadata.name))
                user["used"] += 1
                save_web_config(data)
                return self.send_json(200, {"image": result["image"], "model": result["model"]})
            except Exception as error:
                return self.send_json(500, {"error": str(error)[:300]})
        finally:
            WEB_LOCK.release()


def web_start(port):
    global WEB_SERVER, WEB_THREAD, WEB_PUBLIC_IP
    if WEB_SERVER:
        return web_status()
    port = int(port)
    if not 1024 <= port <= 65535:
        raise RuntimeError("پورت باید بین ۱۰۲۴ و ۶۵۵۳۵ باشد")
    WEB_SERVER = ThreadingHTTPServer(("0.0.0.0", port), WebHandler)
    WEB_SERVER.daemon_threads = True
    WEB_THREAD = threading.Thread(target=WEB_SERVER.serve_forever, daemon=True)
    WEB_THREAD.start()
    try:
        WEB_PUBLIC_IP = requests.get("https://api.ipify.org", timeout=4).text.strip()
    except requests.RequestException:
        WEB_PUBLIC_IP = ""
    return web_status()


def web_stop():
    global WEB_SERVER, WEB_THREAD
    web_public_stop()
    if WEB_SERVER:
        WEB_SERVER.shutdown()
        WEB_SERVER.server_close()
        WEB_SERVER = None
        WEB_THREAD = None
    return web_status()


def web_public_start():
    global WEB_TUNNEL, WEB_TUNNEL_URL, WEB_TUNNEL_CONNECTED, WEB_TUNNEL_ERROR
    if not WEB_SERVER:
        raise RuntimeError("ابتدا وب‌سایت را روشن کنید")
    if WEB_TUNNEL and WEB_TUNNEL.poll() is None and WEB_TUNNEL_CONNECTED:
        return web_status()
    web_public_stop()
    WEB_TUNNEL_ERROR = ""
    try:
        health = requests.get(f"http://127.0.0.1:{WEB_SERVER.server_port}/healthz", timeout=5)
        health.raise_for_status()
        if health.json().get("ok") is not True:
            raise RuntimeError("پاسخ سرویس محلی معتبر نیست")
    except Exception as error:
        raise RuntimeError(f"وب‌سایت روی همین سیستم پاسخ نمی‌دهد: {error}") from error
    binary = shutil.which("cloudflared")
    if not binary:
        binary_path = MODEL_HOME / "nocturne-tools" / "cloudflared.exe"
        if not binary_path.is_file():
            binary_path.parent.mkdir(parents=True, exist_ok=True)
            part = binary_path.with_suffix(".part")
            url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
            with requests.get(url, stream=True, timeout=(15, 45)) as response:
                response.raise_for_status()
                with part.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        output.write(chunk)
            if part.stat().st_size < 1024**2 or part.open("rb").read(2) != b"MZ":
                part.unlink(missing_ok=True)
                raise RuntimeError("فایل Cloudflare Tunnel معتبر دریافت نشد")
            part.replace(binary_path)
        binary = str(binary_path)
    flags = 0x08000000 if os.name == "nt" else 0
    config = MODEL_HOME / "nocturne-tools" / "quick-tunnel.yml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text("loglevel: info\n", encoding="utf-8")
    errors = []
    for protocol in ("auto", "http2"):
        ready = threading.Event()
        state = {"url": "", "registered": False, "logs": []}
        command = [binary, "tunnel", "--config", str(config), "--no-autoupdate",
                   "--protocol", protocol, "--edge-ip-version", "4",
                   "--url", f"http://127.0.0.1:{WEB_SERVER.server_port}"]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", errors="replace", creationflags=flags)
        WEB_TUNNEL = process

        def read_log(proc=process, current=state, signal=ready):
            global WEB_TUNNEL_URL, WEB_TUNNEL_CONNECTED
            for line in proc.stderr:
                current["logs"] = (current["logs"] + [line.strip()])[-12:]
                match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if match:
                    current["url"] = match.group(0)
                if "registered tunnel connection" in line.lower():
                    current["registered"] = True
                if current["url"] and current["registered"]:
                    if WEB_TUNNEL is proc:
                        WEB_TUNNEL_URL = current["url"]
                        WEB_TUNNEL_CONNECTED = True
                    signal.set()
            if WEB_TUNNEL is proc:
                WEB_TUNNEL_CONNECTED = False
            signal.set()

        threading.Thread(target=read_log, daemon=True).start()
        ready.wait(38)
        if state["registered"] and state["url"] and process.poll() is None:
            return web_status()
        errors.extend(state["logs"][-4:])
        web_public_stop()
    WEB_TUNNEL_ERROR = "اتصال به Cloudflare برقرار نشد. برنامه TCP و UDP را امتحان کرد. خروجی پورت 7844 باید در فایروال یا شبکه مجاز باشد؛ بستن این پورت توسط سرویس اینترنت یا محدودیت روتر از داخل برنامه قابل رفع نیست."
    if errors:
        WEB_TUNNEL_ERROR += "\n" + "\n".join(errors)[-1400:]
    raise RuntimeError(WEB_TUNNEL_ERROR)


def web_public_stop():
    global WEB_TUNNEL, WEB_TUNNEL_URL, WEB_TUNNEL_CONNECTED
    WEB_TUNNEL_CONNECTED = False
    if WEB_TUNNEL:
        WEB_TUNNEL.terminate()
        try:
            WEB_TUNNEL.wait(timeout=5)
        except subprocess.TimeoutExpired:
            WEB_TUNNEL.kill()
        WEB_TUNNEL = None
    WEB_TUNNEL_URL = ""
    return web_status()


def chat_download_plan(payload):
    import chat_engine
    repo, filename = payload.get("repo"), payload.get("filename")
    if not isinstance(repo, str) or not isinstance(filename, str):
        return {"requirements": ["Ollama"], "folder": None, "download_bytes": payload.get("size"),
                "reason": "Ollama resolves and stores its own files. Disk use is reported by the engine."}
    info = chat_engine.hf_variants(repo, payload.get("revision"))
    chosen = next((item for item in info["variants"] if filename in item["filenames"]), None)
    if not chosen:
        raise ValueError("The selected GGUF variant was not found.")
    source = HfApi().model_info(repo, revision=info["revision"], files_metadata=True, timeout=20)
    sizes = {item.rfilename: item for item in source.siblings}
    cache = MODEL_CACHE / ("models--" + repo.replace("/", "--"))
    files = []
    for name in chosen["filenames"]:
        item = sizes[name]
        part = cache / "blobs" / (item.lfs.sha256 + ".incomplete") if item.lfs and item.lfs.sha256 else None
        files.append((item.size, cache / "snapshots" / info["revision"] / name, part))
    known = all(isinstance(size, int) for size, _, _ in files)
    return {"requirements": [payload.get("engine") or "llama.cpp"], "gated": bool(info["gated"] and not get_token()),
            "download_bytes": chosen["size"], "remaining_bytes": sum(download_bytes_left(*file) for file in files) if known else None,
            "reason": "Engine prerequisites may be installed separately.", **describe_download_plan(files)}


def model_folder_matches(payload):
    folder = payload.get("folder")
    if folder and Path(folder).resolve() != MODEL_HOME.resolve():
        raise ValueError("Select the original model folder to resume this download.")


def partial_model_files(payload):
    from huggingface_hub.utils import validate_repo_id
    model_id = payload["model_id"]
    validate_repo_id(model_id)
    revisions = checked_revisions(payload.get("revisions") or {})
    revision = revisions.get(model_id) or download_pin(model_id)
    kind = payload.get("kind")
    if kind == "checkpoint":
        base = CHECKPOINT_ROOT / model_id.replace("/", "--")
    elif kind in ("image", "video", "adapter", "voice") and revision:
        base = MODEL_CACHE / ".nocturne-parts" / model_id / revision
    else:
        return []
    root = MODEL_HOME.resolve()
    expected = base.resolve()
    if root not in expected.parents:
        return []
    return [path for path in base.rglob("*.part") if path.is_file() and not path.is_symlink()
            and path.resolve() == expected / path.relative_to(base)]


def download_lock(payload, action="download"):
    kind = payload.get("kind")
    group = "engine:" + ("sdcpp" if kind == "sdcpp" else "chat") if kind in ("sdcpp", "chat") or action == "chat_pull" else ""
    if action == "chat_pull":
        group = "engine:chat"
    key = group or str(payload["model_id"]).casefold()
    name = hashlib.sha256(key.encode()).hexdigest() + ".lock"
    return exclusive_file(MODEL_HOME / ".nocturne-transfers" / name,
                          "Another process is still using this download. Try again shortly.")


def dispatch(action, payload):
    global selected_device, OUTPUT_DIR
    if action in ("download", "tts_download", "chat_pull"):
        model_folder_matches(payload)
        rate = payload.get("bandwidth", 0)
        TRANSFER_LIMIT.bytes_per_sec = max(0, min(rate, 5000 * 1024**2)) if type(rate) is int else 0
        TRANSFER_LIMIT.job_id = payload.get("job_id")
        device = payload.get("device")
        if device == "cpu" or (isinstance(device, str) and re.fullmatch(r"cuda:\d+", device)):
            selected_device = device
        with download_lock(payload, action):
            if action == "download":
                return download(payload["model_id"], payload.get("kind", "image"), payload.get("revisions"),
                                payload.get("variant"), bool(payload.get("repair")))
            if action == "tts_download":
                return tts_download(payload["model_id"], checked_revisions(payload.get("revisions") or {}).get(payload["model_id"]))
            import chat_engine
            def chat_progress(event, data):
                emit_event(event, {**data, "job_id": payload.get("job_id")})
            return chat_engine.dispatch(action, payload, MODEL_HOME, chat_progress)
    if action in ("download_parts_info", "download_parts_delete"):
        model_folder_matches(payload)
        with download_lock(payload):
            paths = partial_model_files(payload)
            size = sum(path.stat().st_size for path in paths)
            if action == "download_parts_delete":
                if size != payload.get("expected_bytes"):
                    raise ValueError("The partial files changed. Review the disk usage and try again.")
                for path in paths:
                    path.unlink()
            return {"bytes": size, "files": len(paths)}
    if action == "chat_download_plan":
        return chat_download_plan(payload)
    if action.startswith("chat_"):
        import chat_engine
        return chat_engine.dispatch(action, payload, MODEL_HOME, emit_event)
    if action == "hf_auth_status":
        return {"logged_in": bool(get_token())}
    if action == "hf_login":
        from huggingface_hub import login
        token = str(payload.get("token", "")).strip()
        if not token:
            raise RuntimeError("توکن Hugging Face خالی است")
        login(token=token, add_to_git_credential=False, skip_if_logged_in=False)
        return {"logged_in": bool(get_token())}
    if action == "web_status":
        return web_status()
    if action == "web_start":
        return web_start(payload.get("port", 8765))
    if action == "web_stop":
        return web_stop()
    if action == "web_public_start":
        return web_public_start()
    if action == "web_public_stop":
        return web_public_stop()
    if action == "web_users":
        return web_users()
    if action == "web_create_user":
        return web_create_user(payload["name"], payload["password"], payload.get("quota", 10))
    if action == "web_set_password":
        return web_set_password(payload["name"], payload["password"])
    if action == "web_revoke_user":
        return web_revoke_user(payload["name"])
    if action == "web_settings":
        value = float(payload.get("min_free_ram_gb", 2))
        if not 0 <= value <= 512:
            raise RuntimeError("مقدار رم نامعتبر است")
        data = web_config()
        data["min_free_ram_gb"] = value
        save_web_config(data)
        return web_status()
    if action == "shutdown":
        web_stop()
        shutil.rmtree(TEMP_IMAGES, ignore_errors=True)
        sys.exit(0)
    if action == "status":
        import torch
        return {"models": list(complete_models("image")), "video_models": list(complete_models("video")), "sdcpp_models": list(sdcpp_models()), "checkpoint_models": list(checkpoint_models()), "adapters": list(downloaded_adapters()), "active": active_model, "active_kind": active_kind, "loaded_models": loaded_models(), "cache_enabled": keep_loaded, "devices": devices(), "device": selected_device, "images": sum(1 for _ in OUTPUT_DIR.glob("*.png")), "model_folder": str(MODEL_HOME), "output_folder": str(OUTPUT_DIR)}
    if action == "models":
        return {"models": list(complete_models("image")), "video_models": list(complete_models("video")), "sdcpp_models": list(sdcpp_models()), "checkpoint_models": list(checkpoint_models()), "adapters": list(downloaded_adapters()), "active": active_model, "active_kind": active_kind, "loaded_models": loaded_models()}
    if action == "cache_mode":
        return set_cache_mode(payload.get("enabled", False))
    if action == "unload":
        return unload_model(payload["model_id"], payload.get("kind", "image"))
    if action == "storage":
        return storage_info()
    if action == "device":
        return choose_device(payload["device"])
    if action == "output_folder":
        OUTPUT_DIR = Path(payload["path"])
        return {"output_folder": str(OUTPUT_DIR)}
    if action == "load":
        if "keep_loaded" in payload:
            set_cache_mode(payload["keep_loaded"])
        return load_model(payload["model_id"], payload.get("kind", "image"))
    if action == "generate":
        return generate_sdcpp(payload["prompt"], aspect_ratio=payload.get("aspect_ratio", "1:1"), temporary=payload.get("temporary", False), metadata=image_context(payload)) if active_kind == "sdcpp" else generate(payload["prompt"], aspect_ratio=payload.get("aspect_ratio", "1:1"), temporary=payload.get("temporary", False), metadata=image_context(payload))
    if action == "image_input_capability":
        return image_input_capability()
    if action == "edit_image":
        return edit_image(payload["prompt"], payload["image"], payload.get("strength", 0.65),
                          payload.get("aspect_ratio", "1:1"), payload.get("temporary", False), image_context(payload), payload.get("mask_image"))
    if action == "save_temporary_image":
        return save_temporary_image(payload["name"])
    if action == "batch_generate":
        return batch_generate(payload["topic"], payload["count"], payload.get("split_cpu", False), payload.get("aspect_ratio", "1:1"), image_context(payload))
    if action == "batch_queue":
        if "keep_loaded" in payload:
            set_cache_mode(payload["keep_loaded"])
        if payload.get("output_folder") and Path(payload["output_folder"]).resolve() != OUTPUT_DIR.resolve():
            raise ValueError("Select the original output folder before resuming this queue.")
        return batch_queue(payload.get("topic", ""), payload["jobs"], payload.get("aspect_ratio", "1:1"),
                           payload.get("run_id", ""), image_context(payload))
    if action == "project_reference":
        return project_reference(payload["project_id"], payload.get("image"),
                                 payload.get("reference_id", ""), payload.get("name", ""))
    if action == "gallery":
        return gallery()
    if action == "video_gallery":
        return video_gallery()
    if action == "video_data":
        return {"video": video_data(payload["name"])}
    if action == "tts_search":
        return tts_search(payload.get("query", ""))
    if action == "tts_info":
        return tts_info(payload["model_id"])
    if action == "tts_installed":
        return tts_installed()
    if action == "tts_generate":
        return tts_generate(payload["model_id"], payload["text"])
    if action == "tts_gallery":
        return tts_gallery()
    if action == "tts_audio":
        return {"audio": tts_audio(payload["name"])}
    if action == "generate_video":
        return generate_video(payload["prompt"])
    if action == "image":
        return {"image": image_data(payload["name"])}
    if action == "search":
        return search(payload.get("query", ""), payload.get("kind", "image"), payload.get("image_only", False))
    if action == "info":
        return model_info(payload["model_id"], payload.get("kind"), payload.get("variant"))
    raise RuntimeError("فرمان ناشناخته است.")


if "--vits-tts-worker" in sys.argv:
    try:
        request = json.loads(sys.stdin.readline())
        selected_device = request["device"]
        with contextlib.redirect_stdout(sys.stderr):
            result = vits_generate(request["model_id"], request["text"])
        print(json.dumps(result, ensure_ascii=False), file=sys.__stdout__, flush=True)
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
elif "--qwen-tts-worker" in sys.argv:
    try:
        print(json.dumps(run_qwen_tts_worker(), ensure_ascii=False), file=sys.__stdout__, flush=True)
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
elif "--batch-cpu-worker" in sys.argv:
    try:
        result = {"ok": True, "data": run_cpu_batch_worker()}
    except Exception as error:
        result = {"ok": False, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False), file=sys.__stdout__, flush=True)
else:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request["action"] in ("load", "generate", "edit_image", "image_input_capability", "device", "unload", "cache_mode", "batch_generate", "batch_queue"):
                with WEB_LOCK:
                    data = dispatch(request["action"], request.get("payload") or {})
            else:
                data = dispatch(request["action"], request.get("payload") or {})
            result = {"ok": True, "data": data}
        except Exception as error:
            result = {"ok": False, "error": str(error)}
        print(json.dumps(result, ensure_ascii=False), file=sys.__stdout__, flush=True)
