import type { Mutation } from "./reconciler.ts";
import type { RunTmuxCommand } from "./snapshot.ts";

import { quoteTmuxArg } from "../../tmux/escape.ts";
import { log } from "../../util/log.ts";
import { LOCAL_PANE_ID_TAG, LOCAL_WINDOW_ID_TAG } from "./snapshot.ts";

export interface ApplyMutationsOptions {
  /**
   * Per-mutation overall plan label for diagnostic logging. The label is
   * tagged into log lines so failures can be correlated with the server
   * they belong to.
   */
  label: string;
  /**
   * Local tmux command-sender. Currently unused — kept in the surface so
   * future mutations that touch local state (e.g. tagging local panes
   * via the convert flow) can be wired through the executor.
   */
  runLocal: RunTmuxCommand;
  runRemote: RunTmuxCommand;
}

/**
 * Result of applying a `MirrorPlan` against a remote tmux server.
 *
 * The reconciler is pure; the executor turns mutations into tmux commands
 * and reports back which mutations actually succeeded so callers can
 * update derived state (notably the last-applied-layout cache) only for
 * the operations that took effect.
 */
export interface ExecutorResult {
  /**
   * Local-window id → remote-window id pairings created during this
   * execution (one per `create-window` mutation that succeeded). The
   * caller (RemoteMirror) merges these into its derived index after
   * the next snapshot is taken — useful between the create and the
   * next reconcile when the executor has fresh information that the
   * snapshot doesn't reflect yet.
   */
  appliedCreateWindows: ReadonlyMap<string, string>;
  /** Remote window ids whose layout was successfully applied. */
  appliedLayouts: ReadonlyMap<string, string>;
  /**
   * Local-pane id → remote-pane id pairings for every pane created this pass
   * via split-window or a create-window's initial pane — including untagged
   * phantoms, which still mirror a local pane and must be resolvable via
   * `remotePaneFor()`. Same role as `appliedCreateWindows`.
   */
  appliedSplits: ReadonlyMap<string, string>;
  failures: ReadonlyArray<{ error: string; mutation: Mutation }>;
}

/**
 * Apply a sequence of mutations to the remote tmux server, in order.
 *
 * Per-mutation errors are caught and reported in the result rather than
 * stopping the loop — the next reconcile pass repairs whatever this one
 * could not, and the executor must be re-entrant (the reconciler's
 * idempotency guarantees that re-applying the same plan after a partial
 * failure produces a smaller or empty plan, never a duplicate one).
 */
export async function applyMutations(
  mutations: ReadonlyArray<Mutation>,
  options: ApplyMutationsOptions,
): Promise<ExecutorResult> {
  const appliedCreateWindows = new Map<string, string>();
  const appliedSplits = new Map<string, string>();
  const appliedLayouts = new Map<string, string>();
  const failures: { error: string; mutation: Mutation }[] = [];

  for (const mutation of mutations) {
    try {
      switch (mutation.kind) {
        case "apply-layout": {
          await options.runRemote(
            `select-layout -t ${quoteTmuxArg("remoteWindowId", mutation.remoteWindowId)} ${quoteTmuxArg("layout", mutation.layout)}`,
          );
          appliedLayouts.set(mutation.remoteWindowId, mutation.layout);
          break;
        }
        case "create-window": {
          // Create the remote window AND its initial pane, capture both
          // ids, then tag the window before any subsequent reconcile can
          // race in and classify it as an orphan. The initial pane only
          // gets `@hmx-local-pane-id` when it actually mirrors a
          // remote-backed local pane; layout-only phantoms stay untagged so
          // swap-pane between local windows doesn't churn the mirror.
          const output = await options.runRemote(`new-window -d -P -F '#{window_id} #{pane_id}'`);
          const trimmed = output.trim();
          const parts = trimmed.split(/\s+/);
          const remoteWindowId = parts[0];
          const remotePaneId = parts[1];
          if (!remoteWindowId || !remotePaneId) {
            throw new Error(`new-window returned malformed output: ${JSON.stringify(trimmed)}`);
          }
          await options.runRemote(
            `set-option -w -t ${quoteTmuxArg("remoteWindowId", remoteWindowId)} ${LOCAL_WINDOW_ID_TAG} ${quoteTmuxArg("localWindowId", mutation.localWindowId)}`,
          );
          if (mutation.initialPaneIsRemoteBacked) {
            await options.runRemote(
              `set-option -p -t ${quoteTmuxArg("remotePaneId", remotePaneId)} ${LOCAL_PANE_ID_TAG} ${quoteTmuxArg("localPaneId", mutation.initialLocalPaneId)}`,
            );
          }
          // Record the pairing whether or not the pane carries a routing tag:
          // an untagged phantom still mirrors a local pane and must resolve
          // via `remotePaneFor()` so that pane can be converted.
          appliedSplits.set(mutation.initialLocalPaneId, remotePaneId);
          appliedCreateWindows.set(mutation.localWindowId, remoteWindowId);
          break;
        }
        case "kill-pane": {
          await options.runRemote(`kill-pane -t ${quoteTmuxArg("remotePaneId", mutation.remotePaneId)}`);
          break;
        }
        case "kill-window": {
          await options.runRemote(`kill-window -t ${quoteTmuxArg("remoteWindowId", mutation.remoteWindowId)}`);
          break;
        }
        case "split-window": {
          const output = await options.runRemote(
            `split-window -t ${quoteTmuxArg("remoteWindowId", mutation.remoteWindowId)} -d -P -F '#{pane_id}'`,
          );
          const remotePaneId = output.trim();
          if (!remotePaneId) {
            throw new Error("split-window returned an empty pane id");
          }
          if (mutation.isRemoteBacked) {
            await options.runRemote(
              `set-option -p -t ${quoteTmuxArg("remotePaneId", remotePaneId)} ${LOCAL_PANE_ID_TAG} ${quoteTmuxArg("localPaneId", mutation.localPaneId)}`,
            );
          }
          appliedSplits.set(mutation.localPaneId, remotePaneId);
          break;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ error, mutation });
      log("remote", `${options.label}: mutation ${mutation.kind} failed: ${error}`);
    }
  }

  return { appliedCreateWindows, appliedLayouts, appliedSplits, failures };
}
