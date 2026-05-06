# @k1low/kakitori

A kanji writing practice library with stroke ending judgment (tome/hane/harai).

Wraps [Hanzi Writer](https://github.com/chanind/hanzi-writer) and adds stroke ending detection using pointer timing analysis.

## Install

```
npm install @k1low/kakitori hanzi-writer
```

## Usage

```javascript
import { char, defaultCharDataLoader } from "@k1low/kakitori";

const c = char.create("#target", "永", {
  size: 300,
  charDataLoader: defaultCharDataLoader,
  onCorrectStroke: (data) => {
    if (data.strokeEnding) {
      console.log(data.strokeEnding.correct ? "OK" : "NG");
    }
  },
  onComplete: (data) => {
    console.log(`Stroke ending mistakes: ${data.strokeEndingMistakes}`);
  },
});

c.setStrokeEndings([
  { types: ["tome"] },
  { types: ["hane"] },
  { types: ["harai"] },
]);

c.start();
```

## License

MIT
