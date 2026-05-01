# Contributing to Helm Visualizer

Thank you for your interest in contributing! This guide will help you get started.

## Table of Contents

- [Branching Strategy](#branching-strategy)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Checklist](#pull-request-checklist)

---

## Branching Strategy

We use a simple trunk-based workflow:

```
main
├── feat/<short-description>     # New features
├── fix/<short-description>      # Bug fixes
├── docs/<short-description>     # Documentation updates
└── chore/<short-description>    # Tooling, deps, config
```

- **`main`** is the stable branch — all PRs target `main` directly.
- Branch names should be lowercase, hyphen-separated (e.g. `feat/subchart-rendering`).
- Keep branches short-lived; open a PR as soon as you have something reviewable.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | **18 or later** | Required |
| npm | Comes with Node.js | Required |
| [Helm CLI](https://helm.sh/docs/intro/install/) | Any recent v3 | *Optional* — the app falls back to a pure-JS renderer when Helm is not installed |

---

## Setup

```bash
# 1. Fork & clone the repository
git clone https://github.com/<your-fork>/helm-visualizer.git
cd helm-visualizer

# 2. Install dependencies
npm install

# 3. Copy the environment template and fill in your values
cp env.example .env.local
# Edit .env.local — at minimum set OPENAI_API_KEY for the AI Chat feature

# 4. Start the dev server
npm run dev
# App available at http://localhost:3000
```

---

## Code Style

We use **TypeScript** in strict mode and **Tailwind CSS** for styling. Please follow these rules:

- **TypeScript strict** — `"strict": true` is enforced by `tsconfig.json`. No `any` without justification.
- **Tailwind utility classes only** — do **not** use inline `style={{}}` props or plain CSS files unless there is a compelling reason. Keep styling co-located with the component.
- **2-space indentation** — tabs are not used anywhere in the project.
- **No magic strings** — extract repeated string literals into named constants or enums.
- **Imports** — use path aliases (`@/lib/...`, `@/components/...`) rather than relative `../../` chains.
- **File naming** — components use `PascalCase.tsx`; utilities and lib files use `camelCase.ts`.

Run the linter before pushing:

```bash
npm run lint
```

ESLint is configured via `eslint.config.mjs` (flat config). Fix all warnings before opening a PR — CI will fail on lint errors.

---

## Testing

Tests are written with **[Vitest](https://vitest.dev/)** and live alongside source files as `*.test.ts` / `*.test.tsx`.

```bash
# Run all tests once (CI mode)
npx vitest run

# or via npm script
npm test

# Watch mode during development
npx vitest

# Coverage report
npx vitest run --coverage
```

### Writing tests

- Place test files next to the module they test: `lib/foo.ts` → `lib/foo.test.ts`.
- Use real temporary directories (via `os.tmpdir()` + `fs`) for tests that touch the filesystem — avoid mocking the FS unless strictly necessary.
- Clean up temp files in `afterEach`.
- Prefer `describe` / `it` over standalone `test` calls for readability.

---

## Commit Messages

We follow the **[Conventional Commits](https://www.conventionalcommits.org/)** specification:

```
<type>(<optional scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `chore` | Build process, dependency updates, tooling |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration changes |

**Examples:**

```
feat(graph): add edge inference for ConfigMap mounts
fix(renderer): handle missing templates/ directory gracefully
docs: add ARCHITECTURE.md and CONTRIBUTING.md
chore(deps): upgrade vitest to 2.x
```

- Use the **imperative mood** in the summary ("add" not "added").
- Keep the summary under **72 characters**.
- Reference issues in the footer: `Closes #71`, `Fixes #76`.

---

## Pull Request Checklist

Before marking your PR as ready for review, confirm all of the following:

- [ ] `npm run lint` passes with no errors or warnings
- [ ] `npm test` (i.e. `npx vitest run`) passes with no failing tests
- [ ] New behaviour is covered by tests (unit or integration as appropriate)
- [ ] Documentation is updated — README, ARCHITECTURE.md, or inline JSDoc as needed
- [ ] **No secrets or credentials are committed** (API keys, tokens, passwords)
- [ ] `.env.local` is not committed (it is in `.gitignore`)
- [ ] Branch is up-to-date with `main` before requesting review
- [ ] PR description explains *what* changed and *why*
- [ ] Linked to the relevant GitHub issue(s) in the PR description

---

## Getting Help

- Open a [GitHub Discussion](../../discussions) for questions or ideas.
- Open an [Issue](../../issues) for bugs or feature requests.
- Tag your issue with the appropriate label (`bug`, `enhancement`, `documentation`, etc.).
