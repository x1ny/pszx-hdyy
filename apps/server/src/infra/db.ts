import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Deliberately constructed without a `schema` argument. Passing one would
// require infra/ to import every module's tables, inverting the dependency
// rule (infra must never know about modules/). The cost is the relational
// query API — use db.select().from(table), importing tables from the module
// that owns them, instead of db.query.table.findMany().
export const db = drizzle({ client: pool });
