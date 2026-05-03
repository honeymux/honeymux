/**
 * Homoglyph table and animation utilities.
 * Maps printable ASCII characters to two visual lookalikes for "dancing" text effects.
 */

const h = String.fromCodePoint;

/** Maps ASCII char to [1st homoglyph, 2nd homoglyph] */
const HOMOGLYPHS: Record<string, [string, string]> = {
  _: [h(0x203e), h(0x2581)],
  "-": [h(0x2010), h(0x2212)],
  ",": [h(0x201a), h(0x060c)],
  ";": [h(0x061b), h(0x204f)],
  ":": [h(0x02d0), h(0xa789)],
  "!": [h(0x00a1), h(0x01c3)],
  "?": [h(0x00bf), h(0x0294)],
  ".": [h(0x00b7), h(0x2024)],
  "'": [h(0x201a), h(0x2019)],
  '"': [h(0x201e), h(0x201c)],
  "(": [h(0x2768), h(0x27ee)],
  ")": [h(0x2769), h(0x27ef)],
  "[": [h(0x27e6), h(0x2772)],
  "]": [h(0x27e7), h(0x2773)],
  "{": [h(0x2774), h(0x2983)],
  "}": [h(0x2775), h(0x2984)],
  "@": [h(0x2295), h(0x229b)],
  "*": [h(0x2217), h(0x22c6)],
  "/": [h(0x2215), h(0x2044)],
  "\\": [h(0x2216), h(0x29f5)],
  "&": [h(0x214b), h(0x204a)],
  "#": [h(0x2317), h(0x266f)],
  "%": [h(0x066a), h(0x2030)],
  "`": [h(0x02bf), h(0x2018)],
  "^": [h(0x02c6), h(0x02c4)],
  "+": [h(0x207a), h(0x2214)],
  "<": [h(0x2039), h(0x27e8)],
  "=": [h(0x2261), h(0x2248)],
  ">": [h(0x203a), h(0x27e9)],
  "|": [h(0x2502), h(0x2758)],
  "~": [h(0x223c), h(0x02dc)],
  $: [h(0x20b4), h(0x20b5)],
  "0": [h(0x1d7ce), h(0x00d8)],
  "1": [h(0x1d7cf), h(0x00b9)],
  "2": [h(0x1d7d0), h(0x00b2)],
  "3": [h(0x1d7d1), h(0x00b3)],
  "4": [h(0x1d7d2), h(0x2074)],
  "5": [h(0x1d7d3), h(0x2075)],
  "6": [h(0x1d7d4), h(0x2076)],
  "7": [h(0x1d7d5), h(0x2077)],
  "8": [h(0x1d7d6), h(0x2078)],
  "9": [h(0x1d7d7), h(0x2079)],
  A: [h(0x0391), h(0x13aa)],
  B: [h(0x0392), h(0x13f4)],
  C: [h(0x03f9), h(0x2ca4)],
  D: [h(0x13a0), h(0x216e)],
  E: [h(0x0395), h(0x13ac)],
  F: [h(0x03dc), h(0x2131)],
  G: [h(0x050c), h(0x13c0)],
  H: [h(0x0397), h(0x13bb)],
  I: [h(0x0399), h(0x2160)],
  J: [h(0x0408), h(0x13eb)],
  K: [h(0x039a), h(0x13e6)],
  L: [h(0x13de), h(0x214c)],
  M: [h(0x039c), h(0x13b7)],
  N: [h(0x039d), h(0x13c1)],
  O: [h(0x039f), h(0x2c9e)],
  P: [h(0x03a1), h(0x13e2)],
  Q: [h(0x051a), h(0x211a)],
  R: [h(0x13a1), h(0x211b)],
  S: [h(0x0405), h(0x13da)],
  T: [h(0x03a4), h(0x13a2)],
  U: [h(0x054d), h(0x144c)],
  V: [h(0x2164), h(0x13d9)],
  W: [h(0x051c), h(0x13b3)],
  X: [h(0x03a7), h(0x2169)],
  Y: [h(0x03a5), h(0x13e9)],
  Z: [h(0x0396), h(0x13c3)],
  a: [h(0x03b1), h(0x0251)],
  b: [h(0x042c), h(0x0184)],
  c: [h(0x00e7), h(0x023c)],
  d: [h(0x0501), h(0x217e)],
  e: [h(0x0435), h(0x212e)],
  f: [h(0x0192), h(0x03dd)],
  g: [h(0x0261), h(0x0563)],
  h: [h(0x04bb), h(0x210e)],
  i: [h(0x03b9), h(0x0131)],
  j: [h(0x0458), h(0x029d)],
  k: [h(0x03ba), h(0x0584)],
  l: [h(0x04cf), h(0x217c)],
  m: [h(0x043c), h(0x217f)],
  n: [h(0x0578), h(0x057c)],
  o: [h(0x03bf), h(0x0275)],
  p: [h(0x03c1), h(0x03c1)],
  q: [h(0x0566), h(0x0563)],
  r: [h(0x0433), h(0x027c)],
  s: [h(0x0455), h(0x1e61)],
  t: [h(0x03c4), h(0x01ad)],
  u: [h(0x03c5), h(0x057d)],
  v: [h(0x03bd), h(0x2174)],
  w: [h(0x0461), h(0x051d)],
  x: [h(0x03c7), h(0x2179)],
  y: [h(0x0443), h(0x03b3)],
  z: [h(0x03b6), h(0x1d22)],
};

/**
 * Applies homoglyph cycling animation to a string.
 * Characters cycle through: original -> 1st homoglyph -> 2nd homoglyph.
 * Adjacent positions are phase-staggered so same-adjacent characters
 * (e.g. "000") never show the same variant simultaneously.
 */
export function homoglyphCycle(text: string, now: number, intervalMs = 169): string {
  const basePhase = Math.floor(now / intervalMs) % 3;
  const result: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const variants = HOMOGLYPHS[ch];
    if (!variants) {
      result.push(ch);
      continue;
    }

    const phase = (basePhase + i) % 3;
    switch (phase) {
      case 0:
        result.push(ch);
        break;
      case 1:
        result.push(variants[0]);
        break;
      case 2:
        result.push(variants[1]);
        break;
    }
  }

  return result.join("");
}
