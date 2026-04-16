import { useRef } from "react";

import type { RemoteAddingState, RemoteEditingState, RemoteTestingState } from "../app/options/model.ts";
import type { OptionsDialogActions, OptionsDialogRenderState } from "./options-dialog.tsx";

import {
  AGENTS_LEFT_COUNT,
  AGENTS_LEFT_HEADER,
  AGENTS_RIGHT_HEADER,
  AGENTS_SPLIT_START,
  INPUT_LEFT_COUNT,
  INPUT_LEFT_HEADER,
  INPUT_RIGHT_HEADER,
  INPUT_SPLIT_START,
  MAX_CONTENT_ROWS,
  TAB_ROWS,
} from "../app/options/model.ts";
import { theme } from "../themes/theme.ts";
import { stringWidth } from "../util/text.ts";
import {
  centerOptionsText,
  fitOptionsText,
  renderCursorViewport,
  sanitizeOptionsText,
} from "./options-dialog-display.ts";
import { SettingRow } from "./options-dialog-setting-row.tsx";

export function OptionsControlsContent({
  actions,
  innerWidth,
  splitLeftWidth,
  splitRightWidth,
  state,
  tmuxPrefixLabel,
}: {
  actions: OptionsDialogActions;
  innerWidth: number;
  splitLeftWidth: number;
  splitRightWidth: number;
  state: OptionsDialogRenderState;
  tmuxPrefixLabel: null | string;
}) {
  if (state.tab === "remote") {
    return (
      <RemoteTabContent
        adding={state.remoteAdding}
        editing={state.remoteEditing}
        innerWidth={innerWidth}
        maxRows={MAX_CONTENT_ROWS}
        selectedIndex={state.remoteSelectedIndex}
        servers={state.remoteServers}
        testing={state.remoteTesting}
      />
    );
  }

  if (state.tab === "input") {
    return (
      <InputTabContent
        actions={actions}
        splitLeftWidth={splitLeftWidth}
        splitRightWidth={splitRightWidth}
        state={state}
        tmuxPrefixLabel={tmuxPrefixLabel}
      />
    );
  }

  if (state.tab === "agents") {
    return (
      <AgentsTabContent
        actions={actions}
        splitLeftWidth={splitLeftWidth}
        splitRightWidth={splitRightWidth}
        state={state}
      />
    );
  }

  return <SingleColumnContent actions={actions} innerWidth={innerWidth} state={state} />;
}

function AgentsTabContent({
  actions,
  splitLeftWidth,
  splitRightWidth,
  state,
}: {
  actions: OptionsDialogActions;
  splitLeftWidth: number;
  splitRightWidth: number;
  state: OptionsDialogRenderState;
}) {
  const rows = TAB_ROWS.agents;
  const leftHalf = rows.slice(AGENTS_SPLIT_START, AGENTS_SPLIT_START + AGENTS_LEFT_COUNT);
  const rightHalf = rows.slice(AGENTS_SPLIT_START + AGENTS_LEFT_COUNT);
  const splitContentRows = Math.max(leftHalf.length, rightHalf.length);
  const splitPad = MAX_CONTENT_ROWS - 2 - splitContentRows;
  const settingRowProps = { actions, state };
  const leftHeader = centerOptionsText(AGENTS_LEFT_HEADER, splitLeftWidth);
  const rightHeader = centerOptionsText(AGENTS_RIGHT_HEADER, splitRightWidth);

  return (
    <>
      <box flexDirection="row" height={1}>
        <text content="│" fg={theme.textDim} />
        <text content={leftHeader} fg={theme.accent} />
        <text content="│" fg={theme.textDim} />
        <text content={rightHeader} fg={theme.accent} />
        <text content="│" fg={theme.textDim} />
      </box>
      <SplitEmptyRow leftWidth={splitLeftWidth} rightWidth={splitRightWidth} />
      {Array.from({ length: splitContentRows }, (_, contentIndex) => (
        <box flexDirection="row" height={1} key={`agents-split-${contentIndex}`}>
          <text content="│" fg={theme.textDim} />
          <box width={splitLeftWidth}>
            {leftHalf[contentIndex] ? (
              <SettingRow
                currentRow={state.row}
                kind={leftHalf[contentIndex]!}
                row={contentIndex + AGENTS_SPLIT_START}
                {...settingRowProps}
              />
            ) : null}
          </box>
          <text content="│" fg={theme.textDim} />
          <box width={splitRightWidth}>
            {rightHalf[contentIndex] ? (
              <SettingRow
                currentRow={state.row}
                kind={rightHalf[contentIndex]!}
                row={contentIndex + AGENTS_SPLIT_START + AGENTS_LEFT_COUNT}
                {...settingRowProps}
              />
            ) : null}
          </box>
          <text content="│" fg={theme.textDim} />
        </box>
      ))}
      {Array.from({ length: Math.max(0, splitPad) }, (_, padIndex) => (
        <SplitEmptyRow key={`agents-pad-${padIndex}`} leftWidth={splitLeftWidth} rightWidth={splitRightWidth} />
      ))}
    </>
  );
}

function InputTabContent({
  actions,
  splitLeftWidth,
  splitRightWidth,
  state,
  tmuxPrefixLabel,
}: {
  actions: OptionsDialogActions;
  splitLeftWidth: number;
  splitRightWidth: number;
  state: OptionsDialogRenderState;
  tmuxPrefixLabel: null | string;
}) {
  const rows = TAB_ROWS.input;
  const leftHalf = rows.slice(INPUT_SPLIT_START, INPUT_SPLIT_START + INPUT_LEFT_COUNT);
  const totalRows = MAX_CONTENT_ROWS - 2;
  const centeredRightPadTop = Math.max(0, Math.floor((totalRows - 3) / 2));
  const rightPadTop = Math.max(0, centeredRightPadTop);
  const leftPadTop = Math.max(0, Math.min(Math.max(0, totalRows - leftHalf.length), centeredRightPadTop + 2) - 1);
  const settingRowProps = { actions, state };
  const leftHeader = centerOptionsText(INPUT_LEFT_HEADER, splitLeftWidth);
  const rightHeader = centerOptionsText(INPUT_RIGHT_HEADER, splitRightWidth);
  const safePrefixLabel = sanitizeOptionsText(tmuxPrefixLabel ?? "unknown");

  return (
    <>
      <box flexDirection="row" height={1}>
        <text content="│" fg={theme.textDim} />
        <text content={leftHeader} fg={theme.accent} />
        <text content="│" fg={theme.textDim} />
        <text content={rightHeader} fg={theme.accent} />
        <text content="│" fg={theme.textDim} />
      </box>
      <SplitEmptyRow leftWidth={splitLeftWidth} rightWidth={splitRightWidth} />
      {Array.from({ length: totalRows }, (_, contentIndex) => {
        const leftIndex = contentIndex - leftPadTop;
        const leftItem = leftIndex >= 0 && leftIndex < leftHalf.length ? leftHalf[leftIndex] : undefined;
        const rightRow = contentIndex - rightPadTop;
        const rightPrefix =
          rightRow === 0 ? fitOptionsText(`   tmux prefix key: ${safePrefixLabel}`, splitRightWidth) : null;
        const rightItem = rightRow === 2 ? "tmuxPrefixKeyAlias" : null;

        return (
          <box flexDirection="row" height={1} key={`input-split-${contentIndex}`}>
            <text content="│" fg={theme.textDim} />
            <box width={splitLeftWidth}>
              {leftItem ? (
                <SettingRow
                  currentRow={state.row}
                  kind={leftItem}
                  row={leftIndex + INPUT_SPLIT_START}
                  {...settingRowProps}
                />
              ) : null}
            </box>
            <text content="│" fg={theme.textDim} />
            <box width={splitRightWidth}>
              {rightPrefix ? (
                <text content={rightPrefix} fg={theme.textSecondary} />
              ) : rightItem ? (
                <SettingRow
                  currentRow={state.row}
                  kind={rightItem}
                  row={INPUT_SPLIT_START + INPUT_LEFT_COUNT}
                  {...settingRowProps}
                />
              ) : null}
            </box>
            <text content="│" fg={theme.textDim} />
          </box>
        );
      })}
    </>
  );
}

function RemoteTabContent({
  adding,
  editing,
  innerWidth,
  maxRows,
  selectedIndex,
  servers,
  testing,
}: {
  adding: RemoteAddingState;
  editing: RemoteEditingState;
  innerWidth: number;
  maxRows: number;
  selectedIndex: number;
  servers: Array<{ agentForwarding?: boolean; host: string; name: string }>;
  testing: RemoteTestingState;
}) {
  const scrollOffsetRef = useRef(0);
  const rowContent: string[] = [];
  const rowColors: string[] = [];

  if (servers.length === 0 && !adding) {
    rowContent.push(fitOptionsText("   No remote servers configured", innerWidth));
    rowColors.push(theme.textDim);
    rowContent.push(" ".repeat(innerWidth));
    rowColors.push(theme.textDim);
    rowContent.push(fitOptionsText("   Press 'a' to add a server", innerWidth));
    rowColors.push(theme.textSecondary);
  } else {
    const addingRows = adding ? 2 : 0;
    const showHints = servers.length > 0 && !editing && !adding;
    const hintRows = showHints ? 2 : 0;
    const serverArea = maxRows - addingRows - hintRows;
    const needsScroll = servers.length > serverArea;

    const renderServerRow = (index: number) => {
      const server = servers[index]!;
      const focused = index === selectedIndex && !adding;
      const prefix = focused ? " ▸ " : "   ";
      const safeName = sanitizeOptionsText(server.name);
      const safeHost = sanitizeOptionsText(server.host);
      if (editing && index === selectedIndex) {
        const label = editing.field === "name" ? "name: " : "host: ";
        const fieldWidth = Math.max(0, innerWidth - stringWidth(prefix) - stringWidth(label));
        const field = renderCursorViewport(editing.value, editing.cursor, fieldWidth);
        rowContent.push(fitOptionsText(`${prefix}${label}${field}`, innerWidth));
        rowColors.push(theme.textBright);
        return;
      }
      const forwarding = server.agentForwarding ? "  [agent fwd]" : "";
      rowContent.push(fitOptionsText(`${prefix}${safeName}: ${safeHost}${forwarding}`, innerWidth));
      rowColors.push(focused ? theme.textBright : theme.textSecondary);
    };

    if (!needsScroll) {
      scrollOffsetRef.current = 0;
      for (let index = 0; index < servers.length; index++) renderServerRow(index);
    } else {
      let offset = scrollOffsetRef.current;
      const maxOffset = Math.max(0, servers.length - serverArea + 2);
      offset = Math.min(offset, maxOffset);

      if (selectedIndex < offset) {
        offset = selectedIndex;
      } else {
        while (offset < maxOffset) {
          const upCost = offset > 0 ? 2 : 0;
          const visibleWithoutDown = serverArea - upCost;
          const downCost = offset + visibleWithoutDown < servers.length ? 2 : 0;
          if (selectedIndex < offset + visibleWithoutDown - downCost) break;
          offset++;
        }
      }
      scrollOffsetRef.current = offset;

      const showUp = offset > 0;
      const upCost = showUp ? 2 : 0;
      const visibleWithoutDown = serverArea - upCost;
      const showDown = offset + visibleWithoutDown < servers.length;
      const visibleRows = visibleWithoutDown - (showDown ? 2 : 0);

      if (showUp) {
        rowContent.push(fitOptionsText(`   ↑ ${offset} more`, innerWidth));
        rowColors.push(theme.textDim);
        rowContent.push(" ".repeat(innerWidth));
        rowColors.push(theme.textDim);
      }

      for (let index = offset; index < offset + visibleRows && index < servers.length; index++) renderServerRow(index);

      if (showDown) {
        const remaining = servers.length - offset - visibleRows;
        rowContent.push(" ".repeat(innerWidth));
        rowColors.push(theme.textDim);
        rowContent.push(fitOptionsText(`   ↓ ${remaining} more`, innerWidth));
        rowColors.push(theme.textDim);
      }
    }

    if (showHints) {
      rowContent.push(" ".repeat(innerWidth));
      rowColors.push(theme.textDim);
      if (testing) {
        const safeServerName = sanitizeOptionsText(servers[testing.index]?.name ?? "server");
        if (testing.status === "testing") {
          rowContent.push(fitOptionsText(`   Testing ${safeServerName}...`, innerWidth));
          rowColors.push(theme.textSecondary);
        } else if (testing.status === "success") {
          rowContent.push(fitOptionsText(`   ✔ ${safeServerName}: connection OK`, innerWidth));
          rowColors.push("#50fa7b");
        } else {
          const safeMessage = testing.message ? `: ${sanitizeOptionsText(testing.message)}` : "";
          rowContent.push(fitOptionsText(`   ✘ ${safeServerName}${safeMessage}`, innerWidth));
          rowColors.push("#ff5555");
        }
      } else {
        rowContent.push(fitOptionsText("   a: add  e: host  d: delete  f: fwd  t: test", innerWidth));
        rowColors.push(theme.textDim);
      }
    }
  }

  if (adding) {
    const nameLabel = "   name: ";
    const hostLabel = "   host: ";
    if (adding.field === "name") {
      const nameWidth = Math.max(0, innerWidth - stringWidth(nameLabel));
      rowContent.push(
        fitOptionsText(`${nameLabel}${renderCursorViewport(adding.name, adding.cursor, nameWidth)}`, innerWidth),
      );
      rowColors.push(theme.textBright);
      rowContent.push(fitOptionsText(`${hostLabel}${sanitizeOptionsText(adding.host || "")}`, innerWidth));
      rowColors.push(theme.textDim);
    } else {
      rowContent.push(fitOptionsText(`${nameLabel}${sanitizeOptionsText(adding.name)}`, innerWidth));
      rowColors.push(theme.textDim);
      const hostWidth = Math.max(0, innerWidth - stringWidth(hostLabel));
      rowContent.push(
        fitOptionsText(`${hostLabel}${renderCursorViewport(adding.host, adding.cursor, hostWidth)}`, innerWidth),
      );
      rowColors.push(theme.textBright);
    }
  }

  while (rowContent.length < maxRows) {
    rowContent.push(" ".repeat(innerWidth));
    rowColors.push(theme.textDim);
  }

  return (
    <>
      {rowContent.slice(0, maxRows).map((content, index) => (
        <box flexDirection="row" height={1} key={`remote-${index}`}>
          <text content="│" fg={theme.textDim} />
          <text content={content} fg={rowColors[index]} />
          <text content="│" fg={theme.textDim} />
        </box>
      ))}
    </>
  );
}

function SingleColumnContent({
  actions,
  innerWidth,
  state,
}: {
  actions: OptionsDialogActions;
  innerWidth: number;
  state: OptionsDialogRenderState;
}) {
  const rows = TAB_ROWS[state.tab];
  const padRows = MAX_CONTENT_ROWS - rows.length;
  const topPad = Math.floor(padRows / 2);
  const bottomPad = padRows - topPad;
  const emptyRow = (key: string) => (
    <box flexDirection="row" height={1} key={key}>
      <text content="│" fg={theme.textDim} />
      <text content={" ".repeat(innerWidth)} />
      <text content="│" fg={theme.textDim} />
    </box>
  );

  return (
    <>
      {Array.from({ length: topPad }, (_, index) => emptyRow(`single-top-${index}`))}
      {rows.map((kind, index) => (
        <box flexDirection="row" height={1} key={kind}>
          <text content="│" fg={theme.textDim} />
          <box width={innerWidth}>
            <SettingRow actions={actions} currentRow={state.row} kind={kind} row={index} state={state} />
          </box>
          <text content="│" fg={theme.textDim} />
        </box>
      ))}
      {Array.from({ length: bottomPad }, (_, index) => emptyRow(`single-bottom-${index}`))}
    </>
  );
}

function SplitEmptyRow({ leftWidth, rightWidth }: { leftWidth: number; rightWidth: number }) {
  return (
    <box flexDirection="row" height={1}>
      <text content="│" fg={theme.textDim} />
      <text content={" ".repeat(leftWidth)} />
      <text content="│" fg={theme.textDim} />
      <text content={" ".repeat(rightWidth)} />
      <text content="│" fg={theme.textDim} />
    </box>
  );
}
