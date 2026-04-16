export type RemoteConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

export interface RemotePaneMapping {
  localPaneId: string;
  remotePaneId: string;
  serverName: string;
}

export interface RemoteServerConfig {
  /** Forward local SSH agent to the remote host (default: false) */
  agentForwarding?: boolean;
  /** SSH hostname or alias from ~/.ssh/config */
  host: string;
  /** Path to identity key file */
  identityFile?: string;
  /** User-facing label, e.g. "dev-box" */
  name: string;
  /** SSH port (default: 22) */
  port?: number;
}

export interface RemoteServerState {
  config: RemoteServerConfig;
  error?: string;
  mirrorSession: string;
  status: RemoteConnectionStatus;
}
