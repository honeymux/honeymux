import { mkdirSync, readFileSync } from "node:fs";

import type { LayoutProfile } from "../../tmux/types.ts";
import type { PaneTab, PaneTabGroup } from "../pane-tabs/types.ts";

import { getTmuxServer } from "../../util/tmux-server.ts";

const STATE_DIR = `${process.env.HOME}/.local/state/honeymux`;
const STATE_FILE = `${STATE_DIR}/last-session`;
const LAYOUT_PROFILES_FILE = `${STATE_DIR}/layout-profiles.json`;

export async function loadLayoutProfiles(): Promise<LayoutProfile[]> {
  try {
    const text = await Bun.file(LAYOUT_PROFILES_FILE).text();
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function saveLastSession(name: string): Promise<void> {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(STATE_FILE, JSON.stringify({ server: getTmuxServer(), session: name }));
  } catch {
    // best-effort
  }
}

export async function saveLayoutProfiles(profiles: LayoutProfile[]): Promise<void> {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(LAYOUT_PROFILES_FILE, JSON.stringify(profiles, null, 2));
  } catch {
    // best-effort
  }
}

// ── UI state persistence ────────────────────────────────────────────

const UI_STATE_FILE = `${STATE_DIR}/ui-state.json`;

export interface UIState {
  conversationsSearchCaseSensitive?: boolean;
  conversationsSearchRegex?: boolean;
  sidebarOpen: boolean;
  sidebarView?: "agents" | "hook-sniffer" | "server";
  sidebarWidth?: number;
  toolbarOpen: boolean;
}

export function loadUIState(): UIState | null {
  try {
    const text = readFileSync(UI_STATE_FILE, "utf-8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveUIState(partial: Partial<UIState>): Promise<void> {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const existing = loadUIState();
    const merged = { ...existing, ...partial };
    const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
    await Bun.write(UI_STATE_FILE, JSON.stringify(sorted, null, 2) + "\n");
  } catch {
    // best-effort
  }
}

// ── Pane tab state persistence ──────────────────────────────────────

export const PANE_TAB_STATE_OPTION = "@hmx-pane-tabs-v1";

export interface PaneTabPersistGroup {
  activePaneId?: string;
  explicitWindowName?: string;
  restoreAutomaticRename?: boolean;
  slotKey: string;
  tabs: PaneTab[];
}

export interface PaneTabPersistState {
  borderLines: string;
  groups: PaneTabPersistGroup[];
}

interface LegacyPaneTabPersistGroup {
  activeIndex?: unknown;
  activePaneId?: unknown;
  explicitWindowName?: unknown;
  restoreAutomaticRename?: unknown;
  slotKey?: unknown;
  tabs?: unknown;
}

interface LegacyPaneTabPersistState {
  borderLines?: unknown;
  groups?: unknown;
}

export function buildPaneTabPersistState(groups: Map<string, PaneTabGroup>, borderLines: string): PaneTabPersistState {
  return {
    borderLines,
    groups: [...groups.values()].map((group) => ({
      activePaneId: group.tabs[group.activeIndex]?.paneId,
      explicitWindowName: group.explicitWindowName,
      restoreAutomaticRename: group.restoreAutomaticRename,
      slotKey: group.slotKey,
      tabs: group.tabs.map((tab) => ({ ...tab })),
    })),
  };
}

export function parsePaneTabStateText(text: null | string): PaneTabPersistState | null {
  try {
    if (!text || text.trim().length === 0) return null;
    return normalizePaneTabState(JSON.parse(text));
  } catch {
    return null;
  }
}

export function serializePaneTabState(state: PaneTabPersistState): string {
  return JSON.stringify(state);
}

function isPaneTab(value: unknown): value is PaneTab {
  if (typeof value !== "object" || value == null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["paneId"] === "string" && typeof record["label"] === "string";
}

function normalizePaneTabState(raw: unknown): PaneTabPersistState | null {
  if (typeof raw !== "object" || raw == null) return null;
  const state = raw as LegacyPaneTabPersistState;
  const borderLines = typeof state.borderLines === "string" ? state.borderLines : "single";
  if (!Array.isArray(state.groups)) {
    return { borderLines, groups: [] };
  }

  const groups: PaneTabPersistGroup[] = [];
  for (const entry of state.groups) {
    if (typeof entry !== "object" || entry == null) continue;
    const group = entry as LegacyPaneTabPersistGroup;
    if (typeof group.slotKey !== "string" || !Array.isArray(group.tabs)) continue;
    const tabs = group.tabs.filter(isPaneTab).map((tab) => ({ ...tab }));
    if (tabs.length === 0) continue;
    const activePaneId =
      typeof group.activePaneId === "string"
        ? group.activePaneId
        : Number.isInteger(group.activeIndex)
          ? tabs[Math.max(0, Math.min(Number(group.activeIndex), tabs.length - 1))]?.paneId
          : undefined;
    const explicitWindowName =
      typeof group.explicitWindowName === "string" && group.explicitWindowName.trim().length > 0
        ? group.explicitWindowName
        : undefined;
    const restoreAutomaticRename =
      typeof group.restoreAutomaticRename === "boolean" ? group.restoreAutomaticRename : undefined;
    groups.push({ activePaneId, explicitWindowName, restoreAutomaticRename, slotKey: group.slotKey, tabs });
  }

  return { borderLines, groups };
}
