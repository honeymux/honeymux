#!/usr/bin/env bun
/**
 * Drive Honeymux through a set of named scenes and capture PNG screenshots
 * of specific UI regions. Region names are resolved by the honeyshots
 * adapter from components tagged with `id="honeyshots:<name>"`.
 *
 * This script is honeymux-specific orchestration only — the rendering,
 * cropping, PTY management, and region tracking all live in honeyshots.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TerminalData } from "ghostty-opentui";
import { TuiHarness, cropTerminalData, renderTerminalToImage, type ShootOptions } from "honeyshots";

import { defaultConfig, type UIMode } from "../src/util/config.ts";
import { cleanEnv } from "../src/util/pty.ts";
import { applyTheme, theme, THEME_NAMES, type ThemeName } from "../src/themes/theme.ts";

const HARNESS_REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HONEYSHOTS_VERSION: string = (() => {
  try {
    const pkgPath = join(HARNESS_REPO_ROOT, "node_modules", "honeyshots", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

type DocsTheme = Exclude<ThemeName, "auto">;
type SceneName =
  | "agent-install"
  | "agents"
  | "buffer-zoom"
  | "conversations"
  | "inactive-pane-dimming"
  | "main"
  | "main-menu"
  | "muxotron"
  | "notifications"
  | "options"
  | "pane-border-menu"
  | "pane-tabs"
  | "pane-tabs-disable"
  | "privileged-pane"
  | "profiles"
  | "quick-terminal"
  | "screenshots"
  | "sessions"
  | "too-narrow";

type MuxotronState =
  | "collapsed"
  | "expanded"
  | "expanded-latchable"
  | "full-view"
  | "latched-perm"
  | "review-preview"
  | "review-latched";
type SubmenuName = "color" | "servers";
type ZoomTarget = "agents" | "server";

interface CliOptions {
  agentInstallTarget?: AgentInstallTarget;
  bgColor?: string;
  border?: number;
  bufferZoomActive: boolean;
  consentUnseen: boolean;
  devicePixelRatio: number;
  height: number;
  keepTemp: boolean;
  muxotronState?: MuxotronState;
  outDir: string;
  region?: string;
  scenes: SceneName[];
  seedInfo?: string;
  seedWarning?: string;
  sidebarView?: SideBarView;
  sshError: boolean;
  submenu?: SubmenuName;
  tab?: string;
  theme: DocsTheme;
  toolbarOpen: boolean;
  uiMode: UIMode;
  width: number;
  zoom?: ZoomTarget;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type AgentInstallTarget = "claude" | "codex" | "gemini" | "opencode";
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

const FIXTURE_HOME_DIR = join(dirname(fileURLToPath(import.meta.url)), "docs-screenshot-fixtures", "home");

const DEFAULT_WIDTH = 132;
const DEFAULT_HEIGHT = 43;
const DEFAULT_THEME: DocsTheme = "nord";
const DEFAULT_UI_MODE = defaultConfig().uiMode;
const DEFAULT_SCENES: SceneName[] = ["main", "main-menu", "options", "agents"];
const VALID_AGENT_INSTALL_TARGETS: AgentInstallTarget[] = ["claude", "codex", "gemini", "opencode"];
const VALID_MUXOTRON_STATES: MuxotronState[] = [
  "collapsed",
  "expanded",
  "expanded-latchable",
  "full-view",
  "latched-perm",
  "review-preview",
  "review-latched",
];
const VALID_SCENES: SceneName[] = [
  "agent-install",
  "agents",
  "buffer-zoom",
  "conversations",
  "inactive-pane-dimming",
  "main",
  "main-menu",
  "muxotron",
  "notifications",
  "options",
  "pane-border-menu",
  "pane-tabs",
  "pane-tabs-disable",
  "privileged-pane",
  "profiles",
  "quick-terminal",
  "screenshots",
  "sessions",
  "too-narrow",
];
const VALID_SIDEBAR_VIEWS: SideBarView[] = ["agents", "server", "hook-sniffer"];
const VALID_SUBMENUS: SubmenuName[] = ["color", "servers"];
const VALID_THEMES: DocsTheme[] = THEME_NAMES.filter((t): t is DocsTheme => t !== "custom");
const VALID_UI_MODES: UIMode[] = ["adaptive", "marquee-top", "marquee-bottom", "raw"];
const VALID_ZOOM_TARGETS: ZoomTarget[] = ["agents", "server"];

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

/**
 * Poll-based region wait that tolerates the honeyshots single-frame waiter
 * semantics — that library only invokes a registered waiter once per frame and
 * then drops it, so if the very first frame after a `send()` does not yet
 * contain the new region the waiter is silently lost. This helper avoids that
 * by re-checking the harness's region map until the timeout.
 */
async function waitForRegionStable(harness: TuiHarness, name: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (harness.getRegion(name)) return;
    await sleep(80);
  }
  throw new Error(
    `Timed out waiting for region ${JSON.stringify(name)} after ${timeoutMs}ms — known: ${JSON.stringify(
      harness.listRegions().map((r) => r.name),
    )}`,
  );
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
      `  --submenu <name>      Open a sub-state of the chosen scene (${VALID_SUBMENUS.join(", ")})`,
      `  --zoom <name>         Trigger a zoom view (${VALID_ZOOM_TARGETS.join(", ")})`,
      `  --muxotron-state <n>  Drive the muxotron into a specific state (${VALID_MUXOTRON_STATES.join(", ")})`,
      "  --consent-unseen      Skip pre-seeding the history-consent fixture",
      "  --ssh-error           Configure an unreachable remote so SSH error fires",
      "  --buffer-zoom-active  For the buffer-zoom scene, trigger bufferZoom after layout primes",
      "  --seed-info <text>    Pre-seed an info notification (lines split on '|')",
      "  --seed-warning <text> Pre-seed a warning notification (lines split on '|')",
      `  --simulate-agent-first-run <name>`,
      `                          Pre-seed an agent-detected hook (${VALID_AGENT_INSTALL_TARGETS.join(", ")})`,
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
    bufferZoomActive: false,
    consentUnseen: false,
    devicePixelRatio: 2,
    height: DEFAULT_HEIGHT,
    keepTemp: false,
    outDir: resolve(process.cwd(), "docs/screenshots"),
    scenes: [...DEFAULT_SCENES],
    sshError: false,
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
    if (arg === "--consent-unseen") {
      options.consentUnseen = true;
      continue;
    }
    if (arg === "--ssh-error") {
      options.sshError = true;
      continue;
    }
    if (arg === "--buffer-zoom-active") {
      options.bufferZoomActive = true;
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
    if (arg === "--submenu") {
      options.submenu = parseEnum(arg, argv[++i], VALID_SUBMENUS);
      continue;
    }
    if (arg === "--zoom") {
      options.zoom = parseEnum(arg, argv[++i], VALID_ZOOM_TARGETS);
      continue;
    }
    if (arg === "--muxotron-state") {
      options.muxotronState = parseEnum(arg, argv[++i], VALID_MUXOTRON_STATES);
      continue;
    }
    if (arg === "--simulate-agent-first-run") {
      options.agentInstallTarget = parseEnum(arg, argv[++i], VALID_AGENT_INSTALL_TARGETS);
      continue;
    }
    if (arg === "--seed-info") {
      const v = argv[++i];
      if (v == null) throw new Error("--seed-info requires a value");
      options.seedInfo = v;
      continue;
    }
    if (arg === "--seed-warning") {
      const v = argv[++i];
      if (v == null) throw new Error("--seed-warning requires a value");
      options.seedWarning = v;
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
  // honeyshots doesn't answer XTVERSION from inside its ghostty-opentui VT
  // buffer, so advertise the harness identity via an env var that
  // src/index.tsx picks up as a post-probe override.
  env["HMX_HARNESS_TERM_NAME"] = `Honeyshots ${HONEYSHOTS_VERSION}`;
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

interface HarnessConfigOverrides {
  bufferZoomFade?: boolean;
  dimInactivePanes?: boolean;
  remoteUnreachable?: boolean;
}

async function writeHarnessConfig(
  homeDir: string,
  themeName: DocsTheme,
  uiMode: UIMode,
  overrides: HarnessConfigOverrides = {},
): Promise<void> {
  const configDir = join(homeDir, ".config", "honeymux");
  const stateDir = join(homeDir, ".local", "state", "honeymux");
  const claudeHooksDir = join(homeDir, ".claude", "hooks");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(claudeHooksDir, { recursive: true });

  const config = {
    ...defaultConfig(),
    ...(overrides.bufferZoomFade === undefined ? {} : { bufferZoomFade: overrides.bufferZoomFade }),
    ...(overrides.dimInactivePanes === undefined ? {} : { dimInactivePanes: overrides.dimInactivePanes }),
    paneTabsEnabled: true,
    remote: overrides.remoteUnreachable
      ? [
          {
            host: "127.0.0.1",
            name: "test-host",
            port: 1,
          },
        ]
      : undefined,
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

async function seedHarnessHome(homeDir: string): Promise<void> {
  // Copy the checked-in fixture dotfiles (.bashrc, .tmux.conf, ...) into the
  // sandboxed HOME so bash and tmux produce a consistent look in screenshots
  // regardless of what the operator has installed on their own machine.
  const entries = readdirSync(FIXTURE_HOME_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = Bun.file(join(FIXTURE_HOME_DIR, entry.name));
    await Bun.write(join(homeDir, entry.name), src);
  }
}

/** Pre-seed history-indexing consent so the consent dialog doesn't fire. */
async function seedHarnessHistoryConsent(homeDir: string): Promise<void> {
  const stateDir = join(homeDir, ".local", "state", "honeymux");
  mkdirSync(stateDir, { recursive: true });
  await Bun.write(
    join(stateDir, "history-consent.json"),
    JSON.stringify({ granted: true, savedAt: Date.now() }) + "\n",
  );
}

/** Pre-seed a couple of layout-profiles so the Profiles dropdown is non-empty. */
async function seedHarnessLayoutProfiles(homeDir: string): Promise<void> {
  const stateDir = join(homeDir, ".local", "state", "honeymux");
  mkdirSync(stateDir, { recursive: true });
  const profiles = [
    {
      favorite: true,
      layout: "bb62,132x40,0,0,0",
      name: "Coding",
      paneCount: 1,
      savedAt: Date.now(),
    },
    {
      layout: "1234,132x40,0,0{66x40,0,0,1,65x40,67,0,2}",
      name: "Review",
      paneCount: 2,
      savedAt: Date.now(),
    },
    {
      layout: "5678,132x40,0,0[132x20,0,0,1,132x19,0,21,2]",
      name: "Logs + Notes",
      paneCount: 2,
      savedAt: Date.now(),
    },
  ];
  await Bun.write(join(stateDir, "layout-profiles.json"), JSON.stringify(profiles, null, 2) + "\n");
}

/**
 * Bind the harness-only zoom keys so the harness can press a single key to
 * enter the agents-zoom or server-zoom view. Sticky-key mode (default) makes
 * the same key tap to dismiss, but for screenshots we just need the first tap.
 *
 * Also binds `agentLatch` so the muxotron's "latch available" dashed border
 * activates when a permission request is pending — isMuxotronDashed only
 * reports dashed when `agentLatchBindingLabel` is set.
 */
async function seedHarnessKeybindings(homeDir: string): Promise<void> {
  const configDir = join(homeDir, ".config", "honeymux");
  mkdirSync(configDir, { recursive: true });
  const file = {
    default: {
      agentLatch: "right_alt",
      mainMenu: "ctrl+g",
      zoomAgentsView: "ctrl+a",
      zoomServerView: "ctrl+b",
    },
  };
  await Bun.write(join(configDir, "keybindings.json"), JSON.stringify(file, null, 2) + "\n");
}

/**
 * Build a long-running stub whose argv[0] matches the agent name so honeymux's
 * pane-process scan flags it. tmux reports `pane_current_command` as the
 * foreground process basename, so we use a perl one-liner that renames itself
 * via $0 before sleeping (a pure-shell `exec sleep` would surface as "sleep"
 * instead).
 */
async function seedAgentDetectionMarker(homeDir: string, target: AgentInstallTarget): Promise<string> {
  const binDir = join(homeDir, "harness-bin");
  mkdirSync(binDir, { recursive: true });
  const stubPath = join(binDir, target);
  // perl's $0 assignment rewrites the kernel argv[0] cookie that tmux reads.
  // Fall back to `exec -a` semantics via bash if perl is unavailable.
  const script = [
    "#!/bin/sh",
    `if command -v perl >/dev/null 2>&1; then`,
    `  exec perl -e '$0=q(${target}); sleep 3600'`,
    `else`,
    `  exec -a ${target} sleep 3600`,
    `fi`,
    "",
  ].join("\n");
  await Bun.write(stubPath, script);
  await Bun.$`chmod +x ${stubPath}`.quiet();
  // The honeymux agent-install dialog suppresses itself when its installer
  // marker (e.g. ~/.claude/hooks/honeymux.py) is present; writeHarnessConfig
  // pre-drops one for normal screenshots, so remove it for this scene.
  if (target === "claude") {
    try {
      await Bun.$`rm -f ${join(homeDir, ".claude", "hooks", "honeymux.py")}`.quiet();
    } catch {
      /* best-effort */
    }
  }
  return stubPath;
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

interface PrepareDemoTmuxOptions {
  /** Extra named tmux sessions (created with `new-session`). */
  extraSessions?: string[];
  /** Spawn this command in a dedicated tmux window so its process name is
   *  visible to honeymux pane detection. */
  windowCommand?: { command: string; name: string };
}

async function prepareDemoTmux(ctx: SceneContext, options: PrepareDemoTmuxOptions = {}): Promise<void> {
  const { extraSessions = [], windowCommand } = options;
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
  if (windowCommand) {
    await runCommand(
      tmuxArgv(ctx.serverName, [
        "new-window",
        "-t",
        ctx.sessionName,
        "-n",
        windowCommand.name,
        windowCommand.command,
      ]),
      { env: ctx.env },
    );
  }
  for (const name of extraSessions) {
    await runCommand(tmuxArgv(ctx.serverName, ["new-session", "-d", "-s", name, "-n", "main"]), {
      env: ctx.env,
    });
  }
  await runCommand(
    tmuxArgv(ctx.serverName, ["select-window", "-t", `${ctx.sessionName}:workspace`]),
    { env: ctx.env },
  );
}

/**
 * Script body for the fake Claude-Code permission dialog that populates the
 * bridged agent terminal inside the Mux-o-Tron's full-viewport states
 * (full-view, latched-perm, review-latched). `clear` resets the VT, the
 * heredoc prints the dialog at the top of the pane, then `exec sleep`
 * blocks forever so no shell prompt reappears below the content.
 */
const FAKE_AGENT_DIALOG_SCRIPT = `#!/bin/sh
clear
cat <<'EOF'

 Read file

  Read(~/src/honeymux/scripts/docs-screenshots.ts)

 Do you want to proceed?
 ❯ 1. Yes, and tell Claude what to do next
   2. Yes, allow reading from scripts/ during this session
   3. No

 Esc to cancel
EOF
exec sleep 86400
`;

interface FakeAgentPaneIds {
  paneId: string;
  windowId: string;
}

/**
 * Seed a dedicated tmux window that prints a fake Claude-Code permission
 * dialog and blocks, so the agent PTY bridge (see use-agent-pty-bridge.ts)
 * has a real pane to attach to with realistic agent content instead of the
 * workspace shell prompt.
 *
 * Returns the new window's `#{window_id}` and first pane's `#{pane_id}`
 * so the caller can route the synthetic session at them via
 * HMX_HARNESS_AGENT_{WINDOW,PANE}_ID.
 */
async function seedFakeAgentDialogPane(ctx: SceneContext): Promise<FakeAgentPaneIds> {
  const scriptPath = join(ctx.homeDir, "fake-agent-dialog.sh");
  await Bun.write(scriptPath, FAKE_AGENT_DIALOG_SCRIPT);
  await Bun.$`chmod +x ${scriptPath}`.quiet();
  const result = await runCommand(
    tmuxArgv(ctx.serverName, [
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}\t#{pane_id}",
      "-t",
      ctx.sessionName,
      "-n",
      "agent",
      scriptPath,
    ]),
    { env: ctx.env },
  );
  const [windowId, paneId] = result.stdout.trim().split("\t");
  if (!windowId || !paneId) {
    throw new Error(`Unexpected tmux new-window output: ${JSON.stringify(result.stdout)}`);
  }
  return { paneId, windowId };
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

interface PrimeBaseScreenOptions {
  /**
   * Split direction:
   *   - false         — no split (single pane)
   *   - "horizontal"  — upper/lower panes (tmux split-window -v, default)
   *   - "vertical"    — left/right panes  (tmux split-window -h)
   */
  split?: "horizontal" | "vertical" | false;
  /** Add a second pane tab to the upper/left pane. Defaults to true. */
  paneTabs?: boolean;
}

async function primeBaseScreen(
  harness: TuiHarness,
  ctx: SceneContext,
  width: number,
  height: number,
  themeName: DocsTheme,
  options: PrimeBaseScreenOptions = {},
): Promise<void> {
  const { paneTabs = true, split = "horizontal" } = options;
  await harness.waitForText("workspace");
  await harness.waitForIdle(300);
  await seedWorkspacePane(ctx, width, height, themeName);
  await harness.waitForText("Honeymux docs demo");
  await harness.waitForIdle(300);
  if (split === "horizontal") await splitWorkspaceHorizontally(harness, ctx);
  else if (split === "vertical") await splitWorkspaceVertically(harness, ctx);
  if (paneTabs) await addSecondPaneTabToUpperPane(harness);
}

async function splitWorkspaceHorizontally(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  // split-window without -h gives us a horizontal divider (upper/lower
  // panes). The new pane is selected automatically; switch focus back
  // to the original upper pane so honeymux treats it as active.
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-v", "-t", target]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await harness.waitForIdle(250);
}

async function splitWorkspaceVertically(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  // split-window -h gives us a vertical divider (left/right panes). The new
  // pane is selected automatically; switch focus back to the original (left)
  // pane so honeymux treats it as active.
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-h", "-t", target]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-L", "-t", target]), { env: ctx.env });
  await harness.waitForIdle(250);
}

async function shootBufferZoomViewport(
  harness: TuiHarness,
  outPath: string,
  options: ShootOptions,
): Promise<void> {
  const full = harness.captureData();
  const visibleStart = Math.max(0, full.lines.length - full.rows);
  const rect = { height: full.rows, left: 0, top: visibleStart, width: full.cols };
  const cropped = cropTerminalData(full, rect);
  const { bgColor, border, theme: themeOverride, ...rest } = options;
  // Remap the primary-screen's dominant explicit bg (ghostty's default dark
  // fill that leaks through between ANSI-colored cells after buffer-zoom
  // paints) to bgColor, and also remap any other near-black explicit bgs so
  // the whole content area renders on the same solid fill as the frame.
  let data = cropped;
  if (bgColor) {
    const remap: Record<string, string> = {};
    for (const line of cropped.lines) {
      for (const span of line.spans) {
        if (!span.bg) continue;
        const hex = span.bg.toLowerCase();
        if (remap[hex]) continue;
        // Remap every dark explicit bg (luminance-ish check on summed
        // channels; pill colors and similar are unaffected).
        const rgb = hexToRgbSum(hex);
        if (rgb !== null && rgb < 0x180) remap[hex] = bgColor;
      }
    }
    if (Object.keys(remap).length > 0) data = remapBackgrounds(cropped, remap);
  }
  const resolved: Parameters<typeof renderTerminalToImage>[1] = { ...rest };
  if (themeOverride) {
    resolved.theme = themeOverride;
  } else if (bgColor) {
    resolved.theme = { background: bgColor, text: "#cccccc" };
  }
  if (bgColor && resolved.frameColor === undefined) {
    resolved.frameColor = bgColor;
  }
  if (typeof border === "number" && border > 0) {
    resolved.paddingX = border;
    resolved.paddingY = border;
  }
  // Pin image height to the full viewport so trailing empty rows (the area
  // below the cursor after the zoomed scrollback paints) don't shrink the
  // shot. Without this the after-shot renders shorter than the before-shot
  // and they don't line up in the side-by-side layout. 19 = round(14 * 1.35)
  // matches honeyshots DEFAULT_FONT_SIZE * DEFAULT_LINE_HEIGHT.
  const lineHeightPx = 19;
  const paddingY = resolved.paddingY ?? 0;
  resolved.height = full.rows * lineHeightPx + paddingY * 2;
  const png = await renderTerminalToImage(data, resolved);
  await Bun.write(outPath, png);
}

function hexToRgbSum(hex: string): null | number {
  const m = /^#([0-9a-f]{6})$/.exec(hex) ?? /^#([0-9a-f]{3})$/.exec(hex);
  if (!m) return null;
  const raw = m[1]!;
  const normalize = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return parseInt(normalize.slice(0, 2), 16) + parseInt(normalize.slice(2, 4), 16) + parseInt(normalize.slice(4, 6), 16);
}

function remapBackgrounds(data: TerminalData, remap: Record<string, string>): TerminalData {
  const lookup = new Map<string, string>();
  for (const [from, to] of Object.entries(remap)) {
    lookup.set(from.toLowerCase(), to);
  }
  const lines = data.lines.map((line) => ({
    ...line,
    spans: line.spans.map((span) => {
      if (!span.bg) return span;
      const replacement = lookup.get(span.bg.toLowerCase());
      return replacement === undefined ? span : { ...span, bg: replacement };
    }),
  }));
  return { ...data, lines };
}

async function seedBufferZoomGridPanes(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  // splitWorkspaceToGrid leaves focus on upper-right. Seed the active pane
  // with `ls -l /dev` (the pane buffer-zoom will capture), then clear the
  // other three so they render as empty shell prompts and visually recede
  // under inactive-pane dimming.
  const clearActive = async (): Promise<void> => {
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "C-l"]), { env: ctx.env });
  };
  const typeActive = async (command: string): Promise<void> => {
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "-l", command]), { env: ctx.env });
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "Enter"]), { env: ctx.env });
  };

  // Upper-right (currently active): ls -l /dev.
  await clearActive();
  await typeActive("ls -l /dev");
  // Upper-left.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-L", "-t", target]), { env: ctx.env });
  await clearActive();
  // Lower-left.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-D", "-t", target]), { env: ctx.env });
  await clearActive();
  // Lower-right.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-R", "-t", target]), { env: ctx.env });
  await clearActive();
  // Park focus back on upper-right so bufferZoom captures that pane's scrollback.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await harness.waitForIdle(400);
}

/**
 * Prepare the 2x2 grid for the inactive-pane-dimming scene: seed a visible
 * `ls -l /dev` listing in the upper-left pane (which becomes the active
 * pane) and clear the other three so they render as empty shell prompts.
 * The dim overlay drops those three into the background while upper-left
 * stays at full brightness.
 */
async function seedInactivePaneDimmingGridPanes(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  const clearActive = async (): Promise<void> => {
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "C-l"]), { env: ctx.env });
  };
  const typeActive = async (command: string): Promise<void> => {
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "-l", command]), { env: ctx.env });
    await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", target, "Enter"]), { env: ctx.env });
  };

  // splitWorkspaceToGrid leaves focus on upper-right. Move to upper-left and
  // seed the visible content there.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-L", "-t", target]), { env: ctx.env });
  await clearActive();
  await typeActive("ls -l /dev");
  // Clear the other three.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-R", "-t", target]), { env: ctx.env });
  await clearActive();
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-D", "-t", target]), { env: ctx.env });
  await clearActive();
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-L", "-t", target]), { env: ctx.env });
  await clearActive();
  // Park focus back on upper-left so the dim overlay covers the other three.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await harness.waitForIdle(400);
}

async function splitWorkspaceToGrid(harness: TuiHarness, ctx: SceneContext): Promise<void> {
  const target = `${ctx.sessionName}:workspace`;
  // Start: single pane P0. Split horizontal divider -> P0 (upper) + P1 (lower), focus on P1.
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-v", "-t", target]), { env: ctx.env });
  // Focus upper (P0), then split vertical divider -> P0 (UL) + P2 (UR), focus on P2.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-h", "-t", target]), { env: ctx.env });
  // Focus lower (P1), then split vertical divider -> P1 (LL) + P3 (LR), focus on P3.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-D", "-t", target]), { env: ctx.env });
  await runCommand(tmuxArgv(ctx.serverName, ["split-window", "-h", "-t", target]), { env: ctx.env });
  // Park focus on the upper-right pane (P2) — buffer-zoom captures the active pane.
  await runCommand(tmuxArgv(ctx.serverName, ["select-pane", "-U", "-t", target]), { env: ctx.env });
  await harness.waitForIdle(300);
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
  // causing consecutive Tabs to be coalesced. Some tabs (options/agents)
  // run continuous preview animations, so never strictly go idle.
  await sleep(300);
  for (let i = 0; i < target; i++) {
    harness.send("\t");
    await sleep(250);
  }
  await sleep(300);
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

/**
 * Add `count` pane tabs to the currently-active pane via the main menu's
 * newPaneTab action. Each iteration opens the menu with Ctrl+G and presses
 * `n`, mirroring {@link addSecondPaneTabToUpperPane} but repeated.
 */
async function addPaneTabsToActivePane(harness: TuiHarness, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    harness.send("\x07");
    await harness.waitForText("Functions");
    await harness.waitForIdle(150);
    harness.send("n");
    await sleep(800);
    await harness.waitForIdle(400, 10_000);
  }
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

async function runQuickTerminalCommand(harness: TuiHarness): Promise<void> {
  // Quick terminal opens to a fresh shell. Send a printf so the shot is not
  // empty. Use the literal sequence rather than C-l so we keep the prompt.
  await sleep(400);
}

async function navigateSessionsToColorPicker(harness: TuiHarness): Promise<void> {
  // Session dropdown opens with the active session focused on the name
  // column (col 0). Press Right to move focus to the color icon (col 1),
  // then Enter to open the color picker.
  await sleep(250);
  harness.send("\x1b[C");
  await sleep(200);
  harness.send("\r");
  await sleep(300);
}

async function disablePaneTabsViaOptions(harness: TuiHarness): Promise<void> {
  // Options dialog opens on the General tab where "Pane Tabs" is one of
  // the toggleable rows. The exact row index can drift, so navigate by
  // searching for the visible label rather than hard-coding a count.
  // This is a best-effort key sequence: down arrows until the row reads
  // "Pane Tabs", then Space to toggle.
  await sleep(300);
  // Navigate down a small number of times to reach the pane-tabs row.
  // The General tab in the options dialog lists about 5-7 toggles before
  // "Pane Tabs"; a fixed count is brittle but works for the screenshot
  // fixture as long as the General tab order is stable.
  for (let i = 0; i < 6; i++) {
    harness.send("\x1b[B");
    await sleep(80);
  }
  // Space toggles the focused boolean control. Pre-existing inactive
  // pane tabs (added during primeBaseScreen) trigger the confirm dialog.
  harness.send(" ");
  await sleep(400);
}

async function pressZoom(harness: TuiHarness, target: ZoomTarget): Promise<void> {
  // The harness keybindings file binds Ctrl+A to zoomAgentsView and
  // Ctrl+B to zoomServerView. The zoom is sticky by default so a single
  // tap toggles it on.
  const seq = target === "agents" ? "\x01" : "\x02";
  await sleep(200);
  harness.send(seq);
  await sleep(300);
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
    let sidebarView = resolveCaptureSidebarView(options);
    // Review workflow (tree-select) auto-opens the sidebar at runtime
    // (use-muxotron-focus-and-agent-selection.ts). That mid-session layout
    // shift can leave the bridged PTY's initial frame stranded, so pre-open
    // the sidebar so the muxotron interior is at its final size from the
    // start of the bridge's lifetime.
    if (
      sceneName === "muxotron" &&
      (options.muxotronState === "review-latched" || options.muxotronState === "review-preview")
    ) {
      sidebarView = sidebarView ?? "agents";
    }
    const toolbarOpen = resolveCaptureToolbarOpen(options);

    // Per-scene fixture seeding decisions.
    const isPaneBorderMenuScene = sceneName === "pane-border-menu";
    const wantsRemoteUnreachable = options.sshError || (isPaneBorderMenuScene && options.submenu === "servers");

    await writeHarnessConfig(homeDir, options.theme, options.uiMode, {
      // Buffer zoom's default fade transition animates over ~600ms. Disable
      // it for the docs shot so the captured scrollback paints synchronously
      // and the shoot window doesn't land mid-fade. Also enable inactive-
      // pane dimming so the three non-target panes visibly recede and the
      // shot clearly signals which pane buffer-zoom will capture.
      ...(sceneName === "buffer-zoom" ? { bufferZoomFade: false, dimInactivePanes: true } : {}),
      ...(sceneName === "inactive-pane-dimming" ? { dimInactivePanes: true } : {}),
      remoteUnreachable: wantsRemoteUnreachable,
    });
    await writeHarnessUiState(homeDir, toolbarOpen, sidebarView);
    await seedHarnessHome(homeDir);

    // Conversations: pre-seed history-consent unless --consent-unseen.
    if (sceneName === "conversations" && !options.consentUnseen) {
      await seedHarnessHistoryConsent(homeDir);
    }
    // Profiles: pre-seed a layout-profiles file so the dropdown is populated.
    if (sceneName === "profiles") {
      await seedHarnessLayoutProfiles(homeDir);
    }
    // Zoom views: bind harness-only zoom keys.
    // Muxotron review/latch scenes: bind agentLatch so the "latch available"
    // dashed border activates (isMuxotronDashed short-circuits to solid when
    // the binding is unset) and the review/latch UI paths are reachable. The
    // expanded state deliberately leaves the binding unbound so its auto-
    // expansion shot renders the approve/deny/goto/dismiss button strip;
    // expanded-latchable binds agentLatch to swap that strip for the single
    // "<key>: latch" hint button at the bottom border.
    const muxotronState = options.muxotronState ?? "expanded";
    const muxotronNeedsLatchBinding =
      sceneName === "muxotron" && muxotronState !== "collapsed" && muxotronState !== "expanded";
    if (options.zoom || muxotronNeedsLatchBinding) {
      await seedHarnessKeybindings(homeDir);
    }
    // Agent install: drop a fake binary on PATH whose name matches the agent
    // and run it inside a tmux pane so honeymux's pane-process scan picks it
    // up as a "running agent".
    let agentStubPath: null | string = null;
    if (sceneName === "agent-install" && options.agentInstallTarget) {
      agentStubPath = await seedAgentDetectionMarker(homeDir, options.agentInstallTarget);
    }

    // Sessions: spin up extra named tmux sessions so the dropdown shows
    // varied entries instead of a single one.
    const extraSessions = sceneName === "sessions" ? ["Build", "Logs", "Sandbox"] : [];
    const tmuxOptions: PrepareDemoTmuxOptions = { extraSessions };
    if (agentStubPath) {
      tmuxOptions.windowCommand = { command: agentStubPath, name: "agent" };
    }
    await prepareDemoTmux(ctx, tmuxOptions);

    // Build the harness env, layering in the env-gated harness hooks honored
    // by useHarnessHooks() in src/app/harness/use-harness-hooks.ts.
    const harnessEnv: Record<string, string> = { ...ctx.env, HMX_HARNESS: "1" };
    if (options.seedInfo || sceneName === "notifications") {
      harnessEnv["HMX_HARNESS_INFO"] = options.seedInfo ?? "Honeymux notification|This is a sample info item.";
    }
    if (options.seedWarning) {
      harnessEnv["HMX_HARNESS_WARNING"] = options.seedWarning;
    }
    if (sceneName === "notifications") {
      harnessEnv["HMX_HARNESS_OPEN_NOTIFICATIONS"] = "1";
    }
    if (options.sshError && sceneName !== "pane-border-menu") {
      // SSH errors take a beat to surface; allow more time before the harness
      // hook auto-clicks the notifications icon so the error is in the queue.
      harnessEnv["HMX_HARNESS_OPEN_NOTIFICATIONS"] = "1";
      harnessEnv["HMX_HARNESS_TRIGGER_DELAY_MS"] = "5000";
    }
    if (isPaneBorderMenuScene) {
      harnessEnv["HMX_HARNESS_OPEN_PANE_BORDER_MENU"] = "1";
    }
    if (sceneName === "privileged-pane") {
      // Force the upper pane only to be reported as root-owned so the demo
      // shows a privileged pane above a normal one. useRootDetection reads
      // this env var when HMX_HARNESS=1.
      harnessEnv["HMX_HARNESS_ROOT_FORCE"] = "top";
    }
    if (sceneName === "pane-tabs") {
      // The harness-hook rename helper polls until every pane-tab group
      // has at least MIN_TABS tabs and the per-group count stabilizes,
      // so the default trigger delay of ~1.4s is fine — the polling loop
      // absorbs the ~10s of async tab creation that follows.
      harnessEnv["HMX_HARNESS_RENAME_PANE_TABS"] = "tab ";
      harnessEnv["HMX_HARNESS_RENAME_PANE_TABS_MIN_TABS"] = "5";
    }
    if (sceneName === "muxotron") {
      const state = options.muxotronState ?? "expanded";
      if (state === "collapsed") {
        // One alive agent so the counter displays 000/001 and the idle bear
        // mascot animates instead of the "no agents" fallback text.
        harnessEnv["HMX_HARNESS_AGENT_ALIVE"] = "~/src/project";
      } else if (
        state === "expanded" ||
        state === "expanded-latchable" ||
        state === "full-view" ||
        state === "latched-perm"
      ) {
        // Expanded, expanded-latchable, full-view, and latched-perm all need an
        // unanswered permission request in a pane the user is NOT focused on.
        // - expanded            — auto-expansion with approve/deny/goto/dismiss
        // - expanded-latchable  — same + agentLatch binding; single "latch" hint
        // - full-view           — review workflow latched onto the perm session
        // - latched-perm        — perm-request latch (no tree selection);
        //                         handleAgentLatch flips muxotronFocusActive,
        //                         giving approve/deny/goto/dismiss + solid
        //                         border + full-viewport agent PTY bridge.
        harnessEnv["HMX_HARNESS_AGENT_WAITING"] = "Read: ~/src/honeymux/scripts/docs-screenshots.ts";
        if (state === "full-view") {
          harnessEnv["HMX_HARNESS_MUXOTRON_LATCH"] = "1";
        } else if (state === "latched-perm") {
          harnessEnv["HMX_HARNESS_MUXOTRON_FOCUS_PERM"] = "1";
        }
      } else if (state === "review-preview") {
        // Review preview (tree-selected, unlatched) — needs an undismissed
        // permission request so the muxotron paints its dashed "latch
        // available" border. The harness hook picks the waiting session as
        // the tree-select target because agentWaitingLabel takes priority.
        harnessEnv["HMX_HARNESS_AGENT_WAITING"] = "Read: ~/src/honeymux/scripts/docs-screenshots.ts";
        harnessEnv["HMX_HARNESS_MUXOTRON_REVIEW"] = "1";
      } else {
        // review-latched: review workflow with an unanswered permission
        // request pending. Tree-selected + latched, so the surface is
        // "engaged" (solid border) and the review button strip renders with
        // dimmed hotkey prefixes for goto/prev/next. The pinned perm header
        // mirrors the "Read: ..." summary shown on the Mux-o-Tron page so
        // all latched docs shots reference the same example prompt.
        harnessEnv["HMX_HARNESS_AGENT_WAITING"] = "Read: ~/src/honeymux/scripts/docs-screenshots.ts";
        harnessEnv["HMX_HARNESS_MUXOTRON_REVIEW"] = "1";
        harnessEnv["HMX_HARNESS_MUXOTRON_LATCH"] = "1";
      }
      // For states where the muxotron takes over the full viewport and
      // bridges an agent PTY inside its frame, route the synthetic session
      // at a harness-seeded window whose pane prints a fake Claude-Code
      // permission dialog. Otherwise the bridge falls back to the workspace
      // window and we get a live bash prompt in the docs shot. review-
      // preview also bridges the PTY (the muxotron's `interactiveAgent`
      // prop is `attachedAgent`, not the latch-gated interactive agent, so
      // TerminalView mounts in preview too — it just isn't a
      // keystroke-forwarding surface until the latch toggles).
      if (
        state === "full-view" ||
        state === "latched-perm" ||
        state === "review-latched" ||
        state === "review-preview"
      ) {
        const { paneId, windowId } = await seedFakeAgentDialogPane(ctx);
        harnessEnv["HMX_HARNESS_AGENT_PANE_ID"] = paneId;
        harnessEnv["HMX_HARNESS_AGENT_WINDOW_ID"] = windowId;
        harnessEnv["HMX_HARNESS_AGENT_SESSION_NAME"] = ctx.sessionName;
      }
      // primeBaseScreen takes ~3s to split + spawn a pane tab and is driven
      // by waitForIdle calls; if the muxotron seeds before it finishes, the
      // scanner animation keeps the tty non-idle and waitForIdle throws. Push
      // the trigger well past the primeBaseScreen deadline so the seed lands
      // on a settled screen.
      harnessEnv["HMX_HARNESS_TRIGGER_DELAY_MS"] = "6000";
    }

    // Too-narrow scene forces a PTY below honeymux's 80-col minimum so the
    // blocking overlay fires. Other scenes use the caller's width/height.
    const harnessCols = sceneName === "too-narrow" ? 70 : options.width;
    const harnessRows = sceneName === "too-narrow" ? 24 : options.height;

    harness = new TuiHarness({
      argv: [process.execPath, "run", "src/index.tsx", "--server", ctx.serverName, ctx.sessionName],
      cols: harnessCols,
      cwd: repoRoot,
      env: harnessEnv,
      rows: harnessRows,
    });
    await harness.start();
    // too-narrow: the overlay blocks the workspace so primeBaseScreen's
    // waitForText("workspace") would time out. Skip it entirely.
    if (sceneName !== "too-narrow") {
      const primeOptions: PrimeBaseScreenOptions =
        sceneName === "privileged-pane"
          ? { paneTabs: false, split: "horizontal" }
          : sceneName === "buffer-zoom" || sceneName === "inactive-pane-dimming"
            ? { paneTabs: false, split: false }
            : sceneName === "pane-tabs"
              ? { paneTabs: false, split: "vertical" }
              : {};
      await primeBaseScreen(harness, ctx, options.width, options.height, options.theme, primeOptions);
    }

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
    } else if (sceneName === "agents") {
      await runAgentsDemo(ctx);
      await openMainMenu(harness, false);
      harness.send("a");
      await harness.waitForRegion("agents");
      await harness.waitForIdle(350);
    } else if (sceneName === "conversations") {
      await openMainMenu(harness);
      harness.send("c");
      const region = options.consentUnseen ? "history-consent-dialog" : "conversations";
      await waitForRegionStable(harness, region);
      await harness.waitForIdle(300);
    } else if (sceneName === "quick-terminal") {
      await openMainMenu(harness);
      harness.send("q");
      await waitForRegionStable(harness, "quick-terminal");
      await runQuickTerminalCommand(harness);
      await harness.waitForIdle(250);
    } else if (sceneName === "profiles") {
      await openMainMenu(harness);
      harness.send("p");
      await waitForRegionStable(harness, "profile-dropdown");
      await harness.waitForIdle(250);
    } else if (sceneName === "sessions") {
      await openMainMenu(harness);
      harness.send("s");
      await waitForRegionStable(harness, "session-dropdown");
      await harness.waitForIdle(400);
      if (options.submenu === "color") {
        await navigateSessionsToColorPicker(harness);
        await waitForRegionStable(harness, "color-picker");
        await harness.waitForIdle(250);
      }
    } else if (sceneName === "screenshots") {
      await openMainMenu(harness);
      harness.send("h");
      await waitForRegionStable(harness, "screenshot-dialog");
      await harness.waitForIdle(250);
    } else if (sceneName === "pane-tabs") {
      // primeBaseScreen already split the workspace vertically (left|right)
      // and left focus on the left pane. Add 4 more tabs to the left pane,
      // switch focus to the right pane via tmux, then add 4 more tabs
      // there. The harness hook (HMX_HARNESS_RENAME_PANE_TABS="tab ")
      // polls until both groups settle at 5 tabs, then renames every tab
      // to `tab 1`..`tab 5`.
      await addPaneTabsToActivePane(harness, 4);
      await runCommand(
        tmuxArgv(ctx.serverName, ["select-pane", "-R", "-t", `${ctx.sessionName}:workspace`]),
        { env: ctx.env },
      );
      await harness.waitForIdle(300);
      await addPaneTabsToActivePane(harness, 4);
      // Wait for the harness hook's polling settle detector to fire (needs
      // the snapshot to be stable for ~1s) and for its serialized renames
      // to commit through the pane-tabs op queue.
      await sleep(4_000);
      await harness.waitForIdle(500, 10_000);
    } else if (sceneName === "pane-tabs-disable") {
      await openMainMenu(harness);
      harness.send("o");
      await waitForRegionStable(harness, "options");
      await harness.waitForText("General");
      await harness.waitForIdle(350);
      await disablePaneTabsViaOptions(harness);
      await waitForRegionStable(harness, "disable-pane-tabs-dialog");
      await harness.waitForIdle(250);
    } else if (sceneName === "pane-border-menu") {
      // The harness hook (HMX_HARNESS_OPEN_PANE_BORDER_MENU=1) auto-opens
      // the pane border menu shortly after startup.
      await waitForRegionStable(harness, "pane-border-menu");
      await harness.waitForIdle(200);
      if (options.submenu === "servers") {
        // Convert-to-remote is the second item; press Down then Enter.
        // Note: the item is disabled when no remote is "ready" (i.e. the
        // SSH mirror has finished initial sync). With an unreachable host
        // the submenu cannot actually open — see notes in 08 report.
        harness.send("\x1b[B");
        await sleep(150);
        harness.send("\r");
        await waitForRegionStable(harness, "pane-border-server-menu");
        await harness.waitForIdle(200);
      }
      if (options.sshError) {
        // SSH error path via pane-border menu requires a working remote
        // for the convert-to-remote item to be enabled. The screen capture
        // for this region is better served by the notifications scene.
        await waitForRegionStable(harness, "ssh-error-dialog", 30_000);
        await harness.waitForIdle(250);
      }
    } else if (sceneName === "notifications") {
      // The harness hook seeds an info item (or warning) and triggers the
      // notifications click. The review frame wraps the inner dialog.
      // For ssh-error, we rely on the unreachable remote configured above
      // emitting a status="error" event; the harness hook still triggers
      // the notifications-click flow.
      const targetRegion = options.sshError
        ? "ssh-error-dialog"
        : options.region === "info-item-dialog"
          ? "info-item-dialog"
          : "notifications-review";
      await waitForRegionStable(harness, targetRegion, 30_000);
      await harness.waitForIdle(300);
    } else if (sceneName === "agent-install") {
      // Install dialog auto-pops once the agent binary is detected.
      await waitForRegionStable(harness, "agent-install-dialog", 20_000);
      await harness.waitForIdle(250);
    } else if (sceneName === "too-narrow") {
      // The overlay renders automatically when honeymux detects a PTY below
      // 80 cols or 24 rows. Just wait for the region tag + a short settle
      // for the honeycomb animation to start.
      await waitForRegionStable(harness, "too-narrow-overlay", 15_000);
      await sleep(400);
    } else if (sceneName === "buffer-zoom") {
      // Build a 2x2 grid of panes and seed `ls -l` in each, with `ls -l /dev`
      // in the upper-right (which becomes the active pane). When
      // --buffer-zoom-active is set, then trigger bufferZoom after content
      // is painted so the shoot captures the full-screen scrollback view.
      await splitWorkspaceToGrid(harness, ctx);
      await seedBufferZoomGridPanes(harness, ctx);
      await harness.waitForIdle(500);
    } else if (sceneName === "inactive-pane-dimming") {
      // Build a 2x2 grid with `ls -l /dev` in the upper-left (active) pane
      // and empty prompts in the other three. The harness config sets
      // dimInactivePanes: true so the three non-active panes render with
      // the semi-transparent dark overlay and visibly recede.
      await splitWorkspaceToGrid(harness, ctx);
      await seedInactivePaneDimmingGridPanes(harness, ctx);
      await harness.waitForIdle(500);
      if (options.bufferZoomActive) {
        await openMainMenu(harness);
        harness.send("b");
        // Buffer zoom suspends the OpenTUI renderer, exits the alt screen,
        // clears the primary screen, and paints the captured scrollback as
        // a single full-terminal view. Then a 100ms OSC-12 glow animation
        // begins, so waitForIdle would never return — pause for a fixed
        // window to let the transition (and fade, if enabled) settle.
        await sleep(2_000);
      }
    } else if (sceneName === "privileged-pane") {
      // Upper pane (privileged): clear the seedWorkspacePane printf output,
      // then type "sudo make me a sandwich" after the prompt so the tinted
      // pane has a visible command queued up. Typed with send-keys -l (no
      // Enter) so the text sits at the prompt instead of executing.
      const upperPane = `${ctx.sessionName}:workspace.0`;
      const lowerPane = `${ctx.sessionName}:workspace.1`;
      await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", upperPane, "C-l"]), { env: ctx.env });
      await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", upperPane, "-l", "sudo make me a sandwich"]), {
        env: ctx.env,
      });
      // Lower pane (unprivileged): clear so it just shows a clean prompt.
      await runCommand(tmuxArgv(ctx.serverName, ["send-keys", "-t", lowerPane, "C-l"]), { env: ctx.env });
      // useRootDetection polls every 2s; wait a few cycles so the
      // forced-root tint has rendered before shooting.
      await sleep(5_000);
      await harness.waitForIdle(300);
    } else if (sceneName === "muxotron") {
      // Drive the muxotron into the requested state. The harness hook handles
      // the actual seeding + latch triggering via env vars. The muxotron's
      // scanner/sine-wave animations run continuously once an unanswered
      // agent is seeded, so we can't call waitForIdle for expanded / full-
      // view — wait for the right region tag, then for visible text that
      // only appears after the synthetic session is injected.
      const state = options.muxotronState ?? "expanded";
      const targetRegion = state === "collapsed" ? "muxotron" : "muxotron-expanded";
      await waitForRegionStable(harness, targetRegion, 20_000);
      // Poll the rendered screen for a distinguishing token that proves the
      // harness hook has already injected its synthetic session(s). Without
      // this, the shoot can fire before the 6s trigger timer elapses.
      const needle = state === "collapsed" ? "001" : "claude (~/src/project)";
      const seededDeadline = Date.now() + 15_000;
      while (Date.now() < seededDeadline) {
        if (harness.screenText().includes(needle)) break;
        await sleep(120);
      }
      // Latched variants (full-view, review-latched, latched-perm) toggle
      // the latch / focus on a 120ms setTimeout after the synthetic session
      // lands, so they need extra settle time before the shoot; the bridge
      // also needs to spawn its overlay session, attach, and feed the first
      // frame before the fake-agent dialog renders. The two unlatched
      // review variants (expanded, review-preview) don't wait on the latch
      // timer but still need a moment for the review surface to paint.
      const latched =
        state === "full-view" || state === "review-latched" || state === "latched-perm";
      const settleMs = latched ? 1_200 : 400;
      await sleep(settleMs);
    }

    // Optional zoom scene (orthogonal to scene branch above).
    if (options.zoom && sceneName === "main") {
      await pressZoom(harness, options.zoom);
      await waitForRegionStable(harness, options.zoom === "agents" ? "agents-zoom" : "tree-zoom");
      await harness.waitForIdle(250);
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
    } else {
      // Without a bgColor remap, honeyshots auto-detects the frame color from
      // the visible edge cells. Overlays (e.g. the privileged-pane red tint)
      // can bleed into that detection; pin the frame to the theme bg so the
      // border matches the honeymux chrome instead.
      shootOptions.frameColor = theme.bg;
    }
    if (options.border) {
      shootOptions.border = options.border;
    }

    mkdirSync(options.outDir, { recursive: true });
    const outPath = join(options.outDir, `${sceneName}.png`);
    if (sceneName === "buffer-zoom" && options.bufferZoomActive) {
      // Buffer zoom suspends the OpenTUI renderer and paints the captured
      // scrollback directly to the primary screen. The outer terminal
      // emulator keeps every line that scrolled past the viewport in its
      // scrollback buffer, so `harness.captureData()` returns a `lines`
      // array much taller than `rows`. `harness.shoot(null, ...)` doesn't
      // crop to the viewport in that case (rectMatchesFull short-circuits
      // when rect.height === full.rows), yielding a very tall image.
      // Crop to the last `rows` lines so the shot matches what a user
      // actually sees when buffer zoom is active.
      await shootBufferZoomViewport(harness, outPath, shootOptions);
    } else {
      await harness.shoot(options.region ?? null, outPath, shootOptions);
    }
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
