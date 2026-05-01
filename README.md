<h1>
<p align="center">
  <a href="https://github.com/honeymux">
    <img src="https://avatars.githubusercontent.com/u/264235977?s=200&v=4" alt="Logo" width="128">
  </a>
  <br>Honeymux
</p>
</h1>
<p align="center">
  Reach terminal velocity.
  <br />
  All of your agents, shells, and TUIs in one durable<a href="#durable">*</a> terminal workspace.
</p>
<p align="center">
  <strong><a href="https://hmx.dev">https://hmx.dev</a></strong>
</p>

## About

Honeymux is a TUI wrapper for [tmux](https://en.wikipedia.org/wiki/Tmux) that adds a wide range of features and interaction surfaces to your terminal.

<p align="center">
  <img src="https://assets.hmx.dev/generated/docs-shots/introduction/main.png" alt="Screenshot">
</p>

These features include:

- Hook-based agent monitoring
- Kitty keyboard protocol support
- Layout profiles
- Mobile-optimized UI (coming soon)
- Pane tabs
- Per-pane OS-native scrollback and search
- Remote-backed pane stitching (SSH)
- Screenshots
- Session menu / editor
- Sidebar
- Toolbar
- Window tabs

Try the interactive demo in a browser terminal at [https://hmx.dev](https://hmx.dev) !

Honeymux is base16-themed and has a zero-config bootstrap. Most user preferences (e.g. key bindings) are configured through the [Main Menu](https://docs.hmx.dev/main-menu/) and [Options](https://docs.hmx.dev/options/) dialogs.

Give it a try if one or more of the following describes you:

- You spend a lot of time at the command line, or are looking to do so
- You are seeking a terminal experience that's a bit closer to a desktop experience
- You have trouble keeping up with your coding agents during multitasking
- You understand the power of tmux but struggle with managing it
- You would like to merge your local and remote tmux panes into a single portable view

Please also check out [OpenTUI](https://github.com/anomalyco/opentui), [libghostty-vt](https://github.com/ghostty-org/ghostty/tree/main/include/ghostty/vt), and [ghostty-opentui](https://github.com/remorses/ghostty-opentui) -- this software would not exist without these in combination.

<a name="durable"></a>

## Durability

Honeymux is powered by tmux, a terminal multiplexer first released in 2007 and battle-tested across nearly two decades of production use on every Unix system that matters. It's about as solid a foundation as software gets. That durability flows through. Your sessions survive dropped SSH connections and crashed clients — long-running agents and shells keep running. Reattach from anywhere and pick up exactly where you left off.

## Install or upgrade

```bash
brew install honeymux/tap/hmx
```

or

```bash
curl -fsSL https://get.hmx.dev | bash
```

> [!CAUTION]
> Please restart both tmux and hmx entirely after upgrading. Neither program guarantees backward compatibility with existing tmux server state after upgrades.

## Documentation

See the [documentation](https://docs.hmx.dev) on the Honeymux website.

> [!WARNING]
> This is new, pre-1.0 release software and is yet to be pressure-tested in a wider variety of environments. Give it a try but expect bugs and YMMV on stability depending on the subset of features you use.
