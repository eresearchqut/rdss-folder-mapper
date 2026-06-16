# RDSS Folder Mapper - Agent Guidelines

## Project Overview
`rdss-folder-mapper` is a Node.js/TypeScript monorepo providing a CLI tool and an
Electron desktop GUI that map RDSS research storage folders to a user's Desktop.
The CLI transforms DMP API responses into a structured `folders.json` and mounts
the corresponding network shares.

## Key Components
- **CLI source:** `cli/src/` (entry point `cli/src/index.ts`; mapping logic in
  `cli/src/mapper.ts`, mounting in `cli/src/mount.ts`, auth in `cli/src/auth.ts`).
- **GUI source:** `gui/src/` (`main.ts` Electron main process, `preload.ts` context
  bridge, `worker.ts` per-remap worker thread, `renderer/index.html` UI).
- **Testing:** Uses **Vitest**. Run with `npm test` (root) or `npx vitest run src/`
  in `cli/`. Spec files import APIs explicitly from `vitest`.
- **Typing:** Strict TypeScript. Check with `npx tsc --noEmit`.
- **Linting:** `gts` via `npm run lint`.
- **Core Logic:** Transforms project plans into folder mappings, filtering for
  records with a `dataStorageId` and extracting fields like `encodedId` (as `id`),
  `project.title` (as `title`), roles, and organisations. The mapping shape is the
  `FolderMapping` interface (`cli/src/mapper.ts`).

## Development Rules
1. **Testing:** Write or update Vitest tests for any new data transformation or
   mounting logic.
2. **Type Safety:** Ensure new properties on interfaces (like `FolderMapping`) are
   correctly typed and handle optional values gracefully.
3. **CLI Execution:** Keep CLI execution wrapped in `if (require.main === module)`
   to prevent unintended execution during test runs.
4. **Formatting/Linting:** Adhere to the existing `gts`/ESLint configuration.
5. **Functional Programming:** Use functional programming to avoid side effects.
