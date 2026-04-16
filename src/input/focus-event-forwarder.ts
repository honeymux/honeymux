/* eslint-disable no-control-regex */

const FOCUS_EVENT_RE = /\x1b\[[IO]/g;

export function stripAndForwardFocusEvents(text: string, writeToPty: (data: string) => void): string {
  return text.replace(FOCUS_EVENT_RE, (match) => {
    writeToPty(match);
    return "";
  });
}
