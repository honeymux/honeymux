#!/usr/bin/env python3
"""Codex CLI lifecycle hook for honeymux.

Fire-and-forget notifier for SessionStart and PermissionRequest. The hook
never emits a decision, so Codex always falls through to its own native
approval prompt (see orchestrator.rs::request_approval). Honeymux uses the
event purely to surface a notification; the user answers Codex's prompt
directly in the pane. If Codex later adds a mode that lets the hook and
native prompt run concurrently, this file is where we'd grow an interactive
allow/deny path.
"""

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time


EVENT_STATUS_MAP = {
    "SessionStart": "alive",
    "PermissionRequest": "unanswered",
}

REMOTE_HOOK_SOCKET_OPTION = "@hmx-agent-socket-path"
REMOTE_HOOK_SOCKET_RE = r"^/.*?/hmx-remote-hook-[0-9a-f]{16}\.sock$"
TMUX_PANE_RE = r"^%\d+$"


def get_runtime_dir():
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir:
        return ensure_private_dir(os.path.join(runtime_dir, "honeymux"))
    return ensure_private_dir(os.path.join(get_state_home(), "honeymux", "runtime"))


def get_runtime_path(name):
    return os.path.join(get_runtime_dir(), name)


def get_socket_path(override=None):
    if override:
        return override

    return get_runtime_path("hmx-codex.sock")


def get_state_home():
    state_home = os.environ.get("XDG_STATE_HOME")
    if state_home:
        return state_home
    return os.path.join(os.path.expanduser("~"), ".local", "state")


def ensure_private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    return path


def get_tmux_remote_socket_path():
    if not os.environ.get("TMUX"):
        return None

    try:
        proc = subprocess.run(
            ["tmux", "show-option", "-gqv", REMOTE_HOOK_SOCKET_OPTION],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    if proc.returncode != 0:
        return None

    path = proc.stdout.strip()
    if not path or not os.path.isabs(path):
        return None
    if not re_match_remote_hook_socket(path):
        return None
    return path


def re_match_remote_hook_socket(path):
    return re.match(REMOTE_HOOK_SOCKET_RE, path) is not None


def running_in_honeymux():
    """Check if we're inside a honeymux-managed tmux session."""
    tmux = os.environ.get("TMUX", "")
    return "honeymux" in tmux


def normalize_tty(tty_name):
    tty = tty_name.strip()
    if not tty or tty in ("-", "?", "??"):
        return None
    if tty.startswith("/dev/"):
        return tty
    return f"/dev/{tty}"


def get_tty():
    ppid = os.getppid()
    try:
        proc = subprocess.run(
            ["ps", "-ww", "-o", "tty=", "-p", str(ppid)],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return normalize_tty(proc.stdout)


def get_tmux_pane_id():
    pane_id = os.environ.get("TMUX_PANE", "").strip()
    if not pane_id or re.match(TMUX_PANE_RE, pane_id) is None:
        return None
    return pane_id


def main():
    if not running_in_honeymux():
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, IOError):
        data = {}

    hook_event = data.get("hook_event_name", "")
    status = EVENT_STATUS_MAP.get(hook_event)
    if not status:
        sys.exit(0)

    session_id = data.get("session_id", "")
    cwd = data.get("cwd", os.getcwd())
    tool_name = data.get("tool_name")
    tool_input = data.get("tool_input")
    # Codex surfaces the active turn rather than a per-call tool_use_id, so we
    # use turn_id as the permission-routing key when available.
    turn_id = data.get("turn_id")
    parent_pid = os.getppid()

    remote_socket_path = get_tmux_remote_socket_path()
    pane_id = get_tmux_pane_id()
    tty = get_tty() if remote_socket_path or not pane_id else None

    event = {
        "sessionId": session_id,
        "agentType": "codex",
        "status": status,
        "cwd": cwd,
        "pid": parent_pid,
        "timestamp": time.time(),
        "hookEvent": hook_event,
        "remoteHost": platform.node(),
    }

    if pane_id:
        event["paneId"] = pane_id
    if tty:
        event["tty"] = tty
    if tool_name:
        event["toolName"] = tool_name
    if isinstance(tool_input, dict):
        event["toolInput"] = tool_input
    if turn_id:
        event["toolUseId"] = turn_id

    sock_path = get_socket_path(remote_socket_path)

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(sock_path)
        sock.sendall((json.dumps(event) + "\n").encode())
        sock.close()
    except (socket.error, OSError):
        pass

    # Always exit without writing anything to stdout — Codex interprets that
    # as "no decision" and proceeds with its native approval prompt.
    sys.exit(0)


if __name__ == "__main__":
    main()
