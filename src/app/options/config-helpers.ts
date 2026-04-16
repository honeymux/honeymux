import type { HoneymuxConfig } from "../../util/config.ts";
import type { RemoteServer } from "./model.ts";

export function configRemoteServersToDraft(config: HoneymuxConfig): RemoteServer[] {
  return (
    config.remote?.map((server) => ({
      agentForwarding: server.agentForwarding,
      host: server.host,
      name: server.name,
    })) ?? []
  );
}
