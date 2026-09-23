# A Sugoi translator of your own

[Sugoi](https://sugoitoolkit.com/) translates Japanese to English noticeably better than the small model the server
carries (`Xenova/opus-mt-ja-en`), especially on manga dialogue. It doesn't run inside the server: it is a fairseq model
in CTranslate2 form, and the server is a Bun executable with onnxruntime. So it runs beside the server, and the server
talks to it over HTTP.

This folder starts one.

```bash
cd tools/sugoi
docker compose up -d --build        # first start downloads the model (~500 MB) into a volume
curl 127.0.0.1:14366/health         # {"ok": true, ...}
```

Then point the server at it and restart it:

```bash
# server/.env
SUGOI_URL=http://127.0.0.1:14366
PREFERRED_TRANSLATION_ENGINE=sugoi
```

Settings → Translation then shows Sugoi as configured, and the page pipeline translates through it. If somebody has
already picked an engine there, that choice is remembered and wins over `PREFERRED_TRANSLATION_ENGINE` — pick Sugoi
in Settings instead of editing the environment. DeepL and the
built-in model stay available: the engine is a setting, and a page can still ask for one explicitly.

## Licence — read this before using it

The model is **Sugoi v4**, which descends from NTT's JParaCrawl models and carries
[NTT's terms](https://huggingface.co/entai2965/sugoi-v4-ja-en-ctranslate2/blob/main/LICENSE):

> This data can only be used for research purposes involving information analysis … this data is not available for
> commercial use, including the sale of translators trained using this data.

So: fine for translating your own reading, not for anything commercial. Nothing of the model is kept in this
repository — the container downloads it from Hugging Face when you first start it, onto your own machine. Sugoi
itself is by [MingShiba](https://sugoitoolkit.com/); the CTranslate2 conversion used here is
[entai2965/sugoi-v4-ja-en-ctranslate2](https://huggingface.co/entai2965/sugoi-v4-ja-en-ctranslate2).

## What it speaks

The format Sugoi clients already use, so the Sugoi Toolkit's own server works with the web server just as well —
point `SUGOI_URL` at that instead and skip this folder.

```bash
curl -X POST 127.0.0.1:14366 -H 'content-type: application/json' \
  -d '{"content": "お前はもう死んでいる", "message": "translate sentences"}'
# "You're already dead"

curl -X POST 127.0.0.1:14366 -H 'content-type: application/json' \
  -d '{"content": ["こんにちは", "さようなら"], "message": "translate sentences"}'
# ["Hello", "Goodbye"]
```

## Settings

| Variable | Default | What it does |
|---|---|---|
| `SUGOI_DEVICE` | `cpu` | `cuda` with an NVIDIA container runtime. A page at a time is comfortable on a CPU. |
| `SUGOI_BEAM_SIZE` | `5` | Higher is slower and slightly better. |
| `SUGOI_MODEL_REPO` | `entai2965/sugoi-v4-ja-en-ctranslate2` | Another CTranslate2 model, if you have one. |
| `PORT` | `14366` | What Sugoi clients expect. |

The container listens on loopback only. It is a translator for the server on this machine, not something to put on a
network.
