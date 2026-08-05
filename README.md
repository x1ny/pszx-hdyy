Welcome to your new TanStack Start app!

## Runtime split: Bun for dev, Node for production

Development tooling (dev server, build, tests, lint) runs on **Bun**. The built production server runs on plain **Node** (`node .output/server/index.mjs`, wired up as `bun run start`) — no Bun runtime required in production.

Because of this, server-side code (`createServerFn` handlers, `server.handlers`, middleware — anything that ends up in `.output/`) must be Node-compatible. Don't call Bun-only APIs (`Bun.file`, `Bun.serve`, `Bun.$`, `bun:sqlite`, `bun:ffi`, ...) unconditionally in that code. If you need to detect the runtime, guard it: `typeof Bun !== "undefined" ? Bun.version : process.version` — see `src/routes/index.tsx` for the pattern in use, which is what proves the split works (it prints `Bun x.x.x` under `bun run dev` and `Node x.x.x` under `bun run start`).

# Getting Started

To run this application:

```bash
bun install
bun --bun run dev
```

# Building For Production

To build this application for production:

```bash
bun --bun run build
```

## Rendering: SPA mode

This project runs TanStack Start with SSR turned off:

```ts
// vite.config.ts
tanstackStart({ spa: { enabled: true } })
```

Route `beforeLoad`, `loader`, and components execute client-side only. The build prerenders a single shell to `.output/public/_shell.html`, and the router's pending fallback renders until the client takes over.

The server is still there and still needed — `createServerFn` calls and any `/api/*` server routes are served by the Node process at runtime. SPA mode removes server *rendering*, not the server itself.

Trade-off: slower time-to-content on first paint, and SEO depends on crawlers executing JavaScript. To turn SSR back on, drop the `spa` option. For per-route control instead of all-or-nothing, see [Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr).

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) v4 with [shadcn/ui](https://ui.shadcn.com/).

**Dark mode is disabled by design.** `src/styles.css` ships light tokens only. Tailwind v4's `dark:` variant defaults to `prefers-color-scheme`, so the stylesheet rebinds it to a `.dark` class that is never applied — that is what stops shadcn components' built-in `dark:` classes from activating off the visitor's OS setting. To enable dark mode later, add a `.dark { ... }` token block and toggle the class on `<html>`.

## Testing

Tests run on [Vitest](https://vitest.dev/) with happy-dom and Testing Library, executed under the Bun runtime.

```bash
bun run test
bun run test:watch
```

Test config lives in `vitest.config.ts` (separate from `vite.config.ts` so the Start/Nitro server plugins stay out of the test pipeline). Test files match `src/**/*.{test,spec}.{ts,tsx}`.

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
bun --bun run lint
bun --bun run format
bun --bun run check
```


## Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
bunx shadcn@latest add button
```


## Deploy with Nitro (Node preset)

`vite.config.ts` configures Nitro with `preset: 'node-server'`, so `bun run build` (Bun is just the build tool here) emits a self-contained **Node** server under `.output/`.

```bash
bun run build
bun run start
```

`bun run start` runs `node .output/server/index.mjs` under the hood — no Bun runtime needed to serve the app. To deploy, ship the `.output/` directory to any Node-capable host (Railway, Fly.io, your own VPS, a plain `node:20`/`node:22` Docker image, etc.) and run `node .output/server/index.mjs` directly. The server honours the `PORT` environment variable. Required Node range: `^20.19.0 || >=22.12.0` (see `engines` in `package.json`).

To target a different runtime, change the preset in `vite.config.ts` — `bun`, `vercel`, `cloudflare-module`, etc. See https://v3.nitro.build/deploy for the full list. If you switch back to the `bun` preset, also revert `start` in `package.json` to run the output with `bun`.



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).



# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
