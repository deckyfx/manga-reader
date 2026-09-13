import Elysia from "elysia";
import index from "../../client/index.html";

/** Serve the React SPA. Paths with file extensions (assets) are NOT intercepted —
 *  Bun serves those natively via its HTML import mechanism or bunfig static plugins. */
export const routeSpa = new Elysia()
  .get("/", index)
  .get("/*", ({ request }) => {
    const { pathname } = new URL(request.url);
    // Let Bun handle asset requests: any path with a dot (file extension) or
    // Bun's virtual module paths (tailwindcss, /_bun/...)
    if (
      pathname.includes(".") ||
      pathname.startsWith("/api") ||
      pathname.startsWith("/studio/api") ||
      pathname.startsWith("/read/api") ||
      pathname.startsWith("/health") ||
      pathname === "/tailwindcss" ||
      pathname.startsWith("/_bun")
    ) {
      return new Response("Not Found", { status: 404 });
    }
    return index;
  });
