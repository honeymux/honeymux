import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

/**
 * Public rect describing the active tmux pane in screen-cell coordinates,
 * used by the cursor-position filter to reject stale buffer cursor updates
 * that land outside the focused pane.
 */
export interface ActivePaneRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface PrepareGhosttyTerminalOptions {
  /**
   * Optional ref pointing at the currently-focused pane's screen rect. When
   * provided, buffer cursor updates that land outside this rect are treated
   * as stale (caused by tmux interleaving non-focused panes' draws into the
   * shared VT) and replaced with the last cursor position seen *inside* the
   * rect. Without this, the outer terminal cursor visibly hops between
   * positions every frame whenever a non-focused pane is rendering rapidly
   * (e.g. Codex while "thinking"), because each frame's snapshot may catch
   * the buffer cursor wherever the most recent pane draw left it.
   */
  activePaneRectRef?: { current: ActivePaneRect | null };
}

interface CursorFilterState {
  lastRect: ActivePaneRect | null;
  lastValid: { visible: boolean; x: number; y: number } | null;
}

interface GhosttyPersistentTerminalLike {
  feed?: (data: Buffer | Uint8Array | string) => void;
  getJson: (options?: { limit?: number; offset?: number }) => GhosttyTerminalData;
}

interface GhosttyTerminalData {
  [key: string]: unknown;
  cursor?: [number, number];
  cursorVisible?: boolean;
  lines: unknown[];
  offset: number;
  rows: number;
  totalLines: number;
}

interface GhosttyTerminalPatchState {
  __honeymuxTmuxPatched?: boolean;
  _persistentTerminal?: GhosttyPersistentTerminalLike;
}

const MAX_NATIVE_OFFSET = 0xffff_ffff;

/**
 * Filter a buffer-reported cursor against the focused-pane rect.
 *
 * Both position AND visibility are buffer-state values that may have been
 * touched by another pane's draw cycle in the shared VT (tmux brackets
 * pane paints with hide/show even for non-active panes, which mutates the
 * VT's global DECTCEM bit). The cursor's position tells us whose draw was
 * most recently processed: if it's inside the active pane, the buffer's
 * state reflects that pane and we trust both fields. If it's outside, the
 * state reflects another pane and we substitute both with the last values
 * we saw while the cursor was inside the active pane.
 *
 * When the active pane changes, the saved last-good position is clamped
 * into the new rect so we don't carry a stale position from a different
 * pane. Visibility is preserved across rect changes.
 *
 * Exported for direct unit tests.
 */
export function filterCursorAgainstActiveRect(
  cursor: [number, number],
  cursorVisible: boolean,
  rect: ActivePaneRect | null,
  state: CursorFilterState,
): { cursor: [number, number]; visible: boolean } {
  if (!rect) {
    state.lastRect = null;
    state.lastValid = null;
    return { cursor, visible: cursorVisible };
  }

  if (state.lastRect === null || !sameRect(state.lastRect, rect)) {
    state.lastRect = rect;
    if (state.lastValid) {
      const clamped = clampToRect(state.lastValid, rect);
      state.lastValid = { visible: state.lastValid.visible, x: clamped.x, y: clamped.y };
    } else {
      state.lastValid = { visible: true, x: rect.left, y: rect.top };
    }
  }

  const [x, y] = cursor;
  if (x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height) {
    state.lastValid = { visible: cursorVisible, x, y };
    return { cursor, visible: cursorVisible };
  }

  const fallback = state.lastValid ?? { visible: true, x: rect.left, y: rect.top };
  return { cursor: [fallback.x, fallback.y], visible: fallback.visible };
}

/**
 * Keep Ghostty's persistent VT buffer aligned with tmux's current screen.
 *
 * tmux uses DECSTBM scroll regions heavily, which makes the VT emulator build
 * scrollback even while tmux itself is only showing the live screen. Asking
 * Ghostty for the full buffer every render becomes very expensive after paging
 * through large outputs like `git diff`. This wrapper keeps the existing
 * tmux-only behavior of rendering just the visible screen, but does the slice
 * in the native layer instead of serializing the whole backlog to JS first.
 *
 * Also enables DEC mode 2027 (Unicode-mode / grapheme-cluster width). Without
 * this, ghostty-vt expands grapheme clusters such as ZWJ-joined emoji into
 * multiple wide-emoji cells, while tmux internally treats them as a single
 * wide cell. The cell-layout disagreement causes tmux's incremental cell
 * updates to land at the wrong columns, accumulating visible corruption
 * during heavy redraws (e.g. dragging translucent boxes over wide-grapheme
 * lines). Tmux does not emit `\x1b[?2027h` itself, so we set it on the
 * persistent terminal directly.
 *
 * When `options.activePaneRectRef` is supplied, also installs a cursor-
 * position filter (see PrepareGhosttyTerminalOptions for rationale).
 */
export function prepareGhosttyTerminalForTmux(
  terminal: GhosttyTerminalRenderable,
  options?: PrepareGhosttyTerminalOptions,
): void {
  terminal.feed("\x1b[20l");
  terminal.feed("\x1b[?2027h");

  const internal = terminal as unknown as GhosttyTerminalPatchState;
  const persistentTerminal = internal._persistentTerminal;
  if (!persistentTerminal || internal.__honeymuxTmuxPatched) {
    return;
  }

  const filterState: CursorFilterState = { lastRect: null, lastValid: null };
  const rectRef = options?.activePaneRectRef;

  const originalGetJson = persistentTerminal.getJson.bind(persistentTerminal);
  persistentTerminal.getJson = (options = {}) => {
    const data = (() => {
      if (options.offset !== undefined || options.limit !== undefined) {
        return originalGetJson(options);
      }
      const meta = originalGetJson({ limit: 1, offset: MAX_NATIVE_OFFSET });
      if (meta.rows <= 0 || meta.totalLines <= meta.rows) {
        return originalGetJson();
      }
      const visibleOffset = Math.max(0, meta.totalLines - meta.rows);
      return originalGetJson({ limit: meta.rows, offset: visibleOffset });
    })();

    if (rectRef && data.cursor) {
      const filtered = filterCursorAgainstActiveRect(
        data.cursor,
        data.cursorVisible ?? true,
        rectRef.current,
        filterState,
      );
      if (filtered.cursor !== data.cursor) {
        data.cursor = filtered.cursor;
      }
      if (filtered.visible !== data.cursorVisible) {
        data.cursorVisible = filtered.visible;
      }
    }

    return data;
  };

  internal.__honeymuxTmuxPatched = true;
}

function clampToRect(point: { x: number; y: number }, rect: ActivePaneRect): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, rect.left), rect.left + rect.width - 1),
    y: Math.min(Math.max(point.y, rect.top), rect.top + rect.height - 1),
  };
}

function sameRect(a: ActivePaneRect, b: ActivePaneRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
