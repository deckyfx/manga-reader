#!/bin/bash

# Release script for version 0.0.5
# Builds, tags, and pushes Docker images

VERSION="0.0.5"

echo "🚀 Releasing version $VERSION"
echo ""

# Step 1: Build images using docker-compose.dev.yml
echo "🔨 Building Docker images..."
docker-compose -f docker-compose.dev.yml build --no-cache

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo ""
echo "✅ Build completed!"
echo ""

# Step 2: Tag the app image
echo "📦 Tagging manga-reader-app image..."
docker tag manga-reader-app:latest deckyfx/manga-reader-app:$VERSION
docker tag manga-reader-app:latest deckyfx/manga-reader-app:latest

# Step 3: Tag the manga-ocr image
echo "📦 Tagging manga-ocr image..."
docker tag manga-reader-manga-ocr:latest deckyfx/manga-reader-manga-ocr:$VERSION
docker tag manga-reader-manga-ocr:latest deckyfx/manga-reader-manga-ocr:latest

echo ""
echo "✅ Images tagged successfully!"
echo ""

# Step 4: Push images to Docker Hub
echo "📤 Pushing images to Docker Hub..."
read -p "Push images now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Pushing app images..."
    docker push deckyfx/manga-reader-app:$VERSION
    docker push deckyfx/manga-reader-app:latest

    echo "Pushing manga-ocr images..."
    docker push deckyfx/manga-reader-manga-ocr:$VERSION
    docker push deckyfx/manga-reader-manga-ocr:latest

    echo ""
    echo "✅ Images pushed successfully!"
else
    echo ""
    echo "⏭️  Skipped pushing. You can push manually with:"
    echo "   docker push deckyfx/manga-reader-app:$VERSION"
    echo "   docker push deckyfx/manga-reader-app:latest"
    echo "   docker push deckyfx/manga-reader-manga-ocr:$VERSION"
    echo "   docker push deckyfx/manga-reader-manga-ocr:latest"
fi

echo ""
echo "🏷️  Don't forget to tag git repository:"
echo "   git tag -a v$VERSION -m 'Release version $VERSION'"
echo "   git push origin v$VERSION"
echo ""
