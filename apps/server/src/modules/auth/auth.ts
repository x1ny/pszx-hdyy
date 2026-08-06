import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  // The web app reaches the server through Vite's /api proxy, so the browser
  // only ever sees one origin. If you split the deployment across two domains,
  // add the web origin here and enable the CORS middleware in src/index.ts.
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
