## Usage

### One-time setup (already done)
```sh
bun scripts/patches.ts init
```

### Exporting a patch from a source repo branch

**Source packages** (ghostty-opentui — ships TS, Bun imports directly):
```sh
bun scripts/patches.ts export ghostty-opentui cursor-rendering-fix
```
This runs `git diff main...cursor-rendering-fix -- src/` and stores the result.

**Compiled packages** (@opentui/core — ships bundled JS):
```sh
bun scripts/patches.ts export @opentui/core fix-wide-char-alpha-blending
```
Export stores a source-level diff (same as source packages). At apply time,
a worktree is created at the base version tag (e.g. `v0.1.86`), all patches
are applied to source, the package is rebuilt (`bun run build` — both native
zig and JS bundle), and the dist output + native `libopentui.so` are copied
into `node_modules/`. Requires the source repo and zig toolchain locally.

Options:
- `--name=descriptive-name` — custom patch filename (default: branch name)
- `--base=v1.4.6` — diff against a different ref (default: `main`)

### After exporting, edit the metadata
```sh
$EDITOR patches/series.json
```
Add a description and upstream PR link to each patch entry.

### Applying patches
Happens automatically after `bun install` via the `postinstall` hook. To run manually:
```sh
bun scripts/patches.ts apply              # all packages
bun scripts/patches.ts apply ghostty-opentui  # one package
```
Idempotent — detects already-applied patches and skips them.

### Checking patches still apply cleanly
```sh
bun scripts/patches.ts verify
```

### When upstream accepts a patch
```sh
# Remove the patch, bump the dep version
bun scripts/patches.ts drop ghostty-opentui cursor-rendering-fix
# Edit package.json to bump ghostty-opentui version
bun install
```

### Adding a new patch (full workflow)
1. Make changes on a branch in the source repo (e.g. `~/src/ghostty-opentui`)
2. `bun scripts/patches.ts export ghostty-opentui my-new-branch`
3. Edit `patches/series.json` to add description
4. Commit the `.patch` file + `series.json` change to honeymux
5. Optionally, keep that commit on its own branch in honeymux (e.g. `patch/ghostty-my-fix`) if you want each patch isolated before merging to main

### Release workflow
Since patches are committed to the repo and auto-applied via `postinstall`, anyone who clones and runs `bun install` gets the patched dependencies. A GitHub release includes the `patches/` directory — fully reproducible.
