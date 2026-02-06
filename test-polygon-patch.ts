#!/usr/bin/env bun
/**
 * Test Polygon Patch Generation
 *
 * Standalone script to test polygon masking:
 * 1. Fetch a caption with polygonPoints from database
 * 2. Send request to Python service via socket
 * 3. Save the result as PNG image
 *
 * Usage:
 *   bun run test-polygon-patch.ts [captionId]
 *
 * Examples:
 *   bun run test-polygon-patch.ts           # Use first polygon caption found
 *   bun run test-polygon-patch.ts 5         # Use specific caption ID
 */

import { MangaOCRAPI } from "./src/services/MangaOCRAPI";
import { CaptionStore } from "./src/stores/caption-store";
import { catchError } from "./src/lib/error-handler";
import { envConfig } from "./src/env-config";
import { db } from "./src/db";
import { userCaptions } from "./src/db/schema";

interface Point {
  x: number;
  y: number;
}

async function main() {
  console.log("🧪 Testing Polygon Patch Generation\n");

  // Get caption ID from command line args (optional)
  const targetCaptionId = Bun.argv[2] ? parseInt(Bun.argv[2]) : null;

  // Step 1: Fetch caption from database
  console.log("📋 Step 1: Fetching caption from database...");

  let caption;
  if (targetCaptionId) {
    console.log(`   Looking for caption ID: ${targetCaptionId}`);
    const [error, result] = await catchError(
      CaptionStore.findById(targetCaptionId)
    );

    if (error || !result) {
      console.error(`❌ Caption ${targetCaptionId} not found`);
      process.exit(1);
    }

    caption = result;
  } else {
    // Find first caption with polygonPoints
    console.log("   Looking for first caption with polygonPoints...");
    const [error, captions] = await catchError(
      db.select().from(userCaptions)
    );

    if (error) {
      console.error("❌ Failed to fetch captions:", error.message);
      process.exit(1);
    }

    const polygonCaption = captions.find((c) => c.polygonPoints !== null);

    if (!polygonCaption) {
      console.error("❌ No captions with polygonPoints found in database");
      console.log("💡 Try creating a polygon caption in the UI first");
      process.exit(1);
    }

    caption = polygonCaption;
  }

  console.log(`✅ Found caption: ID ${caption.id}, Slug: ${caption.slug}`);
  console.log(`   Size: ${caption.width}x${caption.height}`);

  // Parse and display polygon points
  let polygonPoints: Point[] | null = null;
  let relativePolygonPoints: Point[] | null = null;

  if (caption.polygonPoints) {
    polygonPoints = JSON.parse(caption.polygonPoints) as Point[];
    console.log(`   Polygon points: ${polygonPoints.length} points`);
    console.log(`   First point: (${polygonPoints[0]!.x}, ${polygonPoints[0]!.y})`);

    // Convert to relative coordinates (within captured region)
    relativePolygonPoints = polygonPoints.map((point) => ({
      x: point.x - caption.x,
      y: point.y - caption.y,
    }));
    console.log(
      `   Relative first point: (${relativePolygonPoints[0]!.x}, ${relativePolygonPoints[0]!.y})`
    );
  } else {
    console.log("   ⚠️  No polygon points (rectangle caption)");
  }

  // Step 2: Check if Python service is available
  console.log("\n🔌 Step 2: Checking Python service...");
  console.log(`   Socket path: ${envConfig.MANGA_OCR_SOCKET}`);

  const [healthError, isAvailable] = await catchError(MangaOCRAPI.isAvailable());

  if (healthError || !isAvailable) {
    console.error("❌ Python service not available");
    console.log("💡 Make sure manga-ocr service is running:");
    console.log(`   python manga_ocr_service.py`);
    process.exit(1);
  }

  console.log("✅ Python service is healthy");

  // Step 3: Generate patch
  console.log("\n🎨 Step 3: Generating patch...");

  // Remove data URL prefix if present
  const base64Data = caption.capturedImage.replace(
    /^data:image\/\w+;base64,/,
    ""
  );

  // Test parameters
  const testLines = ["Test Line 1", "テスト 2"];
  const fontSize = 40;
  const fontType = "regular" as const;
  const textColor = "#000000";
  const strokeColor = "#FFFFFF";
  const strokeWidth = 2;

  console.log(`   Text: ${testLines.join(", ")}`);
  console.log(`   Font: ${fontSize}px ${fontType}`);
  console.log(`   Colors: text=${textColor}, stroke=${strokeColor}`);
  console.log(`   Polygon: ${relativePolygonPoints ? "Yes" : "No"}`);

  const [patchError, patchImageBase64] = await catchError(
    MangaOCRAPI.generatePatch(
      base64Data,
      testLines,
      fontSize,
      fontType,
      textColor,
      strokeColor,
      strokeWidth,
      relativePolygonPoints || undefined
    )
  );

  if (patchError) {
    console.error("❌ Patch generation failed:", patchError.message);
    process.exit(1);
  }

  console.log("✅ Patch generated successfully");
  console.log(`   Base64 length: ${patchImageBase64.length} characters`);

  // Step 4: Save to file
  console.log("\n💾 Step 4: Saving patch image...");

  const outputPath = `./test-output-${caption.slug || caption.id}.png`;
  const imageBuffer = Buffer.from(patchImageBase64, "base64");

  await Bun.write(outputPath, imageBuffer);

  console.log(`✅ Patch saved to: ${outputPath}`);
  console.log(`   File size: ${imageBuffer.length} bytes`);

  // Step 5: Also save the original captured image for comparison
  console.log("\n📸 Step 5: Saving original captured image...");

  const originalPath = `./test-original-${caption.slug || caption.id}.png`;
  const originalBuffer = Buffer.from(base64Data, "base64");

  await Bun.write(originalPath, originalBuffer);

  console.log(`✅ Original saved to: ${originalPath}`);

  // Step 6: Summary
  console.log("\n" + "=".repeat(60));
  console.log("✨ Test Complete!");
  console.log("=".repeat(60));
  console.log(`\n📊 Results:`);
  console.log(`   Caption ID: ${caption.id}`);
  console.log(`   Caption Slug: ${caption.slug}`);
  console.log(`   Has Polygon: ${polygonPoints ? "Yes" : "No"}`);
  if (polygonPoints) {
    console.log(`   Polygon Points: ${polygonPoints.length} points`);
  }
  console.log(`\n📁 Files Created:`);
  console.log(`   Original: ${originalPath}`);
  console.log(`   Patch:    ${outputPath}`);
  console.log(`\n💡 Next Steps:`);
  console.log(`   1. Open both images to compare`);
  console.log(`   2. Verify patch has transparency outside polygon`);
  console.log(`   3. Check if text is properly rendered`);

  if (polygonPoints) {
    console.log(`\n🔍 Polygon Info:`);
    console.log(`   Absolute coordinates (page):`);
    polygonPoints.forEach((p, i) => {
      console.log(`      Point ${i + 1}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    });

    console.log(`\n   Relative coordinates (within captured region):`);
    relativePolygonPoints!.forEach((p, i) => {
      console.log(`      Point ${i + 1}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    });

    // Calculate polygon bounds
    const relXs = relativePolygonPoints!.map(p => p.x);
    const relYs = relativePolygonPoints!.map(p => p.y);
    const polyMinX = Math.min(...relXs);
    const polyMaxX = Math.max(...relXs);
    const polyMinY = Math.min(...relYs);
    const polyMaxY = Math.max(...relYs);
    const polyWidth = polyMaxX - polyMinX;
    const polyHeight = polyMaxY - polyMinY;

    console.log(`\n   Polygon bounding box (relative):`);
    console.log(`      X: ${polyMinX.toFixed(1)} to ${polyMaxX.toFixed(1)} (width: ${polyWidth.toFixed(1)})`);
    console.log(`      Y: ${polyMinY.toFixed(1)} to ${polyMaxY.toFixed(1)} (height: ${polyHeight.toFixed(1)})`);
    console.log(`\n   Captured region size: ${caption.width} × ${caption.height}`);
    console.log(`   Polygon uses: ${((polyWidth / caption.width) * 100).toFixed(1)}% width, ${((polyHeight / caption.height) * 100).toFixed(1)}% height`);
  }

  console.log("\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
