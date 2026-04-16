import { extend } from "@opentui/react";
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import { useEffect, useRef } from "react";

import { rgbToHex, terminalBgRgb } from "../themes/theme.ts";

// Register the ghostty terminal component for JSX use
extend({ "ghostty-terminal": GhosttyTerminalRenderable });

// Augment JSX types so TypeScript recognizes <ghostty-terminal>
declare module "@opentui/react" {
  interface OpenTUIComponents {
    "ghostty-terminal": typeof GhosttyTerminalRenderable;
  }
}

interface TerminalViewProps {
  bg?: string;
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

  // Match the outer terminal emulator's background (queried via OSC 11 at
  // startup) so the honeymux pane area blends into the host terminal
  // instead of painting its own color on top.  ghostty-opentui v1.4.10
  // changed GhosttyTerminalRenderable to hard-code #1e1e1e when no bg is
  // passed, which produced a visible gray rectangle that clashed with the
  // host terminal's actual bg — pass the probed color explicitly to fix.
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
  return (
    <box height={rows} overflow="hidden" width={cols}>
      <ghostty-terminal
        bg={bg ?? rgbToHex(terminalBgRgb)}
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
