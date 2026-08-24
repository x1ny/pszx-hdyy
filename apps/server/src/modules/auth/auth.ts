import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../../infra/db";
import * as schema from "./schema";

const DEFAULT_SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

const getSessionExpiresInSeconds = () => {
  const raw =
    process.env.BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS?.trim() ||
    String(DEFAULT_SESSION_EXPIRES_IN_SECONDS);
  const seconds = Number(raw);

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(
      `BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS must be a positive integer, got "${raw}"`,
    );
  }

  return seconds;
};

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: getSessionExpiresInSeconds(),
  },
  // The web app reaches the server through Vite's /api proxy, so the browser
  // only ever sees one origin. If you split the deployment across two domains,
  // add the web origin here and enable the CORS middleware in src/index.ts.
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
