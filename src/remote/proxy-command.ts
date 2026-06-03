import { getHoneymuxLogPath } from "../util/log.ts";

const BUNDLED_ENTRY_PREFIX = "/$bunfs/";
const INTERNAL_REMOTE_PROXY_FLAG = "--internal-remote-proxy";
// POSIX-sh supervisor wrapped around every proxy spawn. It runs the real proxy
// as a child with stderr captured to a temp file, and — only if that file is
// non-empty (i.e. the proxy actually printed an error and exited) — appends a
// tagged block to honeymux.log. This is the ONLY way to surface a proxy
// startup failure such as a module-resolution/import error: that crash happens
// before any of proxy.ts's own code (or its uncaughtException handler) runs, so
// nothing in-process can log it. A normal proxy never exits — it's killed by a
// signal on revert/convert with empty stderr — so this stays silent in the
// happy path. Single line, no single quotes, and the proxy token ($4 after the
// shift) is never printed. stdout still flows to the pane (only fd 2 is teed).
const PROXY_CRASH_CAPTURE_SH =
  'log="$1"; shift; err="${TMPDIR:-/tmp}/hmx-proxy-$$.err"; "$@" 2>"$err"; code=$?; ' +
  'if [ -s "$err" ]; then ' +
  '{ printf "%s [remote] proxy subprocess (pane %s) exited code=%s; stderr below:\\n" ' +
  '"$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3" "$code"; cat "$err"; } >>"$log" 2>/dev/null; ' +
  'fi; rm -f "$err"; exit "$code"';

interface RemoteProxyProcessRuntime {
  execPath: string;
  logPath: string;
  mainPath: string;
  proxyScriptPath: string;
}

export function buildRemoteProxyProcessArgv(
  localPaneId: string,
  proxyToken: string,
  socketPath: string,
  runtime: RemoteProxyProcessRuntime = currentRemoteProxyProcessRuntime(),
): string[] {
  // socketPath is resolved by honeymux (the listening side) and passed through
  // verbatim so the spawned proxy connects to exactly the socket honeymux bound,
  // never re-deriving it from the tmux pane's inherited environment.
  //
  // Bundled: the binary embeds proxy.ts, so re-enter the binary with the flag —
  // the index.tsx CLI dispatch routes it to the proxy before any heavy work.
  if (isBundledEntryPath(runtime.mainPath)) {
    return wrapWithCrashCapture(runtime.logPath, [
      runtime.execPath,
      INTERNAL_REMOTE_PROXY_FLAG,
      localPaneId,
      proxyToken,
      socketPath,
    ]);
  }

  // From source: spawn the dedicated, JSX-free proxy entrypoint directly rather
  // than re-loading index.tsx. The app entrypoint transpiles JSX (jsxImportSource
  // @emotion/react), which Bun resolves against the spawning pane's working
  // directory — so re-entering index.tsx fails in any pane whose cwd is outside
  // this project ("Cannot find module '@emotion/react/jsx-dev-runtime'"). proxy.ts
  // pulls in no JSX/OpenTUI, so it loads identically from any cwd.
  return wrapWithCrashCapture(runtime.logPath, [
    runtime.execPath,
    runtime.proxyScriptPath,
    localPaneId,
    proxyToken,
    socketPath,
  ]);
}

export function getInternalRemoteProxyFlag(): string {
  return INTERNAL_REMOTE_PROXY_FLAG;
}

export function isBundledEntryPath(path: string): boolean {
  return path.startsWith(BUNDLED_ENTRY_PREFIX);
}

function currentRemoteProxyProcessRuntime(): RemoteProxyProcessRuntime {
  return {
    execPath: process.execPath,
    logPath: getHoneymuxLogPath(),
    mainPath: Bun.main,
    proxyScriptPath: `${import.meta.dir}/proxy.ts`,
  };
}

function wrapWithCrashCapture(logPath: string, argv: string[]): string[] {
  return ["/bin/sh", "-c", PROXY_CRASH_CAPTURE_SH, "hmx-proxy", logPath, ...argv];
}
