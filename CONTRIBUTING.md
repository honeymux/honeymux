# Contributing to Honeymux

Bug fixes, improvements to existing features, helpful UX tweaks, and other minor updates are always welcome.

Feature suggestions (please file an issue) are also welcome. However, at the time of this writing (April 2026), pull requests that add new features are unlikely to be accepted, until the current feature set sees more widespread testing and hardening. The maintainers believe this is best for the long-term health of the project.

## Guidelines

To increase the likelihood of a successful merge, please ensure your contributions adhere to the following:

- **Take pride in your work.** Whether you employ AI tools or not, laziness will seal your fate. Quality is what matters here.

- **Skilled use of AI tooling is encouraged.** This project would not exist without the powerful models that are available today (see [genesis commit](https://github.com/honeymux/honeymux/commit/4875a4b6664c991656ecef3c01940b88578adc1c)). Skilled means you're not offloading 100% of the thinking and judgment to the LLM -- machines are mechanical, lack taste, and even the frontier models at max inference levels often make poor architectural choices.

- **AGENTS.md is for humans, too.** This is where the expectations around architecture, security concerns, user experience, testing, and other general topics can be found. Code style and formatting is enforced by automation (eslint, perfectionist, prettier, etc).

- **Post PRs with clean commit stacks.** To maintain a strictly linear git history, all PR merges will be performed with the rebase strategy only. Therefore, keep your PRs in draft state until they are review-ready and merge-ready. Limit each individual commit to a reasonable size that a normal human can fit in their head at one time.

- **Commit messages roughly follow the Linux kernel canonical commit-log format.** The 72-column limit leaves room for Git’s indentation (~4 spaces) so messages remain readable in git log, git show, etc without hard-wrapping at 80 columns (the traditional terminal screen width, which is still a baseline assumption in low-level tooling ecosystems).

- **Be concise, but descriptive.** It takes next to zero effort to have an LLM prepare commit messages for you, so this project strictly requires both a summary line and body. That said, most commits should not need more than 1 or 2 paragraphs to adequately describe.

- **When in doubt, follow existing patterns.** If this process seems daunting, don't worry -- there are plenty of existing examples to look at!

Finally, please know that the author has a day job and life outside of open source, so response times to pull requests will vary accordingly.

## Getting started

1. Clone the repository:

   ```bash
   git clone https://github.com/honeymux/honeymux.git
   cd honeymux
   ```

1. Install dependencies

   Honeymux currently bundles a number of patches to its dependencies that have not yet been upstreamed. These patches include bug fixes and performance optimizations but are generally not required for running Honeymux from source for development.

   - To proceed with patches:

     1. Install required dev tools (method varies by OS and/or package manager)
        - patch(1) tool
        - [Zig](https://ziglang.org) (run `bun scripts/patches.ts status` to learn which version is needed)
     1. Clone required source repositories
        ```bash
        cd /path/to/src/dir
        git clone https://github.com/anomalyco/opentui
        git clone https://github.com/remorses/ghostty-opentui
        ```

     Then run:

     ```bash
     HMX_PATCH_SRC_DIR=/path/to/src/dir bun install
     ```

   - To proceed without patches:

     ```bash
     bun install --ignore-scripts
     ```

1. Run

   ```bash
   bun run start
   ```

## Development workflow

### Running locally

To start Honeymux under `bun --watch`:

```bash
bun run dev
```

In this mode, the process will restart automatically when source files change. For a one-shot run without the watcher, use `bun run start` instead.

### Tests

To run the test suite:

```bash
bun test
```

Tests live next to the code they cover (e.g. `src/util/text.test.ts`). Please add or update regression tests for behavior changes.

### Pre-commit checks

Before committing, run the following checks:

```bash
bun run format      # prettier --write src/
bun run lint        # eslint . (incl. perfectionist alphabetical sort rules)
bun run typecheck   # tsc --noEmit
```

ESLint's perfectionist rules will reorder imports, object keys, JSX props, etc. — insert new entries in the correct alphabetical position up front rather than appending and relying on `lint:fix` to clean up.

Optionally, run static security analysis locally before pushing (CI runs it too; requires Docker):

```bash
bun run lint:semgrep
```

### Building a release binary

To build a standalone executable:

```bash
bun run build       # produces ./dist/hmx (single-file compiled binary)
```

CI cross-builds for Linux and macOS on every PR via the `build-and-test` workflow.
