/**
 * One-off migration runner: applies db/schema.sql against POSTGRES_URL.
 * Usage: npm run db:migrate  (needs POSTGRES_URL in env — e.g. `vercel env pull .env.local` first)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";

async function main() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    console.log("Running:\n" + statement.slice(0, 80) + "...");
    await sql.query(statement);
  }

  console.log(`Done. Applied ${statements.length} statements.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
