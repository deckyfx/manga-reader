import tailwind from "bun-plugin-tailwind";

// Fullstack build: server entry bundles HTML import → React client + Tailwind inline.
// Native modules (onnxruntime-node, sharp) stay external: they are resolved at runtime by walking up from the
// binary, so dist/ works because server/node_modules is its parent. A binary copied elsewhere needs them beside it.
const OUT = "./dist/app";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: { outfile: OUT },
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

console.log(`Build complete → ${OUT}`);
