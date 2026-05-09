import { RGBA } from "@opentui/core";
import { extend } from "@opentui/react";
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import { useEffect, useMemo, useRef } from "react";

// Register the ghostty terminal component for JSX use
extend({ "ghostty-terminal": GhosttyTerminalRenderable });

// Augment JSX types so TypeScript recognizes <ghostty-terminal>
declare module "@opentui/react" {
  interface OpenTUIComponents {
    "ghostty-terminal": typeof GhosttyTerminalRenderable;
  }
}

interface TerminalViewProps {
  bg?: RGBA | string;
  cols: number;
  onReady?: (terminal: GhosttyTerminalRenderable) => void;
  rows: number;
  showCursor?: boolean;
}

/**
 * Single terminal view for the PTY-based tmux rendering.
 *
 * The ghostty terminal is wrapped in a clipping box sized to exactly cols×rows.
 * prepareGhosttyTerminalForTmux() already limits the persistent terminal's
 * getJson() to the visible screen, so no scrollbox is needed.
 */
export function TerminalView({ bg, cols, onReady, rows, showCursor = false }: TerminalViewProps) {
  const termRef = useRef<GhosttyTerminalRenderable>(null);
  const readyFired = useRef(false);

  useEffect(() => {
    if (termRef.current && !readyFired.current) {
      readyFired.current = true;
      onReady?.(termRef.current);
    }
  });

  // Default to the SGR-49 "default background" intent so the pane area
  // adopts whatever bg the host terminal is currently using — same behavior
  // as plain tmux, which never paints its own bg fill.  This avoids the
  // wrong-color rectangle on terminals that don't reply to OSC 11 (e.g.
  // Warp), where the probe falls back to a theme color.
  //
  // Passing explicit width={cols}/height={rows} is important for perf: it
  // makes the renderable's _width/_height literal numbers instead of the
  // default "auto" string.  ghostty-opentui's syncTextInfoAfterAnsiUpdate
  // checks `typeof this._width === "number"` as its "has fixed viewport"
  // condition; if false, it falls back to calling updateTextInfo() which
  // unconditionally requests another render.  That creates a ~1:1 feedback
  // loop where every PTY feed triggers two renders: one from feed() and
  // one from the post-renderSelf updateTextInfo() call.  With explicit
  // numeric width/height, the fast path fires and the loop is broken.
  const defaultBg = useMemo(() => RGBA.defaultBackground(), []);
  return (
    <box height={rows} overflow="hidden" width={cols}>
      <ghostty-terminal
        bg={bg ?? defaultBg}
        cols={cols}
        height={rows}
        persistent={true}
        ref={termRef}
        rows={rows}
        showCursor={showCursor}
        width={cols}
      />
    </box>
  );
}
