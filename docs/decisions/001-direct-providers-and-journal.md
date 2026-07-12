# ADR-001: Direct providers, deterministic checks и hash-chained journal

## Status

Accepted

## Date

2026-07-12

## Context

Benchmark должен сравнивать coding-модели без latency/cost ambiguity от агрегатора, проверять фактический результат, переживать crash/resume и оставлять аудитопригодное evidence. LLM-as-a-judge не даёт достаточной воспроизводимости для core score, а прямое исполнение generated code на host неприемлемо.

## Decision

- Вызывать официальные provider APIs напрямую через отдельные streaming adapters.
- Использовать единый внутренний `ProviderAdapter` contract и task-owned deterministic checks.
- Исполнять checks только в Docker с mandatory isolation и без host fallback.
- Хранить source of truth в append-only JSONL journal с fsync и SHA-256 chain.
- Строить `run.json` и static report как производные проекции journal.
- Хранить pricing в model config, чтобы историческая стоимость не менялась при обновлении сайта provider.

## Alternatives considered

### Aggregator API

Проще интеграция, но добавляет routing latency, собственный retry/cache слой и менее ясный provenance. Отклонено для базовых измерений.

### LLM-as-a-judge как основной scorer

Универсален для субъективных ответов, но добавляет вторую модель, drift и спорную калибровку. Отклонено для core score; в будущем может быть отдельным необязательным evidence channel.

### Host process sandbox

Быстрее Docker, но сложнее обеспечить одинаковую сеть, env, filesystem и resource limits на разных OS. Отклонено; при отсутствии Docker run fail-fast.

### Перезаписываемый JSON state

Проще чтение, но crash во время записи и тихая mutation разрушают аудит/resume. Отклонено в пользу journal + derived report.

## Consequences

- Добавление provider требует contract fixtures и streaming parser.
- Task author отвечает за качество deterministic checks и images.
- Реальные cloud outputs всё равно могут дрейфовать; journal доказывает входы и observed outputs, а не детерминизм provider.
- Report можно восстановить без API keys.
- Проверка hash chain обнаруживает mutation, но не является цифровой подписью доверенного автора.
