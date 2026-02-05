# Docker Setup Guide

## Three-Tier Caching Strategy ⚡

This setup uses **ALL THREE** recommended caching approaches for optimal performance:

1. **Layer Caching**: `requirements.txt` before code → code changes don't trigger re-downloads
2. **Pip Cache on Host**: `./data/pip-cache` persists wheels → survives rebuilds
3. **Pre-built Base Image**: `manga-reader-base` has manga-ocr + torch → one-time download

**Result**: Code changes rebuild in ~30 seconds instead of 10-15 minutes!

See [BUILD.md](BUILD.md) for detailed documentation.

---

## Quick Start

### First-Time Setup

**1️⃣ Build the base image** (one-time, ~10-15 min):

```bash
./build-base.sh
```

This downloads manga-ocr (~900MB torch + dependencies) once.

**2️⃣ Build and start** (fast after base is built):

```bash
docker-compose up -d
```

### Development Mode (with Hot Reload)

**Default `docker-compose.yml` is configured for development:**

- ✅ Source code mounted (no rebuild needed for code changes!)
- ✅ Bun watch mode enabled (auto-restart on file changes)
- ✅ Fast iteration cycle

```bash
# Build and start the container
docker-compose up -d

# View logs (watch for auto-reloads)
docker-compose logs -f

# Stop the container
docker-compose down
```

**Edit code and see changes instantly - no rebuild required!**

The app will be available at `http://localhost:3000`

### Production Mode

For production deployment without mounted volumes:

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# Or build and tag for production
docker build -t manga-reader:prod .
docker run -d -p 3000:3000 manga-reader:prod
```

### Build and Run with Docker CLI

```bash
# Build the image
docker build -t manga-reader .

# Run the container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/src/public/uploads:/app/src/public/uploads \
  --name manga-reader \
  manga-reader

# View logs
docker logs -f manga-reader

# Stop the container
docker stop manga-reader
docker rm manga-reader
```

## Tesseract OCR in Docker

**Base Image**: `jitesoft/tesseract-ocr:5` (pre-configured OCR)

- Optimized Tesseract installation
- All language packs included
- Bun runtime installed on top

The Docker image includes:

### Pre-installed Language Packs

- ✅ **Japanese Horizontal** (`jpn`)
- ✅ **Japanese Vertical** (`jpn_vert`)
- ✅ **English** (`eng`)
- ✅ **Chinese Simplified** (`chi_sim`)
- ✅ **Chinese Traditional** (`chi_tra`)
- ✅ **Korean** (`kor`)

### Verify Installation

```bash
# Check Tesseract version
docker exec manga-reader tesseract --version

# List available languages
docker exec manga-reader tesseract --list-langs
```

## Using Custom Trained Models

### Option 1: Add Models to Image (Build Time)

1. Create a `tessdata` directory in your project:

```bash
mkdir -p tessdata
```

2. Download custom models (e.g., manga-optimized models):

```bash
# Example: Download manga model from community
wget https://example.com/manga.traineddata -O tessdata/manga.traineddata
```

3. Update Dockerfile:

```dockerfile
# Add after installing tesseract-ocr
COPY tessdata/*.traineddata /usr/share/tesseract-ocr/4.00/tessdata/
```

4. Rebuild the image:

```bash
docker-compose build
```

### Option 2: Mount Models at Runtime

1. Create a `tessdata` directory with your custom models:

```bash
mkdir -p tessdata
# Add your .traineddata files here
```

2. Update `docker-compose.yml`:

```yaml
volumes:
  - ./src/public/uploads:/app/src/public/uploads
  - ./tessdata:/usr/share/tesseract-ocr/4.00/tessdata:ro
```

3. Restart the container:

```bash
docker-compose restart
```

## Configuration

### Environment Variables

Create a `.env` file:

```env
SERVER_PORT=3000
NODE_ENV=production
```

### Custom Port

To run on a different port:

```yaml
# docker-compose.yml
ports:
  - "8080:3000" # Host:Container
```

## Performance Optimization

### Multi-stage Build (Production)

The Dockerfile is already optimized with a single-stage build. For even smaller images:

```dockerfile
# Add to Dockerfile
FROM oven/bun:1-alpine as base
# ... (alpine has smaller size)
```

### Resource Limits

```yaml
# docker-compose.yml
services:
  manga-reader:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 2G
```

## Debugging

### Access Container Shell

```bash
docker exec -it manga-reader /bin/bash
```

### Test Tesseract Directly

```bash
# Create a test image
docker exec -it manga-reader tesseract \
  src/public/uploads/cropped/test.png \
  stdout \
  -l jpn_vert
```

### Check Logs

```bash
# All logs
docker-compose logs

# Follow logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100
```

## Integration with Nginx Proxy Manager

If using Nginx Proxy Manager:

1. Set network mode to `bridge` (already default in docker-compose.yml)

2. In Nginx Proxy Manager, create a proxy host:
   - Domain: `manga-reader.yourdomain.com`
   - Forward Hostname/IP: `manga-reader` (container name)
   - Forward Port: `3000`

3. Or use host IP:
   - Forward Hostname/IP: `192.168.x.x` (your host IP)
   - Forward Port: `3000`

## Recommended: Custom Manga Models

For better Japanese manga OCR results:

### Manga OCR Project Models

```bash
# Download manga-optimized model
wget https://github.com/kha-white/manga-ocr/releases/download/v0.1.0/manga.traineddata

# Place in tessdata directory
mv manga.traineddata tessdata/
```

### Use in API

```typescript
// Frontend: Select custom preset
setOcrPreset("japaneseManga");

// Or configure manually
{
  language: "manga",
  orientation: "vertical",
  customModelPath: "/usr/share/tesseract-ocr/4.00/tessdata"
}
```

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 3000
lsof -i :3000

# Or change port in docker-compose.yml
ports:
  - "3001:3000"
```

### Permission Issues

```bash
# Fix upload directory permissions
chmod -R 755 src/public/uploads
```

### Tesseract Not Found

```bash
# Verify installation
docker exec manga-reader which tesseract
docker exec manga-reader tesseract --version
```

### Language Pack Missing

```bash
# List available languages
docker exec manga-reader tesseract --list-langs

# If missing, rebuild image or install manually:
docker exec -it manga-reader apt-get update
docker exec -it manga-reader apt-get install tesseract-ocr-jpn
```

## Performance Comparison

| Engine        | Speed           | Accuracy | Use Case                |
| ------------- | --------------- | -------- | ----------------------- |
| Tesseract.js  | Slow (5-10s)    | Good     | Browser-only, no server |
| Tesseract CLI | Fast (0.5-2s)   | Good     | Production, Docker      |
| Python        | Fast (0.5-2s)   | Best     | Custom models           |
| Rust          | Fastest (<0.5s) | Best     | High performance        |

**Recommendation**: Use Tesseract CLI (already in Docker) for production.
