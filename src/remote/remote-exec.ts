/**
 * Minimal seam for running an argv-shaped command on a remote host.
 *
 * Kept as an interface so install/detection code paths stay decoupled from
 * the SSH transport and can be unit-tested with a synthetic executor.
 *
 * Implementations MUST build the remote command from the argv array using the
 * POSIX-safe helper in `./ssh.ts` and MUST NOT concatenate caller-supplied
 * strings into the shell line.
 */
export interface RemoteExec {
  exec(argv: string[], options?: RemoteExecOptions): Promise<RemoteExecResult>;
}

export interface RemoteExecOptions {
  stdin?: string;
}

export interface RemoteExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}
