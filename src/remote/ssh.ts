const CONTROL_CHAR_RE = /[\0\r\n]/;
const WHITESPACE_RE = /\s/;

export function appendSshDestination(args: string[], host: string): void {
  const error = validateSshDestination(host);
  if (error) {
    throw new Error(`Invalid SSH destination "${host}": ${error}`);
  }
  args.push("--", host);
}

export function buildRemoteShellCommand(argv: string[]): string {
  return argv.map(quotePosixShellArg).join(" ");
}

/**
 * Quote a single argument for execution by a POSIX shell on the remote host.
 * SSH's exec request carries a command string, not an argv vector.
 */
export function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function validateSshDestination(host: string): null | string {
  if (typeof host !== "string") return "must be a string";
  if (host.length === 0) return "cannot be empty";
  if (host !== host.trim()) return "cannot start or end with whitespace";
  if (CONTROL_CHAR_RE.test(host)) return "contains invalid control characters";
  if (WHITESPACE_RE.test(host)) return "cannot contain whitespace";
  if (host.startsWith("-")) return "cannot start with '-'";
  return null;
}
