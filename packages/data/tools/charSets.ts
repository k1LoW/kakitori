import {
  hiragana,
  katakana,
  grade1,
  grade2,
  grade3,
  grade4,
  grade5,
  grade6,
  juniorHigh,
  charSets,
} from "../../core/src/charSets.js";

export {
  hiragana,
  katakana,
  grade1,
  grade2,
  grade3,
  grade4,
  grade5,
  grade6,
  juniorHigh,
  charSets,
};

export function getCharSet(name: string): string[] {
  const set = charSets[name];
  if (!set) {
    const available = Object.keys(charSets).join(", ");
    throw new Error(`Unknown char set: ${name}. Available: ${available}`);
  }
  return set;
}

export function getAllChars(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const chars of Object.values(charSets)) {
    for (const c of chars) {
      if (!seen.has(c)) {
        seen.add(c);
        result.push(c);
      }
    }
  }
  return result;
}
