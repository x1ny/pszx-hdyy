# fullstack-template

A lean Bun-workspaces monorepo: a TanStack Router SPA on the front, a Hono API on the back, Drizzle + Postgres underneath, Better Auth across both.

```
apps/web       Vite + TanStack Router, client-only SPA        → :3000
apps/server    Hono + Better Auth + Drizzle (schema included)  → :8787
```

## Getting Started

```bash
bun install
cp .env.example .env   # then edit BETTER_AUTH_SECRET
bun run dev
```

`bun run dev` starts Postgres via `docker compose up -d`, then runs both apps. Open the URL printed by Vite (normally http://localhost:3000).

### Development ports

The root development runner starts the server and web app together. `SERVER_PORT` (default `8787`) and `WEB_PORT` (default `3000`) are preferred starting ports; if either is occupied, the runner finds the next available port. The selected server port is passed to both the Hono server and the Vite `/api` proxy. If the web port changes, `WEB_ORIGIN` and `BETTER_AUTH_URL` are updated for the same run so authentication continues to work.

Use `bun run dev` from the repository root to enable this coordination. Running an individual package script does not perform the cross-process port selection.

First run needs the tables:

```bash
bun run db:push
```

## How the two apps talk

The browser only ever sees one origin. Vite proxies `/api` to the Hono server:

```ts
// apps/web/vite.config.ts
server: { proxy: { "/api": { target: `http://localhost:${serverPort}` } } }
```

That means no CORS setup and no cross-site cookie rules in development — Better Auth's session cookie is same-origin as far as the browser is concerned.

**No REST, no tRPC/oRPC — plain Hono RPC plus one shared convention.** Full rationale (why not oRPC, why status codes don't carry business meaning, the compiler-perf numbers behind `hcWithType`) is in [docs/architecture-decisions.md](docs/architecture-decisions.md). The rules:

- Business routes are named like actions (`getServerInfo`, `submitEcho`), not REST resources, and use `POST` — the HTTP verb carries no business meaning. The raw file transfer endpoint `GET /api/file/:fileId` is an explicit transport exception so browsers can preview or download files natively.
- Business API responses are `{ code: "OK", data } | { code: "SOME_ERROR", message }` (`apps/server/src/shared/result.ts`). The file transfer endpoint is the transport exception: successful reads return raw file bytes, while read failures still return the same JSON envelope. Business outcomes — including "not logged in" and "validation failed" — return HTTP **200**; the `code` field is what the client branches on, never `res.status`. Real non-200s are reserved for the two cases that aren't business outcomes: a malformed request body (`zValidator`'s error hook) and an uncaught exception (`app.onError`).
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

## Backend layout: infra / modules / shared

Three buckets, told apart by a dependency rule, not just a name:

```
infra/     knows the outside world (DB, cache, email…), knows no business logic
shared/    pure logic and types, knows nothing
modules/   may import infra and shared; infra/shared never import modules
```

Rule of thumb: does it hold a connection or do I/O? → `infra`. Pure function or type, no state? → `shared`.

```
apps/server/
├── drizzle.config.ts   schema: "./src/modules/**/schema.ts" — a glob, so a new
│                       modules/<name>/schema.ts is picked up with no config change
└── src/
    ├── infra/
    │   └── db.ts        the Drizzle client — no `schema` argument passed in (see below)
    ├── modules/
    │   ├── auth/         Better Auth instance, its own tables, its Hono mount, session middleware
    │   └── example/      worked examples — delete this once real features replace it
    ├── shared/
    │   └── result.ts     the only thing that's genuinely cross-module: the ApiResult<T> envelope
    ├── client-type.ts     hcWithType
    └── index.ts            composition only: mounts authHandler → session middleware → each module's routes
```

**`infra/db.ts` deliberately builds the Drizzle client without a `schema` option.** Passing one would mean `infra/` has to import every module's tables, inverting the dependency rule above. The trade-off is losing the relational query API (`db.query.user.findMany()`); use `db.select().from(table)` instead, importing `table` from the module that owns it. Nothing in this codebase used `db.query` before this change (Better Auth takes its schema explicitly), so it's a free trade for now.

Add a feature by creating `modules/<name>/{schema,validation,routes}.ts` and chaining the routes in `index.ts` — a `schema.ts` there is picked up automatically by the glob above. Don't add routes to `modules/example`, that folder is a template you replace.

There used to be a separate `packages/db` workspace package. It was folded into `apps/server/src/infra` — its only real consumer was the server, so the package boundary bought nothing but a `bun --hot` blind spot (schema edits didn't trigger a reload — Bun only watches the package it's running from) and an env-var detour (`--env-file=../../.env`). Split it back out if a second runtime consumer shows up (a worker, a CLI, a second service) — that's a small, reversible change whenever it actually happens.

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

Drizzle schema lives per-module under `apps/server/src/modules/*/schema.ts`, picked up by `drizzle.config.ts`'s glob; the client is `apps/server/src/infra/db.ts`.

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
