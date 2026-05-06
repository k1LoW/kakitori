# Changelog

## [v0.10.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.9.0...packages/core/v0.10.0) - 2026-05-06
### Breaking Changes 🛠
- feat(core)!: headless-first Char with judge/result + method chaining by @k1LoW in https://github.com/k1LoW/kakitori/pull/56
### New Features 🚀
- feat(core): add reset() and cross-cancel between start/animate by @k1LoW in https://github.com/k1LoW/kakitori/pull/54

## [v0.9.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.8.0...packages/core/v0.9.0) - 2026-05-05
### Breaking Changes 🛠
- feat(core)!: replace Kakitori class with char namespace by @k1LoW in https://github.com/k1LoW/kakitori/pull/53
### New Features 🚀
- feat(core): always derive animate duration from stroke length by @k1LoW in https://github.com/k1LoW/kakitori/pull/51

## [v0.8.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.7.0...packages/core/v0.8.0) - 2026-05-05
### Breaking Changes 🛠
- fix(core)!: keep the grid visible while animate() is running by @k1LoW in https://github.com/k1LoW/kakitori/pull/50
### Fix bug 🐛
- fix(core): prevent overlay stacking on rapid animate() calls by @k1LoW in https://github.com/k1LoW/kakitori/pull/48
### Other Changes
- chore: introduce oxlint by @k1LoW in https://github.com/k1LoW/kakitori/pull/49

## [v0.7.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.6.0...packages/core/v0.7.0) - 2026-05-04
### New Features 🚀
- feat(data): add zenkaku (full-width) Arabic numerals 0-9 by @k1LoW in https://github.com/k1LoW/kakitori/pull/43
- feat(core): redefine tome/hane/harai judgment criteria by @k1LoW in https://github.com/k1LoW/kakitori/pull/44
### Other Changes
- fix: report strokesRemaining in logical-stroke units; document result types by @k1LoW in https://github.com/k1LoW/kakitori/pull/42

## [v0.6.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.5.0...packages/core/v0.6.0) - 2026-05-03
### New Features 🚀
- feat: add strokeEndingAsMiss option to reject strokes with wrong ending by @k1LoW in https://github.com/k1LoW/kakitori/pull/36
### Fix bug 🐛
- feat: add strokeGroups data for Arabic numerals 0-9 by @k1LoW in https://github.com/k1LoW/kakitori/pull/34
- fix: numeral 7 should be 2 logical strokes, not 1 by @k1LoW in https://github.com/k1LoW/kakitori/pull/38

## [v0.5.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.4.0...packages/core/v0.5.0) - 2026-05-02
### New Features 🚀
- feat: add number charset (Arabic numerals 0-9) by @k1LoW in https://github.com/k1LoW/kakitori/pull/32
### Other Changes
- feat!: destroy() clears DOM and guards against post-destroy usage by @k1LoW in https://github.com/k1LoW/kakitori/pull/30

## [v0.4.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.3.0...packages/core/v0.4.0) - 2026-04-30
### Breaking Changes 🛠
- feat!: add showGrid cross-hair guide and DEFAULT_PADDING constant by @k1LoW in https://github.com/k1LoW/kakitori/pull/27
### New Features 🚀
- feat: scale stroke animation duration by stroke length by @k1LoW in https://github.com/k1LoW/kakitori/pull/29

## [v0.3.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.2.0...packages/core/v0.3.0) - 2026-04-30
### New Features 🚀
- feat: add drawingWidth option by @k1LoW in https://github.com/k1LoW/kakitori/pull/21
- feat: add tests (core + data), fix hane detection, add CI test step by @k1LoW in https://github.com/k1LoW/kakitori/pull/22
### Other Changes
- docs: update release.yml with new changelog categories and labels by @k1LoW in https://github.com/k1LoW/kakitori/pull/24
- feat!: size-independent stroke judgment and replace width/height with size by @k1LoW in https://github.com/k1LoW/kakitori/pull/23
- feat!: rename quiz() to start(), animateCharacter() to animate(), add JSDoc by @k1LoW in https://github.com/k1LoW/kakitori/pull/25
- feat!: rename highlightStroke() to setStrokeColor(), add resetStrokeColor() by @k1LoW in https://github.com/k1LoW/kakitori/pull/26

## [v0.2.0](https://github.com/k1LoW/kakitori/compare/packages/core/v0.1.0...packages/core/v0.2.0) - 2026-04-29
### New Features
- feat: add strokeEndings data for all hiragana characters by @k1LoW in https://github.com/k1LoW/kakitori/pull/12
- feat: add `*` (any) option to set-stroke-endings tool by @k1LoW in https://github.com/k1LoW/kakitori/pull/14
- feat: add Kakitori.render(), charSets export, and gallery demo by @k1LoW in https://github.com/k1LoW/kakitori/pull/17
### Other Changes
- fix: add per-package changelog config to tagpr by @k1LoW in https://github.com/k1LoW/kakitori/pull/15
- fix: use changelogFile instead of changelog in tagpr config by @k1LoW in https://github.com/k1LoW/kakitori/pull/16

## [v0.1.0](https://github.com/k1LoW/kakitori/compare/packages/data/v0.2.0...packages/core/v0.1.0) - 2026-04-29
### New Features
- feat: auto-load character config from @k1low/kakitori-data by @k1LoW in https://github.com/k1LoW/kakitori/pull/9
### Other Changes
- feat: move demo to root and add GitHub Pages deployment by @k1LoW in https://github.com/k1LoW/kakitori/pull/11
