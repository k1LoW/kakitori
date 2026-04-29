# kakitori

A kanji writing practice library with stroke ending judgment (tome/hane/harai).

## Demo

https://k1low.github.io/kakitori/

## About

kakitori wraps [Hanzi Writer](https://github.com/chanind/hanzi-writer) and adds stroke ending judgment for Japanese writing practice. It uses [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp) for character data.

Features:
- Stroke ending judgment: tome (stop), hane (hook), harai (sweep)
- Stroke grouping to correct stroke counts (e.g. "あ" has 4 data strokes but 3 actual strokes)
- animCJK-style stroke animation with seamless grouped strokes
- Click-to-select stroke highlighting
- Logger for debugging pointer events and judgment results

## Packages

| Package | Description |
|---------|-------------|
| [@k1low/kakitori](./packages/core) | Core library (Hanzi Writer wrapper + stroke ending judge) |
| [@k1low/kakitori-data](./packages/data) | Stroke ending data and CLI tools |

## Usage

```javascript
import { Kakitori, defaultCharDataLoader } from "@k1low/kakitori";

const writer = Kakitori.create("#target", "永", {
  width: 300,
  height: 300,
  charDataLoader: defaultCharDataLoader,
  strokeGroups: [[0], [1], [2, 3]], // optional: merge data strokes
  onCorrectStroke: (data) => {
    if (data.strokeEnding) {
      console.log(data.strokeEnding.correct ? "OK" : "NG");
    }
  },
  onComplete: (data) => {
    console.log(`Mistakes: ${data.totalMistakes}, Stroke ending: ${data.strokeEndingMistakes}`);
  },
});

// Set stroke endings (types can be an array for multiple acceptable endings)
writer.setStrokeEndings([
  { types: ["tome"] },
  { types: ["hane"] },
  { types: ["harai"] },
  { types: ["harai"] },
  { types: ["harai"] },
]);

writer.quiz();
```

## License

MIT
