#!/usr/bin/env python3
"""Claude Code lifecycle hook for honeymux.

Reads event JSON from stdin, maps to agent status, sends to Unix socket.
For PermissionRequest events, blocks waiting for approval/denial response.
"""

import json
import os
import platform
import re
import shlex
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

PERMISSION_TIMEOUT = None  # block indefinitely; Claude Code kills the hook on cancel
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


def get_parent_pid(pid):
    if pid <= 1:
        return None

    if sys.platform.startswith("linux"):
        try:
            with open(f"/proc/{pid}/stat", "r") as f:
                stat = f.read()
            close_idx = stat.rfind(")")
            if close_idx == -1:
                return None
            fields = stat[close_idx + 2:].strip().split()
            parent_pid = int(fields[1])
            return parent_pid if parent_pid > 0 else None
        except (OSError, ValueError, IndexError):
            pass

    try:
        proc = subprocess.run(
            ["ps", "-ww", "-o", "ppid=", "-p", str(pid)],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    if proc.returncode != 0:
        return None

    try:
        parent_pid = int(proc.stdout.strip())
    except ValueError:
        return None

    return parent_pid if parent_pid > 0 else None


def normalize_tty(tty_name):
    tty = tty_name.strip()
    if not tty or tty in ("-", "?", "??"):
        return None
    if tty.startswith("/dev/"):
        return tty
    return f"/dev/{tty}"


def extract_cmdline_args(pid):
    """Extract command-line arguments from the process argv."""
    if pid <= 1:
        return {}

    args = None
    if sys.platform.startswith("linux"):
        try:
            with open(f"/proc/{pid}/cmdline", "r") as f:
                args = f.read().rstrip('\0').split('\0')
        except OSError:
            args = None

    if args is None:
        try:
            proc = subprocess.run(
                ["ps", "-ww", "-o", "command=", "-p", str(pid)],
                capture_output=True,
                stdin=subprocess.DEVNULL,
                text=True,
                timeout=1,
            )
        except (OSError, subprocess.SubprocessError):
            return {}

        if proc.returncode != 0:
            return {}

        command = proc.stdout.strip()
        if not command:
            return {}

        try:
            args = shlex.split(command)
        except ValueError:
            return {}

    result = {}
    for i, arg in enumerate(args):
        if arg.startswith("--"):
            key = arg[2:]  # strip '--'
            if "=" in key:
                k, v = key.split("=", 1)
                result[k] = v
            else:
                # next arg is the value (if it doesn't start with --)
                if i + 1 < len(args) and not args[i + 1].startswith("-"):
                    result[key] = args[i + 1]
                else:
                    result[key] = "true"
    return result


def find_claude_code_ancestor_team_info():
    """Walk up process tree to find Claude Code process with --team-name argument.

    Returns dict with teamName, teammateName, source if found, None otherwise.
    """
    ppid = os.getppid()
    seen = set()

    while ppid > 0 and ppid not in seen:
        seen.add(ppid)
        try:
            cmdline_args = extract_cmdline_args(ppid)

            # Check if this process has --team-name (it's a teammate)
            if "team-name" in cmdline_args:
                team_name = cmdline_args.get("team-name")
                agent_name = cmdline_args.get("agent-name")
                parent_session_id = cmdline_args.get("parent-session-id")

                return {
                    "teamName": team_name,
                    "teammateName": agent_name,
                    "source": "ancestor_cmdline",
                    "parentSessionId": parent_session_id,
                }

            new_ppid = get_parent_pid(ppid)
            if new_ppid is None or new_ppid == ppid:
                break
            ppid = new_ppid
        except OSError:
            break

    return None


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


def detect_team_membership_by_session_id(session_id):
    """Check if this session is the lead or member of an active team.

    Since team leads are resumed with --resume, their session ID won't match
    the original leadSessionId. As a fallback, if there's an active team with
    members and this session isn't a member, we treat it as the lead.
    """
    teams_dir = os.path.expanduser("~/.claude/teams")
    try:
        team_dirs = os.listdir(teams_dir)
    except OSError:
        return None

    for team_name in team_dirs:
        config_path = os.path.join(teams_dir, team_name, "config.json")
        if not os.path.isfile(config_path):
            continue

        try:
            with open(config_path) as f:
                config = json.load(f)

            # Check if this session is explicitly the lead by matching leadSessionId
            lead_session_id = config.get("leadSessionId")
            if lead_session_id == session_id:
                return {
                    "teamName": team_name,
                    "teammateName": None,  # This is the lead
                    "source": "leadSessionId",
                }

            # Check if this session is a registered teammate
            members = config.get("members", [])
            for member in members:
                if member.get("sessionId") == session_id:
                    is_lead = member.get("agentType") == "team-lead"
                    result = {
                        "teamName": team_name,
                        "teammateName": None if is_lead else member.get("name"),
                        "source": "memberSessionId",
                    }
                    return result

            # If team has active members but this session doesn't match any,
            # we're likely the lead (this handles --resume case where sessionId changed)
            if members and len(members) > 1:
                return {
                    "teamName": team_name,
                    "teammateName": None,
                    "source": "active_team_lead",
                }

        except (json.JSONDecodeError, OSError) as e:
            continue

    return None


def main():
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

    tty = get_tty()

    # Try detection strategies in order of reliability:
    # 1. Team metadata in hook event (TeammateIdle, TaskCompleted - most reliable, arrives ~1min later)
    # 2. Claude Code ancestor process --team-name argument (immediate, works on SessionStart)
    # 3. Team config file lookup by sessionId (fallback)
    team_info = None

    if team_name:
        team_info = {
            "teamName": team_name,
            "teammateName": teammate_name,
            "source": "event_metadata",
        }

    if not team_info:
        team_info = find_claude_code_ancestor_team_info()

    if not team_info:
        team_info = detect_team_membership_by_session_id(session_id)

    event = {
        "sessionId": session_id,
        "agentType": "claude",
        "status": status,
        "cwd": cwd,
        "pid": os.getppid(),
        "tty": tty,
        "timestamp": time.time(),
        "hookEvent": hook_event,
        "remoteHost": platform.node(),
    }

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

    sock_path = get_socket_path()

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(sock_path)
        sock.sendall((json.dumps(event) + "\n").encode())

        if hook_event == "PermissionRequest":
            # Block waiting for approval decision
            sock.settimeout(PERMISSION_TIMEOUT)
            try:
                response = b""
                while True:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                    if b"\n" in response:
                        break

                if response.strip():
                    raw = json.loads(response.strip())
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
            except socket.timeout:
                pass
        else:
            sock.close()

    except (socket.error, OSError) as e:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
