#!/bin/bash
set -e

echo "🚀 Starting manga-ocr container..."

# Fix permissions on mounted directories
echo "🔧 Fixing permissions..."

# Ensure directories exist and have correct permissions
mkdir -p /app/ocrinput /app/ocroutput /app/images /pip-cache

# Set permissions to allow read/write for everyone
chmod -R 777 /app/ocrinput /app/ocroutput /pip-cache 2>/dev/null || true

# If results.txt exists and is owned by root, fix it
if [ -f /app/ocroutput/results.txt ]; then
  chmod 666 /app/ocroutput/results.txt 2>/dev/null || true
  echo "✅ Fixed permissions on results.txt"
fi

# Create results.txt if it doesn't exist
if [ ! -f /app/ocroutput/results.txt ]; then
  touch /app/ocroutput/results.txt
  chmod 666 /app/ocroutput/results.txt
  echo "📄 Created results.txt"
fi

echo "✅ Permissions fixed"
echo "👁️ Starting manga-ocr daemon mode..."
echo "   Watching: /app/ocrinput"
echo "   Output:   /app/ocroutput/results.txt"
echo ""

# Start manga-ocr in daemon mode
exec manga_ocr --read_from /app/ocrinput --write_to /app/ocroutput/results.txt
