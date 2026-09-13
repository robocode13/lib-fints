# Agent instructions

## Before committing

Run `pnpm exec biome check --fix` (lint + format) on any file you touched. `pnpm run build` also runs Biome, but don't rely on that alone — run it explicitly after resolving merge/rebase conflicts, since hand-edited conflict resolutions are the most common source of leftover lint/format issues that CI (`biome ci`) then catches.
