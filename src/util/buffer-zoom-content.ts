/**
 * Prepare `tmux capture-pane` output for the outer terminal's own auto-wrap.
 * Pass CSI/OSC escapes through unchanged, leave printable text alone (long
 * lines auto-wrap naturally at the outer terminal's right edge), and emit
 * `\x1b[0m\x1b[K\n` before every original newline to reset SGR and clean up
 * trailing cells so stale reverse/background attributes from the capture
 * don't bleed across rows.
 *
 * The point of letting the terminal auto-wrap rather than inserting our own
 * `\n`s is selection semantics: cells produced by auto-wrap carry the
 * terminal's soft-wrap attribute, so selecting and copying across a wrapped
 * line yields a continuation rather than a literal newline.
 */
export function softWrapContent(content: string): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const code = content.charCodeAt(i);
    if (code === 0x1b && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1);
      if (next === 0x5b /* [ */) {
        let j = i + 2;
        while (j < content.length) {
          const c = content.charCodeAt(j);
          if (c >= 0x40 && c <= 0x7e) break;
          j++;
        }
        if (j >= content.length) {
          out += content.slice(i);
          break;
        }
        out += content.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (next === 0x5d /* ] */) {
        let j = i + 2;
        while (j < content.length) {
          if (content.charCodeAt(j) === 0x07) {
            j++;
            break;
          }
          if (content.charCodeAt(j) === 0x1b && j + 1 < content.length && content.charCodeAt(j + 1) === 0x5c) {
            j += 2;
            break;
          }
          j++;
        }
        out += content.slice(i, j);
        i = j;
        continue;
      }
      out += content.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (code === 0x0a /* \n */) {
      out += "\x1b[0m\x1b[K\n";
      i++;
      continue;
    }
    out += content[i];
    i++;
  }
  return out;
}
