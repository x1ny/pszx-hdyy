import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { err } from "./result";

// Every route validates its body the same way and fails the same way, so the
// error hook lives here instead of being copy-pasted per route. Malformed
// input is a business outcome like any other — it comes back as HTTP 200 with
// code: "VALIDATION_ERROR", not as a 400 (see shared/result.ts).
//
// Only the first issue is surfaced: these messages go straight into a toast,
// and the client already validates the same shape before submitting, so a
// full issue list would be noise. Field-level errors are the form's job.
export const jsonBody = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(
        err({
          code: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message ?? "参数不合法",
        }),
      );
    }
  });
