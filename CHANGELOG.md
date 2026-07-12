# Changelog

Все заметные изменения RedactBench документируются в этом файле. Формат следует Keep a Changelog, версии — Semantic Versioning.

## [0.3.0] - 2026-07-12

### Added

- Target field из 11 model/harness entrants, включая GPT-5.5 xHigh, с точными provider model IDs и reasoning variants.
- Docker-only workspace adapters для Codex, Grok Build, Cursor Agent, AGY и OpenCode; Context Recovery использует новый container на каждую фазу.
- `redactbench start` с full preflight, safe `--dry-run`, automatic image/network preparation, run/resume, static report packaging и terminal leaderboard.
- Scoped readiness/staging для четырёх OAuth profiles и двух secret files без сериализации credential values.
- Dashboard target-field surface с provider/harness filters и честным `Not run` состоянием до первого реального benchmark.

### Security

- Harness containers работают non-root с read-only root, dropped capabilities, bounded resources и без evaluator mount.
- Codex/Grok/Cursor/AGY/OpenCode получают встроенные filesystem/tool sandbox policies; hidden graders остаются network-disabled.
- Документировано, что user-defined provider bridges не являются destination egress allowlist и требуют proxy/firewall для adversarial repositories.

## [0.2.0] - 2026-07-12

### Added

- Repeat-level sample SD, standard error и descriptive 95% Student-t interval по полным weighted suite repeats.
- Явные `taskWeight`, `repeatCount`, `concurrency` и `seed` в report/dashboard.
- Algorithms, Refactoring, Security, UI и Reasoning smoke-задачи; demo теперь покрывает все восемь категорий (24 attempts / 96 checks).
- Reliability UI с `n`, CI и честным состоянием без interval при одном repeat.

### Changed

- Каждый hidden check запускается на отдельной копии одного post-response workspace, исключая влияние порядка и side effects.
- Dashboard-filtered score использует suite task weights вместо простого среднего.
- Demo scorer поднят до `1.1.0`; эталонные Strong/Fast/Cautious fixtures получают 100.0% / 59.1% / 32.4%.
- Package version поднята до `0.2.0`, а leaderboard показывает все восемь category columns.

## [0.1.0] - 2026-07-12

### Added

- Versioned YAML/JSON contracts для suites, tasks, models, attempts, journal и reports.
- Direct streaming adapters для OpenAI Responses, Anthropic Messages и Gemini GenerateContent.
- Deterministic fixture adapter и demo-suite из Debugging, Hallucination/Pushback и Context Recovery.
- Isolated Docker hidden checks с weighted partial scoring и без небезопасного host fallback.
- Strict patch/text response protocol, safe repository snapshots и временные workspaces.
- Fsync hash-chained journal, resume, deterministic aggregation и стабильные CLI exit codes.
- Двухфазный stateless Context Recovery с Git checkpoint, notes, duplicate/rollback penalties и crash resume.
- Self-contained React dashboard, report packaging, local CSP server и responsive browser tests.
- Methodology, task-authoring, security documentation и architecture decision records.
