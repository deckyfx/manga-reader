# Testing OCR Integration

## Overview

The manga-ocr container watches `./data/ocrinput/` and writes results to `./data/ocroutput/results.txt`.

The FileWatcher class monitors the results file and displays OCR output in real-time.

## Quick Test

### 1. Start the OCR watcher

```bash
bun run test-ocr-watcher.ts
```

You should see:
```
🚀 OCR Output File Watcher
──────────────────────────────────────────────────
👁️ Started watching: ./data/ocroutput/results.txt

✨ Waiting for OCR results...
💡 Place images in ./data/ocrinput/ to trigger OCR
🛑 Press Ctrl+C to stop
```

### 2. Place an image for OCR

In another terminal:

```bash
# Copy a cropped manga panel to the input directory
cp src/public/uploads/cropped/cropped_*.png ./data/ocrinput/test.png
```

### 3. Watch the output

The watcher will automatically:
1. Detect when manga-ocr writes results
2. Display the OCR text
3. Clear the results file for the next image

Example output:
```
📄 File changed! Content:
──────────────────────────────────────────────────
こんにちは
世界
──────────────────────────────────────────────────
✅ File cleared
```

## How It Works

```
┌─────────────────┐
│  Your App       │
│  (Bun)          │
└────────┬────────┘
         │ saves cropped image
         ▼
┌─────────────────────┐
│  ./data/ocrinput/   │  ◄─┐
└─────────────────────┘    │
         │                 │ watches
         │ reads           │
         ▼                 │
┌─────────────────────┐    │
│  manga-ocr          │    │
│  (Docker)           │    │
└────────┬────────────┘    │
         │ writes          │
         ▼                 │
┌──────────────────────┐   │
│  ./data/ocroutput/   │   │
│  results.txt         │ ──┘
└──────────────────────┘
         │ reads & clears
         ▼
┌─────────────────────┐
│  FileWatcher        │
│  (logs to console)  │
└─────────────────────┘
```

## FileWatcher Singleton Class

### Usage Example

```typescript
import { FileWatcher } from "./src/services/FileWatcher";

// Get the singleton instance
const watcher = FileWatcher.getInstance();

// Start watching a file
await watcher.startWatching("./data/ocroutput/results.txt");

// Check if watching
console.log(watcher.isWatching()); // true

// Get watched file path
console.log(watcher.getWatchedFile()); // "./data/ocroutput/results.txt"

// Stop watching
watcher.stopWatching();
```

### Features

- **Singleton Pattern**: Only one instance across your app
- **Auto-clear**: Clears file after reading to avoid re-processing
- **Debouncing**: Prevents multiple reads during rapid file changes
- **Graceful Shutdown**: Clean exit on Ctrl+C

## Integration with Main App

To integrate FileWatcher into your main application:

```typescript
// In your main server file
import { FileWatcher } from "./services/FileWatcher";

const OCR_OUTPUT_FILE = "./data/ocroutput/results.txt";

// Start watching when server starts
const watcher = FileWatcher.getInstance();
await watcher.startWatching(OCR_OUTPUT_FILE);

// Handle results in your app
// (Modify FileWatcher.handleFileChange() to emit events or call a callback)
```

## Troubleshooting

### No output detected

Check that manga-ocr container is running:
```bash
docker-compose ps
docker-compose logs -f
```

### File not found error

Ensure directories exist:
```bash
mkdir -p ./data/ocrinput ./data/ocroutput
touch ./data/ocroutput/results.txt
```

### Permission issues

Check directory permissions:
```bash
chmod -R 755 ./data
```
