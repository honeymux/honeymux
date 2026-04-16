import type { MutableRefObject } from "react";

import { useMemo } from "react";

import type { AgentProviderRegistry } from "../../agents/provider.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { TmuxPaneAgentProps, TmuxPaneSharedProps } from "./types.ts";

export interface TmuxPaneAgentsDialogProps {
  agentNavNextRef?: MutableRefObject<(() => void) | null>;
  agentNavPrevRef?: MutableRefObject<(() => void) | null>;
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  height: number;
  onClose: () => void;
  onSelect: (session: AgentSession) => void;
  registryRef?: MutableRefObject<AgentProviderRegistry | null>;
  sessions: AgentSession[];
  width: number;
}

interface UsePaneAgentsDialogOptions {
  agentNavNextRef?: MutableRefObject<(() => void) | null>;
  agentNavPrevRef?: MutableRefObject<(() => void) | null>;
  agentSessionsForDialog: TmuxPaneAgentProps["agentSessionsForDialog"];
  agentsDialogOpen: TmuxPaneAgentProps["agentsDialogOpen"];
  dropdownInputRef: TmuxPaneSharedProps["dropdownInputRef"];
  height: number;
  onAgentsDialogClose: TmuxPaneAgentProps["onAgentsDialogClose"];
  onAgentsDialogSelect: TmuxPaneAgentProps["onAgentsDialogSelect"];
  onGoToPane: TmuxPaneAgentProps["onGoToPane"];
  onPermissionRespond: TmuxPaneAgentProps["onPermissionRespond"];
  registryRef: TmuxPaneAgentProps["registryRef"];
  uiMode: TmuxPaneSharedProps["uiMode"];
  width: number;
}

export function buildAgentsDialogProps({
  agentNavNextRef,
  agentNavPrevRef,
  agentSessionsForDialog,
  agentsDialogOpen,
  dropdownInputRef,
  height,
  onAgentsDialogClose,
  onAgentsDialogSelect,
  registryRef,
  width,
}: {
  agentNavNextRef?: MutableRefObject<(() => void) | null>;
  agentNavPrevRef?: MutableRefObject<(() => void) | null>;
  agentSessionsForDialog: TmuxPaneAgentProps["agentSessionsForDialog"];
  agentsDialogOpen: TmuxPaneAgentProps["agentsDialogOpen"];
  dropdownInputRef: TmuxPaneSharedProps["dropdownInputRef"];
  height: number;
  onAgentsDialogClose: TmuxPaneAgentProps["onAgentsDialogClose"];
  onAgentsDialogSelect: TmuxPaneAgentProps["onAgentsDialogSelect"];
  registryRef: TmuxPaneAgentProps["registryRef"];
  width: number;
}): TmuxPaneAgentsDialogProps | null {
  if (
    !agentsDialogOpen ||
    agentSessionsForDialog == null ||
    !onAgentsDialogSelect ||
    !onAgentsDialogClose ||
    !dropdownInputRef
  ) {
    return null;
  }
  return {
    agentNavNextRef,
    agentNavPrevRef,
    dropdownInputRef,
    height,
    onClose: onAgentsDialogClose,
    onSelect: onAgentsDialogSelect,
    registryRef,
    sessions: agentSessionsForDialog,
    width,
  };
}

export function usePaneAgentsDialog({
  agentNavNextRef,
  agentNavPrevRef,
  agentSessionsForDialog,
  agentsDialogOpen,
  dropdownInputRef,
  height,
  onAgentsDialogClose,
  onAgentsDialogSelect,
  registryRef,
  width,
}: UsePaneAgentsDialogOptions): TmuxPaneAgentsDialogProps | null {
  return useMemo(
    () =>
      buildAgentsDialogProps({
        agentNavNextRef,
        agentNavPrevRef,
        agentSessionsForDialog,
        agentsDialogOpen,
        dropdownInputRef,
        height,
        onAgentsDialogClose,
        onAgentsDialogSelect,
        registryRef,
        width,
      }),
    [
      agentsDialogOpen,
      agentSessionsForDialog,
      onAgentsDialogSelect,
      onAgentsDialogClose,
      dropdownInputRef,
      width,
      height,
      registryRef,
      agentNavNextRef,
      agentNavPrevRef,
    ],
  );
}
