#!/bin/bash

# Restore the base image from backup

BACKUP_DIR="./docker-backups"

# Find the most recent backup
BACKUP_FILE=$(ls -t "$BACKUP_DIR"/comic-reader-base-*.tar 2>/dev/null | head -1)

if [ -z "$BACKUP_FILE" ]; then
  echo "❌ No backup found in $BACKUP_DIR"
  echo ""
  echo "Available options:"
  echo "  1. Run ./backup-base-image.sh to create a backup"
  echo "  2. Run ./build-base.sh to rebuild from scratch"
  exit 1
fi

echo "Found backup: $BACKUP_FILE"
echo "Restoring base image..."
echo ""

docker load -i "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Base image restored successfully!"
  echo ""
  docker images | grep comic-reader-base
else
  echo ""
  echo "❌ Restore failed!"
  exit 1
fi
