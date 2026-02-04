#!/bin/bash
set -e

echo "🚀 Initializing manga-ocr container..."

# Fix permissions on mounted directories
echo "🔧 Fixing permissions..."
mkdir -p /app/ocrinput /app/ocroutput /app/images /pip-cache
chmod -R 777 /app/ocrinput /app/ocroutput /pip-cache 2>/dev/null || true
echo "✅ Permissions fixed"
echo ""

# Ensure sockets directory exists
mkdir -p /app/sock

# Start manga-ocr server
exec python -m src.server
