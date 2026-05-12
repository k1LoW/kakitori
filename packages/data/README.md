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
pnpm stats                        # Show progress
```

## Acknowledgements

Stroke grouping references the SVG path data from [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp), which combines:

- [animCJK](https://github.com/parsimonhi/animCJK) — LGPL v3 or later ([LGPL.txt](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/LGPL.txt))
- [subAnimJ](https://github.com/k1LoW/subAnimJ) — Arphic Public License ([LICENSE](https://github.com/k1LoW/subAnimJ/blob/main/LICENSE), [ARPHICPL.TXT](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/ARPHICPL.TXT))
- [animNumber](https://github.com/k1LoW/animNumber) — SIL Open Font License 1.1 ([OFL.txt](https://github.com/k1LoW/animNumber/blob/main/licenses/OFL.txt))
- [Unihan database](https://www.unicode.org/charts/unihan.html) — Unicode license ([COPYING.txt](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/COPYING.txt))

Full upstream license texts: [hanzi-writer-data-jp/licenses/](https://github.com/k1LoW/hanzi-writer-data-jp/tree/main/licenses).

## License

MIT (for this package's own source — the stroke-ending JSON, scripts, and tooling). Referenced stroke path data keeps its upstream license; see Acknowledgements above.
