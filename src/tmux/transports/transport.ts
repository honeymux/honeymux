export type ControlModeStatus = "connected" | "connecting" | "disconnected" | "error" | "idle";

export interface ControlModeTransport {
  onData(handler: (chunk: Uint8Array) => void): () => void;
  onExit(handler: () => void): () => void;
  onStatusChange(handler: (status: ControlModeStatus, error?: string) => void): () => void;
  start(tmuxArgs: ReadonlyArray<string>): Promise<void>;
  readonly status: ControlModeStatus;
  stop(): void;
  write(bytes: Uint8Array | string): void;
}
