import tailwind from "bun-plugin-tailwind";

// Fullstack build: server entry bundles HTML import → React client + Tailwind inline.
// Native modules (onnxruntime-node, sharp) stay external — must be alongside the binary.
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: { outfile: "./app" },
  plugins: [tailwind],
  target: "bun",
  minify: true,
  sourcemap: "inline",
  external: ["onnxruntime-node", "sharp"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  process.exit(1);
}

console.log("Build complete → ./app");
