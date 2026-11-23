"""Local llama.cpp runtimes for downloaded Hugging Face GGUF models."""
import atexit
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import zipfile

import requests

RELEASE = "b12212"
ENGINES = {
    "llama-cpu": ("cpu", 24886394, "85d87accadf52f2a79466f8a9d3dba0e2b888c536d1f865164e345499d126f37"),
    "llama-vulkan": ("vulkan", 37845777, "68c1ffdb19394d61f3f3b30d5b743942ceeb4514b4491a3e8e34c73b41456814"),
}
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
    return root(home) / "engines" / RELEASE / engine / "llama-server.exe"


def install_engine(home, engine, emit):
    exe = executable(home, engine)
    if exe.is_file():
        return exe
    flavor, size, sha = ENGINES[engine]
    name = f"llama-{RELEASE}-bin-win-{flavor}-x64.zip"
    url = f"https://github.com/ggml-org/llama.cpp/releases/download/{RELEASE}/{name}"
    exe.parent.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=exe.parent.parent) as temporary:
        archive = Path(temporary) / name
        received = 0
        with requests.get(url, stream=True, timeout=(20, 60)) as response, archive.open("wb") as output:
            response.raise_for_status()
            for chunk in response.iter_content(1024 * 1024):
                received += len(chunk)
                if received > size:
                    raise RuntimeError("اندازهٔ بستهٔ llama.cpp معتبر نیست.")
                output.write(chunk)
                emit("chat-progress", {"status": f"دریافت موتور llama.cpp · {flavor}", "completed": received, "total": size})
        with archive.open("rb") as source:
            if received != size or hashlib.file_digest(source, "sha256").hexdigest() != sha:
                raise RuntimeError("صحت بستهٔ llama.cpp تأیید نشد.")
        extracted = Path(temporary) / "engine"
        with zipfile.ZipFile(archive) as bundle:
            if any(not (extracted / entry.filename).resolve().is_relative_to(extracted.resolve()) for entry in bundle.infolist()):
                raise RuntimeError("مسیر نامعتبر در بستهٔ llama.cpp.")
            bundle.extractall(extracted)
        if not (extracted / exe.name).is_file():
            raise RuntimeError("فایل اجرایی llama.cpp در بسته پیدا نشد.")
        try:
            extracted.rename(exe.parent)
        except OSError:
            if not exe.is_file():
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
    exe = install_engine(home, record["engine"], emit)
    layers = "0" if cpu or record["engine"] == "llama-cpu" else "999"
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
            cwd=exe.parent, stdout=output, stderr=subprocess.STDOUT, creationflags=FLAGS,
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
