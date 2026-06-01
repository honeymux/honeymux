export function jsonSemanticallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return left === right;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonSemanticallyEqual(value, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key, index) => key === rightKeys[index] && jsonSemanticallyEqual(leftRecord[key], rightRecord[key]),
    );
  }
  return false;
}
