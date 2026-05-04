export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold">app-template</h1>
      <p className="text-sm text-muted-foreground">
        Phase 1 skeleton — no auth, no database, no jobs yet.
      </p>
      <code className="rounded bg-muted px-3 py-1 text-xs">
        docs/superpowers/specs/2026-05-04-app-template-design.md
      </code>
    </main>
  );
}
