#!/bin/bash
set -e

echo "🚀 Starting Comic Reader..."

# Ensure required directories exist
echo "📁 Creating required directories..."
mkdir -p /app/db /app/manga /app/sock

echo ""
echo "🎉 Starting server..."
echo "   Environment: ${NODE_ENV:-production}"
echo "   Port: ${SERVER_PORT:-3000}"
echo ""

# Start the compiled app binary
# (migrations are handled automatically by the app at startup)
exec /app/app
