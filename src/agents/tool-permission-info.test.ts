import { describe, expect, it } from "bun:test";

import { getToolPermissionInfo } from "./tool-permission-info.ts";

describe("getToolPermissionInfo", () => {
  // ---- Claude ----
  describe("claude", () => {
    it("Bash with description and command", () => {
      const info = getToolPermissionInfo("claude", "Bash", {
        command: "npm install\nnpm run build",
        description: "Install deps and build",
      });
      expect(info.summary).toBe("Bash: Install deps and build");
      expect(info.detail).toContain("npm install\nnpm run build");
      expect(info.detail).toContain("Install deps and build");
    });

    it("Bash with command only", () => {
      const info = getToolPermissionInfo("claude", "Bash", {
        command: "ls -la\necho done",
      });
      expect(info.summary).toBe("Bash: ls -la echo done");
      expect(info.detail).toBe("Bash: ls -la\necho done");
    });

    it("Write with file_path and content", () => {
      const info = getToolPermissionInfo("claude", "Write", {
        content: "import React from 'react';\nexport default function App() {}",
        file_path: "/src/app.tsx",
      });
      expect(info.summary).toBe("Write: /src/app.tsx");
      expect(info.detail).toContain("/src/app.tsx");
      expect(info.detail).toContain("import React");
    });

    it("Edit with file_path and diff", () => {
      const info = getToolPermissionInfo("claude", "Edit", {
        file_path: "/src/util.ts",
        new_string: "const x = 2;",
        old_string: "const x = 1;",
      });
      expect(info.summary).toBe("Edit: /src/util.ts");
      expect(info.detail).toContain("- const x = 1;");
      expect(info.detail).toContain("+ const x = 2;");
    });

    it("Read with file_path", () => {
      const info = getToolPermissionInfo("claude", "Read", {
        file_path: "/src/main.ts",
      });
      expect(info.summary).toBe("Read: /src/main.ts");
    });

    it("Glob with pattern and path", () => {
      const info = getToolPermissionInfo("claude", "Glob", {
        path: "/src",
        pattern: "**/*.ts",
      });
      expect(info.summary).toBe("Glob: **/*.ts");
      expect(info.detail).toBe("Glob: **/*.ts in /src");
    });

    it("Grep with pattern and glob filter", () => {
      const info = getToolPermissionInfo("claude", "Grep", {
        glob: "*.ts",
        path: "/src",
        pattern: "TODO",
      });
      expect(info.summary).toBe("Grep: TODO");
      expect(info.detail).toBe("Grep: TODO in /src [glob=*.ts]");
    });

    it("Agent with description and prompt", () => {
      const info = getToolPermissionInfo("claude", "Agent", {
        description: "Explore codebase",
        prompt: "Find all files\nthat import React",
      });
      expect(info.summary).toBe("Agent: Explore codebase");
      expect(info.detail).toContain("Explore codebase");
      expect(info.detail).toContain("Find all files\nthat import React");
    });

    it("WebFetch with url", () => {
      const info = getToolPermissionInfo("claude", "WebFetch", {
        url: "https://example.com",
      });
      expect(info.summary).toBe("WebFetch: https://example.com");
    });

    it("WebSearch with query", () => {
      const info = getToolPermissionInfo("claude", "WebSearch", {
        query: "bun test runner",
      });
      expect(info.summary).toBe("WebSearch: bun test runner");
    });

    it("unknown tool falls back to generic", () => {
      const info = getToolPermissionInfo("claude", "CustomTool", {
        data: "some value",
      });
      expect(info.summary).toBe("CustomTool: some value");
    });
  });

  // ---- Gemini ----
  describe("gemini", () => {
    it("exec with command and rootCommand", () => {
      const info = getToolPermissionInfo("gemini", "ls", {
        command: "ls -d ~/a*",
        rootCommand: "ls",
        title: "Confirm Shell Command",
        type: "exec",
      });
      expect(info.summary).toBe("ls: ls -d ~/a*");
      expect(info.detail).toBe("ls: ls -d ~/a*");
    });

    it("multi-line command", () => {
      const info = getToolPermissionInfo("gemini", "bash", {
        command: "#!/bin/bash\necho hello\necho world",
      });
      expect(info.summary).toBe("bash: #!/bin/bash");
      expect(info.detail).toContain("echo hello\necho world");
    });

    it("title only (no command)", () => {
      const info = getToolPermissionInfo("gemini", "tool", {
        title: "Confirm Action",
      });
      expect(info.summary).toBe("tool: Confirm Action");
    });

    it("empty input", () => {
      const info = getToolPermissionInfo("gemini", "tool", {});
      expect(info.summary).toBe("tool: Permission needed");
    });
  });

  // ---- OpenCode ----
  describe("opencode", () => {
    it("patterns array", () => {
      const info = getToolPermissionInfo("opencode", "bash", {
        command: "npm install",
        patterns: ["npm install", "npm run build"],
        permission: "shell",
        tool: "bash",
      });
      expect(info.summary).toBe("bash: npm install");
      expect(info.detail).toBe("bash: npm install\nnpm run build");
    });

    it("single pattern", () => {
      const info = getToolPermissionInfo("opencode", "write", {
        command: "/src/app.tsx",
        patterns: ["/src/app.tsx"],
        permission: "file.write",
      });
      expect(info.summary).toBe("write: /src/app.tsx");
    });

    it("empty patterns falls back to command", () => {
      const info = getToolPermissionInfo("opencode", "tool", {
        command: "some-cmd",
        patterns: [],
      });
      expect(info.summary).toBe("tool: some-cmd");
    });

    it("no patterns or command falls back to permission", () => {
      const info = getToolPermissionInfo("opencode", "tool", {
        patterns: [],
        permission: "file.read",
      });
      expect(info.summary).toBe("tool: file.read");
    });
  });

  // ---- Codex ----
  describe("codex", () => {
    it("empty input returns Permission needed", () => {
      const info = getToolPermissionInfo("codex", undefined, {});
      expect(info.summary).toBe("Permission needed");
      expect(info.detail).toBe("Permission needed");
    });

    it("tool name only", () => {
      const info = getToolPermissionInfo("codex", "Bash", {});
      expect(info.summary).toBe("Bash: Permission needed");
    });

    it("Bash with command only", () => {
      const info = getToolPermissionInfo("codex", "Bash", {
        command: "rm -f /tmp/example",
      });
      expect(info.summary).toBe("Bash: rm -f /tmp/example");
      expect(info.detail).toBe("Bash: rm -f /tmp/example");
    });

    it("Bash with description leads summary", () => {
      const info = getToolPermissionInfo("codex", "Bash", {
        command: "cp /tmp/src.json /Users/alice/export/src.json",
        description: "Need to copy a generated file outside the workspace",
      });
      expect(info.summary).toBe("Bash: Need to copy a generated file outside the workspace");
      expect(info.detail).toContain("Need to copy a generated file outside the workspace");
      expect(info.detail).toContain("cp /tmp/src.json /Users/alice/export/src.json");
    });

    it("multi-line Bash command collapses first line for summary", () => {
      const info = getToolPermissionInfo("codex", "Bash", {
        command: "set -e\nnpm install\nnpm run build",
      });
      expect(info.summary).toBe("Bash: set -e");
      expect(info.detail).toContain("npm install");
      expect(info.detail).toContain("npm run build");
    });

    it("network approval uses synthetic description", () => {
      const info = getToolPermissionInfo("codex", "Bash", {
        command: "curl http://codex-network-test.invalid",
        description: "network-access http://codex-network-test.invalid",
      });
      expect(info.summary).toBe("Bash: network-access http://codex-network-test.invalid");
    });
  });

  // ---- Edge cases ----
  describe("edge cases", () => {
    it("undefined toolInput with notification", () => {
      const info = getToolPermissionInfo("claude", "Bash", undefined, "Wants to run a command");
      expect(info.summary).toBe("Bash: Wants to run a command");
      expect(info.detail).toBe("Bash: Wants to run a command");
    });

    it("undefined toolInput and no notification", () => {
      const info = getToolPermissionInfo("claude", "Bash", undefined);
      expect(info.summary).toBe("Bash: Permission needed");
    });

    it("no toolName and no toolInput", () => {
      const info = getToolPermissionInfo("claude", undefined, undefined);
      expect(info.summary).toBe("Permission needed");
    });

    it("unknown agent type uses notification or Permission needed", () => {
      const info = getToolPermissionInfo("aider" as any, "tool", {
        command: "do-something",
      });
      expect(info.summary).toBe("tool: Permission needed");

      const info2 = getToolPermissionInfo("aider" as any, "tool", {}, "Wants to run a command");
      expect(info2.summary).toBe("tool: Wants to run a command");
    });
  });
});
