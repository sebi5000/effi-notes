// Phase 1 stub. BullMQ wiring lands in Phase 4.
// OTel init must precede any other import once Phase 5 ships — see CLAUDE.md.

const startedAt = new Date().toISOString();

console.warn(`[worker] started at ${startedAt} — Phase 1 stub, no jobs configured`);

// Keep process alive so `bun --watch` works.
setInterval(() => {
  // intentionally empty: heartbeat replaced with real BullMQ event loop in Phase 4
}, 60_000);

const shutdown = (signal: string): void => {
  console.warn(`[worker] received ${signal}, exiting`);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
