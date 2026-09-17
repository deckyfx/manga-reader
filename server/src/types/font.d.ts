/** Font files imported with `with { type: "file" }` resolve to a path that also works inside the compiled binary. */
declare module "*.ttf" {
  const path: string;
  export default path;
}
