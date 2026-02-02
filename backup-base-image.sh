#!/bin/bash

# Backup the base image to a tar file
# This protects against accidental deletion during docker system prune

BACKUP_DIR="./docker-backups"
BACKUP_FILE="$BACKUP_DIR/comic-reader-base-$(date +%Y%m%d).tar"

echo "Creating backup directory..."
mkdir -p "$BACKUP_DIR"

echo "Saving base image to: $BACKUP_FILE"
echo "This may take a minute (image is ~1-2GB)..."
echo ""

docker save comic-reader-base:latest -o "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo ""
  echo "✅ Backup successful!"
  echo "   File: $BACKUP_FILE"
  echo "   Size: $SIZE"
  echo ""
  echo "To restore later, run:"
  echo "   docker load -i $BACKUP_FILE"
else
  echo ""
  echo "❌ Backup failed!"
  exit 1
fi
