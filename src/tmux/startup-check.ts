const MIN_MAJOR = 3;
const MIN_MINOR = 3;
const MIN_LABEL = "3.3";

const INSTALL_HINTS =
  "Install it with your package manager — e.g.:\n" +
  "  brew install tmux        # macOS\n" +
  "  sudo apt install tmux    # Debian/Ubuntu\n" +
  "  sudo dnf install tmux    # Fedora";

const UPGRADE_HINTS =
  "Upgrade tmux with your package manager — e.g.:\n" +
  "  brew upgrade tmux        # macOS\n" +
  "  sudo apt install tmux    # Debian/Ubuntu (may need a newer repo)\n" +
  "  sudo dnf install tmux    # Fedora";

type ResolveExecutable = (name: string) => null | string;

type SpawnVersionProcess = (tmuxPath: string) => SpawnedVersionProcess;

type SpawnedVersionProcess = {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
};

type TmuxStartupCheckResult = { message: string; ok: false } | { ok: true; version: string };

export async function checkTmuxStartupRequirements(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
  spawnVersionProcess: SpawnVersionProcess = spawnTmuxVersionProcess,
): Promise<TmuxStartupCheckResult> {
  const tmuxPath = resolveExecutable("tmux");
  if (!tmuxPath) {
    return { message: formatMissingTmuxMessage(), ok: false };
  }

  try {
    const proc = spawnVersionProcess(tmuxPath);
    const versionOutput = (proc.stdout ? await new Response(proc.stdout).text() : "").trim();
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !versionOutput) {
      return { message: formatMissingTmuxMessage(), ok: false };
    }

    if (isTmuxVersionTooOld(versionOutput)) {
      return { message: formatTooOldTmuxMessage(versionOutput), ok: false };
    }

    return { ok: true, version: versionOutput };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { message: formatMissingTmuxMessage(), ok: false };
    }

    throw error;
  }
}

function formatMissingTmuxMessage(): string {
  return "honeymux requires tmux but it doesn't appear to be installed.\n" + INSTALL_HINTS;
}

function formatTooOldTmuxMessage(versionOutput: string): string {
  return `honeymux requires tmux ${MIN_LABEL} or later but found ${versionOutput}.\n` + UPGRADE_HINTS;
}

function hasErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isTmuxVersionTooOld(versionOutput: string): boolean {
  const match = versionOutput.match(/(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  return major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR);
}

function spawnTmuxVersionProcess(tmuxPath: string): SpawnedVersionProcess {
  return Bun.spawn([tmuxPath, "-V"], { stderr: "pipe", stdout: "pipe" });
}
