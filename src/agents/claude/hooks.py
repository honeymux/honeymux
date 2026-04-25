#!/usr/bin/env python3
"""Claude Code lifecycle hook for honeymux.

Reads event JSON from stdin, maps to agent status, sends to Unix socket.
For PermissionRequest events, blocks waiting for approval/denial response.
"""

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time

# Map Claude Code hook event names to agent statuses
EVENT_STATUS_MAP = {
    "SessionStart": "alive",
    "PermissionRequest": "unanswered",
    "SessionEnd": "ended",
    "TaskCreated": "alive",  # Team task created — may include early team metadata
    "TeammateIdle": "alive",  # Team progress update — teammate went idle
    "TaskCompleted": "alive",  # Team task completion update
}

PERMISSION_POLL_INTERVAL = 2.0
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

    return get_runtime_path("hmx-claude.sock")


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


def is_original_parent_alive(parent_pid):
    if parent_pid <= 1:
        return False

    if os.getppid() != parent_pid:
        return False

    try:
        os.kill(parent_pid, 0)
    except OSError:
        return False

    return True


def read_permission_response(sock, parent_pid):
    response = b""

    while True:
        try:
            chunk = sock.recv(4096)
        except socket.timeout:
            if not is_original_parent_alive(parent_pid):
                return None
            continue

        if not chunk:
            return None

        response += chunk
        if b"\n" in response:
            return response.strip()


def main():
    if not running_in_honeymux():
        sys.exit(0)

    # Read event data from stdin — Claude Code passes JSON payload here,
    # including the hook_event_name field.
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, IOError):
        data = {}

    hook_event = data.get("hook_event_name", "")
    status = EVENT_STATUS_MAP.get(hook_event)
    team_name = data.get("team_name")
    teammate_name = data.get("teammate_name")
    session_id = data.get("session_id", "")

    if not status:
        sys.exit(0)

    cwd = data.get("cwd", os.getcwd())
    tool_name = data.get("tool_name")
    tool_input = data.get("tool_input")
    tool_use_id = data.get("tool_use_id")
    parent_pid = os.getppid()

    remote_socket_path = get_tmux_remote_socket_path()
    pane_id = get_tmux_pane_id()
    tty = get_tty() if remote_socket_path or not pane_id else None

    team_info = None

    if team_name:
        team_info = {
            "teamName": team_name,
            "teammateName": teammate_name,
            "source": "event_metadata",
        }

    event = {
        "sessionId": session_id,
        "agentType": "claude",
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

    # Include team metadata if detected
    if team_info:
        event["teamName"] = team_info["teamName"]
        if team_info.get("teammateName"):
            event["teammateName"] = team_info["teammateName"]
            event["teamRole"] = "teammate"
        else:
            event["teamRole"] = "lead"

    if tool_name:
        event["toolName"] = tool_name
    if tool_input:
        event["toolInput"] = tool_input
    if tool_use_id:
        event["toolUseId"] = tool_use_id

    # Forward transcript path and user prompt for conversation labels
    transcript_path = data.get("transcript_path")
    if transcript_path:
        event["transcriptPath"] = transcript_path
    prompt = data.get("prompt")
    if prompt:
        event["prompt"] = prompt[:200]

    sock_path = get_socket_path(remote_socket_path)

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(sock_path)
        sock.sendall((json.dumps(event) + "\n").encode())

        if hook_event == "PermissionRequest":
            # Block waiting for approval decision
            sock.settimeout(PERMISSION_POLL_INTERVAL)
            try:
                response = read_permission_response(sock, parent_pid)

                if response:
                    raw = json.loads(response)
                    # Build the format Claude Code expects:
                    # {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow|deny"}}}
                    behavior = raw.get("decision", "deny")
                    output = {
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {
                                "behavior": behavior,
                            },
                        }
                    }
                    if behavior == "deny":
                        output["hookSpecificOutput"]["decision"]["message"] = "Denied by honeymux"
                    # Output decision for Claude Code to enforce
                    json.dump(output, sys.stdout)
                    sys.stdout.flush()
            except (ValueError, socket.error, OSError):
                pass
            finally:
                try:
                    sock.close()
                except OSError:
                    pass
        else:
            sock.close()

    except (socket.error, OSError) as e:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
