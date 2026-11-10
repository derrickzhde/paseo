# Changelog

## 0.15.5 - 2026-11-10

### Added

- Added Claude Fable 5.2 and Mythos 5.2 with medium default effort, including 200K and 1M context window variants following fork pattern ([upstream #9233](https://github.com/getpaseo/paseo/pull/9233))

### Notes

- Both models require Claude Code 2.1.321 or newer; Mythos 5.2 appears only when Claude Code advertises access
- Fork preserves 200K/1M context window splits for all Opus 5.5, Opus 5, Fable 5.2, Fable 5.1, and Fable 5 models

## 0.15.4 - 2026-11-06

### Changed

- Updated fork release infrastructure and documentation
- Refined baseline maintenance workflow

### Notes

- Fork v0.15.4 incorporates upstream v0.15.3

## 0.15.3 - 2026-11-03

### Fixed

- Fixed iOS keyboard blur issue with paseo-scroll module

### Changed

- Updated fork documentation and release processes

## 0.15.2 - 2026-10-28

### Added

- Added math rendering with `\(...\)`, `\[...\]`, and `$$...$$` delimiters
- Added 12/24-hour clock preference following phone settings
- Added per-model thinking and feature controls
- Added Claude 200K/1M context window variants
- Added Codex follow-ups during `/goal` turns
- Added Expo push recovery with individual retry
- Added fork release infrastructure

### Changed

- Updated Enriched Markdown integration for math rendering
- Enhanced session metrics in context details

### Fixed

- Fixed Claude imported-session cache to prevent stale title resurrection

## 0.15.1 - 2026-10-21

### Added

- Added session metrics in context details
- Added native math rendering with RaTeX

### Fixed

- Fixed wait for foreground native turn ID for Codex admission

## 0.15.0 - 2026-10-14

Upstream initial release incorporated into fork.
