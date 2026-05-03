import type { KeyAction } from "../../util/keybindings.ts";

import { ACTION_LABELS } from "../../components/main-menu-dialog.tsx";
import {
  MODIFIER_KEY_CODES,
  formatModifierKeyCode,
  identifyKeySequence,
  isDismissKey,
  isEscape,
  parseRawKeyEvent,
} from "../../util/keybindings.ts";
import { applyLineEdit } from "../dialogs/line-edit.ts";
import {
  AGENTS_LEFT_COUNT,
  AGENTS_SPLIT_START,
  ARROW_EDITABLE_KINDS,
  INPUT_LEFT_COUNT,
  INPUT_SPLIT_START,
  NON_NAV_KINDS,
  type OptionsDialogState,
  TAB_ORDER,
  TAB_ROWS,
  cycleBuiltinTheme,
  cycleCursorShape,
  cycleDimOpacity,
  cycleQuickSize,
  cycleRootTintOpacity,
  cycleUIMode,
  cycleWatermark,
  toggleThemeMode,
} from "./model.ts";

interface OptionsDialogRouteEnv {
  sequenceMap: Map<string, KeyAction>;
  suppressModifierRelease: boolean;
}

type OptionsDialogRouteResult =
  | { draft: OptionsDialogState; kind: "confirm"; suppressModifierRelease: boolean }
  | { draft: OptionsDialogState; kind: "update"; suppressModifierRelease: boolean }
  | { kind: "noop"; suppressModifierRelease: boolean };

export function routeOptionsDialogInput(
  data: string,
  draft: OptionsDialogState,
  env: OptionsDialogRouteEnv,
): OptionsDialogRouteResult {
  if (draft.tmuxPrefixKeyAliasCapturing) {
    return routeTmuxPrefixKeyAliasCapture(data, draft, env);
  }

  if (draft.tab === "remote") {
    return routeRemoteTabInput(data, draft, env);
  }

  const {
    agentAlertAnimConfusables,
    agentAlertAnimEqualizer,
    agentAlertAnimGlow,
    agentAlertAnimScribble,
    agentAlertCursorAlert,
    agentAlertCursorBlink,
    agentAlertCursorShape,
    agentAlertWatermark,
    bufferZoomFade,
    dimInactivePanes,
    honeybeamsEnabled,
    ignoreMouseInput,
    muxotronEnabled,
    privilegedPaneDetection,
    row,
    tab,
    uiMode,
  } = draft;

  const rows = TAB_ROWS[tab];
  const maxRow = rows.length - 1;
  const kind = rows[row];

  // While screenshotDirEditing, keys are routed to OpenTUI's textarea (see
  // OptionsDialog: it sets textInputActive=true and registers an escape
  // handler). The controller still owns entry and commit flow (Enter below).

  // animationDelay / animationCycleCount editing is handled by OpenTUI
  // textareas mounted in OptionsDialog (see onSubmit handlers there).

  if (data === "\x1b[Z") {
    const idx = TAB_ORDER.indexOf(tab);
    return update(
      {
        ...draft,
        multiSelectEditing: false,
        row: 0,
        screenshotDirEditing: false,
        tab: TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!,
      },
      false,
    );
  }

  const canonical = identifyKeySequence(data);
  if (isDismissKey(data) || (canonical && env.sequenceMap.get(canonical) === "options")) {
    if (draft.multiSelectEditing) {
      return update({ ...draft, multiSelectEditing: false }, false);
    }
    return confirm(draft, false);
  }

  if (data === "\t") {
    const idx = TAB_ORDER.indexOf(tab);
    return update(
      {
        ...draft,
        multiSelectEditing: false,
        row: 0,
        screenshotDirEditing: false,
        tab: TAB_ORDER[(idx + 1) % TAB_ORDER.length]!,
      },
      false,
    );
  }

  if (data === "\x1b[A") {
    const d = { ...draft, multiSelectEditing: false };
    if (tab === "input") {
      const inLeft = row < INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      const sectionStart = inLeft ? INPUT_SPLIT_START : INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      const sectionEnd = inLeft ? INPUT_SPLIT_START + INPUT_LEFT_COUNT - 1 : rows.length - 1;
      if (row <= sectionStart) return update({ ...d, row: sectionEnd }, false);
      return update({ ...d, row: row - 1 }, false);
    }
    if (tab === "agents") {
      const inLeft = row < AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      const sectionStart = inLeft ? AGENTS_SPLIT_START : AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      const sectionEnd = inLeft ? AGENTS_SPLIT_START + AGENTS_LEFT_COUNT - 1 : maxRow;
      let firstNav = sectionStart;
      while (firstNav <= sectionEnd && NON_NAV_KINDS.has(rows[firstNav]!)) firstNav++;
      let lastNav = sectionEnd;
      while (lastNav >= sectionStart && NON_NAV_KINDS.has(rows[lastNav]!)) lastNav--;
      if (row <= firstNav) return update({ ...d, row: lastNav }, false);
      let nextRow = row - 1;
      while (nextRow >= sectionStart && NON_NAV_KINDS.has(rows[nextRow]!)) nextRow--;
      if (nextRow < sectionStart) return update({ ...d, row: lastNav }, false);
      return update({ ...d, row: nextRow }, false);
    }
    let nextRow = row <= 0 ? maxRow : row - 1;
    while (NON_NAV_KINDS.has(rows[nextRow]!) && nextRow !== row) {
      nextRow = nextRow <= 0 ? maxRow : nextRow - 1;
    }
    return update({ ...d, row: nextRow, screenshotDirEditing: false }, false);
  }

  if (data === "\x1b[B") {
    const d = { ...draft, multiSelectEditing: false };
    if (tab === "input") {
      const inLeft = row < INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      const sectionStart = inLeft ? INPUT_SPLIT_START : INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      const sectionEnd = inLeft ? INPUT_SPLIT_START + INPUT_LEFT_COUNT - 1 : rows.length - 1;
      if (row >= sectionEnd) return update({ ...d, row: sectionStart }, false);
      return update({ ...d, row: row + 1 }, false);
    }
    if (tab === "agents") {
      const inLeft = row < AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      const sectionStart = inLeft ? AGENTS_SPLIT_START : AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      const sectionEnd = inLeft ? AGENTS_SPLIT_START + AGENTS_LEFT_COUNT - 1 : maxRow;
      let lastNav = sectionEnd;
      while (lastNav >= sectionStart && NON_NAV_KINDS.has(rows[lastNav]!)) lastNav--;
      if (row >= lastNav) {
        let firstNav = sectionStart;
        while (firstNav <= sectionEnd && NON_NAV_KINDS.has(rows[firstNav]!)) firstNav++;
        return update({ ...d, row: firstNav }, false);
      }
      let nextRow = row + 1;
      while (nextRow <= sectionEnd && NON_NAV_KINDS.has(rows[nextRow]!)) nextRow++;
      if (nextRow > sectionEnd) {
        let firstNav = sectionStart;
        while (firstNav <= sectionEnd && NON_NAV_KINDS.has(rows[firstNav]!)) firstNav++;
        return update({ ...d, row: firstNav }, false);
      }
      return update({ ...d, row: nextRow }, false);
    }
    let nextRow = row >= maxRow ? 0 : row + 1;
    while (NON_NAV_KINDS.has(rows[nextRow]!) && nextRow !== row) {
      nextRow = nextRow >= maxRow ? 0 : nextRow + 1;
    }
    return update({ ...d, row: nextRow, screenshotDirEditing: false }, false);
  }

  if (data === "\x1b[D" || data === "\x1b[C") {
    const direction = data === "\x1b[C" ? 1 : -1;
    // Multi-select value changes only when editing is active
    if (draft.multiSelectEditing) {
      if (kind === "themeMode") {
        return update({ ...draft, themeMode: toggleThemeMode(draft.themeMode) }, false);
      }
      if (kind === "themeBuiltin") {
        if (draft.themeMode === "custom") return noop(false);
        return update({ ...draft, themeBuiltin: cycleBuiltinTheme(draft.themeBuiltin, direction) }, false);
      }
      if (kind === "uiMode") return update({ ...draft, uiMode: cycleUIMode(uiMode, direction) }, false);
      if (kind === "agentAlertWatermark") {
        return update({ ...draft, agentAlertWatermark: cycleWatermark(draft.agentAlertWatermark, direction) }, false);
      }
      if (kind === "agentAlertCursorShape") {
        return update({ ...draft, agentAlertCursorShape: cycleCursorShape(agentAlertCursorShape, direction) }, false);
      }
      if (kind === "dimPanes") {
        if (!dimInactivePanes) return noop(false);
        return update(
          { ...draft, dimInactivePanesOpacity: cycleDimOpacity(draft.dimInactivePanesOpacity, direction) },
          false,
        );
      }
      if (kind === "rootDetect") {
        if (!privilegedPaneDetection) return noop(false);
        return update(
          {
            ...draft,
            privilegedPaneDetectionOpacity: cycleRootTintOpacity(draft.privilegedPaneDetectionOpacity, direction),
          },
          false,
        );
      }
      if (kind === "quickTerminalSize") {
        return update({ ...draft, quickTerminalSize: cycleQuickSize(draft.quickTerminalSize, direction) }, false);
      }
      return noop(false);
    }
    // Split-tab column navigation (always available when not editing)
    if (tab === "input") {
      const inLeft = row < INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      const rightStart = INPUT_SPLIT_START + INPUT_LEFT_COUNT;
      if (data === "\x1b[C" && inLeft) return update({ ...draft, row: rightStart }, false);
      if (data === "\x1b[D" && !inLeft) {
        return update({ ...draft, row: Math.min(INPUT_SPLIT_START + INPUT_LEFT_COUNT - 1, row) }, false);
      }
    }
    if (tab === "agents") {
      const inLeft = row < AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      const rightStart = AGENTS_SPLIT_START + AGENTS_LEFT_COUNT;
      if (data === "\x1b[C" && inLeft) {
        const visualRow = row - AGENTS_SPLIT_START;
        let target = Math.min(rightStart + visualRow, maxRow);
        if (NON_NAV_KINDS.has(rows[target]!)) {
          let probe = target + 1;
          while (probe <= maxRow && NON_NAV_KINDS.has(rows[probe]!)) probe++;
          if (probe <= maxRow) target = probe;
          else {
            probe = target - 1;
            while (probe >= rightStart && NON_NAV_KINDS.has(rows[probe]!)) probe--;
            if (probe >= rightStart) target = probe;
          }
        }
        return update({ ...draft, row: target }, false);
      }
      if (data === "\x1b[D" && !inLeft) {
        const visualRow = row - rightStart;
        const leftEnd = AGENTS_SPLIT_START + AGENTS_LEFT_COUNT - 1;
        let target = Math.min(AGENTS_SPLIT_START + visualRow, leftEnd);
        if (NON_NAV_KINDS.has(rows[target]!)) {
          let probe = target - 1;
          while (probe >= AGENTS_SPLIT_START && NON_NAV_KINDS.has(rows[probe]!)) probe--;
          if (probe >= AGENTS_SPLIT_START) target = probe;
        }
        return update({ ...draft, row: target }, false);
      }
    }
    return noop(false);
  }

  if (data === "\r" || data === "\n") {
    if (draft.multiSelectEditing) {
      return update({ ...draft, multiSelectEditing: false }, false);
    }
    if (kind && ARROW_EDITABLE_KINDS.has(kind)) {
      // Don't enter editing for disabled sliders
      if (kind === "dimPanes" && !dimInactivePanes) return noop(false);
      if (kind === "rootDetect" && !privilegedPaneDetection) return noop(false);
      if (kind === "themeBuiltin" && draft.themeMode === "custom") return noop(false);
      return update({ ...draft, multiSelectEditing: true }, false);
    }
    if (kind === "screenshotDir") {
      return update({ ...draft, screenshotDirCursor: draft.screenshotDir.length, screenshotDirEditing: true }, false);
    }
    if (kind === "agentAlertAnimDelay") {
      const text = String(draft.agentAlertAnimDelay);
      return update(
        {
          ...draft,
          animationDelayCursor: text.length,
          animationDelayEditing: true,
          animationDelayText: text,
        },
        false,
      );
    }
    if (kind === "agentAlertAnimCycleCount") {
      const text = String(draft.agentAlertAnimCycleCount);
      return update(
        {
          ...draft,
          animationCycleCountCursor: text.length,
          animationCycleCountEditing: true,
          animationCycleCountText: text,
        },
        false,
      );
    }
    if (kind === "tmuxPrefixKeyAlias") {
      return update(
        {
          ...draft,
          tmuxPrefixKeyAliasCaptureError: "",
          tmuxPrefixKeyAliasCapturing: true,
        },
        false,
      );
    }
    return noop(false);
  }

  if ((data === "\x7f" || data === "\b" || data === "\x1b[3~") && kind === "tmuxPrefixKeyAlias") {
    if (draft.tmuxPrefixKeyAlias === null) return noop(false);
    return update({ ...draft, tmuxPrefixKeyAlias: null }, false);
  }

  if (data === " ") {
    switch (kind) {
      case "activeWindowIdDisplayEnabled":
        return update({ ...draft, activeWindowIdDisplayEnabled: !draft.activeWindowIdDisplayEnabled }, false);
      case "agentAlertAnimConfusables":
        return update({ ...draft, agentAlertAnimConfusables: !agentAlertAnimConfusables }, false);
      case "agentAlertAnimEqualizer":
        return update({ ...draft, agentAlertAnimEqualizer: !agentAlertAnimEqualizer }, false);
      case "agentAlertAnimGlow":
        return update({ ...draft, agentAlertAnimGlow: !agentAlertAnimGlow }, false);
      case "agentAlertAnimScribble":
        return update({ ...draft, agentAlertAnimScribble: !agentAlertAnimScribble }, false);
      case "agentAlertCursorAlert":
        return update({ ...draft, agentAlertCursorAlert: !agentAlertCursorAlert }, false);
      case "agentAlertCursorBlink":
        return update({ ...draft, agentAlertCursorBlink: !agentAlertCursorBlink }, false);
      case "agentAlertCursorColor":
        return update({ ...draft, cursorColorPickerOpen: true }, false);
      case "agentAlertCursorShape":
        return update({ ...draft, agentAlertCursorShape: cycleCursorShape(agentAlertCursorShape, 1) }, false);
      case "agentAlertWatermark":
        return update({ ...draft, agentAlertWatermark: cycleWatermark(agentAlertWatermark, 1) }, false);
      case "bufferZoomFade":
        return update({ ...draft, bufferZoomFade: !bufferZoomFade }, false);
      case "dimPanes":
        return update({ ...draft, dimInactivePanes: !dimInactivePanes }, false);
      case "generalSep":
        return noop(false);
      case "honeybeamsEnabled":
        return update({ ...draft, honeybeamsEnabled: !honeybeamsEnabled }, false);
      case "ignoreMouseInput":
        return update({ ...draft, ignoreMouseInput: !ignoreMouseInput }, false);
      case "muxotronEnabled":
        if (uiMode !== "adaptive") return noop(false);
        return update({ ...draft, muxotronEnabled: !muxotronEnabled }, false);
      case "paneTabsEnabled":
        return update({ ...draft, paneTabsEnabled: !draft.paneTabsEnabled }, false);
      case "quickTerminalSize":
        return update({ ...draft, quickTerminalSize: cycleQuickSize(draft.quickTerminalSize, 1) }, false);
      case "rootDetect":
        return update({ ...draft, privilegedPaneDetection: !privilegedPaneDetection }, false);
      case "screenshotDir":
        return noop(false);
      case "screenshotFlash":
        return update({ ...draft, screenshotFlash: !draft.screenshotFlash }, false);
      case "themeBuiltin": {
        if (draft.themeMode === "custom") return noop(false);
        return update({ ...draft, themeBuiltin: cycleBuiltinTheme(draft.themeBuiltin, 1) }, false);
      }
      case "themeMode": {
        return update({ ...draft, themeMode: toggleThemeMode(draft.themeMode) }, false);
      }
      case "tmuxKeyBindingHints":
        return update({ ...draft, tmuxKeyBindingHints: !draft.tmuxKeyBindingHints }, false);
      case "uiMode":
        return update({ ...draft, uiMode: cycleUIMode(uiMode, 1) }, false);
    }
  }

  return noop(false);
}

function confirm(draft: OptionsDialogState, suppressModifierRelease: boolean): OptionsDialogRouteResult {
  return { draft, kind: "confirm", suppressModifierRelease };
}

function noop(suppressModifierRelease: boolean): OptionsDialogRouteResult {
  return { kind: "noop", suppressModifierRelease };
}

function routeRemoteTabInput(
  data: string,
  draft: OptionsDialogState,
  env: OptionsDialogRouteEnv,
): OptionsDialogRouteResult {
  const { remoteAdding, remoteEditing, remoteSelectedIndex, remoteServers } = draft;

  const editing = remoteEditing ?? remoteAdding;
  if (editing) {
    const field = remoteEditing ? ("remoteEditing" as const) : ("remoteAdding" as const);
    const current = editing;
    const value = "value" in current ? current.value : current[current.field];
    const cursor = current.cursor;

    if (isDismissKey(data)) {
      return update({ ...draft, [field]: null }, false);
    }
    if (data === "\r" || data === "\n") {
      if (remoteEditing) {
        const updated = [...remoteServers];
        const server = updated[remoteSelectedIndex];
        if (server) {
          updated[remoteSelectedIndex] = { ...server, [remoteEditing.field]: remoteEditing.value.trim() };
        }
        return update({ ...draft, remoteEditing: null, remoteServers: updated }, false);
      }
      if (remoteAdding) {
        if (remoteAdding.field === "name") {
          const trimmedName = remoteAdding.name.trim();
          return update(
            {
              ...draft,
              remoteAdding: { ...remoteAdding, cursor: 0, field: "host", name: trimmedName },
            },
            false,
          );
        }
        if (remoteAdding.name.trim() && remoteAdding.host.trim()) {
          const updated = [...remoteServers, { host: remoteAdding.host.trim(), name: remoteAdding.name.trim() }];
          return update(
            {
              ...draft,
              remoteAdding: null,
              remoteSelectedIndex: updated.length - 1,
              remoteServers: updated,
            },
            false,
          );
        }
        return update({ ...draft, remoteAdding: null }, false);
      }
    }
    if (data === "\t" && remoteAdding) {
      const currentField = remoteAdding.field;
      const nextField = currentField === "name" ? "host" : "name";
      return update(
        {
          ...draft,
          remoteAdding: {
            ...remoteAdding,
            [currentField]: remoteAdding[currentField].trim(),
            cursor: remoteAdding[nextField].length,
            field: nextField,
          },
        },
        false,
      );
    }
    // Delegate all text editing (cursor motion, deletion, insertion) to the
    // shared line-edit helper so emacs/readline bindings work uniformly.
    const edit = applyLineEdit({ cursor, query: value }, data);
    if (edit.handled) {
      if (remoteEditing) {
        return update(
          {
            ...draft,
            remoteEditing: { ...remoteEditing, cursor: edit.next.cursor, value: edit.next.query },
          },
          false,
        );
      }
      return update(
        {
          ...draft,
          remoteAdding: { ...remoteAdding!, cursor: edit.next.cursor, [remoteAdding!.field]: edit.next.query },
        },
        false,
      );
    }
    return noop(false);
  }

  if (data === "\x1b[Z") {
    const idx = TAB_ORDER.indexOf(draft.tab);
    return update({ ...draft, row: 0, tab: TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]! }, false);
  }
  if (data === "\t") {
    const idx = TAB_ORDER.indexOf(draft.tab);
    return update({ ...draft, row: 0, tab: TAB_ORDER[(idx + 1) % TAB_ORDER.length]! }, false);
  }
  const canonical = identifyKeySequence(data);
  if (isDismissKey(data) || (canonical && env.sequenceMap.get(canonical) === "options")) {
    return confirm(draft, false);
  }
  if (data === "\x1b[A") {
    if (remoteServers.length === 0 || remoteSelectedIndex === 0) return noop(false);
    return update({ ...draft, remoteSelectedIndex: remoteSelectedIndex - 1 }, false);
  }
  if (data === "\x1b[B") {
    if (remoteServers.length === 0 || remoteSelectedIndex >= remoteServers.length - 1) return noop(false);
    return update({ ...draft, remoteSelectedIndex: remoteSelectedIndex + 1 }, false);
  }
  if (data === "\r" || data === "\n") {
    const server = remoteServers[remoteSelectedIndex];
    if (!server) return noop(false);
    return update(
      {
        ...draft,
        remoteEditing: { cursor: server.name.length, field: "name", value: server.name },
      },
      false,
    );
  }
  if (data === "e") {
    const server = remoteServers[remoteSelectedIndex];
    if (!server) return noop(false);
    return update(
      {
        ...draft,
        remoteEditing: { cursor: server.host.length, field: "host", value: server.host },
      },
      false,
    );
  }
  if (data === "a") {
    return update({ ...draft, remoteAdding: { cursor: 0, field: "name", host: "", name: "" } }, false);
  }
  if (data === "f") {
    const server = remoteServers[remoteSelectedIndex];
    if (!server) return noop(false);
    const updated = [...remoteServers];
    updated[remoteSelectedIndex] = { ...server, agentForwarding: !server.agentForwarding };
    return update({ ...draft, remoteServers: updated }, false);
  }
  if (data === "t") {
    const server = remoteServers[remoteSelectedIndex];
    if (!server) return noop(false);
    return update(
      {
        ...draft,
        remoteTesting: { index: remoteSelectedIndex, status: "testing" },
      },
      false,
    );
  }
  if (data === "d" || data === "\x1b[3~") {
    if (remoteServers.length === 0) return noop(false);
    const updated = remoteServers.filter((_, index) => index !== remoteSelectedIndex);
    return update(
      {
        ...draft,
        remoteSelectedIndex: Math.min(remoteSelectedIndex, Math.max(0, updated.length - 1)),
        remoteServers: updated,
        remoteTesting: null,
      },
      false,
    );
  }
  return noop(false);
}

function routeTmuxPrefixKeyAliasCapture(
  data: string,
  draft: OptionsDialogState,
  env: OptionsDialogRouteEnv,
): OptionsDialogRouteResult {
  const raw = parseRawKeyEvent(data);
  const combo = identifyKeySequence(data);

  if (combo === "escape" || isEscape(data) || combo === "enter" || data === "\r" || data === "\n") {
    return update(
      {
        ...draft,
        tmuxPrefixKeyAliasCaptureError: "",
        tmuxPrefixKeyAliasCapturing: false,
      },
      false,
    );
  }

  if (data === "\x7f" || data === "\b" || data === "\x1b[3~" || combo === "backspace" || combo === "delete") {
    return update(
      {
        ...draft,
        tmuxPrefixKeyAlias: null,
        tmuxPrefixKeyAliasCaptureError: "",
        tmuxPrefixKeyAliasCapturing: false,
      },
      false,
    );
  }

  if (raw?.eventType === 3 && !raw.isModifierOnly) return noop(env.suppressModifierRelease);
  if (raw?.isModifierOnly && raw.eventType === 1) return noop(env.suppressModifierRelease);
  if (raw?.isModifierOnly && raw.eventType === 3 && env.suppressModifierRelease) {
    return noop(false);
  }

  if (raw?.isModifierOnly && raw.eventType === 3 && raw.code in MODIFIER_KEY_CODES) {
    const name = MODIFIER_KEY_CODES[raw.code]!;
    const occupant = env.sequenceMap.get(name);
    if (occupant) {
      const label = ACTION_LABELS[occupant] ?? occupant;
      return update(
        {
          ...draft,
          tmuxPrefixKeyAliasCaptureError: `${formatModifierKeyCode(raw.code)} already bound to ${label}`,
        },
        env.suppressModifierRelease,
      );
    }
    return update(
      {
        ...draft,
        tmuxPrefixKeyAlias: name,
        tmuxPrefixKeyAliasCaptureError: "",
        tmuxPrefixKeyAliasCapturing: false,
      },
      false,
    );
  }

  const comboUsesModifiers = combo !== null && /\b(ctrl|alt|shift)\b/.test(combo);
  return update(
    {
      ...draft,
      tmuxPrefixKeyAliasCaptureError: "prefix key alias must be a modifier key",
    },
    comboUsesModifiers || !!raw?.mods,
  );
}

function update(draft: OptionsDialogState, suppressModifierRelease: boolean): OptionsDialogRouteResult {
  return { draft, kind: "update", suppressModifierRelease };
}
