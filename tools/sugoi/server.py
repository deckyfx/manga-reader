"""
A Sugoi translation server: Japanese in, English out, speaking the format Sugoi clients already use.

The model is Sugoi v4 (fairseq, converted to CTranslate2 by entai2965), fetched from Hugging Face the first time this
starts and cached in /models. Nothing here is vendored: the model carries NTT's licence (see README.md), so it is
downloaded by whoever runs the server, for their own use.

  POST /            {"content": "テキスト", "message": "translate sentences"}   -> "text"
  POST /            {"content": ["A", "B"], "message": "translate sentences"}   -> ["a", "b"]
  GET  /health      -> {"ok": true, "model": "..."}
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ctranslate2
import sentencepiece
from huggingface_hub import snapshot_download

MODEL_REPO = os.environ.get("SUGOI_MODEL_REPO", "entai2965/sugoi-v4-ja-en-ctranslate2")
MODEL_DIR = os.environ.get("SUGOI_MODEL_DIR", "/models")
PORT = int(os.environ.get("PORT", "14366"))
# More than this in one request and it is almost certainly a mistake, not a page of manga
MAX_SENTENCES = 128

print(f"Fetching {MODEL_REPO} (cached in {MODEL_DIR} after the first run)…", flush=True)
path = snapshot_download(repo_id=MODEL_REPO, cache_dir=MODEL_DIR)
translator = ctranslate2.Translator(path, device=os.environ.get("SUGOI_DEVICE", "cpu"))
# Japanese goes in through one sentencepiece model and English comes out through the other
source_spm = sentencepiece.SentencePieceProcessor(os.path.join(path, "spm", "spm.ja.nopretok.model"))
target_spm = sentencepiece.SentencePieceProcessor(os.path.join(path, "spm", "spm.en.nopretok.model"))
print(f"Sugoi ready on :{PORT}", flush=True)


def translate(sentences: list[str]) -> list[str]:
    """Each sentence through sentencepiece, the model, and back — in one batch."""
    tokens = [source_spm.encode(line, out_type=str) for line in sentences]
    results = translator.translate_batch(tokens, beam_size=int(os.environ.get("SUGOI_BEAM_SIZE", "5")))
    return [target_spm.decode(result.hypotheses[0]) for result in results]


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - the base class names it
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "model": MODEL_REPO})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "expected JSON"})

        content = request.get("content")
        if isinstance(content, str):
            sentences, single = [content], True
        elif isinstance(content, list) and all(isinstance(line, str) for line in content):
            sentences, single = content, False
        else:
            return self._send(400, {"error": 'expected {"content": "…"} or {"content": ["…"]}'})
        if len(sentences) > MAX_SENTENCES:
            return self._send(413, {"error": f"at most {MAX_SENTENCES} sentences in one request"})

        try:
            out = translate(sentences)
        except Exception as err:  # the client gets the reason rather than a dropped connection
            return self._send(500, {"error": str(err)})
        self._send(200, out[0] if single else out)

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} {fmt % args}", flush=True)


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
