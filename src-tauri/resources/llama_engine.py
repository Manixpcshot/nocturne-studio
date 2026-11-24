"""Local llama.cpp runtimes for downloaded Hugging Face GGUF models."""
import atexit
import hashlib
import json
import os
import platform
import shutil
import tarfile
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import zipfile

import requests

RELEASE = "b12212"
WINDOWS_ENGINES = {
    "llama-cpu": [("llama-b12212-bin-win-cpu-x64.zip", 24886394, "85d87accadf52f2a79466f8a9d3dba0e2b888c536d1f865164e345499d126f37")],
    "llama-vulkan": [("llama-b12212-bin-win-vulkan-x64.zip", 37845777, "68c1ffdb19394d61f3f3b30d5b743942ceeb4514b4491a3e8e34c73b41456814")],
    "llama-cuda": [
        ("llama-b12212-bin-win-cuda-12.4-x64.zip", 288918507, "d7ad4987b645478282e96a7e6a17f02ec263b7ef5f7fae83f9d58be427f1ba3c"),
        ("cudart-llama-bin-win-cuda-12.4-x64.zip", 391443627, "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"),
    ],
    "llama-rocm": [("llama-b12212-bin-win-rocm-10.0-x64.zip", 267490363, "1874e0d3b62c09cb64de3c73aa832e61b55808b61b20bc4e21102f9aefb16803")],
    "llama-openvino": [("llama-b12212-bin-win-openvino-2026.4.1-x64.zip", 104881825, "cb3aa08f85f5c239b13ff8605369ecd720f286278b693c63594a05ec2bc6a63b")],
}
LINUX_ENGINES = {
    "llama-cpu": [("llama-b12212-bin-ubuntu-x64.tar.gz", 23108809, "a9b987738e6724b116980de8f5e15a901a3086587c3d2328533d77582e25ad5b")],
    "llama-vulkan": [("llama-b12212-bin-ubuntu-vulkan-x64.tar.gz", 35924320, "1f4c94a3a38b52ed632924aba9cdfa736caaa3ea7812b62ca1d8b84917eb3e15")],
    "llama-cuda": [
        ("llama-b12212-bin-ubuntu-cuda-12.8-x64.tar.gz", 188258753, "b934629500b2eeab1256ccade67212fc33c70be0d09b3229751315a125c8b253"),
        ("cudart-llama-b12212-bin-ubuntu-cuda-12.8-x64.tar.gz", 594371409, "23978b289b8864681eadc94ca0edde565833dc50e5cb5b32d20b8df33e783b41"),
    ],
    "llama-rocm": [("llama-b12212-bin-ubuntu-rocm-10.0-x64.tar.gz", 255607135, "7e9bb285b3da796bbc5ae56e6118166eac8059821aef0eee5a62de53ac61a4ef")],
    "llama-openvino": [("llama-b12212-bin-ubuntu-openvino-2026.4.1-x64.tar.gz", 122652770, "0cb4daf63b0c2a2c5b1060655ff694604693709f281541a9c2120f6d2b0faf5f")],
}
ENGINES = {"Windows": WINDOWS_ENGINES, "Linux": LINUX_ENGINES}.get(platform.system(), {}) if platform.machine().lower() in ("amd64", "x86_64") else {}
SERVER = None
FLAGS = 0x08000000 if os.name == "nt" else 0


def stop():
    global SERVER
    if SERVER is None:
        return
    process, _, _, _ = SERVER
    SERVER = None
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


atexit.register(stop)


def root(home):
    return Path(home) / "nocturne-chat" / "llama"


def executable(home, engine):
    name = "llama-server.exe" if os.name == "nt" else "llama-server"
    return root(home) / "engines" / RELEASE / engine / name


def engine_ready(home, engine):
    path = executable(home, engine)
    return path.is_file() and os.access(path, os.X_OK)


def runtime_env(folder):
    env = os.environ.copy()
    key = "PATH" if os.name == "nt" else "LD_LIBRARY_PATH"
    paths = (str(folder), env.get(key)) if os.name == "nt" else (str(folder), str(folder / "lib"), str(folder / "lib64"), env.get(key))
    env[key] = os.pathsep.join(filter(None, paths))
    return env


def extract_verified_engine(archive, destination):
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            if any(not (destination / entry.filename).resolve().is_relative_to(destination.resolve()) for entry in bundle.infolist()):
                raise RuntimeError("مسیر نامعتبر در بستهٔ موتور.")
            bundle.extractall(destination)
        return
    if archive.name.endswith(".zst"):
        with subprocess.Popen(["zstd", "-d", "-c", "--", str(archive)], stdout=subprocess.PIPE) as process:
            try:
                with tarfile.open(fileobj=process.stdout, mode="r|") as bundle:
                    bundle.extractall(destination, filter="data")
            except Exception:
                process.kill()
                raise
            if process.wait() != 0:
                raise RuntimeError("باز کردن بستهٔ فشردهٔ موتور ناموفق بود.")
        return
    with tarfile.open(archive, "r:gz") as bundle:
        bundle.extractall(destination, filter="data")


def install_engine(home, engine, emit):
    if engine not in ENGINES:
        raise ValueError("این موتور روی سیستم‌عامل یا معماری فعلی موجود نیست.")
    exe = executable(home, engine)
    if engine_ready(home, engine):
        return exe
    assets = ENGINES[engine]
    total = sum(size for _, size, _ in assets)
    completed = 0
    exe.parent.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(exe.parent.parent).free < total * 3:
        raise RuntimeError("فضای کافی برای دانلود و استخراج موتور llama.cpp وجود ندارد.")
    with tempfile.TemporaryDirectory(dir=exe.parent.parent) as temporary:
        staging = Path(temporary)
        extracted = staging / "engine"
        extracted.mkdir()
        for index, (name, size, sha) in enumerate(assets):
            unpacked = staging / f"asset-{index}"
            archive = staging / name
            url = f"https://github.com/ggml-org/llama.cpp/releases/download/{RELEASE}/{name}"
            received = 0
            with requests.get(url, stream=True, timeout=(20, 60)) as response, archive.open("wb") as output:
                response.raise_for_status()
                last = 0.0
                for chunk in response.iter_content(1024 * 1024):
                    received += len(chunk)
                    if received > size:
                        raise RuntimeError("اندازهٔ بستهٔ llama.cpp معتبر نیست.")
                    output.write(chunk)
                    now = time.monotonic()
                    if now - last >= .4 or received == size:
                        emit("chat-progress", {"status": f"دریافت موتور {engine}", "completed": completed + received, "total": total})
                        last = now
            with archive.open("rb") as source:
                if received != size or hashlib.file_digest(source, "sha256").hexdigest() != sha:
                    raise RuntimeError("صحت بستهٔ llama.cpp تأیید نشد.")
            extract_verified_engine(archive, unpacked)
            archive.unlink()
            candidates = list(unpacked.rglob(exe.name))
            content = candidates[0].parent if len(candidates) == 1 else unpacked
            while not candidates:
                children = list(content.iterdir())
                if len(children) != 1 or not children[0].is_dir():
                    break
                content = children[0]
            shutil.copytree(content, extracted, dirs_exist_ok=True, symlinks=True)
            if content.name == "bin":
                for lib in ("lib", "lib64"):
                    sibling = content.parent / lib
                    if sibling.is_dir():
                        shutil.copytree(sibling, extracted / lib, dirs_exist_ok=True, symlinks=True)
            completed += received
        candidate = extracted / exe.name
        if not candidate.is_file():
            raise RuntimeError("فایل اجرایی llama.cpp در بسته پیدا نشد.")
        test = subprocess.run([str(candidate), "--version"], cwd=extracted, env=runtime_env(extracted),
                              capture_output=True, text=True, errors="replace", timeout=30, creationflags=FLAGS)
        if test.returncode:
            raise RuntimeError(f"موتور {engine} اجرا نشد. {test.stderr[-800:]}")
        try:
            extracted.rename(exe.parent)
        except OSError:
            if not engine_ready(home, engine):
                raise
    return exe


def installed(home):
    result = {}
    for path in (root(home) / "models").glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            files = [Path(file) for file in record["files"]]
            if record["engine"] in ENGINES and files and all(file.is_file() for file in files):
                result[path.stem] = record
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return result


def install_model(home, engine, repo, revision, variant, emit):
    from huggingface_hub import hf_hub_download
    from tqdm import tqdm

    install_engine(home, engine, emit)
    done = 0
    total = variant["size"]
    files = []

    class Progress(tqdm):
        def update(self, n=1):
            super().update(n)
            emit("chat-progress", {"status": f"دریافت وزن مدل · {repo}", "completed": done + self.n, "total": total})

    for filename in variant["filenames"]:
        path = Path(hf_hub_download(repo, filename, revision=revision, cache_dir=Path(home) / "hub", tqdm_class=Progress))
        # Keep snapshot names so llama.cpp can find neighboring split shards.
        files.append(str(path.absolute()))
        done += path.stat().st_size
        emit("chat-progress", {"status": f"دریافت وزن مدل · {repo}", "completed": done, "total": total})
    model_id = hashlib.sha256(f"{engine}:{repo}:{revision}:{variant['filenames'][0]}".encode()).hexdigest()[:24]
    manifest = root(home) / "models" / f"{model_id}.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    record = {"name": f"{repo} · {variant['tag']}", "size": done, "engine": engine, "files": files}
    with tempfile.NamedTemporaryFile(mode="w", dir=manifest.parent, encoding="utf-8", delete=False) as output:
        json.dump(record, output, ensure_ascii=False)
    Path(output.name).replace(manifest)
    return {"model": f"llama:{model_id}"}


def start(home, record, cpu, emit):
    global SERVER
    engine = "llama-cpu" if cpu else record["engine"]
    exe = install_engine(home, engine, emit)
    layers = "0" if engine == "llama-cpu" else "999"
    key = (str(exe), record["files"][0], layers)
    if SERVER and SERVER[0].poll() is None and SERVER[1] == key:
        return SERVER[2:]
    stop()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    token = secrets.token_urlsafe(24)
    log = root(home) / "llama-server.log"
    with log.open("wb") as output:
        process = subprocess.Popen(
            [str(exe), "--model", record["files"][0], "--ctx-size", "4096", "--parallel", "1",
             "--host", "127.0.0.1", "--port", str(port), "--n-gpu-layers", layers, "--api-key", token],
            cwd=exe.parent, env=runtime_env(exe.parent), stdout=output, stderr=subprocess.STDOUT, creationflags=FLAGS,
        )
    SERVER = (process, key, base, token)
    try:
        deadline = time.monotonic() + 180
        while process.poll() is None and time.monotonic() < deadline:
            try:
                response = requests.get(base + "/health", timeout=2)
                if response.ok and response.json().get("status") == "ok" and process.poll() is None:
                    return base, token
            except (requests.RequestException, ValueError):
                pass
            time.sleep(0.3)
        with log.open("rb") as output:
            output.seek(max(0, log.stat().st_size - 1800))
            detail = output.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"موتور llama.cpp آماده نشد. {detail}")
    except Exception:
        stop()
        raise


def generate(home, record, messages, cpu, emit):
    base, token = start(home, record, cpu, emit)
    chunks = []
    with requests.post(
        base + "/v1/chat/completions", headers={"Authorization": f"Bearer {token}"},
        json={"messages": messages, "stream": True, "max_tokens": 2048, "temperature": 0.7},
        stream=True, timeout=(10, 300),
    ) as response:
        if not response.ok:
            raise RuntimeError(f"llama.cpp · {response.status_code} · {response.text[:700]}")
        for line in response.iter_lines():
            if not line.startswith(b"data:"):
                continue
            data = line[5:].strip()
            if data == b"[DONE]":
                return {"text": "".join(chunks)}
            event = json.loads(data)
            if event.get("error"):
                raise RuntimeError(str(event["error"]))
            for choice in event.get("choices", []):
                chunk = choice.get("delta", {}).get("content") or ""
                if chunk:
                    chunks.append(chunk)
                    emit("chat-token", {"text": chunk})
    raise RuntimeError("ارتباط با موتور llama.cpp قطع شد؛ پاسخ ممکن است ناقص باشد.")
