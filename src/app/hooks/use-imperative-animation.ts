import type { BoxRenderable, OptimizedBuffer } from "@opentui/core";
import type { RefObject } from "react";

import { useEffect, useRef } from "react";

/**
 * Drive an animated <box> renderable without going through React re-renders.
 *
 * The standard React pattern for a ticking animation is a setInterval that
 * calls setState, forcing the whole component subtree to reconcile on every
 * frame.  For decorative effects on a terminal UI that ticks at 10-30 Hz,
 * this is expensive: each React render creates fresh JSX objects, walks
 * fibers, diffs props, and routes through opentui's prop setters — all
 * paying GC pressure for work that's ultimately invariant.
 *
 * This hook provides the imperative alternative: a self-paced setTimeout
 * loop that calls requestRender() directly on the target renderable, and
 * a renderAfter callback that paints the current frame from a ref-held
 * state snapshot.  React re-renders the parent component only when the
 * *structural* props change (position, size, visibility gating, etc.) —
 * never for animation ticks.
 *
 * Usage:
 *
 *   const { ref, renderAfter } = useImperativeAnimation({
 *     state: { hasAgent, lastOutputAt },
 *     getRefreshDelay: (state, now) =>
 *       state.hasAgent ? 50 : null,
 *     paint(buffer, state, now) {
 *       // this === BoxRenderable.  Draw into buffer based on state + now.
 *       buffer.drawText(...);
 *     },
 *   });
 *
 *   return <box ref={ref} renderAfter={renderAfter} .../>
 *
 * The state argument is captured by reference on every React render, so the
 * paint callback always sees the latest props.  When the caller provides a
 * new state object, the timer loop is also restarted immediately so an idle
 * animation can wake up right away instead of waiting for its next idle poll.
 * The renderAfter and ref identities are stable across renders — opentui
 * will not spuriously re-invalidate the target.
 *
 * Return value from getRefreshDelay:
 *   - null    : idle.  The hook polls at idlePollMs without issuing renders,
 *               waiting for state to change and reactivate the animation.
 *               Use this when the animation is visibly at rest (wave is
 *               drained, mascot is stable, etc.).
 *   - number  : schedule the next frame this many milliseconds from now.
 *               The hook will call requestRender() on the target renderable
 *               and then reschedule itself via a recursive getRefreshDelay.
 *
 * Mutable per-animation state (e.g. a mascot's current frame index) should
 * live in a useRef on the caller and be passed through `state` as part of
 * the snapshot.  Both getRefreshDelay and paint can read and update it.
 */
interface UseImperativeAnimationOptions<TState> {
  /**
   * Compute how long until the next animation frame should fire.  Called
   * from the internal timer loop with the latest state and the current
   * timestamp.  Return null to idle-poll, or a positive number of
   * milliseconds to schedule the next render.
   */
  getRefreshDelay(state: TState, now: number): null | number;

  /**
   * Interval (ms) between idle polls when getRefreshDelay returns null.
   * Lower values shorten the idle-to-active latency when props change;
   * higher values save CPU.  Default: 500ms.
   */
  idlePollMs?: number;

  /**
   * Paint the current frame into the buffer.  Called by opentui's render
   * loop as a renderAfter callback.  `this` is bound to the BoxRenderable
   * so you can read geometry (this.x, this.y, this.width, this.height).
   * The current time is passed as an argument so you don't need to call
   * performance.now() yourself.
   */
  paint(this: BoxRenderable, buffer: OptimizedBuffer, state: TState, now: number): void;

  /**
   * The current state snapshot.  Captured in a ref on every render; the
   * renderAfter callback and timer loop always read the latest value.
   * The shape is up to the caller — bundle whatever props the paint and
   * getRefreshDelay need into an object.
   */
  state: TState;
}

interface UseImperativeAnimationResult {
  /** Attach to the target renderable via `<box ref={ref} .../>`. */
  ref: RefObject<BoxRenderable | null>;
  /** Attach to the target renderable via `<box renderAfter={renderAfter} .../>`. */
  renderAfter: (this: BoxRenderable, buffer: OptimizedBuffer, deltaTime: number) => void;
}

export function useImperativeAnimation<TState>(
  options: UseImperativeAnimationOptions<TState>,
): UseImperativeAnimationResult {
  const renderableRef = useRef<BoxRenderable | null>(null);

  // State snapshot — updated on every render so the renderAfter callback
  // (which has stable identity) always reads the latest props.
  const stateRef = useRef(options.state);
  stateRef.current = options.state;

  // Paint and delay functions are also swapped via refs on every render so
  // the captured closure identities stay stable for opentui's prop diffing.
  const paintRef = useRef(options.paint);
  paintRef.current = options.paint;

  const getRefreshDelayRef = useRef(options.getRefreshDelay);
  getRefreshDelayRef.current = options.getRefreshDelay;

  // Build the renderAfter callback exactly once.  Subsequent renders keep
  // the same function identity so opentui's renderAfter prop setter doesn't
  // invalidate the renderable on every React render.
  const renderAfterRef = useRef<((this: BoxRenderable, buffer: OptimizedBuffer, deltaTime: number) => void) | null>(
    null,
  );
  if (renderAfterRef.current == null) {
    renderAfterRef.current = function renderImperativeAnimation(this: BoxRenderable, buffer: OptimizedBuffer) {
      paintRef.current.call(this, buffer, stateRef.current, performance.now());
    };
  }

  const idlePollMs = options.idlePollMs ?? 500;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (): void => {
      if (cancelled) return;
      const now = performance.now();
      const delay = getRefreshDelayRef.current(stateRef.current, now);

      if (delay == null) {
        // Idle poll: don't issue a render.  The target renderable keeps its
        // last painted state until getRefreshDelay returns a number again.
        timeoutId = setTimeout(scheduleNext, idlePollMs);
        return;
      }

      timeoutId = setTimeout(() => {
        renderableRef.current?.requestRender();
        scheduleNext();
      }, delay);
    };

    // Kick off an immediate paint so the first frame shows up without
    // waiting for the first scheduled tick.  This also runs on state-object
    // changes so dormant animations wake immediately when fresh props arrive.
    renderableRef.current?.requestRender();
    scheduleNext();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [idlePollMs, options.state]);

  return { ref: renderableRef, renderAfter: renderAfterRef.current };
}
