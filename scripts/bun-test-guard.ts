/**
 * Preloaded by `bun test` via the `[test]` section of bunfig.toml.
 *
 * This repo's suite runs on Vitest — the tests use Vitest's `vi` mocking API
 * and a jsdom environment that Bun's native test runner does not provide
 * (see CLAUDE.md → Testing). Running `bun test` would surface ~80 spurious
 * failures that look like real bugs but are only runner incompatibility.
 *
 * Rather than let that footgun stand, we abort early with a clear pointer to
 * the supported command. `bun run test` / `bun run vitest` are unaffected:
 * they invoke Vitest directly and never load this file.
 */
process.stderr.write(
  "\n  ✗ `bun test` is not this project's test runner.\n" +
    '    The suite runs on Vitest (vi mocking + jsdom).\n\n' +
    '    Use:  bun run test        — full run\n' +
    '          bun run test:watch  — watch mode\n\n',
);
process.exit(1);
