import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold">This page doesn't exist</h1>
      <p className="text-muted-foreground">
        The link may be broken, or the page may have been moved.
      </p>
      <Link
        to="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        Go home
      </Link>
    </div>
  );
}
