import { z } from "zod";

export const EchoInput = z.object({
  message: z.string().min(1).max(200),
});
