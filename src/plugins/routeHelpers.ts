import { join } from "node:path";
import { envConfig } from "../env-config";
import { catchError } from "../lib/error-handler";

/**
 * Handler for serving uploaded manga files
 *
 * Serves files from MANGA_DIR using Bun.file()
 */
export const serveUploadedFiles = async ({
  params,
}: {
  params: Record<string, string>;
}) => {
  // Get the wildcard path (everything after /uploads/)
  const filePath = params["*"];
  if (!filePath) {
    return new Response("File path is required", { status: 400 });
  }
  const fullPath = join(envConfig.MANGA_DIR, filePath);

  // Serve file using Bun.file()
  const file = Bun.file(fullPath);

  // Check if file exists
  const [error, exists] = await catchError(file.exists());

  if (error) {
    console.error("Error serving file:", error);
    return new Response("Error serving file", { status: 500 });
  }

  if (!exists) {
    return new Response("File not found", { status: 404 });
  }

  return file;
};
