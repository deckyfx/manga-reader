#!/usr/bin/env bun
/**
 * Health check script for comic-reader app
 *
 * Checks if the server is responding on port 3000
 */

const PORT = process.env.SERVER_PORT || 3000;
const TIMEOUT = 2000;

try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  const response = await fetch(`http://localhost:${PORT}/`, {
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (response.ok) {
    console.log("✅ Health check passed");
    process.exit(0);
  } else {
    console.error(`❌ Health check failed: HTTP ${response.status}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
