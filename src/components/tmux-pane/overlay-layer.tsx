import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  TmuxPaneAgentProps,
  TmuxPaneCoreProps,
  TmuxPaneLayoutProps,
  TmuxPaneSessionDropdownProps,
  TmuxPaneSharedProps,
  TmuxPaneToolbarProps,
} from "./types.ts";

import { theme } from "../../themes/theme.ts";
import { fitToWidth, padEndToWidth, stringWidth, stripNonPrintingControlChars, truncateName } from "../../util/text.ts";
import { ProfileDropdown } from "../profile-dropdown.tsx";
import { SessionDropdown } from "../session-dropdown.tsx";
import { SideBar } from "../sidebar.tsx";
import { TOOLBAR_WIDTH, ToolBar } from "../toolbar.tsx";
import { useDropdownKeyboard } from "../use-dropdown-keyboard.ts";

interface OverflowDropdownProps {
  activeIndex: TmuxPaneCoreProps["activeIndex"];
  dropdownInputRef: NonNullable<TmuxPaneSharedProps["dropdownInputRef"]>;
  itemWidth: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  overflowStartX: number;
  visibleCount: number;
  windows: TmuxPaneCoreProps["windows"];
}

interface TmuxPaneOverlayLayerProps {
  agent: TmuxPaneAgentProps;
  core: TmuxPaneCoreProps;
  layout: TmuxPaneLayoutProps;
  rootOverlayNode?: ReactNode;
  runtime: TmuxPaneOverlayRuntime;
  sessionDropdown: TmuxPaneSessionDropdownProps;
  shared: TmuxPaneSharedProps;
  toolbar: TmuxPaneToolbarProps;
}

interface TmuxPaneOverlayRuntime {
  agentsDialogNode: ReactNode;
  onBufferZoom: () => void;
  overflow: {
    hasOverflow: boolean;
    itemWidth: number;
    onClose: () => void;
    onSelect: (index: number) => void;
    open: boolean;
    startX: number;
    visibleCount: number;
  };
}

export function TmuxPaneOverlayLayer({
  agent,
  core,
  layout,
  rootOverlayNode,
  runtime,
  sessionDropdown,
  shared,
  toolbar,
}: TmuxPaneOverlayLayerProps) {
  const { activeIndex, height, sessionName, width, windows } = core;
  const {
    currentSession,
    dropdownOpen,
    onCreateSession,
    onDeleteSession,
    onDropdownClose,
    onGetSessionInfo,
    onRenameSession,
    onSessionSelect,
    onSetSessionColor,
    onTextInputActive,
    sessions,
  } = sessionDropdown;
  const {
    layoutDropdownOpen,
    layoutProfiles,
    onLayoutDelete,
    onLayoutDropdownClose,
    onLayoutRename,
    onLayoutSave,
    onLayoutSaveCommands,
    onLayoutSelect,
    onLayoutSetFavorite,
  } = layout;
  const {
    activePaneRect,
    bufferZoomBinding,
    dimInactivePanesEnabled,
    dimInactivePanesOpacity,
    muxotronFocusActive,
    onClosePane,
    onDetach,
    onMobileToggle,
    onMuxotronDismiss,
    onSidebarViewChange,
    onSplitHorizontal,
    onSplitVertical,
    onToolbarToggle,
    sidebarClientRef,
    sidebarCurrentSessionName,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarItemCountRef,
    sidebarOnTreeNavigate,
    sidebarOnTreeSwitchPaneTab,
    sidebarOpen,
    sidebarPaneTabGroups,
    sidebarView,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    sidebarWidth,
    tmuxKeyBindingHints,
    toolbarActivateRef,
    toolbarFocused,
    toolbarFocusedIndex,
    toolbarItemCountRef,
    toolbarOpen,
  } = toolbar;
  const {
    agentAlertAnimConfusables,
    agentAlertAnimCycleCount,
    agentAlertAnimDelay,
    agentAlertAnimEqualizer,
    agentAlertAnimGlow,
    agentAlertAnimScribble,
    agentSessions,
    codingAgentLastOutputByPaneRef,
    configAgentsPreview,
    hookSnifferEvents,
    onAgentsDialogSelect,
    onGoToPane,
    onTreeAgentSelect,
    registryRef,
  } = agent;
  const { dropdownInputRef, keyBindings, uiMode } = shared;
  const { agentsDialogNode, onBufferZoom, overflow } = runtime;
  const topOffset = uiMode === "raw" || uiMode === "marquee-bottom" ? 0 : 3;
  const bottomOffset = uiMode === "marquee-bottom" ? 3 : 0;
  const toolbarFlashTriggerRef = useRef<((index: number) => void) | null>(null);

  // Build toolbar actions array matching ToolBar button order
  const toolbarActions = useMemo(() => {
    const actions: (() => void)[] = [];
    if (onSplitVertical) actions.push(onSplitVertical);
    if (onSplitHorizontal) actions.push(onSplitHorizontal);
    if (onBufferZoom) actions.push(onBufferZoom);
    // ToolBar merges mobile/close into one button slot
    if (onMobileToggle) actions.push(onMobileToggle);
    else if (onClosePane) actions.push(onClosePane);
    if (onDetach) actions.push(onDetach);
    return actions;
  }, [onSplitVertical, onSplitHorizontal, onClosePane, onDetach, onBufferZoom, onMobileToggle]);

  // Sync toolbar item count for input router navigation
  useEffect(() => {
    if (toolbarItemCountRef) toolbarItemCountRef.current = toolbarActions.length;
  }, [toolbarActions.length, toolbarItemCountRef]);

  // Register toolbar activate handler so app.tsx can dispatch Enter presses
  useEffect(() => {
    if (toolbarActivateRef) {
      toolbarActivateRef.current = (index: number) => {
        toolbarFlashTriggerRef.current?.(index);
        toolbarActions[index]?.();
      };
      return () => {
        if (toolbarActivateRef.current) toolbarActivateRef.current = null;
      };
    }
  }, [toolbarActions, toolbarActivateRef]);

  return (
    <>
      {overflow.open && overflow.hasOverflow && overflow.startX >= 0 && dropdownInputRef && (
        <OverflowDropdown
          activeIndex={activeIndex}
          dropdownInputRef={dropdownInputRef}
          itemWidth={overflow.itemWidth}
          onClose={overflow.onClose}
          onSelect={overflow.onSelect}
          overflowStartX={overflow.startX}
          visibleCount={overflow.visibleCount}
          windows={windows}
        />
      )}
      {dropdownOpen &&
        sessions &&
        sessions.length > 0 &&
        onSessionSelect &&
        onDropdownClose &&
        onCreateSession &&
        dropdownInputRef && (
          <SessionDropdown
            currentSession={currentSession ?? sessionName}
            dropdownInputRef={dropdownInputRef}
            maxWidth={width}
            onClose={onDropdownClose}
            onCreateSession={onCreateSession}
            onDeleteSession={onDeleteSession}
            onGetSessionInfo={onGetSessionInfo}
            onRenameSession={onRenameSession}
            onSelect={onSessionSelect}
            onSetSessionColor={onSetSessionColor}
            onTextInputActive={onTextInputActive}
            sessions={sessions}
          />
        )}
      {layoutDropdownOpen &&
        layoutProfiles &&
        onLayoutSave &&
        onLayoutSelect &&
        onLayoutDropdownClose &&
        dropdownInputRef && (
          <ProfileDropdown
            dropdownInputRef={dropdownInputRef}
            maxWidth={width}
            onClose={onLayoutDropdownClose}
            onDeleteProfile={onLayoutDelete}
            onRenameProfile={onLayoutRename}
            onSave={onLayoutSave}
            onSaveCommands={onLayoutSaveCommands}
            onSelect={onLayoutSelect}
            onSetFavorite={onLayoutSetFavorite}
            onTextInputActive={onTextInputActive}
            profiles={layoutProfiles}
          />
        )}
      {rootOverlayNode}
      {agentsDialogNode}
      {(sidebarFocused || muxotronFocusActive) &&
        (() => {
          const sidebarOffset = sidebarOpen && sidebarWidth ? sidebarWidth + 1 : 0;
          const tbDeduct = toolbarOpen ? TOOLBAR_WIDTH : 0;
          if (dimInactivePanesEnabled && activePaneRect) {
            // Inactive panes are already dimmed — only dim the active pane at the same opacity
            const alphaHex = Math.round(((dimInactivePanesOpacity ?? 40) / 100) * 255)
              .toString(16)
              .padStart(2, "0");
            const w = Math.min(activePaneRect.width, width - sidebarOffset - tbDeduct - activePaneRect.left);
            const h = activePaneRect.height;
            const dimMouseDown =
              muxotronFocusActive && onMuxotronDismiss
                ? (e: MouseEvent) => {
                    if (e.button === 0) onMuxotronDismiss();
                  }
                : undefined;
            return w > 0 && h > 0 ? (
              <box
                backgroundColor={`#000000${alphaHex}`}
                height={h}
                left={sidebarOffset + activePaneRect.left}
                onMouseDown={dimMouseDown}
                position="absolute"
                top={topOffset + activePaneRect.top}
                width={w}
                zIndex={9}
              />
            ) : null;
          }
          // Dim the entire pane area
          const paneW = width - sidebarOffset - tbDeduct;
          const paneH = height - topOffset - bottomOffset;
          const dimMouseDown =
            muxotronFocusActive && onMuxotronDismiss
              ? (e: MouseEvent) => {
                  if (e.button === 0) onMuxotronDismiss();
                }
              : undefined;
          return paneW > 0 && paneH > 0 ? (
            <box
              backgroundColor="#00000066"
              height={paneH}
              left={sidebarOffset}
              onMouseDown={dimMouseDown}
              position="absolute"
              top={topOffset}
              width={paneW}
              zIndex={9}
            />
          ) : null;
        })()}
      {sidebarOpen && sidebarWidth && onSidebarViewChange && (
        <SideBar
          agentAlertAnimConfusables={
            configAgentsPreview ? configAgentsPreview === "agentAlertAnimConfusables" : agentAlertAnimConfusables
          }
          agentAlertAnimCycleCount={agentAlertAnimCycleCount}
          agentAlertAnimDelay={agentAlertAnimDelay}
          agentAlertAnimEqualizer={
            configAgentsPreview ? configAgentsPreview === "agentAlertAnimEqualizer" : agentAlertAnimEqualizer
          }
          agentAlertAnimGlow={configAgentsPreview ? configAgentsPreview === "agentAlertAnimGlow" : agentAlertAnimGlow}
          agentAlertAnimScribble={
            configAgentsPreview ? configAgentsPreview === "agentAlertAnimScribble" : agentAlertAnimScribble
          }
          agentSessions={agentSessions}
          bottomOffset={bottomOffset}
          clientRef={sidebarClientRef}
          codingAgentLastOutputByPaneRef={codingAgentLastOutputByPaneRef}
          configAgentsPreview={configAgentsPreview}
          currentSessionName={sidebarCurrentSessionName}
          focused={sidebarFocused}
          focusedIndex={sidebarFocusedIndex ?? -1}
          height={height}
          hookSnifferEvents={hookSnifferEvents}
          itemCountRef={sidebarItemCountRef}
          onSessionSelect={onGoToPane ?? onTreeAgentSelect ?? onAgentsDialogSelect}
          onSessionZoom={onTreeAgentSelect ?? onAgentsDialogSelect}
          onTreeNavigate={sidebarOnTreeNavigate}
          onTreeSwitchPaneTab={sidebarOnTreeSwitchPaneTab}
          onViewChange={onSidebarViewChange}
          paneTabGroups={sidebarPaneTabGroups}
          registryRef={registryRef}
          topOffset={topOffset}
          view={sidebarView ?? "agents"}
          viewActivateRef={sidebarViewActivateRef}
          viewZoomRef={sidebarViewZoomRef}
          width={sidebarWidth}
        />
      )}
      {toolbarOpen && onToolbarToggle && onSplitVertical && onSplitHorizontal && onClosePane && onDetach && (
        <ToolBar
          bottomOffset={bottomOffset}
          bufferZoomBinding={bufferZoomBinding}
          flashTriggerRef={toolbarFlashTriggerRef}
          focused={toolbarFocused}
          focusedIndex={toolbarFocusedIndex}
          height={height}
          keyBindings={keyBindings}
          onBufferZoom={onBufferZoom}
          onClosePane={onClosePane}
          onDetach={onDetach}
          onMobileToggle={onMobileToggle}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          tmuxKeyBindingHints={tmuxKeyBindingHints}
          topOffset={topOffset}
        />
      )}
    </>
  );
}

function OverflowDropdown({
  activeIndex,
  dropdownInputRef,
  itemWidth,
  onClose,
  onSelect,
  overflowStartX,
  visibleCount,
  windows,
}: OverflowDropdownProps) {
  const overflowWindows = windows.slice(visibleCount);
  const dropdownWidth = itemWidth + 2;
  const dropdownHeight = overflowWindows.length + 2;

  const handleSelect = useCallback(
    (index: number) => {
      onSelect(visibleCount + index);
    },
    [onSelect, visibleCount],
  );

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef,
    isOpen: true,
    itemCount: overflowWindows.length,
    onClose,
    onSelect: handleSelect,
  });

  return (
    <>
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onClose();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={9}
      />
      <box
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={dropdownHeight}
        left={overflowStartX}
        position="absolute"
        top={3}
        width={dropdownWidth}
        zIndex={10}
      >
        {overflowWindows.map((w, i) => {
          const origIdx = visibleCount + i;
          const name = truncateName(stripNonPrintingControlChars(w.name), 20);
          const isActive = origIdx === activeIndex;
          const isFocused = i === focusedIndex;
          const prefix = isFocused ? " ▸ " : "   ";
          const idStr = w.id;
          const nameStr = prefix + name;
          const nameColWidth = 3 + 20 + 1; // prefix + padded name + space
          return (
            <box flexDirection="row" height={1} key={origIdx} width={itemWidth}>
              <text
                bg={isFocused ? theme.bgFocused : theme.bgSurface}
                content={fitToWidth(nameStr, nameColWidth)}
                fg={isFocused ? theme.textBright : isActive ? theme.accent : theme.text}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onSelect(origIdx);
                }}
                width={nameColWidth}
              />
              <text
                bg={isFocused ? theme.bgFocused : theme.bgSurface}
                content={padEndToWidth(idStr, stringWidth(idStr) + 1)}
                fg={isFocused ? theme.textBright : theme.textDim}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onSelect(origIdx);
                }}
              />
            </box>
          );
        })}
      </box>
    </>
  );
}
