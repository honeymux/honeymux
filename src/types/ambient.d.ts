import type { BoxRenderable, Renderable } from "@opentui/core";

declare module "@opentui/core" {
  interface BoxOptions<_TRenderable extends Renderable = BoxRenderable> {
    selectable?: boolean;
  }
}

// FFI exports added by patches/ghostty-opentui/0004-base-palette-override.patch.
// Declared here so typecheck succeeds in CI, which runs `bun install --ignore-scripts`
// and never sees the patched node_modules tree.
declare module "ghostty-opentui" {
  export function clearBasePalette(): void;
  export function setBasePaletteEntry(idx: number, r: number, g: number, b: number): void;
}
