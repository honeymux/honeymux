import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useCallback, useRef, useState } from "react";

import type { AgentSession, HookSnifferEntry } from "../../agents/types.ts";
import type { MainMenuTab } from "../../components/main-menu-dialog.tsx";
import type { TmuxKeyBindings, TmuxSession, TmuxWindow } from "../../tmux/types.ts";
import type { KeyAction } from "../../util/keybindings.ts";

import { SIDEBAR_DEFAULT_WIDTH } from "../../components/sidebar.tsx";
import { loadUIState, saveUIState } from "../services/session-persistence.ts";

export interface AgentDialogState {
  agentSessions: AgentSession[];
  agentsDialogOpen: boolean;
  agentsDialogOpenRef: MutableRefObject<boolean>;
  claudeDialogPending: boolean;
  codexDialogPending: boolean;
  /** Remote server name when the current agent-install dialog targets a remote host; undefined = local. */
  dialogHostId: string | undefined;
  /** Whether the current dialog is a fresh install or an update of already-present hooks. */
  dialogMode: "install" | "upgrade";
  dialogSelected: "install" | "never" | "skip";
  geminiDialogPending: boolean;
  hookSnifferEvents: HookSnifferEntry[];
  openCodeDialogPending: boolean;
  overlayOpenRef: MutableRefObject<boolean>;
  quickTerminalMenuCloseRef: MutableRefObject<(() => void) | null>;
  quickTerminalOpen: boolean;
  quickTerminalOpenRef: MutableRefObject<boolean>;
  setAgentSessions: Dispatch<SetStateAction<AgentSession[]>>;
  setAgentsDialogOpen: Dispatch<SetStateAction<boolean>>;
  setClaudeDialogPending: Dispatch<SetStateAction<boolean>>;
  setCodexDialogPending: Dispatch<SetStateAction<boolean>>;
  setDialogHostId: Dispatch<SetStateAction<string | undefined>>;
  setDialogMode: Dispatch<SetStateAction<"install" | "upgrade">>;
  setDialogSelected: Dispatch<SetStateAction<"install" | "never" | "skip">>;
  setGeminiDialogPending: Dispatch<SetStateAction<boolean>>;
  setHookSnifferEvents: Dispatch<SetStateAction<HookSnifferEntry[]>>;
  setOpenCodeDialogPending: Dispatch<SetStateAction<boolean>>;
  setQuickTerminalOpen: Dispatch<SetStateAction<boolean>>;
}

export type MainMenuSelectedCol = "left-sticky" | "left" | "right-sticky" | "right";

export type SidebarView = "agents" | "hook-sniffer" | "server";
export interface StatusBarInfo {
  lines: number;
  position: "bottom" | "top";
}

export interface TmuxSessionState {
  activeIndex: number;
  connected: boolean;
  currentSessionName: string;
  detachingRef: MutableRefObject<boolean>;
  initTargetRef: MutableRefObject<string>;
  keyBindings: TmuxKeyBindings | null;
  sessionKey: number;
  sessions: TmuxSession[];
  setActiveIndex: Dispatch<SetStateAction<number>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setCurrentSessionName: Dispatch<SetStateAction<string>>;
  setKeyBindings: Dispatch<SetStateAction<TmuxKeyBindings | null>>;
  setSessionKey: Dispatch<SetStateAction<number>>;
  setSessions: Dispatch<SetStateAction<TmuxSession[]>>;
  setStatusBarInfo: Dispatch<SetStateAction<StatusBarInfo | null>>;
  setWindows: Dispatch<SetStateAction<TmuxWindow[]>>;
  statusBarInfo: StatusBarInfo | null;
  switchingRef: MutableRefObject<Set<string>>;
  windows: TmuxWindow[];
}

export interface UiChromeState {
  dropdownOpen: boolean;
  dropdownOpenRef: MutableRefObject<boolean>;
  mainMenuCaptureError: string;
  mainMenuCapturing: boolean;
  mainMenuDialogOpen: boolean;
  mainMenuDialogOpenRef: MutableRefObject<boolean>;
  mainMenuSelectedCol: MainMenuSelectedCol;
  mainMenuSelectedRow: number;
  mainMenuTab: MainMenuTab;
  muxotronFocusActive: boolean;
  muxotronFocusActiveRef: MutableRefObject<boolean>;
  setDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setMainMenuCaptureError: Dispatch<SetStateAction<string>>;
  setMainMenuCapturing: Dispatch<SetStateAction<boolean>>;
  setMainMenuDialogOpen: Dispatch<SetStateAction<boolean>>;
  setMainMenuSelectedCol: Dispatch<SetStateAction<MainMenuSelectedCol>>;
  setMainMenuSelectedRow: Dispatch<SetStateAction<number>>;
  setMainMenuTab: Dispatch<SetStateAction<MainMenuTab>>;
  setMuxotronFocusActive: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: (value: boolean) => void;
  setSidebarView: (value: SidebarView) => void;
  setSidebarWidth: (value: number) => void;
  setToolbarOpen: (value: boolean) => void;
  setZoomAction: Dispatch<SetStateAction<KeyAction | null>>;
  sidebarOpen: boolean;
  sidebarView: SidebarView;
  sidebarWidth: number;
  toolbarOpen: boolean;
  /** Which zoom overlay is currently shown, or null for in-place mux-o-tron focus. */
  zoomAction: KeyAction | null;
}

export function useAgentDialogState(): AgentDialogState {
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const [hookSnifferEvents, setHookSnifferEvents] = useState<HookSnifferEntry[]>([]);
  const [agentsDialogOpen, setAgentsDialogOpen] = useState(false);
  const agentsDialogOpenRef = useRef(agentsDialogOpen);
  agentsDialogOpenRef.current = agentsDialogOpen;

  const [claudeDialogPending, setClaudeDialogPending] = useState(false);
  const [openCodeDialogPending, setOpenCodeDialogPending] = useState(false);
  const [geminiDialogPending, setGeminiDialogPending] = useState(false);
  const [codexDialogPending, setCodexDialogPending] = useState(false);
  const [dialogSelected, setDialogSelected] = useState<"install" | "never" | "skip">("install");
  const [dialogHostId, setDialogHostId] = useState<string | undefined>(undefined);
  const [dialogMode, setDialogMode] = useState<"install" | "upgrade">("install");
  const overlayOpenRef = useRef(false);
  const [quickTerminalOpen, setQuickTerminalOpen] = useState(false);
  // NOTE: quickTerminalOpenRef is managed exclusively by the open/close handlers
  // in use-agent-actions.ts — NOT synced from state here.  This avoids a race
  // where an intermediate render resets the ref before the state update propagates.
  const quickTerminalOpenRef = useRef(false);
  const quickTerminalMenuCloseRef = useRef<(() => void) | null>(null);

  return {
    agentSessions,
    agentsDialogOpen,
    agentsDialogOpenRef,
    claudeDialogPending,
    codexDialogPending,
    dialogHostId,
    dialogMode,
    dialogSelected,
    geminiDialogPending,
    hookSnifferEvents,
    openCodeDialogPending,
    overlayOpenRef,
    quickTerminalMenuCloseRef,
    quickTerminalOpen,
    quickTerminalOpenRef,
    setAgentSessions,
    setAgentsDialogOpen,
    setClaudeDialogPending,
    setCodexDialogPending,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    setGeminiDialogPending,
    setHookSnifferEvents,
    setOpenCodeDialogPending,
    setQuickTerminalOpen,
  };
}

export function useTmuxSessionState(initialSessionName: string): TmuxSessionState {
  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [connected, setConnected] = useState(false);
  const [currentSessionName, setCurrentSessionName] = useState(initialSessionName);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [keyBindings, setKeyBindings] = useState<TmuxKeyBindings | null>(null);
  const [statusBarInfo, setStatusBarInfo] = useState<StatusBarInfo | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const initTargetRef = useRef(initialSessionName);
  const switchingRef = useRef<Set<string>>(new Set());
  const detachingRef = useRef(false);

  return {
    activeIndex,
    connected,
    currentSessionName,
    detachingRef,
    initTargetRef,
    keyBindings,
    sessionKey,
    sessions,
    setActiveIndex,
    setConnected,
    setCurrentSessionName,
    setKeyBindings,
    setSessionKey,
    setSessions,
    setStatusBarInfo,
    setWindows,
    statusBarInfo,
    switchingRef,
    windows,
  };
}

export function useUiChromeState(): UiChromeState {
  const persistedVisibility = loadUIState();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownOpenRef = useRef(dropdownOpen);
  dropdownOpenRef.current = dropdownOpen;

  const [toolbarOpen, setToolbarOpenState] = useState(() => persistedVisibility?.toolbarOpen ?? false);
  const [sidebarOpen, setSidebarOpenState] = useState(() => persistedVisibility?.sidebarOpen ?? false);
  const [sidebarView, setSidebarViewState] = useState<SidebarView>(() => persistedVisibility?.sidebarView ?? "server");
  const [sidebarWidth, setSidebarWidthState] = useState(
    () => persistedVisibility?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH,
  );

  const toolbarOpenRef = useRef(toolbarOpen);
  toolbarOpenRef.current = toolbarOpen;
  const sidebarOpenPersistRef = useRef(sidebarOpen);
  sidebarOpenPersistRef.current = sidebarOpen;
  const sidebarViewPersistRef = useRef(sidebarView);
  sidebarViewPersistRef.current = sidebarView;
  const sidebarWidthPersistRef = useRef(sidebarWidth);
  sidebarWidthPersistRef.current = sidebarWidth;

  const [mainMenuDialogOpen, setMainMenuDialogOpen] = useState(false);
  const mainMenuDialogOpenRef = useRef(mainMenuDialogOpen);
  mainMenuDialogOpenRef.current = mainMenuDialogOpen;

  const [mainMenuTab, setMainMenuTab] = useState<MainMenuTab>("functions");
  const [mainMenuSelectedRow, setMainMenuSelectedRow] = useState(0);
  const [mainMenuSelectedCol, setMainMenuSelectedCol] = useState<MainMenuSelectedCol>("left");
  const [mainMenuCapturing, setMainMenuCapturing] = useState(false);
  const [mainMenuCaptureError, setMainMenuCaptureError] = useState("");

  const [muxotronFocusActive, setMuxotronFocusActive] = useState(false);
  const muxotronFocusActiveRef = useRef(muxotronFocusActive);
  muxotronFocusActiveRef.current = muxotronFocusActive;
  const [zoomAction, setZoomAction] = useState<KeyAction | null>(null);

  const setToolbarOpen = useCallback((value: boolean) => {
    setToolbarOpenState((previous) => {
      if (previous !== value) {
        void saveUIState({
          sidebarOpen: sidebarOpenPersistRef.current,
          sidebarView: sidebarViewPersistRef.current,
          sidebarWidth: sidebarWidthPersistRef.current,
          toolbarOpen: value,
        });
      }
      return value;
    });
  }, []);

  const setSidebarOpen = useCallback((value: boolean) => {
    setSidebarOpenState((previous) => {
      if (previous !== value) {
        void saveUIState({
          sidebarOpen: value,
          sidebarView: sidebarViewPersistRef.current,
          sidebarWidth: sidebarWidthPersistRef.current,
          toolbarOpen: toolbarOpenRef.current,
        });
      }
      return value;
    });
  }, []);

  const setSidebarView = useCallback((value: SidebarView) => {
    setSidebarViewState(value);
    void saveUIState({
      sidebarOpen: sidebarOpenPersistRef.current,
      sidebarView: value,
      sidebarWidth: sidebarWidthPersistRef.current,
      toolbarOpen: toolbarOpenRef.current,
    });
  }, []);

  const setSidebarWidth = useCallback((value: number) => {
    setSidebarWidthState(value);
    void saveUIState({
      sidebarOpen: sidebarOpenPersistRef.current,
      sidebarView: sidebarViewPersistRef.current,
      sidebarWidth: value,
      toolbarOpen: toolbarOpenRef.current,
    });
  }, []);

  return {
    dropdownOpen,
    dropdownOpenRef,
    mainMenuCaptureError,
    mainMenuCapturing,
    mainMenuDialogOpen,
    mainMenuDialogOpenRef,
    mainMenuSelectedCol,
    mainMenuSelectedRow,
    mainMenuTab,
    muxotronFocusActive,
    muxotronFocusActiveRef,
    setDropdownOpen,
    setMainMenuCaptureError,
    setMainMenuCapturing,
    setMainMenuDialogOpen,
    setMainMenuSelectedCol,
    setMainMenuSelectedRow,
    setMainMenuTab,
    setMuxotronFocusActive,
    setSidebarOpen,
    setSidebarView,
    setSidebarWidth,
    setToolbarOpen,
    setZoomAction,
    sidebarOpen,
    sidebarView,
    sidebarWidth,
    toolbarOpen,
    zoomAction,
  };
}
