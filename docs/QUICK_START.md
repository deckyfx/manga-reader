# Quick Start Guide

## 🚀 First Time Setup

```bash
# 1. Build base image with manga-ocr (ONE-TIME, ~10-15 min)
./build-base.sh

# 2. Start the application
docker-compose up -d

# 3. Check logs
docker-compose logs -f
```

## 📦 What Gets Downloaded Once

| Component | Size | Where Cached | When Re-downloaded |
|-----------|------|--------------|-------------------|
| PyTorch | ~900MB | Base image | Only if you rebuild base |
| manga-ocr model | ~400MB | `./data/models/` | Never (volume persists) |
| Pip wheels | Variable | `./data/pip-cache/` | Never (volume persists) |

## 🔄 Regular Usage

```bash
# Start containers
docker-compose up -d

# Stop containers
docker-compose down

# View logs
docker-compose logs -f

# Rebuild after code changes (~30 seconds)
docker-compose build && docker-compose up -d
```

## 📁 Directory Structure

```
./data/
├── models/huggingface/hub/    # manga-ocr model (~400MB)
├── pip-cache/                  # Python package wheels (~900MB)
├── ocrinput/                   # Images to OCR
└── ocroutput/                  # OCR results
```

## ✅ Verify Caching Works

```bash
# Check pip cache is populated
ls -lh ./data/pip-cache/

# Check model cache
ls -lh ./data/models/huggingface/hub/

# Check base image exists
docker images | grep comic-reader-base
```

## 🔧 Common Tasks

### Code changes
```bash
# Just rebuild (fast - uses cache)
docker-compose build
docker-compose up -d
```

### Update manga-ocr version
```bash
# Edit requirements.txt, then:
./build-base.sh              # Rebuild base
docker-compose build         # Rebuild app
docker-compose up -d
```

### Start fresh
```bash
# Remove all caches
rm -rf ./data/pip-cache/*
docker rmi comic-reader-base:latest

# Rebuild from scratch
./build-base.sh
docker-compose up -d
```

## 🎯 Performance

- **First build**: 10-15 min (downloads everything)
- **Code change**: ~30 seconds ✅
- **Clean rebuild**: 2-3 min ✅
- **Without caching**: 10-15 min every time ❌
