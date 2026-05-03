import { getInternalRemoteProxyFlag } from "../remote/proxy-command.ts";

type CliParseResult =
  | {
      explicitServer: string | undefined;
      kind: "run";
      sessionName: string | undefined;
    }
  | { kind: "error"; message: string }
  | { kind: "help" }
  | {
      kind: "internal-remote-proxy";
      localPaneId: string;
      proxyToken: string;
    }
  | { kind: "version" };

const USAGE = [
  "Usage: hmx [options] [session]",
  "",
  "Options:",
  "  -h, --help       Show this help message",
  "  -V, --version    Show version",
  "  --server <name>  Use a specific tmux server name",
].join("\n");

export function formatUsage(): string {
  return USAGE;
}

export function parseCliArgs(args: string[]): CliParseResult {
  let explicitServer: string | undefined;
  const internalRemoteProxyFlag = getInternalRemoteProxyFlag();
  let parsingOptions = true;
  let sessionName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (parsingOptions && arg === "--") {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg === "-h") {
      return { kind: "help" };
    }

    if (parsingOptions && arg === "--help") {
      return { kind: "help" };
    }

    if (parsingOptions && (arg === "-V" || arg === "--version")) {
      return { kind: "version" };
    }

    if (parsingOptions && arg === internalRemoteProxyFlag) {
      const localPaneId = args[i + 1];
      if (localPaneId === undefined) {
        return { kind: "error", message: `honeymux: option '${internalRemoteProxyFlag}' requires a pane id` };
      }
      const proxyToken = args[i + 2];
      if (proxyToken === undefined) {
        return { kind: "error", message: `honeymux: option '${internalRemoteProxyFlag}' requires a proxy token` };
      }
      if (args[i + 3] !== undefined) {
        return { kind: "error", message: `honeymux: unexpected argument '${args[i + 3]}'` };
      }
      return { kind: "internal-remote-proxy", localPaneId, proxyToken };
    }

    if (parsingOptions && arg === "--server") {
      const nextArg = args[i + 1];
      if (nextArg === undefined) {
        return { kind: "error", message: "honeymux: option '--server' requires a value" };
      }
      explicitServer = nextArg;
      i++;
      continue;
    }

    if (parsingOptions && arg.startsWith("-")) {
      return { kind: "error", message: `honeymux: unknown option '${arg}'` };
    }

    if (sessionName !== undefined) {
      return { kind: "error", message: `honeymux: unexpected argument '${arg}'` };
    }

    sessionName = arg;
  }

  return { explicitServer, kind: "run", sessionName };
}
