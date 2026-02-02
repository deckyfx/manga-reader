# FileWatcher Usage Guide

## Overview

The FileWatcher singleton class now includes:
1. ✅ **Auto-cleanup** - Removes all files from OCR input directory after processing
2. ✅ **Event subscription** - Hook into OCR results from other processes

## Basic Usage

### 1. Start Watching with Cleanup

```typescript
import { FileWatcher } from "./src/services/FileWatcher";

const watcher = FileWatcher.getInstance();

// Start watching with automatic input cleanup
await watcher.startWatching(
  "./data/ocroutput/results.txt",  // Output file to watch
  "./data/ocrinput"                 // Input directory to clean
);
```

### 2. Subscribe to OCR Results

```typescript
import type { OCRResult } from "./src/services/FileWatcher";

// Subscribe to receive OCR results
const unsubscribe = watcher.subscribe(async (result: OCRResult) => {
  console.log("Received:", result.content);
  console.log("At:", result.timestamp);

  // Do anything with the result:
  // - Save to database
  // - Send to API
  // - Update UI
  // - etc.
});

// Later, unsubscribe when done
unsubscribe();
```

## OCRResult Interface

```typescript
interface OCRResult {
  content: string;      // The OCR text result
  timestamp: Date;      // When the result was processed
  filePath: string;     // Path to the output file
}
```

## Complete Example

```typescript
import { FileWatcher, type OCRResult } from "./src/services/FileWatcher";

async function main() {
  const watcher = FileWatcher.getInstance();

  // Subscribe to results (can have multiple subscribers)
  const unsubscribe1 = watcher.subscribe(async (result) => {
    // Subscriber 1: Log to console
    console.log("📝 OCR Text:", result.content);
  });

  const unsubscribe2 = watcher.subscribe(async (result) => {
    // Subscriber 2: Save to database
    await saveToDatabase(result);
  });

  const unsubscribe3 = watcher.subscribe(async (result) => {
    // Subscriber 3: Send to API
    await fetch("https://api.example.com/ocr", {
      method: "POST",
      body: JSON.stringify(result),
    });
  });

  // Start watching (will notify all subscribers)
  await watcher.startWatching(
    "./data/ocroutput/results.txt",
    "./data/ocrinput"
  );

  console.log(`Active subscribers: ${watcher.getSubscriberCount()}`); // 3

  // Cleanup
  process.on("SIGINT", () => {
    unsubscribe1();
    unsubscribe2();
    unsubscribe3();
    watcher.stopWatching();
    process.exit(0);
  });
}
```

## Integration with Elysia API

### Example: Send OCR results to WebSocket clients

```typescript
import { Elysia } from "elysia";
import { FileWatcher, type OCRResult } from "./services/FileWatcher";

const app = new Elysia();

// WebSocket endpoint
app.ws("/ocr-stream", {
  open(ws) {
    console.log("Client connected to OCR stream");

    // Subscribe this client to OCR results
    const unsubscribe = FileWatcher.getInstance().subscribe(async (result) => {
      ws.send(JSON.stringify({
        type: "ocr-result",
        data: result,
      }));
    });

    // Store unsubscribe function for cleanup
    ws.data.unsubscribe = unsubscribe;
  },
  close(ws) {
    // Unsubscribe when client disconnects
    ws.data.unsubscribe?.();
    console.log("Client disconnected from OCR stream");
  },
});

// Start the watcher
await FileWatcher.getInstance().startWatching(
  "./data/ocroutput/results.txt",
  "./data/ocrinput"
);

app.listen(3000);
```

### Example: REST API endpoint

```typescript
import { Elysia } from "elysia";
import { FileWatcher, type OCRResult } from "./services/FileWatcher";

const app = new Elysia();
const latestResults: OCRResult[] = [];

// Subscribe to store latest results
FileWatcher.getInstance().subscribe(async (result) => {
  latestResults.unshift(result);
  // Keep only last 10 results
  if (latestResults.length > 10) {
    latestResults.pop();
  }
});

// API endpoint to get recent OCR results
app.get("/api/ocr/recent", () => {
  return {
    success: true,
    results: latestResults,
  };
});

// Start watching
await FileWatcher.getInstance().startWatching(
  "./data/ocroutput/results.txt",
  "./data/ocrinput"
);

app.listen(3000);
```

## Workflow

```
┌───────────────────┐
│ User uploads      │
│ cropped image     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Copy to           │
│ ./data/ocrinput/  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ manga-ocr         │
│ (Docker)          │
│ processes image   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Writes result to  │
│ results.txt       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ FileWatcher       │
│ detects change    │
└─────────┬─────────┘
          │
          ├─────────────────┐
          │                 │
          ▼                 ▼
┌───────────────┐   ┌──────────────┐
│ Notify all    │   │ Log to       │
│ subscribers   │   │ console      │
└───────┬───────┘   └──────────────┘
        │
        ├──────────────────┐
        │                  │
        ▼                  ▼
┌──────────────┐   ┌──────────────┐
│ Clear        │   │ Delete all   │
│ results.txt  │   │ input files  │
└──────────────┘   └──────────────┘
```

## Features

### 1. Auto-cleanup Input Directory
- Automatically deletes all files from OCR input directory after processing
- Prevents duplicate processing
- Keeps the pipeline clean

### 2. Multiple Subscribers
- Multiple processes/functions can subscribe to the same results
- Each subscriber receives the result independently
- Subscribers run in parallel (Promise.all)

### 3. Error Handling
- If a subscriber throws an error, it doesn't affect other subscribers
- Errors are logged but don't stop processing

### 4. Type Safety
- Full TypeScript type definitions
- OCRResult interface for structured data
- Type-safe callback signatures

## API Reference

### FileWatcher Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getInstance()` | Get singleton instance | `FileWatcher` |
| `startWatching(outputFile, inputDir?)` | Start watching file | `Promise<void>` |
| `stopWatching()` | Stop watching | `void` |
| `subscribe(callback)` | Subscribe to results | `() => void` (unsubscribe) |
| `getSubscriberCount()` | Get active subscribers | `number` |
| `isWatching()` | Check if watching | `boolean` |
| `getWatchedFile()` | Get watched file path | `string` |

### Callback Signature

```typescript
type OCRResultCallback = (result: OCRResult) => void | Promise<void>;
```

- Can be sync or async
- Receives OCRResult object
- No return value expected
