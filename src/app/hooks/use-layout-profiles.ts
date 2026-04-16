import { useCallback, useEffect, useRef, useState } from "react";

import type { LayoutProfile } from "../../tmux/types.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { TmuxSessionState, UiChromeState } from "./use-app-state-groups.ts";

import { formatArgv } from "../../util/argv.ts";
import { reattachSessionPty } from "../runtime/tmux-client-resync.ts";
import { loadLayoutProfiles, saveLayoutProfiles } from "../services/session-persistence.ts";

export interface LayoutProfilesApi {
  handleApplyFavoriteProfile: () => void;
  handleDeleteProfile: (name: string) => void;
  handleLayoutProfileClick: () => void;
  handleLayoutSave: (name: string) => Promise<LayoutProfile | undefined>;
  handleLayoutSelect: (profile: LayoutProfile) => Promise<void>;

  handleRenameProfile: (oldName: string, newName: string) => void;
  handleSaveCommands: (profileName: string, commands: string[][]) => void;
  handleSetFavorite: (profileName: string) => void;
  layoutDropdownOpen: boolean;
  layoutProfiles: LayoutProfile[];
  setLayoutDropdownOpen: (open: boolean) => void;
}

interface UseLayoutProfilesOptions {
  refs: AppRuntimeRefs;
  tmuxSessionState: TmuxSessionState;
  uiChromeState: UiChromeState;
}

export function useLayoutProfiles({
  refs,
  tmuxSessionState,
  uiChromeState,
}: UseLayoutProfilesOptions): LayoutProfilesApi {
  const {
    clientRef,
    dropdownInputRef,
    ptyRef,
    spawnPtyBridgeRef,
    terminalRef,
    textInputActive: textInputActiveRef,
  } = refs;
  const { currentSessionName } = tmuxSessionState;
  const { setDropdownOpen } = uiChromeState;
  const [layoutDropdownOpen, setLayoutDropdownOpenState] = useState(false);
  const [layoutProfiles, setLayoutProfiles] = useState<LayoutProfile[]>([]);

  const layoutProfilesRef = useRef<LayoutProfile[]>([]);
  layoutProfilesRef.current = layoutProfiles;

  const sortProfiles = (list: LayoutProfile[]) => list.sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    loadLayoutProfiles().then((p) => setLayoutProfiles(sortProfiles(p)));
  }, []);

  const setLayoutDropdownOpen = useCallback((open: boolean) => {
    setLayoutDropdownOpenState(open);
  }, []);

  const applyLayoutProfile = useCallback(
    async (profile: LayoutProfile) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        await client.killAllPanesExceptActive();
        if (profile.paneCount > 1) {
          await client.createPanes(profile.paneCount - 1);
        }
        await client.applyLayout(profile.layout);

        // Send per-pane commands as keystrokes to the shells
        if (profile.commands && profile.commands.some((cmd) => cmd.length > 0)) {
          const paneIds = await client.listWindowPaneIds();
          for (let i = 0; i < paneIds.length && i < profile.commands.length; i++) {
            const cmd = profile.commands[i];
            if (cmd && cmd.length > 0) {
              await client.sendKeysToPane(paneIds[i]!, formatArgv(cmd));
            }
          }
        }
      } catch {
        // ignore
      }
    },
    [clientRef],
  );

  const shouldReattachSessionPty = useCallback(
    (profile: Pick<LayoutProfile, "commands" | "paneCount">) =>
      profile.paneCount > 1 || Boolean(profile.commands?.some((cmd) => cmd.length > 0)),
    [],
  );

  // Profiles rebuild the active window out-of-band via the control client.
  // Reattaching the PTY gives tmux a fresh terminal to paint into immediately.
  const resyncProfileSessionPty = useCallback(() => {
    reattachSessionPty({
      ptyRef,
      sessionName: currentSessionName,
      spawnPtyBridge: spawnPtyBridgeRef.current,
      terminalRef,
    });
  }, [currentSessionName, ptyRef, spawnPtyBridgeRef, terminalRef]);

  const handleLayoutProfileClick = useCallback(() => {
    dropdownInputRef.current = null;
    setLayoutDropdownOpenState((open) => !open);
    setDropdownOpen(false);
  }, [dropdownInputRef, setDropdownOpen]);

  const handleLayoutSave = useCallback(
    async (name: string): Promise<LayoutProfile | undefined> => {
      const client = clientRef.current;
      if (!client) return undefined;

      try {
        const layout = await client.getWindowLayout();
        // Count panes from layout string — each leaf node matches WxH,X,Y,ID
        const paneCount = (layout.match(/\d+x\d+,\d+,\d+,\d+/g) || []).length;
        const profile: LayoutProfile = { layout, name, paneCount, savedAt: Date.now() };

        setLayoutProfiles((prev) => {
          const updated = [...prev, profile];
          sortProfiles(updated);
          saveLayoutProfiles(updated);
          return updated;
        });

        return profile;
      } catch {
        return undefined;
      }
    },
    [clientRef],
  );

  const handleLayoutSelect = useCallback(
    async (profile: LayoutProfile) => {
      dropdownInputRef.current = null;
      setLayoutDropdownOpenState(false);

      const client = clientRef.current;
      if (!client) return;

      try {
        await client.newWindow();
        await applyLayoutProfile(profile);
        if (shouldReattachSessionPty(profile)) {
          resyncProfileSessionPty();
        }
      } catch {
        // ignore
      }
    },
    [applyLayoutProfile, clientRef, dropdownInputRef, resyncProfileSessionPty, shouldReattachSessionPty],
  );

  const handleDeleteProfile = useCallback((name: string) => {
    setLayoutProfiles((prev) => {
      const updated = prev.filter((p) => p.name !== name);
      saveLayoutProfiles(updated);
      return updated;
    });
  }, []);

  const handleRenameProfile = useCallback(
    (oldName: string, newName: string) => {
      textInputActiveRef.current = false;
      setLayoutProfiles((prev) => {
        const updated = prev.map((p) => (p.name === oldName ? { ...p, name: newName } : p));
        sortProfiles(updated);
        saveLayoutProfiles(updated);
        return updated;
      });
    },
    [textInputActiveRef],
  );

  const handleSaveCommands = useCallback((profileName: string, commands: string[][]) => {
    setLayoutProfiles((prev) => {
      const updated = prev.map((p) => (p.name === profileName ? { ...p, commands } : p));
      saveLayoutProfiles(updated);
      return updated;
    });
  }, []);

  const handleSetFavorite = useCallback((profileName: string) => {
    setLayoutProfiles((prev) => {
      const updated = prev.map((p) => {
        if (p.name === profileName) {
          // Toggle: if already favorite, unset; otherwise set
          const { favorite, ...rest } = p;
          return favorite ? (rest as LayoutProfile) : { ...p, favorite: true };
        }
        // Clear favorite from all other profiles
        const { favorite, ...rest } = p;
        return favorite ? (rest as LayoutProfile) : p;
      });
      saveLayoutProfiles(updated);
      return updated;
    });
  }, []);

  const handleApplyFavoriteProfile = useCallback(async () => {
    const favorite = layoutProfilesRef.current.find((p) => p.favorite);
    if (!favorite) return;
    await handleLayoutSelect(favorite);
  }, [handleLayoutSelect]);

  return {
    handleApplyFavoriteProfile,
    handleDeleteProfile,
    handleLayoutProfileClick,
    handleLayoutSave,
    handleLayoutSelect,

    handleRenameProfile,
    handleSaveCommands,
    handleSetFavorite,
    layoutDropdownOpen,
    layoutProfiles,
    setLayoutDropdownOpen,
  };
}
