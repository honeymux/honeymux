#!/usr/bin/env python3
"""Gemini CLI lifecycle hook for honeymux.

Reads event JSON from stdin, maps to agent status, sends to Unix socket.
"""

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

    return get_runtime_path("hmx-gemini.sock")


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
    """Get the TTY of the parent Gemini process via /proc."""
    ppid = os.getppid()
    try:
        return os.readlink(f"/proc/{ppid}/fd/0")
    except OSError:
        return None


def running_in_honeymux():
    """Check if we're inside a honeymux-managed tmux session."""
    tmux = os.environ.get("TMUX", "")
    return "honeymux" in tmux


# Events we send to honeymux and their status mapping
EVENT_MAP = {
    "SessionStart": "alive",
    "BeforeAgent": None,       # Not a status change — used to capture prompt
    "Notification": None,      # Handled specially (only ToolPermission → unanswered)
    "SessionEnd": "ended",
}


def send_event(event):
    sock_path = get_socket_path()
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(sock_path)
        sock.sendall((json.dumps(event) + "\n").encode())
        sock.close()
        return True
    except (socket.error, OSError):
        return False


def main():
    if not running_in_honeymux():
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, IOError):
        data = {}

    hook_event = data.get("hook_event_name", "")
    if hook_event not in EVENT_MAP:
        sys.exit(0)

    session_id = data.get("session_id", "")
    cwd = data.get("cwd", os.getcwd())

    def base_event(status, he=hook_event):
        ev = {
            "sessionId": session_id,
            "agentType": "gemini",
            "status": status,
            "cwd": cwd,
            "pid": os.getppid(),
            "tty": get_tty(),
            "timestamp": time.time(),
            "hookEvent": he,
            "remoteHost": platform.node(),
        }
        # Forward transcript path when available
        transcript_path = data.get("transcript_path")
        if transcript_path:
            ev["transcriptPath"] = transcript_path
        return ev

    # --- BeforeAgent: capture user prompt and forward it ---
    # This fires before the first tool call, carrying the user's prompt text.
    if hook_event == "BeforeAgent":
        prompt = data.get("prompt")
        if prompt:
            ev = base_event("alive")
            ev["prompt"] = prompt[:200]
            send_event(ev)
        sys.exit(0)

    # --- SessionStart / SessionEnd ---
    if hook_event in ("SessionStart", "SessionEnd"):
        ev = base_event(EVENT_MAP[hook_event])
        prompt = data.get("prompt")
        if prompt:
            ev["prompt"] = prompt[:200]
        send_event(ev)
        sys.exit(0)

    # --- Notification: only ToolPermission → unanswered ---
    if hook_event == "Notification":
        notification_type = data.get("notification_type", "")
        if notification_type != "ToolPermission":
            sys.exit(0)

        ev = base_event("unanswered")
        details = data.get("details", {})
        if not isinstance(details, dict):
            details = {}

        # Extract tool name from details
        # Gemini uses: {type: "exec", title: "Confirm Shell Command",
        #               command: "ls -d ~/a*", rootCommand: "ls"}
        tool_title = details.get("title", "")
        root_cmd = details.get("rootCommand", "")
        tool_name = root_cmd or tool_title or details.get("type", "")
        if tool_name:
            ev["toolName"] = tool_name
            ev["toolUseId"] = f"{session_id}-{tool_name}-{int(time.time() * 1000)}"

        # Forward the full details dict so the frontend can produce rich
        # per-agent previews.  The dict typically contains: type, title,
        # command, rootCommand.  Keeping "command" as a top-level key
        # preserves backward compatibility with older frontend code.
        if isinstance(details, dict):
            ev["toolInput"] = dict(details)

        # Forward the notification message as fallback
        message = data.get("message", "")
        if message:
            ev["notification"] = message[:200]

        send_event(ev)
        sys.exit(0)


if __name__ == "__main__":
    main()
