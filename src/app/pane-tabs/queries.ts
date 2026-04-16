export function parsePaneWindowIdMap(output: string): Map<string, string> {
  const paneWindowIds = new Map<string, string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [paneId, windowId] = trimmed.split(" ");
    if (paneId && windowId) paneWindowIds.set(paneId, windowId);
  }
  return paneWindowIds;
}

export function parseWindowNameMap(output: string): Map<string, string> {
  const windowNames = new Map<string, string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx <= 0) continue;
    windowNames.set(trimmed.slice(0, spaceIdx), trimmed.slice(spaceIdx + 1));
  }
  return windowNames;
}
