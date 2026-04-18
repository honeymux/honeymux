#!/usr/bin/env bun
/**
 * Drive Honeymux through a set of named scenes and capture PNG screenshots
 * of specific UI regions. Region names are resolved by the honeyshots
 * adapter from components tagged with `id="honeyshots:<name>"`.
 *
 * This script is honeymux-specific orchestration only — the rendering,
 * cropping, PTY management, and region tracking all live in honeyshots.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TuiHarness, type ShootOptions } from "honeyshots";

import { defaultConfig, type UIMode } from "../src/util/config.ts";
import { cleanEnv } from "../src/util/pty.ts";
import { applyTheme, theme, THEME_NAMES, type ThemeName } from "../src/themes/theme.ts";

type DocsTheme = Exclude<ThemeName, "auto">;
type SceneName = "agents" | "main" | "main-menu" | "options";

interface CliOptions {
  bgColor?: string;
  border?: number;
  devicePixelRatio: number;
  height: number;
  keepTemp: boolean;
  outDir: string;
  region?: string;
  scenes: SceneName[];
  sidebarView?: SideBarView;
  tab?: string;
  theme: DocsTheme;
  toolbarOpen: boolean;
  uiMode: UIMode;
  width: number;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type SideBarView = "agents" | "hook-sniffer" | "server";

/** Tab order inside the main menu dialog. Pressing Tab cycles in this order. */
const MAIN_MENU_TAB_ORDER = ["functions", "navigation", "agents", "about"] as const;

/** Tab order inside the options dialog. Pressing Tab cycles in this order. */
const OPTIONS_TAB_ORDER = ["general", "appearance", "input", "agents", "remote", "misc"] as const;

interface SceneContext {
  env: Record<string, string>;
  homeDir: string;
  rootDir: string;
  runtimeDir: string;
  serverName: string;
  sessionName: string;
}

const DEFAULT_WIDTH = 132;
const DEFAULT_HEIGHT = 43;
const DEFAULT_THEME: DocsTheme = "nord";
const DEFAULT_UI_MODE = defaultConfig().uiMode;
const DEFAULT_SCENES: SceneName[] = ["main", "main-menu", "options", "agents"];
const VALID_THEMES: DocsTheme[] = THEME_NAMES.filter((t): t is DocsTheme => t !== "custom");
const VALID_UI_MODES: UIMode[] = ["adaptive", "marquee-top", "marquee-bottom", "raw"];
const VALID_SCENES: SceneName[] = ["main", "main-menu", "options", "agents"];
const VALID_SIDEBAR_VIEWS: SideBarView[] = ["agents", "server", "hook-sniffer"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPath(path: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for path: ${path}`);
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun run scripts/docs-screenshots.ts [options]",
      "",
      "Options:",
      `  --width <cols>        Terminal width in columns (default: ${DEFAULT_WIDTH})`,
      `  --height <rows>       Terminal height in rows (default: ${DEFAULT_HEIGHT})`,
      "  --out-dir <path>      Output directory for PNG files",
      `  --theme <name>        Theme to render (${VALID_THEMES.join(", ")})`,
      `  --ui-mode <name>      UI mode (${VALID_UI_MODES.join(", ")})`,
      `  --scenes <list>       Comma-separated scenes (${VALID_SCENES.join(", ")})`,
      '  --region <name>       Named region to crop to (e.g. "sidebar", "toolbar", "main-menu")',
      `  --tab <name>          Switch to a specific tab before capture`,
      `                          main-menu: ${MAIN_MENU_TAB_ORDER.join(", ")}`,
      `                          options:   ${OPTIONS_TAB_ORDER.join(", ")}`,
      "  --border <px>         Add a border of the terminal bg color around the image",
      '  --bg-color <#hex>     Override the terminal background color (e.g. "#000000")',
      `  --sidebar-view <name> Open sidebar view (${VALID_SIDEBAR_VIEWS.join(", ")})`,
      "  --toolbar             Open the toolbar before capture",
      "  --device-pixel-ratio  Renderer DPR (default: 2)",
      "  --keep-temp           Preserve per-scene temp directories",
      "  --help                Show this help text",
    ].join("\n") + "\n",
  );
}

function parsePositiveInt(flag: string, value: string | undefined): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive integer`);
  return n;
}

function parsePositiveNumber(flag: string, value: string | undefined): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
}

function parseNonNegativeInt(flag: string, value: string | undefined): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative integer`);
  return n;
}

function parseScenes(value: string | undefined): SceneName[] {
  if (!value) throw new Error("--scenes requires a value");
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("--scenes must name at least one scene");
  const invalid = parts.filter((s) => !VALID_SCENES.includes(s as SceneName));
  if (invalid.length > 0) throw new Error(`Unknown scene(s): ${invalid.join(", ")}`);
  return parts as SceneName[];
}

function parseEnum<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T {
  if (!value) throw new Error(`${flag} requires a value`);
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    devicePixelRatio: 2,
    height: DEFAULT_HEIGHT,
    keepTemp: false,
    outDir: resolve(process.cwd(), "docs/screenshots"),
    scenes: [...DEFAULT_SCENES],
    theme: DEFAULT_THEME,
    toolbarOpen: false,
    uiMode: DEFAULT_UI_MODE,
    width: DEFAULT_WIDTH,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    if (arg === "--toolbar") {
      options.toolbarOpen = true;
      continue;
    }
    if (arg === "--width") {
      options.width = parsePositiveInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--height") {
      options.height = parsePositiveInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--out-dir") {
      const v = argv[++i];
      if (!v) throw new Error("--out-dir requires a value");
      options.outDir = resolve(process.cwd(), v);
      continue;
    }
    if (arg === "--theme") {
      options.theme = parseEnum(arg, argv[++i], VALID_THEMES);
      continue;
    }
    if (arg === "--ui-mode") {
      options.uiMode = parseEnum(arg, argv[++i], VALID_UI_MODES);
      continue;
    }
    if (arg === "--scenes") {
      options.scenes = parseScenes(argv[++i]);
      continue;
    }
    if (arg === "--region") {
      const v = argv[++i];
      if (!v) throw new Error("--region requires a value");
      options.region = v;
      continue;
    }
    if (arg === "--sidebar-view") {
      options.sidebarView = parseEnum(arg, argv[++i], VALID_SIDEBAR_VIEWS);
      continue;
    }
    if (arg === "--device-pixel-ratio") {
      options.devicePixelRatio = parsePositiveNumber(arg, argv[++i]);
      continue;
    }
    if (arg === "--border") {
      options.border = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--bg-color") {
      const v = argv[++i];
      if (!v) throw new Error("--bg-color requires a value");
      if (!HEX_COLOR_RE.test(v)) {
        throw new Error(`--bg-color must be a 3- or 6-digit hex color (e.g. "#000000"), got ${JSON.stringify(v)}`);
      }
      options.bgColor = v;
      continue;
    }
    if (arg === "--tab") {
      const v = argv[++i];
      if (!v) throw new Error("--tab requires a value");
      options.tab = v;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function buildHarnessEnv(homeDir: string, runtimeDir: string): Record<string, string> {
  const env = cleanEnv();
  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = join(homeDir, ".config");
  env.XDG_STATE_HOME = join(homeDir, ".local", "state");
  env.XDG_RUNTIME_DIR = runtimeDir;
  env.TMUX_TMPDIR = runtimeDir;
  env.LANG = env.LANG && env.LANG.includes("UTF-8") ? env.LANG : "en_US.UTF-8";
  env.LC_ALL = env.LC_ALL && env.LC_ALL.includes("UTF-8") ? env.LC_ALL : "en_US.UTF-8";
  env.SHELL = env.SHELL || "/bin/bash";
  return env;
}

function resolveCaptureSidebarView(options: CliOptions): SideBarView | undefined {
  if (options.sidebarView) return options.sidebarView;
  if (options.region === "sidebar") return "agents";
  return undefined;
}

function resolveCaptureToolbarOpen(options: CliOptions): boolean {
  return options.toolbarOpen || options.region === "toolbar";
}

async function writeHarnessConfig(homeDir: string, themeName: DocsTheme, uiMode: UIMode): Promise<void> {
  const configDir = join(homeDir, ".config", "honeymux");
  const stateDir = join(homeDir, ".local", "state", "honeymux");
  const claudeHooksDir = join(homeDir, ".claude", "hooks");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(claudeHooksDir, { recursive: true });

  const config = {
    ...defaultConfig(),
    paneTabsEnabled: true,
    savedAt: Date.now(),
    screenshotFlash: false,
    shellPrompt: "honeymux" as const,
    statusBar: "honeymux" as const,
    themeBuiltin: themeName,
    themeMode: "built-in" as const,
    uiMode,
  };

  await Bun.write(join(configDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  await Bun.write(join(claudeHooksDir, "honeymux.py"), "# harness marker\n");
}

async function writeHarnessUiState(
  homeDir: string,
  toolbarOpen: boolean,
  sidebarView: SideBarView | undefined,
): Promise<void> {
  const stateDir = join(homeDir, ".local", "state", "honeymux");
  mkdirSync(stateDir, { recursive: true });
  await Bun.write(
    join(stateDir, "ui-state.json"),
    JSON.stringify(
      {
        sidebarOpen: !!sidebarView,
        sidebarView: sidebarView ?? "agents",
        toolbarOpen,
      },
      null,
      2,
    ) + "\n",
  );
}

async function runCommand(
  argv: string[],
  options: {
    check?: boolean;
    cwd?: string;
    env?: Record<string, string>;
    stderr?: "ignore" | "pipe";
    stdout?: "ignore" | "pipe";
  } = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stderr: options.stderr ?? "pipe",
    stdout: options.stdout ?? "pipe",
  });
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
  const code = await proc.exited;
  if ((options.check ?? true) && code !== 0) {
    throw new Error(`Command failed (${code}): ${argv.join(" ")}\n${stderr || stdout || "(no output)"}`);
  }
  return { code, stderr, stdout };
}

function tmuxArgv(serverName: string, args: string[]): string[] {
  return ["tmux", "-L", serverName, ...args];
}

async function prepareDemoTmux(ctx: SceneContext): Promise<void> {
  await runCommand(tmuxArgv(ctx.serverName, ["kill-server"]), {
    check: false,
    env: ctx.env,
    stderr: "ignore",
    stdout: "ignore",
  });
  await runCommand(
    tmuxArgv(ctx.serverName, ["new-session", "-d", "-s", ctx.sessionName, "-n", "workspace"]),
    { env: ctx.env },
  );
  await runCommand(tmuxArgv(ctx.serverName, ["new-window", "-t", ctx.sessionName, "-n", "logs"]), {
    env: ctx.env,
  });
  await runCommand(tmuxArgv(ctx.serverName, ["new-window", "-t", ctx.sessionName, "-n", "notes"]), {
    env: ctx.env,
  });
  await runCommand(
    tmuxArgv(ctx.serverName, ["select-window", "-t", `${ctx.sessionName}:workspace`]),
    { env: ctx.env },
  );
}

async function seedWorkspacePane(
  ctx: SceneContext,
  width: number,
  height: number,
  themeName: DocsTheme,
): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  const lines = [
    "Honeymux docs demo",
    "",
    `Viewport: ${width}x${height}`,
    `Theme: ${themeName}`,
    "Scenes: main, main-menu, options, agents",
    "",
    "Use Ctrl+G to open the built-in menu.",
  ];
  const printfArg = `printf '${lines.join("\\n")}\\n'`;
  await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "C-l"]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "-l", printfArg]), {
    env: ctx.env,
  });
  await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "Enter"]), { env: ctx.env });
}

async function openMainMenu(harness: TuiHarness, settle = true): Promise<void> {
  harness.send("\x07");
  await harness.waitForText("Functions");
  if (settle) await harness.waitForIdle(200);
}

async function primeBaseScreen(
  harness: TuiHarness,
  ctx: SceneContext,
  width: number,
  height: number,
  themeName: DocsTheme,
): Promise<void> {
  await harness.waitForText("workspace");
  await harness.waitForIdle(300);
  await seedWorkspacePane(ctx, width, height, themeName);
  await harness.waitForText("Honeymux docs demo");
  await harness.waitForIdle(300);
  await splitWorkspaceHorizontally(harness, ctx);
  await addSecondPaneTabToUpperPane(harness);
}

async function splitWorkspaceHorizontally(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  // split-window without -h gives us a horizontal divider (upper/lower
  // panes). The new pane is selected automatically; switch focus back
  // to the original upper pane so honeymux treats it as active.
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-v", "-t", target]), { env: ctx.env });
  await runCommand(
    tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "-l", "printf 'Second pane\\n'"]),
    { env: ctx.env },
  );
  await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "Enter"]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await harness.waitForText("Second pane");
  await harness.waitForIdle(250);
}

async function switchDialogTab(
  harness: TuiHarness,
  tab: string | undefined,
  order: readonly string[],
  dialog: "main-menu" | "options",
): Promise<void> {
  if (!tab) return;
  const target = order.indexOf(tab);
  if (target === -1) {
    throw new Error(
      `Unknown ${dialog} tab ${JSON.stringify(tab)}. Valid tabs: ${order.join(", ")}`,
    );
  }
  // Dialogs open on the first tab (index 0); press Tab to advance.
  // Use an explicit sleep rather than waitForIdle — the frame can settle
  // visually before the input router finishes processing the prior key,
  // causing consecutive Tabs to be coalesced.
  await sleep(300);
  for (let i = 0; i < target; i++) {
    harness.send("\t");
    await sleep(250);
  }
  await harness.waitForIdle(200);
}

async function addSecondPaneTabToUpperPane(harness: TuiHarness): Promise<void> {
  // Ctrl+G opens the main menu; "N" triggers newPaneTab which adds a
  // tab to the currently-active pane (the upper one, after split). The
  // menu auto-closes when the action dispatches, so no explicit Esc is
  // needed. Pane-tab creation spawns a detached tmux window, which can
  // take a moment; wait for the " bash | bash " tab bar to settle
  // before the caller spawns any subsequent flows.
  harness.send("\x07");
  await harness.waitForText("Functions");
  await harness.waitForIdle(150);
  harness.send("n");
  await sleep(800);
  await harness.waitForIdle(400, 10_000);
}

async function runAgentsDemo(ctx: SceneContext): Promise<void> {
  // Optional: if scripts/demo-team.ts exists, seed some demo agents into
  // honeymux so the dialog shows realistic rows. Otherwise fall back to
  // capturing the empty-state dialog.
  const demoScript = "scripts/demo-team.ts";
  if (!existsSync(join(process.cwd(), demoScript))) return;
  const socketPath = join(ctx.runtimeDir, "hmx-claude.sock");
  try {
    await waitForPath(socketPath, 3_000);
  } catch {
    return;
  }
  await runCommand([process.execPath, "run", demoScript], {
    cwd: process.cwd(),
    env: {
      ...ctx.env,
      HMX_AGENT_SOCKET_PATH: socketPath,
    },
  });
}

async function captureScene(sceneName: SceneName, options: CliOptions, repoRoot: string): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), `honeymux-docs-${sceneName}-`));
  const homeDir = join(tempRoot, "home");
  const runtimeDir = join(tempRoot, "runtime");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  const ctx: SceneContext = {
    env: buildHarnessEnv(homeDir, runtimeDir),
    homeDir,
    rootDir: tempRoot,
    runtimeDir,
    serverName: `hmx-docs-${sceneName}-${process.pid}`,
    sessionName: "My Project",
  };

  let preserveTemp = options.keepTemp;
  let harness: null | TuiHarness = null;

  try {
    const sidebarView = resolveCaptureSidebarView(options);
    const toolbarOpen = resolveCaptureToolbarOpen(options);

    await writeHarnessConfig(homeDir, options.theme, options.uiMode);
    await writeHarnessUiState(homeDir, toolbarOpen, sidebarView);
    await prepareDemoTmux(ctx);

    harness = new TuiHarness({
      argv: [process.execPath, "run", "src/index.tsx", "--server", ctx.serverName, ctx.sessionName],
      cols: options.width,
      cwd: repoRoot,
      env: ctx.env,
      rows: options.height,
    });
    await harness.start();
    await primeBaseScreen(harness, ctx, options.width, options.height, options.theme);

    if (sceneName === "main-menu") {
      await openMainMenu(harness);
      await harness.waitForRegion("main-menu");
      await harness.waitForIdle(200);
      await switchDialogTab(harness, options.tab, MAIN_MENU_TAB_ORDER, "main-menu");
    } else if (sceneName === "options") {
      await openMainMenu(harness);
      harness.send("o");
      await harness.waitForRegion("options");
      await harness.waitForText("General");
      await harness.waitForIdle(350);
      await switchDialogTab(harness, options.tab, OPTIONS_TAB_ORDER, "options");
      await harness.waitForIdle(400);
    } else if (sceneName === "agents") {
      await runAgentsDemo(ctx);
      await openMainMenu(harness, false);
      harness.send("a");
      await harness.waitForRegion("agents");
      await harness.waitForIdle(350);
    }

    applyTheme(options.theme);
    const shootOptions: ShootOptions = {
      devicePixelRatio: options.devicePixelRatio,
      theme: {
        background: options.bgColor ?? theme.bg,
        text: theme.text,
      },
    };
    if (options.bgColor) {
      shootOptions.bgColor = options.bgColor;
    }
    if (options.border) {
      shootOptions.border = options.border;
    }

    mkdirSync(options.outDir, { recursive: true });
    const outPath = join(options.outDir, `${sceneName}.png`);
    await harness.shoot(options.region ?? null, outPath, shootOptions);
    process.stdout.write(`${sceneName}: wrote ${outPath}\n`);
  } catch (error) {
    preserveTemp = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${sceneName}: ${message}\n`);
    if (harness) {
      process.stderr.write(harness.screenText().split("\n").slice(0, 60).join("\n") + "\n");
    }
    throw error;
  } finally {
    await harness?.close();
    await runCommand(tmuxArgv(ctx.serverName, ["kill-server"]), {
      check: false,
      env: ctx.env,
      stderr: "ignore",
      stdout: "ignore",
    });
    if (preserveTemp) {
      process.stdout.write(`${sceneName}: kept temp dir ${tempRoot}\n`);
    } else {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  process.stdout.write(
    `Capturing scenes ${options.scenes.join(", ")} at ${options.width}x${options.height} using theme ${options.theme}\n`,
  );

  let hadFailure = false;
  for (const sceneName of options.scenes) {
    try {
      await captureScene(sceneName, options, repoRoot);
    } catch {
      hadFailure = true;
      break;
    }
  }

  process.exit(hadFailure ? 1 : 0);
}

await main();
