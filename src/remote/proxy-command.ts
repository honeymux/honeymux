const BUNDLED_ENTRY_PREFIX = "/$bunfs/";
const INTERNAL_REMOTE_PROXY_FLAG = "--internal-remote-proxy";

interface RemoteProxyProcessRuntime {
  execPath: string;
  mainPath: string;
}

export function buildRemoteProxyProcessArgv(
  localPaneId: string,
  proxyToken: string,
  runtime: RemoteProxyProcessRuntime = currentRemoteProxyProcessRuntime(),
): string[] {
  if (isBundledEntryPath(runtime.mainPath)) {
    return [runtime.execPath, INTERNAL_REMOTE_PROXY_FLAG, localPaneId, proxyToken];
  }

  return [runtime.execPath, runtime.mainPath, INTERNAL_REMOTE_PROXY_FLAG, localPaneId, proxyToken];
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
  };
}
