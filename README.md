# fullstack-template

A lean Bun-workspaces monorepo: a TanStack Router SPA on the front, a Hono API on the back, Drizzle + Postgres underneath, Better Auth across both.

```
apps/web       Vite + TanStack Router, client-only SPA   → :3000
apps/server    Hono + Better Auth                        → :8787
packages/db    Drizzle schema + client (shared)
```

## Getting Started

```bash
bun install
cp .env.example .env   # then edit BETTER_AUTH_SECRET
bun run dev
```

`bun run dev` starts Postgres via `docker compose up -d`, then runs both apps. Open http://localhost:3000.

First run needs the tables:

```bash
bun run db:push
```

## How the two apps talk

The browser only ever sees one origin. Vite proxies `/api` to the Hono server:

```ts
// apps/web/vite.config.ts
server: { proxy: { "/api": { target: "http://localhost:8787" } } }
```

That means no CORS setup and no cross-site cookie rules in development — Better Auth's session cookie is same-origin as far as the browser is concerned.

**No REST, no tRPC/oRPC — plain Hono RPC plus one shared convention.** Full rationale (why not oRPC, why status codes don't carry business meaning, the compiler-perf numbers behind `hcWithType`) is in [docs/architecture-decisions.md](docs/architecture-decisions.md). The rules:

- Routes are named like actions (`getServerInfo`, `submitEcho`), not REST resources, and everything is `POST` — the HTTP verb carries no business meaning.
- Every response is `{ code: "OK", data } | { code: "SOME_ERROR", message }` (`apps/server/src/shared/result.ts`). Business outcomes — including "not logged in" and "validation failed" — return HTTP **200**; the `code` field is what the client branches on, never `res.status`. Real non-200s are reserved for the two cases that aren't business outcomes: a malformed request body (`zValidator`'s error hook) and an uncaught exception (`app.onError`).
- The server chains its routes onto a single value and exports its type:

```ts
// apps/server/src/index.ts
const routes = app.route("/", exampleRoutes); // .route("/", xyzRoutes) per module

export type AppType = typeof routes;
```

and the web app builds a fully typed client from it via the pre-compiled `hcWithType` (not `hc` directly — see the perf note in the architecture doc):

```ts
// apps/web/src/lib/api.ts
import { hcWithType } from "@repo/server/client-type";

export const api = hcWithType(baseUrl, { init: { credentials: "include" } });
```

```ts
const res = await api.api.getServerInfo.$post();
const result = await res.json(); // { code: "OK"; data: {...} } — inferred, no hand-written types
if (result.code === "OK") {
  console.log(result.data.runtime);
}
```

Two rules keep this working: routes must be **chained** (a standalone `app.post(...)` never lands in `AppType`), and the web app must import `@repo/server` **type-only** so no server code reaches the browser bundle.

## Backend layout: by feature, not by layer

```
apps/server/src/
├── modules/
│   ├── auth/       Better Auth instance, its official Hono mount, the session middleware
│   └── example/    worked examples — delete this once real features replace it
├── shared/
│   └── result.ts   the only thing that's genuinely cross-module: the ApiResult<T> envelope
├── client-type.ts  hcWithType
└── index.ts        composition only: mounts authHandler → session middleware → each module's routes
```

Add a feature by creating `modules/<name>/{schemas,routes}.ts` and chaining it in `index.ts` — don't add routes to `modules/example`, that folder is a template you replace.

## Authentication

Better Auth runs entirely on the server and is mounted as a catch-all, following the official Hono integration doc verbatim:

```ts
// apps/server/src/modules/auth/routes.ts
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

In `index.ts`, this is registered *before* the session middleware — that ordering is a deliberate choice, not something the official docs mandate: the handler never touches Hono's context and never calls `next()`, so mounting it first means Better Auth's own routes skip the session middleware entirely (Hono runs middleware in registration order, and once an earlier route matches and returns without `next()`, anything registered after it never runs for that request).

On the client, the session is a react-query entry (`apps/web/src/lib/session.ts`) and `_authenticated.tsx` is a pathless layout that guards every route beneath it.

**Gotcha worth knowing:** the guard uses `ensureQueryData`, which returns cached data even when it's stale. After signing in or out you must `queryClient.removeQueries({ queryKey: sessionQueryKey })` — `invalidateQueries` alone leaves the stale `null` in place and the guard bounces a freshly logged-in user straight back to `/login`.

The frontend guard is a UX affordance, not a security boundary — the app is a client-only SPA, so anyone can call `/api/*` directly. Every protected endpoint checks the session itself.

## Rendering

`apps/web` is a plain SPA. `index.html` is the only HTML shell, `src/main.tsx` mounts the router, and `beforeLoad` / `loader` / components all run in the browser only. There is no SSR and no server-function mechanism — server logic lives in `apps/server`.

## Database

Drizzle schema lives in `packages/db`, shared by the server and the drizzle-kit CLI.

```bash
bun run db:push       # push schema to the dev database
bun run db:generate   # generate a migration
bun run db:migrate    # apply migrations
bun run db:studio     # browse data
```

Regenerate the Better Auth tables after changing auth config or plugins:

```bash
bun run --filter '@repo/server' auth:generate
```

## Runtime

Everything runs on Bun today, including the server in production — `apps/server/src/index.ts` default-exports `{ port, fetch }`, which is Bun's server convention and is not understood by Node.

Before the monorepo split, production ran on plain Node because Nitro emitted a self-contained Node bundle. Nitro is gone. To go back to Node, add [`@hono/node-server`](https://github.com/honojs/node-server) and point the `start` script at it; the app itself needs no changes.

`typeof Bun !== "undefined" ? Bun.version : process.version` in `modules/example/routes.ts`'s `getServerInfo` is the runtime probe pattern, and the only sanctioned reference to the `Bun` global.

## Styling

[Tailwind CSS](https://tailwindcss.com/) v4 with [shadcn/ui](https://ui.shadcn.com/).

**Dark mode is disabled by design.** `apps/web/src/styles.css` ships light tokens only. Tailwind v4's `dark:` variant defaults to `prefers-color-scheme`, so the stylesheet rebinds it to a `.dark` class that is never applied — that is what stops shadcn components' built-in `dark:` classes from activating off the visitor's OS setting. To enable dark mode later, add a `.dark { ... }` token block and toggle the class on `<html>`.

Add components from inside `apps/web`:

```bash
bunx shadcn@latest add button
```

## Routing

[TanStack Router](https://tanstack.com/router) with file-based routing. Routes are files under `apps/web/src/routes`; `routeTree.gen.ts` is generated by `@tanstack/router-plugin` on dev/build (or `bun run --filter '@repo/web' generate-routes`) and must never be edited by hand.

In `vite.config.ts`, `tanstackRouter()` has to come before `viteReact()` so generated routes get transformed.

Layouts live in `src/routes/__root.tsx` — this is a normal `component` rendering an `<Outlet />`, not a Start `shellComponent`. Page `<title>` and meta go in `apps/web/index.html`.

## Testing

[Vitest](https://vitest.dev/) with happy-dom and Testing Library, in `apps/web` only.

```bash
bun run test
bun run --filter '@repo/web' test:watch
```

Test config lives in `apps/web/vitest.config.ts`, deliberately separate from `vite.config.ts`. Test files match `src/**/*.{test,spec}.{ts,tsx}`.

## Linting & Formatting

[Biome](https://biomejs.dev/), configured once at the repo root for all packages.

```bash
bun run lint
bun run format
bun run check
```

## Path aliases

`apps/web` uses `#/*` → `apps/web/src/*`, declared in both `package.json#imports` and `tsconfig.json#paths`.

`apps/server` uses **relative imports only**. `paths` applies program-wide, so when the web app pulls server sources in via `import type`, web's `#/*` would be used to resolve `#/` inside server files and resolve to the wrong place.

## Learn More

- [TanStack Router](https://tanstack.com/router)
- [Hono](https://hono.dev) — [RPC guide](https://hono.dev/docs/guides/rpc)
- [Better Auth](https://www.better-auth.com/docs/integrations/hono)
- [Drizzle ORM](https://orm.drizzle.team)
