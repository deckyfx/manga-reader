#!/bin/bash
set -e

echo "🚀 Starting manga-ocr server..."

# Fix permissions on mounted directories
echo "🔧 Fixing permissions..."

# Ensure directories exist and have correct permissions
mkdir -p /app/ocrinput /app/ocroutput /app/images /pip-cache

# Set permissions to allow read/write for everyone
chmod -R 777 /app/ocrinput /app/ocroutput /pip-cache 2>/dev/null || true

echo "✅ Permissions fixed"
echo "🌐 Starting FastAPI server on Unix socket..."
echo "   Socket: /app/sock/manga-ocr.sock"
echo "   Endpoints:"
echo "     GET  /health      - Health check"
echo "     POST /scan        - Scan image (base64 JSON)"
echo "     POST /scan-upload - Scan image (file upload)"
echo ""

# Ensure sockets directory exists
mkdir -p /app/sock

# Start manga-ocr server
exec python -m src.server
