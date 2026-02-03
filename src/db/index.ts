import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { envConfig } from "../env-config";
import { join } from "node:path";

const dbPath = join(envConfig.DB_DIR, "comic-reader.db");
const sqlite = new Database(dbPath);

export const db = drizzle(sqlite);
