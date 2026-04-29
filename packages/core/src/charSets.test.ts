import { describe, it, expect } from "vitest";
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
} from "./charSets.js";

describe("charSets", () => {
  describe("character counts", () => {
    it("hiragana has 46 characters", () => {
      expect(hiragana).toHaveLength(46);
    });

    it("katakana has 46 characters", () => {
      expect(katakana).toHaveLength(46);
    });

    it("grade1 has 80 characters", () => {
      expect(grade1).toHaveLength(80);
    });

    it("grade2 has 160 characters", () => {
      expect(grade2).toHaveLength(160);
    });

    it("grade3 has 200 characters", () => {
      expect(grade3).toHaveLength(200);
    });

    it("grade4 has 202 characters (2017 revision)", () => {
      expect(grade4).toHaveLength(202);
    });

    it("grade5 has 193 characters (2017 revision)", () => {
      expect(grade5).toHaveLength(193);
    });

    it("grade6 has 191 characters (2017 revision)", () => {
      expect(grade6).toHaveLength(191);
    });

    it("juniorHigh has 1110 characters", () => {
      expect(juniorHigh).toHaveLength(1110);
    });

    it("kyoiku kanji total is 1026", () => {
      const kyoiku = new Set([
        ...grade1, ...grade2, ...grade3,
        ...grade4, ...grade5, ...grade6,
      ]);
      expect(kyoiku.size).toBe(1026);
    });

    it("all joyo kanji total is 2136", () => {
      const all = new Set([
        ...grade1, ...grade2, ...grade3,
        ...grade4, ...grade5, ...grade6,
        ...juniorHigh,
      ]);
      expect(all.size).toBe(2136);
    });
  });

  describe("no duplicates within each set", () => {
    const sets = { hiragana, katakana, grade1, grade2, grade3, grade4, grade5, grade6, juniorHigh };

    for (const [name, chars] of Object.entries(sets)) {
      it(`${name} has no duplicates`, () => {
        expect(new Set(chars).size).toBe(chars.length);
      });
    }
  });

  describe("no overlap between kanji grades", () => {
    const grades = [grade1, grade2, grade3, grade4, grade5, grade6];

    it("no kanji appears in multiple grades", () => {
      const seen = new Set<string>();
      for (const grade of grades) {
        for (const char of grade) {
          expect(seen.has(char), `${char} is duplicated across grades`).toBe(false);
          seen.add(char);
        }
      }
    });

    it("no overlap between kyoiku and juniorHigh", () => {
      const kyoiku = new Set(grades.flat());
      for (const char of juniorHigh) {
        expect(kyoiku.has(char), `${char} is in both kyoiku and juniorHigh`).toBe(false);
      }
    });
  });

  describe("charSets record", () => {
    it("contains all expected keys", () => {
      expect(Object.keys(charSets)).toEqual([
        "hiragana", "katakana",
        "grade1", "grade2", "grade3", "grade4", "grade5", "grade6",
        "juniorHigh",
      ]);
    });

    it("references the same arrays", () => {
      expect(charSets.hiragana).toBe(hiragana);
      expect(charSets.grade1).toBe(grade1);
      expect(charSets.juniorHigh).toBe(juniorHigh);
    });
  });
});
