# ================================
# Stage 1: BUILDER (Fat - will be discarded)
# ================================
FROM python:3.11-slim AS builder

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies (will NOT be in final image)
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip to latest version
RUN pip install --upgrade pip

# Install packages to custom directory for easy extraction
ENV PYTHONUSERBASE=/install

# Pin numpy to 1.x for PyTorch compatibility
RUN pip install --user --no-cache-dir "numpy>=1.26.0,<2.0"

# Install CPU-only PyTorch (latest stable)
RUN pip install --user --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Copy our modernized manga-ocr package
WORKDIR /build
COPY pyproject.toml .
COPY src/ src/

# Install our modern manga-ocr package
RUN pip install --user --no-cache-dir .

# OPTIMIZATION 1: Strip debug symbols from .so files (saves ~20% on compiled libs)
RUN find /install -name "*.so" -exec strip --strip-debug {} \; 2>/dev/null || true

# OPTIMIZATION 2: Remove unnecessary files
RUN find /install -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true && \
    find /install -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find /install -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find /install -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true && \
    find /install -name "*.h" -delete 2>/dev/null || true && \
    find /install -name "*.c" -delete 2>/dev/null || true && \
    find /install -name "*.cpp" -delete 2>/dev/null || true && \
    find /install -name "*.md" -delete 2>/dev/null || true && \
    find /install -name "LICENSE*" -delete 2>/dev/null || true && \
    find /install -name "README*" -delete 2>/dev/null || true

# OPTIMIZATION 3: Remove .pyc files (will be regenerated in stage 2)
RUN find /install -name "*.pyc" -delete 2>/dev/null || true
RUN find /install -name "*.pyo" -delete 2>/dev/null || true

# ================================
# Stage 2: RUNTIME (Slim - final image)
# ================================
FROM python:3.11-slim

# Install ONLY runtime dependencies (no build tools!)
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Copy ONLY the installed packages from builder (no source, no cache, no build tools)
COPY --from=builder /install /usr/local

# OPTIMIZATION 4: Strip binaries in final image
RUN find /usr/local -name "*.so*" -type f -exec strip --strip-unneeded {} \; 2>/dev/null || true

# OPTIMIZATION 5: Regenerate bytecode for faster startup
RUN python -m compileall -q /usr/local/lib/python3.11/site-packages 2>/dev/null || true

# Verify installation works
RUN python -c "from src import MangaOcr; print('✅ manga-ocr installed!')"

# Set working directory
WORKDIR /app

# Create required directories
RUN mkdir -p /app/ocrinput /app/ocroutput /app/images /pip-cache

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]
