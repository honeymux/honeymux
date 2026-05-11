import type { MutableRefObject } from "react";

import { useCallback, useRef, useState } from "react";

/**
 * Like useRef, but the setter also triggers a re-render of the owning
 * component. Use when many writers (event handlers, async optimistic updates,
 * other hooks) need synchronous read access via `.current`, but consumers also
 * need to re-render when the value changes.
 *
 * The ref and the underlying state are always kept in sync; no-op writes are
 * skipped so unchanged values do not schedule renders.
 */
export function useObservableRef<T>(initial: T): [MutableRefObject<T>, (value: T) => void] {
  const ref = useRef<T>(initial);
  const [, setValue] = useState<T>(initial);
  const set = useCallback((value: T) => {
    if (ref.current === value) return;
    ref.current = value;
    setValue(value);
  }, []);
  return [ref, set];
}
