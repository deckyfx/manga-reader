#!/bin/bash

# Build the base image with manga-ocr pre-installed
# Run this once, or when you need to update manga-ocr version

echo "Building base image with manga-ocr (this will download ~900MB torch)..."
echo "This is a ONE-TIME operation. The base image will be cached."
echo ""

# Create pip-cache directory if it doesn't exist
mkdir -p ./data/pip-cache

# Build base image (regular docker build, no BuildKit needed)
docker build \
  -f Dockerfile.base \
  -t comic-reader-base:latest \
  .

# Check if build succeeded
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Base image built successfully!"
  echo "You can now run: docker-compose build"
  echo ""
  echo "The base image contains:"
  echo "  - Python 3.11"
  echo "  - manga-ocr 0.1.14"
  echo "  - PyTorch (~900MB)"
  echo "  - All system dependencies"
  echo ""
  echo "Pip cache will be stored in: ./data/pip-cache/"
else
  echo ""
  echo "❌ Build failed! Check the error messages above."
  exit 1
fi
