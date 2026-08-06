import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

export default defineConfig({
  out: "./drizzle",
  // Glob, not a single file: each module owns its own tables, and a new
  // modules/<name>/schema.ts is picked up without touching this config.
  schema: "./src/modules/**/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
});
