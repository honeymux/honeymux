import type { AgentType, ToolPermissionInfo } from "./types.ts";

export function getToolPermissionInfo(
  agentType: AgentType,
  toolName?: string,
  toolInput?: Record<string, unknown>,
  notification?: string,
): ToolPermissionInfo {
  if (!toolInput || Object.keys(toolInput).length === 0) {
    // No tool input — use notification or generic fallback
    const fallback = notification
      ? { detail: prefixed(toolName, notification), summary: prefixed(toolName, notification) }
      : { detail: prefixed(toolName, "Permission needed"), summary: prefixed(toolName, "Permission needed") };
    // If there's no toolName either, just use the text
    if (!toolName) {
      return { detail: notification ?? "Permission needed", summary: notification ?? "Permission needed" };
    }
    return fallback;
  }

  switch (agentType) {
    case "claude":
      return claudeToolPermissionInfo(toolName, toolInput);
    case "codex":
      return codexToolPermissionInfo(toolName);
    case "gemini":
      return geminiToolPermissionInfo(toolName, toolInput);
    case "opencode":
      return openCodeToolPermissionInfo(toolName, toolInput);
    default: {
      const name = toolName ?? "";
      const text = notification ?? "Permission needed";
      return { detail: prefixed(name, text), summary: prefixed(name, text) };
    }
  }
}

function claudeToolPermissionInfo(toolName: string | undefined, input: Record<string, unknown>): ToolPermissionInfo {
  const name = toolName ?? "";
  switch (name) {
    case "Agent": {
      const desc = str(input, "description");
      const prompt = str(input, "prompt");
      return {
        detail: prefixed(name, desc ? `${desc}\n${prompt}` : prompt),
        summary: prefixed(name, desc || oneLine(prompt)),
      };
    }
    case "Bash": {
      const cmd = str(input, "command");
      const desc = str(input, "description");
      const summaryBody = desc || oneLine(cmd).split("\n")[0]!;
      return {
        detail: prefixed(name, desc ? `${desc}\n${cmd}` : cmd),
        summary: prefixed(name, summaryBody),
      };
    }
    case "Edit": {
      const fp = str(input, "file_path");
      const oldStr = str(input, "old_string");
      const newStr = str(input, "new_string");
      const diffBody = oldStr || newStr ? `\n- ${oldStr}\n+ ${newStr}` : "";
      return {
        detail: prefixed(name, fp) + diffBody,
        summary: prefixed(name, fp),
      };
    }
    case "Glob": {
      const pattern = str(input, "pattern");
      const path = str(input, "path");
      return {
        detail: prefixed(name, path ? `${pattern} in ${path}` : pattern),
        summary: prefixed(name, pattern),
      };
    }
    case "Grep": {
      const pattern = str(input, "pattern");
      const path = str(input, "path");
      const glob = str(input, "glob");
      let detail = pattern;
      if (path) detail += ` in ${path}`;
      if (glob) detail += ` [glob=${glob}]`;
      return {
        detail: prefixed(name, detail),
        summary: prefixed(name, pattern),
      };
    }
    case "Read": {
      const fp = str(input, "file_path");
      const offset = input["offset"];
      const limit = input["limit"];
      const range =
        typeof offset === "number" || typeof limit === "number"
          ? ` [${offset ?? 0}:${typeof limit === "number" ? ((offset as number) ?? 0) + limit : ""}]`
          : "";
      return {
        detail: prefixed(name, `${fp}${range}`),
        summary: prefixed(name, fp),
      };
    }
    case "WebFetch": {
      const url = str(input, "url");
      return { detail: prefixed(name, url), summary: prefixed(name, url) };
    }
    case "WebSearch": {
      const query = str(input, "query");
      return { detail: prefixed(name, query), summary: prefixed(name, query) };
    }
    case "Write": {
      const fp = str(input, "file_path");
      const content = str(input, "content");
      return {
        detail: prefixed(name, fp) + (content ? `\n${content}` : ""),
        summary: prefixed(name, fp),
      };
    }
    default: {
      // Unknown Claude tool — use description if available, otherwise first string field
      const desc = str(input, "description");
      if (desc) {
        return { detail: prefixed(name, desc), summary: prefixed(name, oneLine(desc)) };
      }
      for (const [, val] of Object.entries(input)) {
        if (typeof val === "string" && val.length > 0) {
          return { detail: prefixed(name, val), summary: prefixed(name, oneLine(val)) };
        }
      }
      return { detail: name || "Permission needed", summary: name || "Permission needed" };
    }
  }
}

function codexToolPermissionInfo(toolName: string | undefined): ToolPermissionInfo {
  const name = toolName ?? "";
  return { detail: name || "Permission needed", summary: name || "Permission needed" };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function geminiToolPermissionInfo(toolName: string | undefined, input: Record<string, unknown>): ToolPermissionInfo {
  const name = toolName ?? "";
  const command = str(input, "command");
  const title = str(input, "title");

  if (command) {
    const firstLine = command.split("\n")[0]!;
    return {
      detail: prefixed(name, command),
      summary: prefixed(name, oneLine(firstLine)),
    };
  }
  if (title) {
    return { detail: prefixed(name, title), summary: prefixed(name, title) };
  }
  return { detail: name || "Permission needed", summary: name || "Permission needed" };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/** Collapse newlines to spaces for single-line display. */
function oneLine(s: string): string {
  return s.replaceAll("\n", " ");
}

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

function openCodeToolPermissionInfo(toolName: string | undefined, input: Record<string, unknown>): ToolPermissionInfo {
  const name = toolName ?? "";
  const patterns = Array.isArray(input["patterns"]) ? (input["patterns"] as string[]) : [];
  const permission = str(input, "permission");
  const command = str(input, "command");

  if (patterns.length > 0) {
    const firstPattern = oneLine(patterns[0]!);
    return {
      detail: prefixed(name, patterns.join("\n")),
      summary: prefixed(name, firstPattern),
    };
  }
  if (command) {
    return {
      detail: prefixed(name, command),
      summary: prefixed(name, oneLine(command)),
    };
  }
  if (permission) {
    return { detail: prefixed(name, permission), summary: prefixed(name, permission) };
  }
  return { detail: name || "Permission needed", summary: name || "Permission needed" };
}

// ---------------------------------------------------------------------------
// Codex (stub — no permission hooks yet)
// ---------------------------------------------------------------------------

/** Prefix a body with `toolName: ` when toolName is non-empty. */
function prefixed(toolName: string | undefined, body: string): string {
  return toolName ? `${toolName}: ${body}` : body;
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/** Extract a string field from toolInput, returning "" if missing/non-string. */
function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v : "";
}
