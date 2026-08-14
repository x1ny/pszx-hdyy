import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { err, ok } from "../../shared/result";
import type { Variables } from "../auth";
import { EchoInput } from "./validation";

// Everything here is a worked example, not real product surface — action-
// named routes, POST for everything (the verb carries no business meaning),
// business outcomes expressed as `code` in the body rather than HTTP status.
export const exampleRoutes = new Hono<{ Variables: Variables }>()
  .post("/getServerInfo", (c) =>
    c.json(
      ok({
        runtime:
          typeof Bun !== "undefined"
            ? `Bun ${Bun.version}`
            : `Node ${process.version}`,
        time: new Date().toISOString(),
      }),
    ),
  )
  .post("/getMe", (c) => {
    const user = c.get("user");
    if (!user) return c.json(err({ code: "UNAUTHORIZED", message: "未登录" }));
    return c.json(ok({ id: user.id, name: user.name, email: user.email }));
  })
  .post(
    "/submitEcho",
    zValidator("json", EchoInput, (result, c) => {
      if (!result.success) {
        return c.json(
          err({
            code: "VALIDATION_ERROR",
            message: result.error.issues[0]?.message ?? "参数不合法",
          }),
        );
      }
    }),
    (c) => {
      const { message } = c.req.valid("json");
      return c.json(ok({ message, receivedAt: new Date().toISOString() }));
    },
  );
