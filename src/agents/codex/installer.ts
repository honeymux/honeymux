import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import type { InstallHost } from "../install-host.ts";

import { formatArgv } from "../../util/argv.ts";
import { log } from "../../util/log.ts";
import { type HostConsent, readHostConsent, writeHostConsent } from "../consent-store.ts";
import { localInstallHost } from "../install-host.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const HOOK_SCRIPT_NAME = "honeymux.py";
// SessionStart fires at session boot; UserPromptSubmit carries the user's
// prompt text and transcript path for the agents-list label; PermissionRequest
// marks the session as awaiting an approval decision; PostToolUse signals the
// approval was resolved (whether by codex's auto-policy or by the user
// answering codex's native prompt) so honeymux can clear the unanswered state.
const HOOK_EVENTS = ["PermissionRequest", "PostToolUse", "SessionStart", "UserPromptSubmit"] as const;
type HookEvent = (typeof HOOK_EVENTS)[number];

// Codex persists per-hook trust state under config.toml keys whose event-name
// segment is snake_case (`pre_tool_use`, etc.). See codex-rs/hooks/src/lib.rs
// :: hook_event_key_label.
const HOOK_EVENT_KEY_LABEL: Record<HookEvent, string> = {
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
};

type CodexSettings = {
  hooks?: Record<string, HookMatcherGroup[]>;
};

type HookHandler = {
  command: string;
  type: "command";
};

type HookMatcherGroup = {
  hooks: HookHandler[];
};

type HookTrustTarget = {
  event: HookEvent;
  groupIndex: number;
  hookIndex: number;
};

type ResolveExecutable = (name: string) => null | string | undefined;

// Consent lives on the local filesystem regardless of install target.
const CONSENT_FILE = `${process.env.HOME}/.local/state/honeymux/codex-hooks-consent.json`;

export async function areCodexHooksInstalled(host: InstallHost = localInstallHost): Promise<boolean> {
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  const script = await host.readFile(scriptPath);
  if (script === null) return false;
  const resolver = await buildHostResolver(host);
  return buildCodexHookCommand(scriptPath, resolver) !== null;
}

export function buildCodexHookCommand(
  scriptPath: string,
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  const interpreter = resolveCodexHookPython(resolveExecutable);
  if (!interpreter) return null;
  // Store the interpreter by name (python3/python), not its absolute path, so
  // the command stays identical across hosts and shells that resolve it to
  // different paths — an absolute path would otherwise read as a stale install.
  return formatArgv([basename(interpreter), scriptPath]);
}

export function ensureCodexHooksFeature(configText: string): string {
  const lines = configText.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let inFeatures = false;
  let inserted = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inFeatures && !inserted) {
        lines.splice(i, 0, "hooks = true");
        inserted = true;
        break;
      }
      inFeatures = trimmed === "[features]";
      continue;
    }
    if (inFeatures && /^hooks\s*=/.test(trimmed)) {
      lines[i] = "hooks = true";
      inserted = true;
      break;
    }
  }

  if (!inserted) {
    if (inFeatures) {
      lines.push("hooks = true");
    } else {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("[features]");
      lines.push("hooks = true");
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Inject `trusted_hash` entries into `config.toml` for each honeymux-managed
 * codex hook event, so codex treats our hooks as user-trusted and actually
 * invokes them. Codex requires per-handler trust before firing any hook other
 * than the legacy implicit ones; without these entries, PostToolUse (and any
 * future hooks we register) silently no-ops.
 *
 * The hash mirrors codex's own `command_hook_hash`: sha256 of the canonical
 * JSON encoding of `{event_name, hooks: [{type, command, timeout, async}]}`
 * with object keys sorted recursively. See `codex-rs/hooks/src/engine/
 * discovery.rs` and `codex-rs/config/src/fingerprint.rs`.
 *
 * The user already consented to honeymux installing the hook script and
 * registering it in hooks.json; trusting our own command on their behalf is
 * the natural extension of that consent. We never trust hooks honeymux did
 * not author.
 */
export function ensureCodexHooksTrust(
  configText: string,
  hooksJsonPath: string,
  command: string,
  settings: CodexSettings = upsertCodexHookSettings({}, command),
): string {
  let result = configText;
  for (const target of findCodexHookTrustTargets(settings, command)) {
    const label = HOOK_EVENT_KEY_LABEL[target.event];
    const hash = computeCodexHookTrustHash(label, command);
    result = ensureCodexTrustSection(result, hooksJsonPath, label, target.groupIndex, target.hookIndex, hash);
  }
  return result;
}

export async function installCodexHooks(host: InstallHost = localInstallHost): Promise<boolean> {
  try {
    const hooksDir = await getHooksDir(host);
    await host.mkdir(hooksDir, { recursive: true });

    const destPath = join(hooksDir, HOOK_SCRIPT_NAME);
    if (!(await syncCodexHookInstall(host, destPath))) return false;

    await saveCodexConsent(true, host.hostId);
    return true;
  } catch {
    return false;
  }
}

export function isCodexConsented(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).consented === true;
}

/**
 * True when the on-disk hook script, hooks.json, and config.toml already
 * match what `installCodexHooks` would produce — i.e. sync would be a no-op.
 * Used to suppress the "upgrade" prompt when nothing is actually stale.
 */
export async function isCodexHookInstallCurrent(host: InstallHost = localInstallHost): Promise<boolean> {
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  const currentScript = await host.readFile(scriptPath);
  if (currentScript !== HOOK_CONTENT) return false;
  const resolver = await buildHostResolver(host);
  const command = buildCodexHookCommand(scriptPath, resolver);
  if (!command) return false;
  const hooksFile = await getHooksFile(host);
  const currentHooksText = await host.readFile(hooksFile);
  if (currentHooksText === null) return false;
  const nextSettings = upsertCodexHookSettings(safeParseJson(currentHooksText), command);
  const nextHooksText = JSON.stringify(nextSettings, null, 2);
  if (currentHooksText !== nextHooksText) return false;
  const configFile = await getConfigFile(host);
  const currentConfigText = (await host.readFile(configFile)) ?? "";
  const nextConfigText = ensureCodexHooksTrust(
    ensureCodexHooksFeature(currentConfigText),
    hooksFile,
    command,
    nextSettings,
  );
  return currentConfigText === nextConfigText;
}

export function isCodexIgnored(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).ignored === true;
}

/**
 * If the user has granted consent for this host and the hook script is already
 * present on disk, re-run the sync so script + hooks.json + config.toml stay
 * current with the bundled version. No-op when consent is missing or the
 * script is absent.
 */
export async function refreshCodexHooksIfConsented(host: InstallHost = localInstallHost): Promise<void> {
  if (readHostConsent(CONSENT_FILE, host.hostId).consented !== true) return;
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  if ((await host.readFile(scriptPath)) === null) return;
  try {
    await syncCodexHookInstall(host, scriptPath);
  } catch {
    // best-effort — silent failure, normal flows will re-surface on next detection
  }
}

export function resolveCodexHookPython(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

export async function saveCodexConsent(consented: boolean, hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export async function saveCodexIgnored(hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented: false, ignored: true, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export function upsertCodexHookSettings(settings: CodexSettings, command: string): CodexSettings {
  const next: CodexSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
  };
  const hooks = next.hooks!;

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event])
      ? hooks[event].filter((group: unknown) => !containsOurHook(group))
      : [];

    existing.push({
      hooks: [
        {
          command,
          type: "command",
        },
      ],
    });

    hooks[event] = existing;
  }

  return next;
}

async function buildHostResolver(host: InstallHost): Promise<ResolveExecutable> {
  const python3 = await host.resolveExecutable("python3");
  const python = await host.resolveExecutable("python");
  return (name) => (name === "python3" ? python3 : name === "python" ? python : null);
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalizeJson(source[key]);
    }
    return sorted;
  }
  return value;
}

function computeCodexHookTrustHash(eventKeyLabel: string, command: string): string {
  // Mirrors codex's `command_hook_hash` for a single-handler group with no
  // matcher. `timeout: 600` is codex's default applied during discovery; the
  // `async` field defaults to false.
  const identity = {
    event_name: eventKeyLabel,
    hooks: [
      {
        async: false,
        command,
        timeout: 600,
        type: "command",
      },
    ],
  };
  const canonical = canonicalizeJson(identity);
  const serialized = JSON.stringify(canonical);
  const hex = createHash("sha256").update(serialized).digest("hex");
  return `sha256:${hex}`;
}

function containsOurHook(obj: unknown): boolean {
  if (typeof obj === "string") return obj.includes(HOOK_SCRIPT_NAME);
  if (Array.isArray(obj)) return obj.some(containsOurHook);
  if (obj && typeof obj === "object") return Object.values(obj).some(containsOurHook);
  return false;
}

function ensureCodexTrustSection(
  configText: string,
  hooksJsonPath: string,
  eventKeyLabel: string,
  groupIndex: number,
  hookIndex: number,
  trustedHash: string,
): string {
  const sectionHeader = `[hooks.state."${hooksJsonPath}:${eventKeyLabel}:${groupIndex}:${hookIndex}"]`;
  const trustLine = `trusted_hash = "${trustedHash}"`;
  const lines = configText.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const headerIdx = lines.indexOf(sectionHeader);
  if (headerIdx === -1) {
    if (lines.length > 0) lines.push("");
    lines.push(sectionHeader);
    lines.push(trustLine);
    return `${lines.join("\n")}\n`;
  }

  // Walk the section body (until next [table.header] or EOF). Replace an
  // existing trusted_hash in place; otherwise insert one immediately after the
  // last key-value line so we don't dangle below a blank separator.
  let lastKeyIdx = headerIdx;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) break;
    if (/^trusted_hash\s*=/.test(trimmed)) {
      if (lines[i] !== trustLine) lines[i] = trustLine;
      return `${lines.join("\n")}\n`;
    }
    if (trimmed.length > 0) lastKeyIdx = i;
  }

  lines.splice(lastKeyIdx + 1, 0, trustLine);
  return `${lines.join("\n")}\n`;
}

function findCodexHookTrustTargets(settings: CodexSettings, command: string): HookTrustTarget[] {
  const targets: HookTrustTarget[] = [];
  for (const event of HOOK_EVENTS) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;

    for (const [groupIndex, group] of groups.entries()) {
      if (!isHookMatcherGroup(group)) continue;

      for (const [hookIndex, hook] of group.hooks.entries()) {
        if (!isMatchingCodexHookHandler(hook, command)) continue;
        targets.push({ event, groupIndex, hookIndex });
      }
    }
  }
  return targets;
}

async function getConfigFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/config.toml`;
}

async function getHooksDir(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/hooks`;
}

async function getHooksFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/hooks.json`;
}

function isHookMatcherGroup(value: unknown): value is HookMatcherGroup {
  return !!value && typeof value === "object" && Array.isArray((value as { hooks?: unknown }).hooks);
}

function isMatchingCodexHookHandler(value: unknown, command: string): boolean {
  if (!value || typeof value !== "object") return false;
  const handler = value as { command?: unknown; type?: unknown };
  return handler.command === command && handler.type === "command";
}

function safeParseJson(text: string): CodexSettings {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function syncCodexHookInstall(host: InstallHost, scriptPath: string): Promise<boolean> {
  const resolver = await buildHostResolver(host);
  const command = buildCodexHookCommand(scriptPath, resolver);
  if (!command) return false;

  await host.mkdir(await getHooksDir(host), { recursive: true });

  const currentScript = await host.readFile(scriptPath);
  if (currentScript !== HOOK_CONTENT) {
    await host.writeFile(scriptPath, HOOK_CONTENT, { mode: 0o755 });
    log(
      "hooks",
      `codex: ${currentScript === null ? "installed" : "updated"} hook script on ${host.hostId} at ${scriptPath}`,
    );
  }

  const hooksFile = await getHooksFile(host);
  const currentHooksText = await host.readFile(hooksFile);
  const currentSettings: CodexSettings = currentHooksText ? safeParseJson(currentHooksText) : {};
  const nextSettings = upsertCodexHookSettings(currentSettings, command);
  const nextHooksText = JSON.stringify(nextSettings, null, 2);
  if (currentHooksText !== nextHooksText) {
    await host.writeFile(hooksFile, nextHooksText);
    log(
      "hooks",
      `codex: ${currentHooksText === null ? "installed" : "updated"} hooks.json on ${host.hostId} at ${hooksFile}`,
    );
  }

  const configFile = await getConfigFile(host);
  const currentConfigText = (await host.readFile(configFile)) ?? "";
  const withFeature = ensureCodexHooksFeature(currentConfigText);
  const nextConfigText = ensureCodexHooksTrust(withFeature, hooksFile, command, nextSettings);
  if (currentConfigText !== nextConfigText) {
    await host.writeFile(configFile, nextConfigText);
    log("hooks", `codex: updated config.toml on ${host.hostId} at ${configFile}`);
  }

  return true;
}
