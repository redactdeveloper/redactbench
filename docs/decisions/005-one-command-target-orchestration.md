# ADR-005: One-command target orchestration

## Status

Accepted

## Date

2026-07-12

## Context

Target field v0.3 состоит из 11 entrants, пяти локально установленных agent CLIs, шести provider network boundaries, четырёх OAuth profiles, двух API secret files, восьми benchmark tasks и двух типов containers: networked harness и network-disabled grader. Ручной порядок подготовки легко выполнить частично или перепутать, а readiness failure после первого платного request создаёт ненужный расход и невоспроизводимый run.

Нужна одна команда с безопасным режимом проверки, которая использует versioned manifests как source of truth и не требует вручную собирать временный `models.yaml`.

## Decision

1. `redactbench start` выполняет фиксированный pipeline:
   `load/validate → Docker preflight → credential readiness → image readiness/build → network readiness/create → scoped credential staging → run/resume → report package → terminal leaderboard`.
2. Default inputs — `benchmarks/target-field.yaml`, `benchmarks/target-runtimes.yaml` и `benchmarks/demo/suite.yaml`; каждый путь, run ID, repeat, concurrency, seed и output root имеют CLI override.
3. `--dry-run` выполняет только read-only validation/inspection. Он не копирует credentials, не запускает harness container и не делает model/API request. Missing images/networks показываются как planned actions.
4. Normal run завершается до image build, network creation и provider request, если хотя бы один credential source отсутствует. Diagnostic содержит только стабильное имя readiness check.
5. Missing harness images собираются из локально установленных pinned CLI binaries и reviewed common runner. Image tags включают CLI version и RedactBench runtime version; фактические immutable image IDs записываются в run evidence.
6. Для всех 11 entrants динамически создаётся in-memory `docker-harness` model config. Отдельный adapter запускает ровно один fresh container на generation request. Поэтому Context Recovery phase 1 и phase 2 автоматически получают разные containers.
7. Journal остаётся source of truth. Повтор команды с тем же `--run-id` и идентичной конфигурацией пропускает завершённые attempts; несовпадающая конфигурация отклоняется.
8. После полного run dashboard копируется в `runs/<run-id>/report/`, а stdout получает общий score table, run ID и путь к `index.html`.

## Alternatives considered

### Shell script из последовательности существующих команд

Shell удобен для прототипа, но начинает дублировать validation, secret staging, cleanup и error mapping. Также сложнее доказать, что prompt/key не попал в argv. Отклонено в пользу типизированного orchestration layer и unit/integration contracts.

### Автоматически читать raw keys из shell environment

Снижает число setup steps, но значения легче попадают в child environment, process diagnostics и случайный debug output. Отклонено для target field; используются отдельные protected files.

### Продолжать после частичного readiness

Позволяет запустить только доступные модели, но итог перестаёт соответствовать объявленному target field и сравнивает разные task/model matrices. Отклонено: default `start` fail-closed; subset experiments остаются за custom `run` workflow.

### Автоматически открывать browser и оставлять server запущенным

Удобно интерактивно, но превращает завершённую batch-команду в долгоживущий process и усложняет automation. Отклонено: `start` печатает static path, а пользователь при необходимости вызывает `redactbench serve`.

## Consequences

- Первый запуск дольше из-за image builds, последующие переиспользуют pinned tags и Docker cache.
- Команда не может автоматически перевыпустить раскрытый provider key или подтвердить денежный бюджет; эти два решения остаются явными действиями владельца.
- Один и тот же run ID нужен для resume. Автоматический timestamp защищает независимые запуски от случайного смешивания.
- User-defined provider bridges не дают destination allowlist. Для adversarial workspace нужен отдельный egress proxy/firewall; это ограничение сохраняется из ADR-004.
- Обновление common runner или CLI требует нового RedactBench runtime/image tag и повторной image verification.
