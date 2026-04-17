import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Transport-agnostic filesystem surface used by the per-agent installers.
 *
 * Each installer writes its hook script + config files via these primitives
 * so the same install logic can target either the local filesystem or a
 * remote host (over SSH) without forking the installer.
 *
 * Consent/state tracking is NOT part of this interface — consent files always
 * live on local disk (they record Honeymux's knowledge of whether we've asked
 * on a given host).
 */
export interface InstallHost {
  /** Resolve the absolute home directory on this host. */
  homeDir(): Promise<string>;
  /** Stable identifier used as the consent-file key ("local" or server name). */
  readonly hostId: string;
  /** Create a directory (optionally recursively). Must succeed if it already exists. */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Read a file as UTF-8; returns null if it does not exist. */
  readFile(path: string): Promise<null | string>;
  /** Resolve an executable by name in PATH; returns null if not found. */
  resolveExecutable(name: string): Promise<null | string>;
  /** Atomically write UTF-8 content to a file; chmod afterward when mode given. */
  writeFile(path: string, content: string, options?: { mode?: number }): Promise<void>;
}

export class LocalInstallHost implements InstallHost {
  readonly hostId = "local";

  async homeDir(): Promise<string> {
    const home = process.env.HOME;
    if (!home) throw new Error("HOME environment variable is not set");
    return home;
  }

  async mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    mkdirSync(path, { recursive: options.recursive ?? false });
  }

  async readFile(path: string): Promise<null | string> {
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }

  async resolveExecutable(name: string): Promise<null | string> {
    return Bun.which(name) ?? null;
  }

  async writeFile(path: string, content: string, options: { mode?: number } = {}): Promise<void> {
    writeFileSync(path, content);
    if (options.mode !== undefined) chmodSync(path, options.mode);
  }
}

export const localInstallHost: InstallHost = new LocalInstallHost();
