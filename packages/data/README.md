# @k1low/kakitori-data

Stroke ending data (tome/hane/harai) and stroke grouping data for [@k1low/kakitori](https://github.com/k1LoW/kakitori).

## Data format

Each character has a JSON file (e.g. `data/あ.json`):

```json
{
  "character": "あ",
  "strokeGroups": [[0], [1], [2, 3]],
  "strokeEndings": [
    { "types": ["tome"] },
    { "types": ["tome"] },
    { "types": ["tome", "harai"] }
  ]
}
```

- `strokeGroups` (optional): Maps logical strokes to data stroke indices. Merges split strokes from [hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp).
- `strokeEndings` (optional): Per-stroke ending types. `{}` skips judgment for that stroke.

## CLI tools

```
pnpm set-stroke-endings あ        # Set stroke endings for a character
pnpm set-stroke-endings --set hiragana  # Batch set by character set
pnpm validate                     # Validate all data files
pnpm stats                        # Show progress
```

## License

MIT
