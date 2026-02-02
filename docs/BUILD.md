# Build Instructions

## Three-Tier Caching Strategy

This project uses ALL three recommended caching approaches for optimal build performance:

### 1️⃣ Layer Caching (Docker's built-in)
- `requirements.txt` is copied **before** application code
- Heavy dependencies are installed in a separate layer
- ✅ Code changes don't trigger dependency re-downloads

### 2️⃣ Pip Cache on Host
- `PIP_CACHE_DIR=/pip-cache` environment variable
- Volume mounted: `./data/pip-cache:/pip-cache`
- ✅ PyTorch wheels (~900MB) cached on your machine
- ✅ Survives container rebuilds

### 3️⃣ Pre-built Base Image
- `comic-reader-base:latest` contains manga-ocr + torch
- Built once, reused everywhere
- ✅ Zero re-downloads unless manga-ocr version changes

## Build Process

### First Time Setup (One-time)

Build the base image with all heavy dependencies:

```bash
./build-base.sh
```

This downloads and caches:
- Python 3.11
- manga-ocr 0.1.14
- PyTorch (~900MB)
- System dependencies

**This is a ONE-TIME operation** (unless you update manga-ocr version)

### Regular Development Build

After base image is built:

```bash
# Build the application image (fast - uses base)
docker-compose build

# Start the container
docker-compose up -d
```

### What Gets Cached Where

| Component | Size | Cache Location | Rebuild Trigger |
|-----------|------|----------------|-----------------|
| PyTorch + deps | ~900MB | Base image layer | `Dockerfile.base` change |
| manga-ocr model | ~400MB | `./data/models/huggingface/hub` | Never (volume) |
| Pip wheels | Variable | `./data/pip-cache` | Never (volume) |
| Application code | ~1MB | Not cached | Every code change |

## Cache Verification

Check that caches are populated:

```bash
# Pip cache (after first base build)
ls -lh ./data/pip-cache/

# Hugging Face model cache (after first run)
ls -lh ./data/models/huggingface/hub/

# Base image (after build-base.sh)
docker images | grep comic-reader-base
```

## Updating Dependencies

### Update manga-ocr version

1. Edit `requirements.txt`
2. Rebuild base image:
   ```bash
   ./build-base.sh
   ```
3. Rebuild app:
   ```bash
   docker-compose build
   ```

### Add new Python packages

1. Add to `requirements.txt`
2. Rebuild (no need to rebuild base):
   ```bash
   docker-compose build
   ```

## Performance Comparison

| Scenario | Without Caching | With All 3 Caching |
|----------|----------------|-------------------|
| First build | 10-15 min | 10-15 min |
| Code change rebuild | 10-15 min ❌ | **30 seconds** ✅ |
| Clean rebuild | 10-15 min | **2-3 min** ✅ |

## Troubleshooting

### "comic-reader-base:latest not found"

Run the base image build first:
```bash
./build-base.sh
```

### Cache not working

Verify pip cache is mounted:
```bash
docker-compose config | grep pip-cache
```

Should show: `./data/pip-cache:/pip-cache`

### Want to force fresh download

Remove cached data:
```bash
rm -rf ./data/pip-cache/*
docker rmi comic-reader-base:latest
./build-base.sh
```
