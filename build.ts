import twPlugin from "bun-plugin-tailwind";

console.log("🏗️  Two-stage build process\n");

// ============================================================
// STAGE 1: Build web assets to dist/
// ============================================================
console.log("📦 Stage 1: Building web assets...\n");

// Clean dist directory
console.log("🧹 Cleaning dist directory...");
await Bun.$`rm -rf ./dist`;

const webResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  sourcemap: "external",
  plugins: [twPlugin],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.RUN_MODE": JSON.stringify("source"),
  },
});

if (!webResult.success) {
  console.error("❌ Stage 1 failed:");
  for (const log of webResult.logs) {
    console.error(`   ${log.message}`);
  }
  process.exit(1);
}

console.log("✅ Stage 1 completed!");
console.log(`   Output: ./dist/`);
console.log(`   Files: ${webResult.outputs.length}\n`);

// ============================================================
// STAGE 2: Bundle into binary executable
// ============================================================
console.log("📦 Stage 2: Building binary executable...\n");

const binaryResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: {
    outfile: "./app",
  },
  plugins: [twPlugin],
  minify: true,
  sourcemap: true,
  // You can use the bytecode option if you use no top-level await
  // bytecode: true,
  target: "bun",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.RUN_MODE": JSON.stringify("binary"),
  },
});

if (!binaryResult.success) {
  console.error("❌ Stage 2 failed:");
  for (const log of binaryResult.logs) {
    console.error(`   ${log.message}`);
  }
  process.exit(1);
}

console.log("✅ Stage 2 completed!");
console.log(`   Output: ./app`);

// ============================================================
// BUILD SUMMARY
// ============================================================
console.log("\n🎉 Build successful!");
console.log("   📂 Web assets: ./dist/");
console.log("   🚀 Binary: ./app");
