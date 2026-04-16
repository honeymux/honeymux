#!/usr/bin/env python3
"""Codex CLI SessionStart hook for honeymux."""

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time


REMOTE_HOOK_SOCKET_OPTION = "@hmx-agent-socket-path"
REMOTE_HOOK_SOCKET_RE = r"^/.*?/hmx-remote-hook-[0-9a-f]{16}\.sock$"


def get_runtime_dir():
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir:
        return ensure_private_dir(os.path.join(runtime_dir, "honeymux"))
    return ensure_private_dir(os.path.join(get_state_home(), "honeymux", "runtime"))


def get_runtime_path(name):
    return os.path.join(get_runtime_dir(), name)


def get_socket_path():
    override = get_tmux_remote_socket_path()
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


def get_tty():
    ppid = os.getppid()
    try:
        return os.readlink(f"/proc/{ppid}/fd/0")
    except OSError:
        return None


def running_in_honeymux():
    """Check if we're inside a honeymux-managed tmux session."""
    tmux = os.environ.get("TMUX", "")
    return "honeymux" in tmux


def main():
    if not running_in_honeymux():
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, IOError):
        data = {}

    if data.get("hook_event_name") != "SessionStart":
        sys.exit(0)

    event = {
        "sessionId": data.get("session_id", ""),
        "agentType": "codex",
        "status": "alive",
        "cwd": data.get("cwd", os.getcwd()),
        "pid": os.getppid(),
        "tty": get_tty(),
        "timestamp": time.time(),
        "hookEvent": "SessionStart",
        "remoteHost": platform.node(),
    }

    sock_path = get_socket_path()

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(sock_path)
        sock.sendall((json.dumps(event) + "\n").encode())
        sock.close()
    except (socket.error, OSError):
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
