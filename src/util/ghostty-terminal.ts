import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

interface GhosttyPersistentTerminalLike {
  feed?: (data: Buffer | Uint8Array | string) => void;
  getJson: (options?: { limit?: number; offset?: number }) => GhosttyTerminalData;
}

interface GhosttyTerminalData {
  [key: string]: unknown;
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
 */
export function prepareGhosttyTerminalForTmux(terminal: GhosttyTerminalRenderable): void {
  terminal.feed("\x1b[20l");
  terminal.feed("\x1b[?2027h");

  const internal = terminal as unknown as GhosttyTerminalPatchState;
  const persistentTerminal = internal._persistentTerminal;
  if (!persistentTerminal || internal.__honeymuxTmuxPatched) {
    return;
  }

  const originalGetJson = persistentTerminal.getJson.bind(persistentTerminal);
  persistentTerminal.getJson = (options = {}) => {
    if (options.offset !== undefined || options.limit !== undefined) {
      return originalGetJson(options);
    }

    const meta = originalGetJson({ limit: 1, offset: MAX_NATIVE_OFFSET });
    if (meta.rows <= 0 || meta.totalLines <= meta.rows) {
      return originalGetJson();
    }

    const visibleOffset = Math.max(0, meta.totalLines - meta.rows);
    return originalGetJson({ limit: meta.rows, offset: visibleOffset });
  };

  internal.__honeymuxTmuxPatched = true;
}
