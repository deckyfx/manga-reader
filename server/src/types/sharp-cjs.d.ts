/** The CommonJS shim beside lib/sharp.ts; its export is sharp itself (see that file for why it exists). */
declare module "*/sharp.cjs" {
  import type Sharp from "sharp";
  const sharp: typeof Sharp;
  export default sharp;
}
