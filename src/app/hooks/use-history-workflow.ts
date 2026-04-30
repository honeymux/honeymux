import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HistoryQueryResult } from "../../agents/history-search.ts";
import type { LineEditState } from "../dialogs/line-edit.ts";

import { hasHistoryConsent, historyIndex, saveHistoryConsent } from "../../agents/history-search.ts";
import { log } from "../../util/log.ts";
import { loadUIState, saveUIState } from "../services/session-persistence.ts";

export const CONVERSATIONS_PAGE_SIZE = 50;
export const CONVERSATIONS_MENU_ITEM_COUNT = 2;

const EMPTY_HISTORY_QUERY_RESULT: HistoryQueryResult = {
  hasMore: false,
  results: [],
  total: 0,
};

export interface ConversationsAbsoluteIndexView {
  loadedCount: number;
  offset: number;
  resultIndex: number;
}

export interface HistoryWorkflowApi {
  closeConversationsDialog: () => void;
  closeConversationsMenu: () => void;
  consentDialogSelected: "allow" | "deny";
  conversationsCursor: number;
  conversationsDialogOpen: boolean;
  conversationsLoadedCount: number;
  conversationsMenuIndex: number;
  conversationsMenuOpen: boolean;
  conversationsPageOffset: number;
  conversationsQuery: string;
  conversationsResultIndex: number;
  conversationsResults: HistoryQueryResult;
  conversationsSearchCaseSensitive: boolean;
  conversationsSearchRegex: boolean;
  goToConversationsAbsoluteIndex: (index: number) => void;
  handleConsentAllow: () => Promise<void>;
  handleConsentDeny: () => Promise<void>;
  handleOpenConversationsRef: MutableRefObject<() => void>;
  historyConsent: boolean | null;
  historyConsentDialogOpen: boolean;
  historyConsentRef: MutableRefObject<boolean | null>;
  historyLoadStartedRef: MutableRefObject<boolean>;
  historyReady: boolean;
  jumpToNewestConversationsPage: () => void;
  jumpToOldestConversationsPage: () => void;
  loadMoreConversations: () => void;
  openConversationsMenu: () => void;
  resetConversationsPagination: () => void;
  setConsentDialogSelected: Dispatch<SetStateAction<"allow" | "deny">>;
  setConversationsDialogOpen: Dispatch<SetStateAction<boolean>>;
  setConversationsLineEdit: Dispatch<SetStateAction<LineEditState>>;
  setConversationsMenuIndex: Dispatch<SetStateAction<number>>;
  setConversationsResultIndex: Dispatch<SetStateAction<number>>;
  setHistoryConsent: Dispatch<SetStateAction<boolean | null>>;
  setHistoryConsentDialogOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryReady: Dispatch<SetStateAction<boolean>>;
  showNewerConversationsPage: () => void;
  showOlderConversationsPage: () => void;
  toggleConversationsMenu: () => void;
  toggleConversationsSearchCaseSensitive: () => void;
  toggleConversationsSearchRegex: () => void;
}

interface UseHistoryWorkflowOptions {
  setAgentsDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export function getConversationsViewForAbsoluteIndex(
  absoluteIndex: number,
  total: number,
  pageSize = CONVERSATIONS_PAGE_SIZE,
): ConversationsAbsoluteIndexView {
  if (total <= 0) {
    return {
      loadedCount: pageSize,
      offset: 0,
      resultIndex: 0,
    };
  }

  const clampedIndex = Math.max(0, Math.min(total - 1, absoluteIndex));
  const offset = Math.floor(clampedIndex / pageSize) * pageSize;

  return {
    loadedCount: pageSize,
    offset,
    resultIndex: clampedIndex - offset,
  };
}

export function getOldestConversationsPageOffset(total: number, pageSize = CONVERSATIONS_PAGE_SIZE): number {
  if (total <= 0) return 0;
  return Math.floor((total - 1) / pageSize) * pageSize;
}

export function useHistoryWorkflow({ setAgentsDialogOpen }: UseHistoryWorkflowOptions): HistoryWorkflowApi {
  const [historyReady, setHistoryReady] = useState(false);

  // null = never asked, true = granted, false = denied
  const [historyConsent, setHistoryConsent] = useState<boolean | null>(() => hasHistoryConsent());
  const [historyConsentDialogOpen, setHistoryConsentDialogOpen] = useState(false);
  const [consentDialogSelected, setConsentDialogSelected] = useState<"allow" | "deny">("allow");

  const [conversationsDialogOpen, setConversationsDialogOpen] = useState(false);
  // Cursor and query share one state object so the dispatch handler can apply
  // edits via a functional updater. Keeping them in separate `useState` slots
  // would let rapid keystrokes (e.g. fast typing or pasted bursts) read a
  // stale closure snapshot before React commits the prior update, dropping
  // characters whenever two events arrived within a single render window.
  const [conversationsLineEdit, setConversationsLineEdit] = useState<LineEditState>({ cursor: 0, query: "" });
  const { cursor: conversationsCursor, query: conversationsQuery } = conversationsLineEdit;
  const [conversationsMenuOpen, setConversationsMenuOpen] = useState(false);
  const [conversationsMenuIndex, setConversationsMenuIndex] = useState(0);
  const [conversationsSearchCaseSensitive, setConversationsSearchCaseSensitive] = useState(
    () => loadUIState()?.conversationsSearchCaseSensitive ?? false,
  );
  const [conversationsSearchRegex, setConversationsSearchRegex] = useState(
    () => loadUIState()?.conversationsSearchRegex ?? false,
  );
  const [conversationsPageOffset, setConversationsPageOffset] = useState(0);
  const [conversationsResultIndex, setConversationsResultIndex] = useState(0);
  const [conversationsLoadedCount, setConversationsLoadedCount] = useState(CONVERSATIONS_PAGE_SIZE);
  const [indexUpdateCount, setIndexUpdateCount] = useState(0);

  const historyConsentRef = useRef<boolean | null>(null);
  historyConsentRef.current = historyConsent;

  const historyLoadStartedRef = useRef(false);

  const resetConversationsPagination = useCallback(() => {
    setConversationsPageOffset(0);
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
    setConversationsResultIndex(0);
  }, []);

  const loadMoreConversations = useCallback(() => {
    setConversationsLoadedCount((count) => count + CONVERSATIONS_PAGE_SIZE);
  }, []);

  const openConversationsMenu = useCallback(() => {
    setConversationsMenuIndex(0);
    setConversationsMenuOpen(true);
  }, []);

  const closeConversationsMenu = useCallback(() => {
    setConversationsMenuOpen(false);
    setConversationsMenuIndex(0);
  }, []);

  const toggleConversationsMenu = useCallback(() => {
    const nextOpen = !conversationsMenuOpen;
    setConversationsMenuOpen(nextOpen);
    if (nextOpen) {
      setConversationsMenuIndex(0);
    }
  }, [conversationsMenuOpen]);

  const toggleConversationsSearchCaseSensitive = useCallback(() => {
    setConversationsSearchCaseSensitive((current) => {
      const next = !current;
      void saveUIState({ conversationsSearchCaseSensitive: next });
      return next;
    });
    resetConversationsPagination();
  }, [resetConversationsPagination]);

  const toggleConversationsSearchRegex = useCallback(() => {
    setConversationsSearchRegex((current) => {
      const next = !current;
      void saveUIState({ conversationsSearchRegex: next });
      return next;
    });
    resetConversationsPagination();
  }, [resetConversationsPagination]);

  const conversationsResults = useMemo(
    () =>
      historyConsent === true && historyReady
        ? historyIndex.querySessions(conversationsQuery, {
            caseSensitive: conversationsSearchCaseSensitive,
            limit: conversationsLoadedCount,
            offset: conversationsPageOffset,
            regex: conversationsSearchRegex,
          })
        : EMPTY_HISTORY_QUERY_RESULT,
    [
      conversationsLoadedCount,
      conversationsPageOffset,
      conversationsQuery,
      conversationsSearchCaseSensitive,
      conversationsSearchRegex,
      historyConsent,
      historyReady,
      indexUpdateCount,
    ],
  );

  const jumpToNewestConversationsPage = useCallback(() => {
    setConversationsPageOffset(0);
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
  }, []);

  const jumpToOldestConversationsPage = useCallback(() => {
    const oldestPageOffset = getOldestConversationsPageOffset(conversationsResults.total);
    setConversationsPageOffset(oldestPageOffset);
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
  }, [conversationsResults.total]);

  const showNewerConversationsPage = useCallback(() => {
    setConversationsPageOffset((offset) => Math.max(0, offset - CONVERSATIONS_PAGE_SIZE));
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
  }, []);

  const showOlderConversationsPage = useCallback(() => {
    const oldestPageOffset = getOldestConversationsPageOffset(conversationsResults.total);
    setConversationsPageOffset((offset) => Math.min(oldestPageOffset, offset + CONVERSATIONS_PAGE_SIZE));
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
  }, [conversationsResults.total]);

  const goToConversationsAbsoluteIndex = useCallback(
    (absoluteIndex: number) => {
      const view = getConversationsViewForAbsoluteIndex(absoluteIndex, conversationsResults.total);
      setConversationsPageOffset(view.offset);
      setConversationsLoadedCount(view.loadedCount);
      setConversationsResultIndex(view.resultIndex);
    },
    [conversationsResults.total],
  );

  const closeConversationsDialog = useCallback(() => {
    setConversationsDialogOpen(false);
    setConversationsLineEdit({ cursor: 0, query: "" });
    setConversationsMenuOpen(false);
    setConversationsMenuIndex(0);
    setConversationsPageOffset(0);
    setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
    setConversationsResultIndex(0);
  }, []);

  useEffect(() => {
    const lastIndex = conversationsResults.results.length - 1;
    if (lastIndex < 0 && conversationsResultIndex !== 0) {
      setConversationsResultIndex(0);
      return;
    }
    if (lastIndex >= 0 && conversationsResultIndex > lastIndex) {
      setConversationsResultIndex(lastIndex);
    }
  }, [conversationsResultIndex, conversationsResults.results.length]);

  const handleOpenConversationsRef = useRef<() => void>(() => {});
  handleOpenConversationsRef.current = () => {
    if (historyConsentRef.current === null) {
      setAgentsDialogOpen(false);
      setHistoryConsentDialogOpen(true);
      return;
    }
    if (historyConsentRef.current === true && historyIndex.status === "ready") {
      setAgentsDialogOpen(false);
      setConversationsLineEdit({ cursor: 0, query: "" });
      setConversationsMenuOpen(false);
      setConversationsMenuIndex(0);
      setConversationsPageOffset(0);
      setConversationsLoadedCount(CONVERSATIONS_PAGE_SIZE);
      setConversationsResultIndex(0);
      setConversationsDialogOpen(true);
      const previousOnReady = historyIndex.onReady;
      historyIndex.onReady = () => {
        setIndexUpdateCount((c) => c + 1);
        previousOnReady?.();
      };
      void historyIndex.reload();
    }
  };

  const handleConsentAllow = useCallback(async () => {
    log("consent", "history indexing: access allowed");
    setHistoryConsentDialogOpen(false);
    setConsentDialogSelected("allow");
    setHistoryConsent(true);
    await saveHistoryConsent(true);
  }, []);

  const handleConsentDeny = useCallback(async () => {
    log("consent", "history indexing: access denied");
    setHistoryConsentDialogOpen(false);
    setConsentDialogSelected("allow");
    setHistoryConsent(false);
    await saveHistoryConsent(false);
  }, []);

  // Trigger history indexing when consent is first granted
  useEffect(() => {
    if (historyConsent === true && !historyLoadStartedRef.current) {
      historyLoadStartedRef.current = true;
      historyIndex.loadAsync({ verbose: true }).catch(() => {});
    }
  }, [historyConsent]);

  // Re-index every 5 minutes when consent is granted
  useEffect(() => {
    if (historyConsent !== true) return;
    const interval = setInterval(
      () => {
        const previousOnReady = historyIndex.onReady;
        historyIndex.onReady = () => {
          setIndexUpdateCount((c) => c + 1);
          previousOnReady?.();
        };
        void historyIndex.reload();
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(interval);
  }, [historyConsent]);

  return {
    closeConversationsDialog,
    closeConversationsMenu,
    consentDialogSelected,
    conversationsCursor,
    conversationsDialogOpen,
    conversationsLoadedCount,
    conversationsMenuIndex,
    conversationsMenuOpen,
    conversationsPageOffset,
    conversationsQuery,
    conversationsResultIndex,
    conversationsResults,
    conversationsSearchCaseSensitive,
    conversationsSearchRegex,
    goToConversationsAbsoluteIndex,
    handleConsentAllow,
    handleConsentDeny,
    handleOpenConversationsRef,
    historyConsent,
    historyConsentDialogOpen,
    historyConsentRef,
    historyLoadStartedRef,
    historyReady,
    jumpToNewestConversationsPage,
    jumpToOldestConversationsPage,
    loadMoreConversations,
    openConversationsMenu,
    resetConversationsPagination,
    setConsentDialogSelected,
    setConversationsDialogOpen,
    setConversationsLineEdit,
    setConversationsMenuIndex,
    setConversationsResultIndex,
    setHistoryConsent,
    setHistoryConsentDialogOpen,
    setHistoryReady,
    showNewerConversationsPage,
    showOlderConversationsPage,
    toggleConversationsMenu,
    toggleConversationsSearchCaseSensitive,
    toggleConversationsSearchRegex,
  };
}
