const BUNDLED_ENTRY_PREFIX = "/$bunfs/";
const INTERNAL_REMOTE_PROXY_FLAG = "--internal-remote-proxy";

interface RemoteProxyProcessRuntime {
  execPath: string;
  mainPath: string;
  proxyScriptPath: string;
}

export function buildRemoteProxyProcessArgv(
  localPaneId: string,
  proxyToken: string,
  runtime: RemoteProxyProcessRuntime = currentRemoteProxyProcessRuntime(),
): string[] {
  // Bundled: the binary embeds proxy.ts, so re-enter the binary with the flag —
  // the index.tsx CLI dispatch routes it to the proxy before any heavy work.
  if (isBundledEntryPath(runtime.mainPath)) {
    return [runtime.execPath, INTERNAL_REMOTE_PROXY_FLAG, localPaneId, proxyToken];
  }

  // From source: spawn the dedicated, JSX-free proxy entrypoint directly rather
  // than re-loading index.tsx. The app entrypoint transpiles JSX (jsxImportSource
  // @emotion/react), which Bun resolves against the spawning pane's working
  // directory — so re-entering index.tsx fails in any pane whose cwd is outside
  // this project ("Cannot find module '@emotion/react/jsx-dev-runtime'"). proxy.ts
  // pulls in no JSX/OpenTUI, so it loads identically from any cwd.
  return [runtime.execPath, runtime.proxyScriptPath, localPaneId, proxyToken];
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
    mainPath: Bun.main,
    proxyScriptPath: `${import.meta.dir}/proxy.ts`,
  };
}
