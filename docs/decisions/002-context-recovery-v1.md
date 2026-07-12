# ADR-002: Context Recovery v1 как два stateless patch-запроса

## Status

Accepted

## Date

2026-07-12

## Context

Нужно измерить, может ли coding-модель продолжить длинную задачу после потери conversation history, не повторить уже сделанное и не откатить правильный код. Провайдеры имеют разные tool-use contracts, поэтому полноценный общий agent loop значительно расширил бы MVP и смешал качество модели с качеством orchestration layer.

## Decision

Context Recovery v1 состоит из двух независимых calls через тот же provider adapter:

1. Phase 1 получает initial snapshot, делает ограниченный patch и оставляет обязательные notes.
2. Harness применяет patch, создаёт локальный Git commit и durable journal checkpoint.
3. Phase 2 вызывается без conversation messages и получает только исходное краткое задание, recovery instruction, notes, Git summary и post-phase-1 snapshot.
4. Второй patch применяется поверх surviving state, затем запускаются обычные hidden checks.
5. Line-based duplicate edits уменьшают score до 25%, rollback phase-1 work умножает score на 0.5.

Resume проверяет checkpoint snapshot hash и commit SHA и не повторяет оплаченный phase-1 call.

## Alternatives considered

### Суммаризация всей беседы

Похожа на реальный compaction, но трудно гарантировать одинаковый объём/качество summary для разных моделей. Отклонено: v1 намеренно даёт только явно разрешённые artifacts.

### Provider-native tool loops

Реалистичнее для coding agents, но tools, event semantics и orchestration различаются. Отложено до schema v2; v1 измеряет recovery при едином patch protocol.

### Один call с искусственным маркером reset

Не доказывает потерю hidden conversation state. Отклонено; adapter вызывается второй раз с новым request object.

### Только финальные tests без behavioral penalties

Модель могла бы откатить правильную фазу и случайно пройти часть checks. Отклонено: сохраняются duplicate/rollback signals и phase-specific checks.

## Consequences

- Test прост, provider-neutral и воспроизводим.
- Это не benchmark полноценного autonomous coding loop; документация обязана называть его двухфазным patch protocol.
- Line comparison может дать conservative false positives/negatives для semantic duplication. Поэтому signals и формула versioned, а checks остаются главным correctness evidence.
- Notes сами являются untrusted model output и не исполняются.
