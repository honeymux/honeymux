import type { TmuxKeyBindings, TmuxPaneTtyMapping, TmuxSession, TmuxWindow } from "./types.ts";

export interface TmuxActivePaneGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface TmuxActivePaneScreenshotInfo extends TmuxActivePaneGeometry {
  cwd: string;
  paneId: string;
}

export interface TmuxPaneContext {
  paneId: string;
  paneName: string;
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowName: string;
}

export interface TmuxPaneInfo extends TmuxActivePaneGeometry {
  active: boolean;
  command: string;
  id: string;
  pid: number;
  tty: string;
}

export interface TmuxSessionInfo {
  paneTabActive: Set<string>;
  paneTabMembers: Set<string>;
  paneWindowIds: Map<string, string>;
  windowNames: Map<string, string>;
  windowPanes: Map<string, number>;
}

export interface TmuxSessionSummary {
  panes: number;
  sessions: number;
  windows: number;
}

export interface TmuxStatusBarInfo {
  lines: number;
  position: "bottom" | "top";
}

export interface TmuxTreePane {
  active: boolean;
  command: string;
  cwd?: string;
  id: string;
  index: number;
  pid: number;
  remoteHost?: string;
  sessionName: string;
  title?: string;
  windowId: string;
}

export interface TmuxTreeWindow {
  active: boolean;
  id: string;
  index: number;
  name: string;
  sessionName: string;
}

export interface TmuxWindowPaneInfo {
  active: boolean;
  height: number;
  id: string;
  width: number;
}

export function parseActivePaneCwdOutput(output: string): string {
  for (const line of output.split("\n")) {
    if (!line.startsWith("1 ")) continue;
    return line.slice(2);
  }
  throw new Error("No active pane found");
}

export function parseActivePaneGeometryOutput(output: string): TmuxActivePaneGeometry {
  for (const line of output.split("\n")) {
    if (!line.startsWith("1 ")) continue;
    const parts = line.split(" ");
    return {
      height: parseInt(parts[4]!, 10),
      left: parseInt(parts[1]!, 10),
      top: parseInt(parts[2]!, 10),
      width: parseInt(parts[3]!, 10),
    };
  }
  throw new Error("No active pane found");
}

export function parseActivePaneScreenshotInfoOutput(output: string): TmuxActivePaneScreenshotInfo {
  for (const line of output.split("\n")) {
    if (!line.startsWith("1 ")) continue;
    const parts = line.split(" ");
    return {
      cwd: parts.slice(6).join(" "),
      height: parseInt(parts[5]!, 10),
      left: parseInt(parts[2]!, 10),
      paneId: parts[1]!,
      top: parseInt(parts[3]!, 10),
      width: parseInt(parts[4]!, 10),
    };
  }
  throw new Error("No active pane found");
}

export function parseAllPaneInfoOutput(output: string): TmuxPaneInfo[] {
  const panes: TmuxPaneInfo[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(" ");
    if (parts.length < 9) continue;
    panes.push({
      active: parts[7] === "1",
      command: parts[1] ?? "",
      height: parseInt(parts[6]!, 10),
      id: parts[8] ?? "",
      left: parseInt(parts[3]!, 10),
      pid: parseInt(parts[0]!, 10),
      top: parseInt(parts[4]!, 10),
      tty: parts[2] ?? "",
      width: parseInt(parts[5]!, 10),
    });
  }
  return panes;
}

export function parseFullTreeOutputs(
  sessionsOut: string,
  windowsOut: string,
  panesOut: string,
): {
  panes: TmuxTreePane[];
  sessions: TmuxSession[];
  windows: TmuxTreeWindow[];
} {
  const sessions = parseListSessionsOutput(sessionsOut);

  // Structural fields (session name, ids, index) must be non-empty: consumers
  // filter by them and an empty string silently never matches anything real.
  // Only window name is allowed empty — tmux permits unnamed windows.
  const windows: TmuxTreeWindow[] = [];
  for (const line of windowsOut.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const sessionName = parts[0];
    const id = parts[1];
    const index = Number.parseInt(parts[2] ?? "", 10);
    if (!sessionName || !id || !Number.isFinite(index)) continue;
    windows.push({
      active: parts[4] === "1",
      id,
      index,
      name: parts[3] ?? "",
      sessionName,
    });
  }

  const panes: TmuxTreePane[] = [];
  for (const line of panesOut.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const sessionName = parts[0];
    const windowId = parts[1];
    const id = parts[2];
    const index = Number.parseInt(parts[3] ?? "", 10);
    if (!sessionName || !windowId || !id || !Number.isFinite(index)) continue;
    panes.push({
      active: parts[4] === "1",
      command: parts[5] || "shell",
      cwd: parts[7] || undefined,
      id,
      index,
      pid: Number.parseInt(parts[6] ?? "", 10) || 0,
      remoteHost: parts[8] || undefined,
      sessionName,
      title: parts.slice(9).join("\t") || undefined,
      windowId,
    });
  }

  return { panes, sessions, windows };
}

export function parseKeyBindingsOutput(prefixOut: string, keysOut: string): TmuxKeyBindings {
  const rawPrefix = prefixOut.trim();
  const prefix = formatKey(rawPrefix);

  const bindings = new Map<string, string>();
  for (const line of keysOut.split("\n")) {
    const match = line.match(/^bind-key\s+-T\s+prefix\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const key = match[1]!.replace(/^\\/, "");
    const cmd = match[2]!.trim();
    if (!bindings.has(cmd)) {
      bindings.set(cmd, key);
    }
  }

  const find = (pattern: RegExp): string => {
    for (const [cmd, key] of bindings) {
      if (pattern.test(cmd)) return `${prefix} + ${formatKey(key)}`;
    }
    return "";
  };

  const selectWindow: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const key = bindings.get(`select-window -t :=${i}`);
    selectWindow.push(key ? `${prefix} + ${formatKey(key)}` : `${prefix} + ${i}`);
  }

  return {
    closePane: find(/^(?:confirm-before\s.*)?kill-pane/),
    detach: find(/^(?:confirm-before\s.*)?detach-client/),
    killWindow: find(/^(?:confirm-before\s.*)?kill-window/),
    newWindow: find(/^new-window$/),
    prefix,
    selectWindow,
    splitHorizontal: find(/^split-window\b(?!\s+-h)/),
    splitVertical: find(/^split-window\s+-h/),
  };
}

export function parseListAllPaneIdsOutput(output: string): Set<string> {
  const ids = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

export function parseListPanesInWindowOutput(output: string): TmuxWindowPaneInfo[] {
  const panes: TmuxWindowPaneInfo[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(" ");
    if (parts.length < 4) continue;
    panes.push({
      active: parts[3] === "1",
      height: parseInt(parts[2]!, 10),
      id: parts[0]!,
      width: parseInt(parts[1]!, 10),
    });
  }
  return panes;
}

export function parseListSessionsOutput(output: string): TmuxSession[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const color = parts[3] && parts[3].length > 0 ? parts[3] : undefined;
      return {
        attached: parts[2] === "1",
        color,
        id: parts[0]!,
        name: parts[1]!,
      };
    });
}

export function parseListWindowPaneIdsOutput(output: string): string[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(" ");
      return { id: parts[1]!, index: parseInt(parts[0]!, 10) };
    })
    .sort((a, b) => a.index - b.index)
    .map((pane) => pane.id);
}

export function parseListWindowsOutput(output: string): TmuxWindow[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return {
        active: parts[3] === "1",
        id: parts[0]!,
        index: parseInt(parts[1]!, 10),
        layout: parts[5]!,
        name: parts[2]!,
        paneId: parts[4]!,
      };
    });
}

export function parsePaneCommandsOutput(output: string, paneIds: string[]): Map<string, string> {
  const wanted = new Set(paneIds);
  const result = new Map<string, string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;
    const id = trimmed.substring(0, spaceIdx);
    if (wanted.has(id)) {
      result.set(id, trimmed.substring(spaceIdx + 1));
    }
  }
  return result;
}

export function parsePaneContextOutput(output: string): TmuxPaneContext {
  const line = output.trim();
  const parts = line.split("\t");
  return {
    paneId: parts[4] ?? "",
    paneName: parts.slice(5).join("\t"),
    sessionId: parts[1] ?? "",
    sessionName: parts[0] ?? "",
    windowId: parts[3] ?? "",
    windowName: parts[2] ?? "",
  };
}

export function parsePaneTtyMappingsOutput(output: string): TmuxPaneTtyMapping[] {
  const mappings: TmuxPaneTtyMapping[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 4) continue;
    const tty = parts[0];
    const paneId = parts[1];
    const sessionName = parts[2];
    const windowId = parts[3];
    if (!tty || !paneId || !sessionName || !windowId) continue;
    mappings.push({ paneId, sessionName, tty, windowId });
  }
  return mappings;
}

export function parseSessionInfoOutputs(
  sessionName: string,
  windowsOutput: string,
  panesOutput: string,
): TmuxSessionInfo {
  const windowPanes = new Map<string, number>();
  const windowNames = new Map<string, string>();
  for (const line of windowsOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [windowId, countStr, windowName = ""] = trimmed.split("\t");
    if (!windowId) continue;
    windowPanes.set(windowId, parseInt(countStr ?? "0", 10) || 0);
    windowNames.set(windowId, windowName);
  }

  const paneWindowIds = new Map<string, string>();
  const paneTabMembers = new Set<string>();
  const paneTabActive = new Set<string>();
  for (const line of panesOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [lineSessionName, paneId, windowId, member = "", active = ""] = trimmed.split("\t");
    if (lineSessionName !== sessionName) continue;
    if (paneId && windowId) paneWindowIds.set(paneId, windowId);
    if (paneId && member === "1") paneTabMembers.add(paneId);
    if (paneId && active === "1") paneTabActive.add(paneId);
  }

  return { paneTabActive, paneTabMembers, paneWindowIds, windowNames, windowPanes };
}

export function parseSessionSummaryOutputs(
  sessionsOut: string,
  windowsOut: string,
  panesOut: string,
): TmuxSessionSummary {
  return {
    panes: panesOut.split("\n").filter(Boolean).length,
    sessions: sessionsOut.split("\n").filter(Boolean).length,
    windows: windowsOut.split("\n").filter(Boolean).length,
  };
}

export function parseStatusBarInfoOutput(statusOut: string, posOut: string): TmuxStatusBarInfo | null {
  const status = statusOut.trim();
  if (status === "off") return null;
  const lines = status === "on" ? 1 : parseInt(status, 10) || 1;
  const position = posOut.trim() === "top" ? "top" : "bottom";
  return { lines, position };
}

function formatKey(key: string): string {
  if (key.startsWith("C-")) return `ctrl+${key.slice(2).toLowerCase()}`;
  if (key.startsWith("M-")) return `alt+${key.slice(2).toLowerCase()}`;
  return key.toLowerCase();
}
