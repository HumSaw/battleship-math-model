# Contributing

Thank you for improving Admiral.

## Development

1. Fork and clone the repository.
2. Install dependencies with `pnpm install`.
3. Create a focused branch from `main`.
4. Run `pnpm dev` while developing.
5. Before opening a pull request, run:

```bash
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm build
```

## Engine changes

For inference or policy changes, include a regression test with a minimal board state. Explain whether the change affects validation, the placement prior, probability estimation, or policy selection. Do not report benchmark improvements without the command, parameters, seed, hardware context, and commit SHA.

## Pull requests

Keep pull requests narrowly scoped. Describe user-visible behavior, tests performed, and any mathematical assumption introduced or changed. Avoid committing generated coverage output, local environment files, or temporary benchmark bundles.

## Reporting bugs

Include the rule set, all marked cells, explicit sunk-ship cells if relevant, expected behavior, actual behavior, browser, and reproduction steps. Screenshots are useful, but a board-state description is required for engine bugs.
