#!/usr/bin/env bun
/**
 * Health check script for manga-reader app
 *
 * Checks if the server is responding on /api/health endpoint
 */

const PORT = process.env.SERVER_PORT || 3000;
const TIMEOUT = 2000;

try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  const response = await fetch(`http://localhost:${PORT}/api/health`, {
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    console.error(`❌ Health check failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const data = await response.json();

  // Validate response schema
  if (data.status === "OK" && typeof data.timestamp === "string") {
    console.log("✅ Health check passed");
    process.exit(0);
  } else {
    console.error(`❌ Health check failed: Invalid response schema`, data);
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
