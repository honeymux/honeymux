import { describe, expect, mock, test } from "bun:test";

import { setupInputRouter } from "./router.ts";

function createRouterHarness(options?: {
  callbacks?: Record<string, unknown>;
  keybindings?: Map<string, string>;
  tmuxPrefixKeyAliasCode?: number;
}) {
  let registeredHandler: ((sequence: string) => boolean) | null = null;

  const renderer = {
    prependInputHandler(fn: (sequence: string) => boolean) {
      registeredHandler = fn;
    },
  };

  const writeToPty = mock((_data: string) => {});
  const onDialogInput = mock((_data: string) => {});
  const onTmuxPrefixKeyAlias = mock(() => {});
  const onDropdownInput = mock((_data: string) => true);
  const onZoomStart = mock((_action: string) => {});

  setupInputRouter(
    renderer as any,
    writeToPty,
    {
      isDialogOpen: () => false,
      isReady: () => true,
      matchTmuxPrefixKeyAliasCode: (code) => code === options?.tmuxPrefixKeyAliasCode,
      onDialogInput,
      onDropdownInput,
      onTabNext: () => {},
      onTabPrev: () => {},
      onTmuxPrefixKeyAlias,
      onZoomStart,
      ...(options?.callbacks ?? {}),
    },
    () => (options?.keybindings as Map<string, any> | undefined) ?? new Map(),
  );

  if (!registeredHandler) throw new Error("router handler was not registered");
  const handler = registeredHandler as (sequence: string) => boolean;
  return { handler, onDialogInput, onDropdownInput, onTmuxPrefixKeyAlias, onZoomStart, writeToPty };
}

describe("router terminal reply handling", () => {
  test("lets OpenTUI handle kitty keyboard replies", () => {
    const { handler, onDialogInput, writeToPty } = createRouterHarness();

    expect(handler("\x1b[?0u")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
    expect(onDialogInput).not.toHaveBeenCalled();
  });

  test("lets OpenTUI handle DCS capability replies", () => {
    const { handler, writeToPty } = createRouterHarness();

    expect(handler("\x1bP1+r4d73=\\E[4m\x1b\\")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("lets OpenTUI handle Kitty graphics APC replies", () => {
    const { handler, writeToPty } = createRouterHarness();

    expect(handler("\x1b_Gi=31337;OK\x1b\\")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("lets OpenTUI handle pixel-resolution replies", () => {
    const { handler, writeToPty } = createRouterHarness();

    expect(handler("\x1b[4;1152;1678t")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("still consumes ambiguous CPR-like replies outside dialog mode", () => {
    const { handler, writeToPty } = createRouterHarness();

    expect(handler("\x1b[1;1R")).toBe(true);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("still consumes ambiguous CPR-like replies while a dialog is open", () => {
    const { handler, onDialogInput, writeToPty } = createRouterHarness({
      callbacks: {
        isDialogOpen: () => true,
      },
    });

    expect(handler("\x1b[1;1R")).toBe(true);
    expect(writeToPty).not.toHaveBeenCalled();
    expect(onDialogInput).not.toHaveBeenCalled();
  });

  test("still forwards kitty CSI u keys to dialog capture", () => {
    const { handler, onDialogInput, writeToPty } = createRouterHarness({
      callbacks: {
        isDialogOpen: () => true,
      },
    });

    expect(handler("\x1b[97;8u")).toBe(true);
    expect(onDialogInput).toHaveBeenCalledWith("\x1b[97;8u");
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("dispatches modifier-only prefix alias releases before PTY forwarding", () => {
    const { handler, onTmuxPrefixKeyAlias, writeToPty } = createRouterHarness({ tmuxPrefixKeyAliasCode: 57447 });

    expect(handler("\x1b[57447;2:3u")).toBe(true);
    expect(onTmuxPrefixKeyAlias).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("does not dispatch modifier-only prefix alias releases while text input is active", () => {
    const { handler, onTmuxPrefixKeyAlias, writeToPty } = createRouterHarness({
      callbacks: {
        isTextInputActive: () => true,
      },
      tmuxPrefixKeyAliasCode: 57447,
    });

    expect(handler("\x1b[57447;2:3u")).toBe(false);
    expect(onTmuxPrefixKeyAlias).not.toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("does not trigger combo zoom bindings while text input is active", () => {
    const { handler, onZoomStart, writeToPty } = createRouterHarness({
      callbacks: {
        isTextInputActive: () => true,
      },
      keybindings: new Map([["ctrl+g", "zoomAgentsView"]]),
    });

    expect(handler("\x07")).toBe(false);
    expect(onZoomStart).not.toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("keeps modifier-only input owned by dropdowns", () => {
    const { handler, onDropdownInput, onTmuxPrefixKeyAlias, writeToPty } = createRouterHarness({
      callbacks: {
        isDropdownOpen: () => true,
      },
      tmuxPrefixKeyAliasCode: 57447,
    });

    expect(handler("\x1b[57447;2:3u")).toBe(true);
    expect(onDropdownInput).toHaveBeenCalledWith("\x1b[57447;2:3u");
    expect(onTmuxPrefixKeyAlias).not.toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });
});
