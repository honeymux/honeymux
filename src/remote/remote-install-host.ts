import type { InstallHost } from "../agents/install-host.ts";
import type { RemoteExec } from "./remote-exec.ts";

/**
 * InstallHost implementation backed by an argv-shaped remote exec seam.
 *
 * All shell invocations are built via argv arrays and passed to the exec
 * implementation, which is expected to quote them POSIX-safely. File content
 * is delivered via stdin so its bytes are never interpolated into the shell
 * line.
 *
 * The host id is the remote server name (tmux-owned, validated at config time);
 * it is used as the consent-file key on local disk.
 */
export class RemoteInstallHost implements InstallHost {
  readonly hostId: string;

  private cachedExecutables = new Map<string, null | string>();
  private cachedHome: null | string = null;

  constructor(
    serverName: string,
    private readonly exec: RemoteExec,
  ) {
    this.hostId = serverName;
  }

  async homeDir(): Promise<string> {
    if (this.cachedHome) return this.cachedHome;
    const { exitCode, stderr, stdout } = await this.exec.exec(["sh", "-c", 'printf "%s" "$HOME"']);
    if (exitCode !== 0) {
      throw new Error(`remote homeDir failed${stderr ? `: ${stderr}` : ""}`);
    }
    const home = stdout.trim();
    if (!home.startsWith("/")) {
      throw new Error(`remote homeDir returned non-absolute path: ${home || "<empty>"}`);
    }
    this.cachedHome = home;
    return home;
  }

  async mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    const argv = options.recursive ? ["mkdir", "-p", "--", path] : ["mkdir", "--", path];
    const { exitCode, stderr } = await this.exec.exec(argv);
    if (exitCode !== 0) {
      throw new Error(`remote mkdir failed: ${path}${stderr ? ` (${stderr})` : ""}`);
    }
  }

  async readFile(path: string): Promise<null | string> {
    // Use sh -c so we can surface a distinct exit code for "not found" vs other errors.
    const script = 'if [ -e "$1" ]; then cat -- "$1"; else exit 3; fi';
    const { exitCode, stdout } = await this.exec.exec(["sh", "-c", script, "sh", path]);
    if (exitCode === 3) return null;
    if (exitCode !== 0) return null;
    return stdout;
  }

  async resolveExecutable(name: string): Promise<null | string> {
    if (this.cachedExecutables.has(name)) {
      return this.cachedExecutables.get(name) ?? null;
    }
    const { exitCode, stdout } = await this.exec.exec(["sh", "-c", 'command -v -- "$1" || true', "sh", name]);
    let resolved: null | string = null;
    if (exitCode === 0) {
      const first = stdout.split("\n")[0]?.trim() ?? "";
      if (first.startsWith("/")) resolved = first;
    }
    this.cachedExecutables.set(name, resolved);
    return resolved;
  }

  async writeFile(path: string, content: string, options: { mode?: number } = {}): Promise<void> {
    // mkdir -p "$(dirname "$path")", cat > "$path" < stdin, [optional] chmod.
    // Mode is passed as a positional arg so arbitrary caller input cannot reach the script body.
    const mode = options.mode !== undefined ? options.mode.toString(8) : "";
    // `[ -z "$2" ] || chmod ...` is a no-op when mode is empty, so callers can skip chmod.
    const script = [
      "set -e",
      'mkdir -p -- "$(dirname -- "$1")"',
      'cat > "$1"',
      '[ -z "$2" ] || chmod "$2" -- "$1"',
    ].join("; ");
    const { exitCode, stderr } = await this.exec.exec(["sh", "-c", script, "sh", path, mode], {
      stdin: content,
    });
    if (exitCode !== 0) {
      throw new Error(`remote writeFile failed: ${path}${stderr ? ` (${stderr})` : ""}`);
    }
  }
}
