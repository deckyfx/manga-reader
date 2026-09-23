FROM python:3.12-slim

# ctranslate2 ships wheels for x86-64 and arm64; sentencepiece needs no build tools on either
RUN pip install --no-cache-dir "ctranslate2==4.*" "sentencepiece==0.2.*" "huggingface_hub==0.*"

WORKDIR /app
COPY server.py .

ENV PORT=14366 SUGOI_MODEL_DIR=/models
EXPOSE 14366
VOLUME ["/models"]
CMD ["python", "-u", "server.py"]
