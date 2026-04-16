import type { BoxRenderable, Renderable } from "@opentui/core";

declare module "@opentui/core" {
  interface BoxOptions<_TRenderable extends Renderable = BoxRenderable> {
    selectable?: boolean;
  }
}
