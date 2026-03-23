# RDSS Folder Mapper - Agent Guidelines

## Project Overview
`rdss-folder-mapper` is a Node.js/TypeScript command-line application designed to transform and map RESTful API responses into a structured `folders.json` format.

## Key Components
- **Source Code:** Primarily located in `index.ts`.
- **Testing:** Uses Jest (`index.spec.ts`). Ensure to run tests using `npx jest`.
- **Typing:** Strict TypeScript checking (`npx tsc --noEmit`).
- **Core Logic:** Involves transforming project plans (e.g., from `plans.json`) into drive mappings, specifically filtering for records with a `dataStorageId` and extracting fields like `encodedId` (as `id`), `project.title` (as `title`), roles, and organisations.

## Development Rules
1. **Testing:** Write or update Jest tests for any new data transformation logic.
2. **Type Safety:** Ensure all new properties on interfaces (like `DriveMapping`) are correctly typed and handle optional values gracefully.
3. **CLI Execution:** Keep CLI execution wrapped in `if (require.main === module)` to prevent unintended execution during test runs.
4. **Formatting/Linting:** Adhere to existing ESLint configurations (`eslint.config.js`).
