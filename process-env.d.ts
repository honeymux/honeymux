declare namespace NodeJS {
  interface ProcessEnv {
    HOME?: string;
    LANG?: string;
    LC_ALL?: string;
    LC_CTYPE?: string;
    SHELL?: string;
    TERM?: string;
    TMUX?: string;
    TMUX_TMPDIR?: string;
    XDG_CONFIG_HOME?: string;
    XDG_RUNTIME_DIR?: string;
    XDG_STATE_HOME?: string;
  }
}
