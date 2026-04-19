import type { MutableRefObject } from "react";

import type { KeyAction } from "../../util/keybindings.ts";
import type { OptionsWorkflowApi } from "../hooks/use-options-workflow.ts";

import { isDismissKey } from "../../util/keybindings.ts";
import { applyOptionsDialogState, buildOptionsDialogState, confirmOptionsDialog } from "./bridge.ts";
import { routeOptionsDialogInput } from "./controller.ts";
import { maybeStartRemoteTest } from "./remote-test.ts";

let suppressNextOptionsModifierRelease = false;

export interface OptionsDialogDispatchDeps {
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  onReturnToMainMenu: () => void;
  optionsWorkflow: OptionsWorkflowApi;
  sequenceMapRef: MutableRefObject<Map<string, KeyAction>>;
}

export function dispatchOptionsDialogInput(data: string, deps: OptionsDialogDispatchDeps): void {
  if (deps.dropdownInputRef.current) {
    deps.dropdownInputRef.current(data);
    return;
  }

  const current = buildOptionsDialogState(deps.optionsWorkflow);
  const result = routeOptionsDialogInput(data, current, {
    sequenceMap: deps.sequenceMapRef.current,
    suppressModifierRelease: suppressNextOptionsModifierRelease,
  });
  suppressNextOptionsModifierRelease = result.suppressModifierRelease;

  if (result.kind === "confirm") {
    suppressNextOptionsModifierRelease = false;
    const returnToMainMenu = isDismissKey(data) && deps.optionsWorkflow.openedFromMainMenuRef.current;
    deps.optionsWorkflow.openedFromMainMenuRef.current = false;
    void confirmOptionsDialog(deps.optionsWorkflow, result.draft);
    if (returnToMainMenu) deps.onReturnToMainMenu();
    return;
  }

  if (result.kind === "update") {
    applyOptionsDialogState(deps.optionsWorkflow, result.draft);
    maybeStartRemoteTest(current, result.draft, deps.optionsWorkflow);
  }
}
