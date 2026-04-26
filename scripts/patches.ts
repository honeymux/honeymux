#!/usr/bin/env bun
//
// patches.ts — manage patches against upstream dependency versions
//
// Patches are stored in patches/<pkg-dir>/ as unified diffs.
// series.json tracks metadata: branch, description, upstream PR link.
//
// Source packages (e.g. ghostty-opentui, which ships TS src/ and uses
// Bun's "bun" export condition) are diffed at the source level.
//
// Compiled packages (e.g. @opentui/core, which ships bundled JS) are
// built in git worktrees and diffed at the dist level.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

const ROOT = resolve(import.meta.dirname!, "..");
const PATCHES_DIR = join(ROOT, "patches");
const SERIES_FILE = join(PATCHES_DIR, "series.json");

// ── Types ────────────────────────────────────────────────────────────

interface PatchEntry {
  branch: string;
  description: string;
  file: string;
  upstream?: string;
}

interface NativeLibConfig {
  /** Directory relative to sourceSubdir containing the current host's built native library */
  srcDir: string;
  /** Destination directory relative to node_modules/ for the current host's native package */
  destDir: string;
}

interface PackageConfig {
  /** If set, export builds both sides and diffs the output */
  buildCmd?: string;
  /** Restrict source diffs to these paths (relative to sourceSubdir or repo root) */
  diffPaths?: string[];
  /** Native library to copy after build (for packages with FFI bindings) */
  nativeLib?: NativeLibConfig;
  patches: PatchEntry[];
  sourceRepo: string;
  sourceSubdir?: string;
  version: string;
}

type Series = Record<string, PackageConfig>;

// ── Helpers ──────────────────────────────────────────────────────────

function pkgDirName(pkg: string): string {
  return pkg.replace(/\//g, "+");
}

function defaultPackageConfigs(): Record<string, Omit<PackageConfig, "patches" | "version">> {
  return {
    "@opentui/core": {
      buildCmd: "bun run build",
      nativeLib: {
        destDir: "@opentui/core-{platform}-{arch}",
        srcDir: "src/zig/lib/{zigTarget}",
      },
      sourceRepo: "~/src/opentui",
      sourceSubdir: "packages/core",
    },
    "@opentui/react": {
      buildCmd: "bun run build:lib",
      sourceRepo: "~/src/opentui",
      sourceSubdir: "packages/react",
    },
    "ghostty-opentui": {
      diffPaths: ["src/"],
      sourceRepo: "~/src/ghostty-opentui",
    },
  };
}

function applyRuntimeDefaults(series: Series): Series {
  const defaults = defaultPackageConfigs();
  const merged: Series = { ...series };

  for (const [pkg, config] of Object.entries(series)) {
    const defaultsForPkg = defaults[pkg];
    if (!defaultsForPkg) continue;

    merged[pkg] =
      pkg === "@opentui/core"
        ? { ...defaultsForPkg, ...config, nativeLib: defaultsForPkg.nativeLib, version: config.version }
        : { ...defaultsForPkg, ...config, version: config.version };
  }

  return merged;
}

function loadSeries(): Series {
  if (!existsSync(SERIES_FILE)) return {};
  return applyRuntimeDefaults(JSON.parse(readFileSync(SERIES_FILE, "utf-8")));
}

/**
 * Read the version requested for `pkg` in the workspace package.json.
 * Used to guard against series.json drifting out of sync with the requested dependency:
 * patches authored against an older version may apply with fuzz (source packages) or be
 * silently overwritten by a build of the older source (compiled packages), masking real upgrades.
 *
 * Reads the workspace package.json — not node_modules/<pkg>/package.json — because applyCompiled
 * writes through bun's hardlinked cache, so the installed package.json reflects the patched
 * source's version, not the requested version.
 */
function requestedPackageVersion(pkg: string): null | string {
  try {
    const json = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const declared: unknown = json.dependencies?.[pkg] ?? json.devDependencies?.[pkg];
    if (typeof declared !== "string") return null;
    return declared.replace(/^[\^~=]/, "");
  } catch {
    return null;
  }
}

/**
 * Pre-flight: refuse to do any patch work if series.json's pinned version
 * disagrees with package.json. Otherwise compiled packages would silently
 * rebuild the old version and mask the upgrade.
 */
function assertSeriesVersionsMatch(series: Series): void {
  const mismatches: { pkg: string; pinned: string; requested: string }[] = [];
  for (const [pkg, config] of Object.entries(series)) {
    const requested = requestedPackageVersion(pkg);
    if (requested && requested !== config.version) {
      mismatches.push({ pkg, pinned: config.version, requested });
    }
  }
  if (mismatches.length === 0) return;
  for (const m of mismatches) {
    console.error(`✗ ${m.pkg}: version mismatch`);
    console.error(`  series.json pins ${m.pinned}, but package.json requests ${m.requested}`);
  }
  console.error(`bump series.json + re-export patches against the new version, or revert the dep bump`);
  process.exit(1);
}

function saveSeries(series: Series): void {
  mkdirSync(PATCHES_DIR, { recursive: true });
  writeFileSync(SERIES_FILE, JSON.stringify(series, null, 2) + "\n");
}

function nextNum(patches: PatchEntry[]): string {
  return String(patches.length + 1).padStart(4, "0");
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function expandHome(p: string): string {
  return p.replace(/^~/, process.env.HOME!);
}

function symlinkDirIfMissing(src: string, dest: string): boolean {
  if (existsSync(dest) || !existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(src, dest);
  return true;
}

function expandRuntimePlaceholders(value: string): string {
  return value
    .replaceAll("{arch}", process.arch)
    .replaceAll("{platform}", process.platform)
    .replaceAll("{zigTarget}", zigTarget());
}

function nativeLibraryCandidates(platform = process.platform): string[] {
  switch (platform) {
    case "darwin":
      return ["libopentui.dylib"];
    case "win32":
      return ["opentui.dll", "libopentui.dll"];
    default:
      return ["libopentui.so"];
  }
}

function resolveNativeLibrary(
  nativeLib: NativeLibConfig,
  pkgSrcDir: string,
): { dest: string; relativeDest: string; src: string } | null {
  const srcDir = join(pkgSrcDir, expandRuntimePlaceholders(nativeLib.srcDir));
  const relativeDestDir = expandRuntimePlaceholders(nativeLib.destDir);
  const destDir = join(ROOT, "node_modules", relativeDestDir);

  for (const fileName of nativeLibraryCandidates()) {
    const src = join(srcDir, fileName);
    if (!existsSync(src)) continue;
    return {
      dest: join(destDir, fileName),
      relativeDest: `${relativeDestDir}/${fileName}`,
      src,
    };
  }

  return null;
}

function supportedZigVersions(buildZigSource: string): string[] {
  const versions = new Set<string>();
  for (const match of buildZigSource.matchAll(/\.{\s*\.major = (\d+),\s*\.minor = (\d+),\s*\.patch = (\d+)\s*}/g)) {
    versions.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return [...versions];
}

/** Map Node's process.platform/arch to zig target directory names */
function zigTarget(): string {
  const archMap: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };
  const platMap: Record<string, string> = { linux: "linux", darwin: "macos" };
  return `${archMap[process.arch] ?? process.arch}-${platMap[process.platform] ?? process.platform}`;
}

type RunOpts = { cwd?: string; env?: Record<string, string> };

async function ensureSupportedZigVersion(pkg: string, pkgSrcDir: string): Promise<boolean> {
  const buildZigPath = join(pkgSrcDir, "src", "zig", "build.zig");
  if (!existsSync(buildZigPath)) return true;

  const versions = supportedZigVersions(readFileSync(buildZigPath, "utf-8"));
  if (versions.length === 0) return true;

  const zig = await run(["zig", "version"]);
  if (zig.exitCode !== 0) {
    console.error(`  ✗ zig is required to rebuild ${pkg}`);
    console.error(`    install Zig ${versions.join(", ")} and ensure it is on PATH`);
    return false;
  }

  const currentVersion = zig.stdout.trim();
  if (versions.includes(currentVersion)) return true;

  console.error(`  ✗ unsupported Zig version ${currentVersion} for ${pkg}`);
  console.error(`    supported version${versions.length === 1 ? "" : "s"}: ${versions.join(", ")}`);
  console.error(
    `    Honeymux rebuilds ${pkg} from source during postinstall; switch to a supported Zig release and rerun bun install.`,
  );
  return false;
}

/** Run a command, return stdout. Throws on non-zero exit unless quiet. */
async function run(cmd: string[], opts: RunOpts = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** Run a shell command string */
async function sh(cmd: string, opts: RunOpts = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return run(["sh", "-c", cmd], opts);
}

/** Run and throw on failure */
async function exec(cmd: string[], opts: RunOpts = {}): Promise<string> {
  const r = await run(cmd, opts);
  if (r.exitCode !== 0) {
    throw new Error(`Command failed (exit ${r.exitCode}): ${cmd.join(" ")}\n${r.stderr}`);
  }
  return r.stdout;
}

/** Run shell and throw on failure */
async function execSh(cmd: string, opts: RunOpts = {}): Promise<string> {
  const r = await sh(cmd, opts);
  if (r.exitCode !== 0) {
    throw new Error(`Command failed (exit ${r.exitCode}): ${cmd}\n${r.stderr}`);
  }
  return r.stdout;
}

// ── Export ────────────────────────────────────────────────────────────

async function cmdExport(pkg: string, branch: string, opts: { name?: string; base?: string }) {
  const series = loadSeries();
  const config = series[pkg];
  if (!config) {
    console.error(`Package "${pkg}" not in series.json. Run: bun scripts/patches.ts init`);
    process.exit(1);
  }

  const repoPath = expandHome(config.sourceRepo);
  if (!existsSync(repoPath)) {
    console.error(`Source repo not found: ${repoPath}`);
    process.exit(1);
  }

  // Verify branch exists
  const check = await run(["git", "rev-parse", "--verify", branch], { cwd: repoPath });
  if (check.exitCode !== 0) {
    console.error(`Branch "${branch}" not found in ${repoPath}`);
    process.exit(1);
  }

  // Check for duplicate
  if (config.patches.some((p) => p.branch === branch)) {
    console.error(`A patch for branch "${branch}" already exists for ${pkg}. Drop it first.`);
    process.exit(1);
  }

  const base = opts.base ?? "main";
  const patchName = opts.name ?? safeName(branch);
  const num = nextNum(config.patches);
  const fileName = `${num}-${patchName}.patch`;
  const outDir = join(PATCHES_DIR, pkgDirName(pkg));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, fileName);

  // Always export source-level diffs. For compiled packages, the build
  // step happens at apply time (worktree → patch → build → copy dist).
  const kind = config.buildCmd ? "compiled" : "source";
  console.log(`Exporting ${kind} patch for ${pkg}: ${base}...${branch}`);
  const content = await exportSource(repoPath, config, base, branch);

  if (!content.trim()) {
    console.error(`No differences found between ${base} and ${branch} for ${pkg}`);
    process.exit(1);
  }

  writeFileSync(outPath, content);

  config.patches.push({
    file: fileName,
    description: `Changes from branch '${branch}'`,
    branch,
  });
  saveSeries(series);

  console.log(`\nCreated: patches/${pkgDirName(pkg)}/${fileName}`);
  console.log(`Tip: edit patches/series.json to refine the description and add an upstream link.`);
}

async function exportSource(repoPath: string, config: PackageConfig, base: string, branch: string): Promise<string> {
  const args = ["git", "diff", `${base}...${branch}`, "--"];

  // Build path specs: combine sourceSubdir with diffPaths
  const prefix = config.sourceSubdir ? config.sourceSubdir + "/" : "";
  if (config.diffPaths && config.diffPaths.length > 0) {
    for (const p of config.diffPaths) {
      args.push(`${prefix}${p}`);
    }
  } else if (prefix) {
    args.push(prefix);
  }

  const r = await run(args, { cwd: repoPath });
  let patch = r.stdout;

  // Rewrite paths: strip sourceSubdir prefix so patch is relative to package root
  if (prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patch = patch.replace(new RegExp(`a/${escaped}`, "g"), "a/");
    patch = patch.replace(new RegExp(`b/${escaped}`, "g"), "b/");
  }

  return patch;
}

/**
 * Apply patches for a compiled package by building from patched source.
 * Creates a worktree at the base version, applies all source patches,
 * builds, and copies the dist output into node_modules.
 */
async function applyCompiled(pkg: string, config: PackageConfig): Promise<boolean> {
  const repoPath = expandHome(config.sourceRepo);
  if (!existsSync(repoPath)) {
    console.error(`  ✗ source repo not found: ${repoPath}`);
    console.error(`    compiled packages require the source repo to rebuild`);
    return false;
  }

  const subdir = config.sourceSubdir ?? ".";
  const buildCmd = config.buildCmd!;

  // Find the base ref: try tag vVERSION, then VERSION, then fall back to main
  let baseRef = "main";
  for (const candidate of [`v${config.version}`, config.version]) {
    const r = await run(["git", "rev-parse", "--verify", candidate], { cwd: repoPath });
    if (r.exitCode === 0) {
      baseRef = candidate;
      break;
    }
  }

  const wt = mkdtempSync(join(tmpdir(), "patch-build-"));

  try {
    // Create worktree at base version
    await exec(["git", "worktree", "add", "--detach", wt, baseRef], { cwd: repoPath });

    // Symlink all node_modules directories so workspace resolution works
    const nmDirs = await exec([
      "find",
      repoPath,
      "-maxdepth",
      "4",
      "-name",
      "node_modules",
      "-type",
      "d",
      "-not",
      "-path",
      "*/node_modules/*",
    ]);
    let linkedNodeModules = 0;
    for (const srcNm of nmDirs.trim().split("\n").filter(Boolean)) {
      const rel = srcNm.slice(repoPath.length);
      const target = join(wt, rel);
      if (symlinkDirIfMissing(srcNm, target)) linkedNodeModules++;
    }

    let installedWorktreeDeps = false;
    if (linkedNodeModules === 0) {
      console.log(`  ↺ installing worktree dependencies for ${pkg} build`);
      const install = await run(["bun", "install", "--ignore-scripts"], { cwd: wt });
      if (install.exitCode !== 0) {
        console.error(`  ✗ failed to install worktree dependencies for ${pkg}`);
        console.error(`    ${install.stderr.trim()}`);
        return false;
      }
      installedWorktreeDeps = true;
    }

    // Apply all source patches to the worktree.
    // Use patch(1) instead of git apply: our patches are exported against
    // 'main' but applied to a version tag, so the git index hashes won't
    // match and git apply silently skips files (exit 0 but no changes).
    const pkgSrcDir = join(wt, subdir);
    const fallbackNm = join(ROOT, "node_modules");
    const linkedFallbackRoot = installedWorktreeDeps
      ? false
      : symlinkDirIfMissing(fallbackNm, join(wt, "node_modules"));
    const linkedFallbackPkg = installedWorktreeDeps
      ? false
      : symlinkDirIfMissing(fallbackNm, join(pkgSrcDir, "node_modules"));
    const hasBuildNodeModules = existsSync(join(pkgSrcDir, "node_modules")) || existsSync(join(wt, "node_modules"));

    if (!hasBuildNodeModules) {
      console.error(`  ✗ no node_modules available to build ${pkg}`);
      console.error(`    checked source repo ${repoPath} and Honeymux workspace ${fallbackNm}`);
      console.error(`    run bun install in ${repoPath} or rerun Honeymux install after dependencies are present.`);
      return false;
    }

    if (linkedFallbackRoot || linkedFallbackPkg) {
      console.log(`  ↺ using Honeymux node_modules fallback for ${pkg} build`);
    }
    const zigVersionOk = await ensureSupportedZigVersion(pkg, pkgSrcDir);
    if (!zigVersionOk) {
      return false;
    }
    for (const entry of config.patches) {
      const patchFile = resolve(join(PATCHES_DIR, pkgDirName(pkg), entry.file));
      if (!existsSync(patchFile)) {
        console.error(`  ✗ ${entry.file}: file not found`);
        return false;
      }
      const r = await sh(`patch -p1 --forward --no-backup-if-mismatch < "${patchFile}"`, { cwd: pkgSrcDir });
      if (r.exitCode !== 0) {
        // Check if already applied
        if (r.stdout.includes("Reversed") || r.stdout.includes("already applied")) {
          console.log(`  ✓ ${entry.file} (already applied)`);
          continue;
        }
        console.error(`  ✗ ${entry.file}: failed to apply to source`);
        console.error(`    ${r.stdout.trim()}`);
        console.error(`    ${r.stderr.trim()}`);
        return false;
      }
      console.log(`  ✓ ${entry.file} (applied to source)`);
    }

    console.log(`  Building ${pkg}...`);
    await execSh(buildCmd, { cwd: pkgSrcDir });

    // Copy dist output to node_modules
    const distDir = join(pkgSrcDir, "dist");
    const nmPkgDir = join(ROOT, "node_modules", pkg);
    if (!existsSync(distDir)) {
      console.error(`  ✗ build produced no dist/ directory`);
      return false;
    }

    // Clean old JS/map files from node_modules to avoid stale content-hashed chunks
    const oldFiles = await exec([
      "find",
      nmPkgDir,
      "-maxdepth",
      "1",
      "-type",
      "f",
      "-name",
      "*.js",
      "-o",
      "-name",
      "*.js.map",
    ]);
    for (const f of oldFiles.trim().split("\n").filter(Boolean)) {
      rmSync(f);
    }

    // Copy dist files into node_modules
    const distFiles = await exec(["find", distDir, "-maxdepth", "1", "-type", "f"]);
    for (const src of distFiles.trim().split("\n").filter(Boolean)) {
      const name = src.slice(distDir.length + 1);
      cpSync(src, join(nmPkgDir, name));
    }
    // Also copy subdirectories
    const distDirs = await exec(["find", distDir, "-maxdepth", "1", "-mindepth", "1", "-type", "d"]);
    for (const src of distDirs.trim().split("\n").filter(Boolean)) {
      const name = src.slice(distDir.length + 1);
      const dest = join(nmPkgDir, name);
      if (existsSync(dest)) rmSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    }

    // Copy native library if configured
    if (config.nativeLib) {
      const nativeLib = resolveNativeLibrary(config.nativeLib, pkgSrcDir);
      if (!nativeLib) {
        const expected = nativeLibraryCandidates().join(", ");
        const nativeSrcDir = expandRuntimePlaceholders(config.nativeLib.srcDir);
        console.error(`  ✗ native lib not found in ${nativeSrcDir}`);
        console.error(`    expected one of: ${expected}`);
        return false;
      }

      mkdirSync(dirname(nativeLib.dest), { recursive: true });
      cpSync(nativeLib.src, nativeLib.dest);
      console.log(`  ✓ native lib → node_modules/${nativeLib.relativeDest}`);
    }

    console.log(`  ✓ built and installed to node_modules/${pkg}`);
    return true;
  } finally {
    await run(["git", "worktree", "remove", "--force", wt], { cwd: repoPath });
  }
}

// ── Apply ────────────────────────────────────────────────────────────

async function cmdApply(targetPkg?: string) {
  const series = loadSeries();
  assertSeriesVersionsMatch(series);
  let failed = false;
  let applied = 0;

  for (const [pkg, config] of Object.entries(series)) {
    if (targetPkg && pkg !== targetPkg) continue;
    if (config.patches.length === 0) continue;

    const nmDir = join(ROOT, "node_modules", pkg);
    if (!existsSync(nmDir)) {
      console.warn(`  skip ${pkg}: not installed`);
      continue;
    }

    console.log(`${pkg}: applying ${config.patches.length} patch(es)`);

    // Compiled packages: rebuild from patched source
    if (config.buildCmd) {
      const ok = await applyCompiled(pkg, config);
      if (ok) {
        applied += config.patches.length;
      } else {
        failed = true;
      }
      continue;
    }

    // Source packages: apply patches directly to node_modules
    for (const entry of config.patches) {
      const patchFile = resolve(join(PATCHES_DIR, pkgDirName(pkg), entry.file));
      if (!existsSync(patchFile)) {
        console.error(`  ✗ ${entry.file}: file not found`);
        failed = true;
        continue;
      }

      // Check if already applied (reverse-apply succeeds → patch is already in)
      const rev = await run(
        ["git", "apply", "--check", "--reverse", "-p1", "--directory", `node_modules/${pkg}`, patchFile],
        { cwd: ROOT },
      );
      if (rev.exitCode === 0) {
        console.log(`  ✓ ${entry.file} (already applied)`);
        applied++;
        continue;
      }

      // Try git apply
      const r = await run(["git", "apply", "-p1", "--directory", `node_modules/${pkg}`, patchFile], { cwd: ROOT });
      if (r.exitCode === 0) {
        console.log(`  ✓ ${entry.file}`);
        applied++;
        continue;
      }

      // Fallback: patch(1) with --forward (skips already-applied hunks)
      const r2 = await sh(`patch -p1 --forward --no-backup-if-mismatch < "${patchFile}"`, { cwd: nmDir });
      if (r2.exitCode === 0) {
        console.log(`  ✓ ${entry.file} (via patch)`);
        applied++;
        continue;
      }

      // Check if all hunks were already applied (patch exits 1 but says "Reversed")
      if (r2.stdout.includes("Reversed") || r2.stdout.includes("already applied")) {
        console.log(`  ✓ ${entry.file} (already applied)`);
        applied++;
        continue;
      }

      console.error(`  ✗ ${entry.file}: failed to apply`);
      console.error(`    ${r.stderr.trim()}`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
  if (applied > 0) console.log(`Applied ${applied} patch(es).`);
}

// ── Verify ───────────────────────────────────────────────────────────

async function cmdVerify(targetPkg?: string) {
  const series = loadSeries();
  assertSeriesVersionsMatch(series);
  let failed = false;
  let count = 0;

  for (const [pkg, config] of Object.entries(series)) {
    if (targetPkg && pkg !== targetPkg) continue;
    if (config.patches.length === 0) continue;

    const nmDir = join(ROOT, "node_modules", pkg);
    if (!existsSync(nmDir)) {
      console.warn(`  skip ${pkg}: not installed`);
      continue;
    }

    for (const entry of config.patches) {
      const patchFile = resolve(join(PATCHES_DIR, pkgDirName(pkg), entry.file));
      if (!existsSync(patchFile)) {
        console.error(`✗ ${pkg} / ${entry.file}: file not found`);
        failed = true;
        continue;
      }

      // Check if already applied
      const rev = await run(
        ["git", "apply", "--check", "--reverse", "-p1", "--directory", `node_modules/${pkg}`, patchFile],
        { cwd: ROOT },
      );
      if (rev.exitCode === 0) {
        console.log(`✓ ${pkg} / ${entry.file} (already applied)`);
        count++;
        continue;
      }

      // Check if can apply
      const r = await run(["git", "apply", "--check", "-p1", "--directory", `node_modules/${pkg}`, patchFile], {
        cwd: ROOT,
      });
      if (r.exitCode === 0) {
        console.log(`✓ ${pkg} / ${entry.file}`);
        count++;
      } else {
        console.error(`✗ ${pkg} / ${entry.file}: would not apply cleanly`);
        console.error(`  ${r.stderr.trim()}`);
        failed = true;
      }
    }
  }

  if (failed) process.exit(1);
  if (count > 0) console.log(`\nAll ${count} patch(es) OK.`);
}

// ── Status ───────────────────────────────────────────────────────────

function cmdStatus() {
  const series = loadSeries();
  if (Object.keys(series).length === 0) {
    console.log("No packages configured. Run: bun scripts/patches.ts init");
    return;
  }

  for (const [pkg, config] of Object.entries(series)) {
    console.log(`\n${pkg} (${config.version})`);
    console.log(`  repo: ${config.sourceRepo}${config.sourceSubdir ? `/${config.sourceSubdir}` : ""}`);
    if (config.buildCmd) console.log(`  build: ${config.buildCmd}`);
    if (config.patches.length === 0) {
      console.log("  (no patches)");
    }
    for (const p of config.patches) {
      const up = p.upstream ? ` → ${p.upstream}` : "";
      console.log(`  ${p.file}: ${p.description} [${p.branch}]${up}`);
    }
  }
  console.log();
}

// ── Drop ─────────────────────────────────────────────────────────────

function cmdDrop(pkg: string, nameOrBranch: string) {
  const series = loadSeries();
  const config = series[pkg];
  if (!config) {
    console.error(`Package "${pkg}" not in series.json.`);
    process.exit(1);
  }

  const idx = config.patches.findIndex(
    (p) => p.file === nameOrBranch || p.file.includes(nameOrBranch) || p.branch === nameOrBranch,
  );
  if (idx === -1) {
    console.error(`Patch "${nameOrBranch}" not found for ${pkg}.`);
    process.exit(1);
  }

  const removed = config.patches.splice(idx, 1)[0];
  if (!removed) {
    console.error(`Patch "${nameOrBranch}" disappeared while removing it.`);
    process.exit(1);
  }
  const file = join(PATCHES_DIR, pkgDirName(pkg), removed.file);
  if (existsSync(file)) rmSync(file);
  saveSeries(series);
  console.log(`Dropped: ${removed.file}`);
}

// ── Init ─────────────────────────────────────────────────────────────

function cmdInit() {
  const pkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const series = loadSeries();
  const defaults = defaultPackageConfigs();

  for (const [pkg, def] of Object.entries(defaults)) {
    const version = pkgJson.dependencies?.[pkg] ?? pkgJson.devDependencies?.[pkg] ?? "unknown";
    if (!series[pkg]) {
      series[pkg] = { version, patches: [], ...def };
    } else {
      // Merge new config fields into existing entries (preserve patches + user overrides)
      series[pkg] = { ...def, ...series[pkg], version };
    }
  }

  saveSeries(series);
  console.log("Initialized patches/series.json\n");
  cmdStatus();
}

// ── CLI ──────────────────────────────────────────────────────────────

const USAGE = `honeymux patch manager

Usage: bun scripts/patches.ts <command>

Commands:
  init                        Set up series.json with package configs
  export <pkg> <branch>       Export a patch from a source repo branch
    --name=<name>               Custom patch name (default: branch name)
    --base=<ref>                Base ref to diff against (default: main)
  apply [<pkg>]               Apply all patches to node_modules
  verify [<pkg>]              Check that patches apply cleanly (dry run)
  status                      Show packages and their patches
  drop <pkg> <name|branch>    Remove a patch

Workflow:
  1. bun scripts/patches.ts init
  2. bun scripts/patches.ts export ghostty-opentui cursor-rendering-fix
  3. Edit patches/series.json to add description + upstream link
  4. bun install && bun scripts/patches.ts apply
`;

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "init":
    cmdInit();
    break;

  case "export": {
    const pkg = args[0];
    const branch = args[1];
    if (!pkg || !branch) {
      console.error("Usage: bun scripts/patches.ts export <package> <branch> [--name=<name>] [--base=<ref>]");
      process.exit(1);
    }
    const name = args.find((a) => a.startsWith("--name="))?.slice(7);
    const base = args.find((a) => a.startsWith("--base="))?.slice(7);
    await cmdExport(pkg, branch, { name, base });
    break;
  }

  case "apply":
    await cmdApply(args[0]);
    break;

  case "verify":
    await cmdVerify(args[0]);
    break;

  case "status":
    cmdStatus();
    break;

  case "drop": {
    if (!args[0] || !args[1]) {
      console.error("Usage: bun scripts/patches.ts drop <package> <patch-name-or-branch>");
      process.exit(1);
    }
    cmdDrop(args[0], args[1]);
    break;
  }

  default:
    console.log(USAGE);
}
