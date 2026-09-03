import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` works offline from the schema alone.
// `drizzle-kit migrate` needs DATABASE_URL to point at a real Postgres.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
