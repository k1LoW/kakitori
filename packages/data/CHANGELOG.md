# Changelog

## [v0.5.1](https://github.com/k1LoW/kakitori/compare/packages/data/v0.5.0...packages/data/v0.5.1) - 2026-05-02
### Fix bug 🐛
- feat: add strokeGroups data for Arabic numerals 0-9 by @k1LoW in https://github.com/k1LoW/kakitori/pull/34

## [v0.5.0](https://github.com/k1LoW/kakitori/compare/packages/data/v0.4.0...packages/data/v0.5.0) - 2026-05-02
### Breaking Changes 🛠
- feat!: size-independent stroke judgment and replace width/height with size by @k1LoW in https://github.com/k1LoW/kakitori/pull/23
- feat!: rename quiz() to start(), animateCharacter() to animate(), add JSDoc by @k1LoW in https://github.com/k1LoW/kakitori/pull/25
- feat!: rename highlightStroke() to setStrokeColor(), add resetStrokeColor() by @k1LoW in https://github.com/k1LoW/kakitori/pull/26
- feat!: add showGrid cross-hair guide and DEFAULT_PADDING constant by @k1LoW in https://github.com/k1LoW/kakitori/pull/27
### New Features 🚀
- feat: add drawingWidth option by @k1LoW in https://github.com/k1LoW/kakitori/pull/21
- feat: add tests (core + data), fix hane detection, add CI test step by @k1LoW in https://github.com/k1LoW/kakitori/pull/22
- feat: scale stroke animation duration by stroke length by @k1LoW in https://github.com/k1LoW/kakitori/pull/29
- feat: add number charset (Arabic numerals 0-9) by @k1LoW in https://github.com/k1LoW/kakitori/pull/32
### Other Changes
- docs: update release.yml with new changelog categories and labels by @k1LoW in https://github.com/k1LoW/kakitori/pull/24
- feat!: destroy() clears DOM and guards against post-destroy usage by @k1LoW in https://github.com/k1LoW/kakitori/pull/30

## [v0.4.0](https://github.com/k1LoW/kakitori/compare/packages/data/v0.3.0...packages/data/v0.4.0) - 2026-04-29
### New Features
- feat: add Kakitori.render(), charSets export, and gallery demo by @k1LoW in https://github.com/k1LoW/kakitori/pull/17

## [v0.3.0](https://github.com/k1LoW/kakitori/compare/packages/data/v0.2.0...packages/data/v0.3.0) - 2026-04-29
### New Features
- feat: auto-load character config from @k1low/kakitori-data by @k1LoW in https://github.com/k1LoW/kakitori/pull/9
- feat: add strokeEndings data for all hiragana characters by @k1LoW in https://github.com/k1LoW/kakitori/pull/12
- feat: add `*` (any) option to set-stroke-endings tool by @k1LoW in https://github.com/k1LoW/kakitori/pull/14
### Other Changes
- feat: move demo to root and add GitHub Pages deployment by @k1LoW in https://github.com/k1LoW/kakitori/pull/11
- fix: add per-package changelog config to tagpr by @k1LoW in https://github.com/k1LoW/kakitori/pull/15
- fix: use changelogFile instead of changelog in tagpr config by @k1LoW in https://github.com/k1LoW/kakitori/pull/16

## [v0.2.0](https://github.com/k1LoW/kakitori/compare/packages/data/v0.1.1...packages/data/v0.2.0) - 2026-04-29
### New Features
- feat: add kanji data for elementary and junior high school by @k1LoW in https://github.com/k1LoW/kakitori/pull/8

## [v0.1.1](https://github.com/k1LoW/kakitori/compare/packages/data/v0.1.0...packages/data/v0.1.1) - 2026-04-28

## [v0.1.0](https://github.com/k1LoW/kakitori/commits/packages/data/v0.1.0) - 2026-04-28
### New Features
- feat: add kana strokeGroups data and multi-type stroke endings by @k1LoW in https://github.com/k1LoW/kakitori/pull/5
### Other Changes
- ci: add CI/CD workflows with tagpr by @k1LoW in https://github.com/k1LoW/kakitori/pull/2
- build(deps-dev): bump vite from 6.3.5 to 6.4.2 by @dependabot[bot] in https://github.com/k1LoW/kakitori/pull/1
