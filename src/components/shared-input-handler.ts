import type { MutableRefObject } from "react";

export function claimSharedInputHandler<T>(
  sharedRef: MutableRefObject<T | null> | undefined,
  ownerRef: MutableRefObject<T | null>,
  handler: T,
): () => void {
  ownerRef.current = handler;
  if (sharedRef) {
    sharedRef.current = handler;
  }
  return () => releaseMatchingSharedInputHandler(sharedRef, ownerRef, handler);
}

export function releaseSharedInputHandler<T>(
  sharedRef: MutableRefObject<T | null> | undefined,
  ownerRef: MutableRefObject<T | null>,
): void {
  const handler = ownerRef.current;
  if (handler === null) return;
  releaseMatchingSharedInputHandler(sharedRef, ownerRef, handler);
}

function releaseMatchingSharedInputHandler<T>(
  sharedRef: MutableRefObject<T | null> | undefined,
  ownerRef: MutableRefObject<T | null>,
  handler: T,
): void {
  if (sharedRef?.current === handler) {
    sharedRef.current = null;
  }
  if (ownerRef.current === handler) {
    ownerRef.current = null;
  }
}
