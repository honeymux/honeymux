import type { Dispatch, SetStateAction } from "react";

import { useCallback, useEffect, useState } from "react";

import type { AgentBinaryDetectionApi, AgentType } from "./use-agent-binary-detection.ts";

import { acknowledgeIndexingInfo, getAcknowledgedIndexingInfos, historyIndex } from "../../agents/history-search.ts";
import { dismissNotice, isNoticeDismissed } from "../../util/notices.ts";

interface InfoItem {
  id: string;
  message: string | string[];
}

type InfoNotificationItem = Extract<NotificationItem, { kind: "info" }>;

type NotificationItem =
  | { agent: AgentType; kind: "agent" }
  | { id: string; kind: "info"; message: string | string[] }
  | { kind: "ssh"; server: string };

const ROOT_TINT_NOTICE_ID = "root-tint-intro";

interface NotificationsReviewApi {
  addInfo: (id: string, message: string | string[]) => void;
  clearSshErrors: () => void;
  dialogReview: {
    close: () => void;
    dismissCurrentInfo: () => void;
    infoDialogPending: boolean;
    open: boolean;
  };
  dialogSshError: {
    dismiss: () => void;
    dismissPermanently: () => void;
    server: null | string;
  };
  handleNotificationsClick: () => void;
  handleSshServerStatusChange: (serverName: string, status: string, error?: string) => void;
  infoCount: number;
  infoDialogPending: boolean;
  overlayReview: {
    index: number;
    onClose: () => void;
    onDismissInfo: (id: string) => void;
    open: boolean;
    queue: NotificationItem[];
    total: number;
  };
  overlaySshError: {
    error: null | string;
    errorAt: number;
    onDismiss: () => void;
    server: null | string;
  };
  sshErrorDialogServer: null | string;
  warningCount: number;
}

interface UseNotificationsReviewOptions {
  agentDetection: AgentBinaryDetectionApi;
  claudeDialogPending: boolean;
  codexDialogPending: boolean;
  geminiDialogPending: boolean;
  historyReady: boolean;
  openCodeDialogPending: boolean;
  rootPanesDetected: boolean;
  setClaudeDialogPending: Dispatch<SetStateAction<boolean>>;
  setCodexDialogPending: Dispatch<SetStateAction<boolean>>;
  setGeminiDialogPending: Dispatch<SetStateAction<boolean>>;
  setOpenCodeDialogPending: Dispatch<SetStateAction<boolean>>;
}

const HISTORY_INDEXING_AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function buildHistoryIndexingInfoItems(
  agentCounts: Record<string, number>,
  acknowledgedIds: Set<string>,
): InfoNotificationItem[] {
  const items: InfoNotificationItem[] = [];
  for (const [agent, count] of Object.entries(agentCounts)) {
    const id = `history-indexing-${agent}`;
    if (acknowledgedIds.has(id)) continue;
    const label = HISTORY_INDEXING_AGENT_LABELS[agent] ?? agent;
    items.push({
      id,
      kind: "info",
      message: `Completed indexing ${count} conversation${count !== 1 ? "s" : ""} for ${label}`,
    });
  }
  return items;
}

export function buildNotificationsQueue(
  sshErrors: Map<string, { at: number; message: string }>,
  deferredAgents: AgentType[],
  infoItems: InfoItem[],
): NotificationItem[] {
  return [
    ...[...sshErrors.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .map(([server]): NotificationItem => ({ kind: "ssh", server })),
    ...deferredAgents.map((agent): NotificationItem => ({ agent, kind: "agent" })),
    ...infoItems.map((item): NotificationItem => ({ id: item.id, kind: "info", message: item.message })),
  ];
}

export function useNotificationsReview({
  agentDetection,
  claudeDialogPending,
  codexDialogPending,
  geminiDialogPending,
  historyReady,
  openCodeDialogPending,
  rootPanesDetected,
  setClaudeDialogPending,
  setCodexDialogPending,
  setGeminiDialogPending,
  setOpenCodeDialogPending,
}: UseNotificationsReviewOptions): NotificationsReviewApi {
  const [infoItems, setInfoItems] = useState<InfoItem[]>([]);
  const [sshErrors, setSshErrors] = useState<Map<string, { at: number; message: string }>>(new Map());
  const [sshErrorDialogServer, setSshErrorDialogServer] = useState<null | string>(null);
  const [infoDialogPending, setInfoDialogPending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewQueue, setReviewQueue] = useState<NotificationItem[]>([]);

  const dismissInfo = useCallback((id: string) => {
    setInfoItems((previous) => previous.filter((item) => item.id !== id));
    setInfoDialogPending(false);
    if (id.startsWith("history-indexing-")) acknowledgeIndexingInfo(id);
    if (id === ROOT_TINT_NOTICE_ID) dismissNotice(id);
  }, []);

  const addInfo = useCallback((id: string, message: string | string[]) => {
    setInfoItems((previous) => {
      if (previous.some((item) => item.id === id)) return previous;
      return [...previous, { id, message }];
    });
  }, []);

  const closeReview = useCallback(() => {
    setReviewOpen(false);
    setInfoDialogPending(false);
    setSshErrorDialogServer(null);
    setClaudeDialogPending(false);
    setOpenCodeDialogPending(false);
    setGeminiDialogPending(false);
    setCodexDialogPending(false);
  }, [setClaudeDialogPending, setCodexDialogPending, setGeminiDialogPending, setOpenCodeDialogPending]);

  const openReviewItem = useCallback(
    (item: NotificationItem) => {
      if (item.kind === "ssh") {
        setSshErrorDialogServer(item.server);
        setInfoDialogPending(false);
        return;
      }
      if (item.kind === "agent") {
        setSshErrorDialogServer(null);
        setInfoDialogPending(false);
        agentDetection.openDeferredDialog(item.agent);
        return;
      }
      setSshErrorDialogServer(null);
      setInfoDialogPending(true);
    },
    [agentDetection],
  );

  const dismissCurrentInfo = useCallback(() => {
    const item = reviewQueue[reviewIndex];
    if (item?.kind === "info") dismissInfo(item.id);
  }, [dismissInfo, reviewIndex, reviewQueue]);

  const handleNotificationsClick = useCallback(() => {
    if (reviewOpen) {
      closeReview();
      return;
    }
    const queue = buildNotificationsQueue(sshErrors, agentDetection.deferredAgents, infoItems);
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setReviewIndex(0);
    setReviewOpen(true);
    openReviewItem(queue[0]!);
  }, [agentDetection.deferredAgents, closeReview, infoItems, openReviewItem, reviewOpen, sshErrors]);

  const handleSshServerStatusChange = useCallback((serverName: string, status: string, error?: string) => {
    setSshErrors((previous) => {
      if (status === "error") {
        const next = new Map(previous);
        next.set(serverName, { at: Date.now(), message: error ?? "Unknown error" });
        return next;
      }
      if (status === "connected" && previous.has(serverName)) {
        const next = new Map(previous);
        next.delete(serverName);
        return next;
      }
      return previous;
    });

    if (status === "connected") {
      setSshErrorDialogServer((previous) => (previous === serverName ? null : previous));
    }
  }, []);

  const clearSshErrors = useCallback(() => {
    setSshErrors(new Map());
    setSshErrorDialogServer(null);
  }, []);

  const dismissSshErrorDialog = useCallback(() => {
    setSshErrorDialogServer(null);
  }, []);

  const dismissSshErrorDialogPermanently = useCallback(() => {
    setSshErrors((previous) => {
      if (!sshErrorDialogServer) return previous;
      const next = new Map(previous);
      next.delete(sshErrorDialogServer);
      return next;
    });
    setSshErrorDialogServer(null);
  }, [sshErrorDialogServer]);

  useEffect(() => {
    if (!reviewOpen) return;
    const anyDialogOpen =
      claudeDialogPending ||
      openCodeDialogPending ||
      geminiDialogPending ||
      codexDialogPending ||
      infoDialogPending ||
      sshErrorDialogServer !== null;
    if (anyDialogOpen) return;

    const nextIndex = reviewIndex + 1;
    if (nextIndex < reviewQueue.length) {
      setReviewIndex(nextIndex);
      openReviewItem(reviewQueue[nextIndex]!);
      return;
    }
    setReviewOpen(false);
  }, [
    claudeDialogPending,
    codexDialogPending,
    geminiDialogPending,
    infoDialogPending,
    openCodeDialogPending,
    openReviewItem,
    reviewIndex,
    reviewOpen,
    reviewQueue,
    sshErrorDialogServer,
  ]);

  useEffect(() => {
    if (!historyReady) return;
    const acknowledgedIds = getAcknowledgedIndexingInfos();
    for (const item of buildHistoryIndexingInfoItems(historyIndex.agentCounts, acknowledgedIds)) {
      addInfo(item.id, item.message);
    }
  }, [addInfo, historyReady]);

  useEffect(() => {
    if (!rootPanesDetected) return;
    if (isNoticeDismissed(ROOT_TINT_NOTICE_ID)) return;
    addInfo(ROOT_TINT_NOTICE_ID, [
      "A foreground process running in one or more",
      "panes was detected as running with elevated",
      "privileges.",
      "",
      "By default, privileged panes are tinted red",
      "to help you maintain awareness. This can be",
      "disabled in the appearance options.",
    ]);
  }, [addInfo, rootPanesDetected]);

  const warningCount = agentDetection.deferredAgents.length + sshErrors.size;
  const infoCount = infoItems.length;
  const activeSshError = sshErrorDialogServer ? (sshErrors.get(sshErrorDialogServer) ?? null) : null;

  return {
    addInfo,
    clearSshErrors,
    dialogReview: {
      close: closeReview,
      dismissCurrentInfo,
      infoDialogPending,
      open: reviewOpen,
    },
    dialogSshError: {
      dismiss: dismissSshErrorDialog,
      dismissPermanently: dismissSshErrorDialogPermanently,
      server: sshErrorDialogServer,
    },
    handleNotificationsClick,
    handleSshServerStatusChange,
    infoCount,
    infoDialogPending,
    overlayReview: {
      index: reviewIndex,
      onClose: closeReview,
      onDismissInfo: dismissInfo,
      open: reviewOpen,
      queue: reviewQueue,
      total: reviewQueue.length,
    },
    overlaySshError: {
      error: activeSshError?.message ?? null,
      errorAt: activeSshError?.at ?? 0,
      onDismiss: dismissSshErrorDialogPermanently,
      server: sshErrorDialogServer,
    },
    sshErrorDialogServer,
    warningCount,
  };
}
