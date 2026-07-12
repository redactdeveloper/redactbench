# ADR-004: Docker-only harness execution boundary

## Status

Accepted

## Date

2026-07-12

## Context

RedactBench v0.2 вызывает direct-provider adapters на host и использует Docker только для hidden checks. Целевая сравнительная матрица v0.3 включает Codex, Grok Build, Cursor Agent, AGY и OpenCode. Эти harnesses обладают agent capabilities, локальным auth state и могут изменять repository, поэтому их нельзя считать эквивалентом одного безопасного text API call.

Нужно одновременно обеспечить:

- одинаковую execution boundary для каждого entrant;
- настоящий reset процесса между attempts и Context Recovery phases;
- provider network для harness, но отсутствие evaluator files;
- передачу credentials без попадания значений в config, argv, journal или image;
- сохранение отдельного network-disabled grader boundary.

## Decision

1. Один harness container соответствует `entrant × task × repeat`. Host CLI можно использовать только для auth discovery и preflight; benchmark host fallback запрещён.
2. Context Recovery phase 1 и phase 2 запускаются в разных containers. Между ними переживают только разрешённые workspace/Git/notes artifacts.
3. Harness container получает:
   - fresh writable bind mount только в `/workspace`;
   - prompt как read-only file или stdin;
   - минимальный read-only auth profile mount при необходимости;
   - API credentials как отдельные read-only files `/run/secrets/*`;
   - user-defined network `redactbench-egress-*`.
4. Harness container не получает `/evaluator`, Docker socket, host root, полный environment или arbitrary mounts.
5. Baseline hardening: read-only root filesystem, non-root UID/GID `65532:65532`, `cap-drop ALL`, `no-new-privileges`, bounded memory/CPU/PIDs/output/time и tmpfs `/tmp`.
6. Entrant/runtime schemas принимают только `execution: docker`, argv arrays без shell entrypoint и allowlisted templates. Secret values отсутствуют в schemas.
7. После harness завершения hidden checks запускаются в отдельных grader containers с `network none` и fresh workspace clone на каждый check.

Docker рекомендует явный `readonly` для bind mounts и `--mount` вместо сокращённого volume syntax: https://docs.docker.com/engine/storage/bind-mounts/. User-defined bridge networks дают лучшую изоляцию от unrelated containers, чем default bridge: https://docs.docker.com/engine/network/drivers/bridge/. Secret-file подход следует модели Docker secrets: https://docs.docker.com/engine/swarm/secrets/.

## Security note: egress is not yet provider-filtered

Имя `redactbench-egress-*` и user-defined bridge изолируют container от default bridge, но сами по себе не ограничивают внешние destinations. Перед платными/adversarial runs нужен отдельный egress proxy или host firewall allowlist для официальных provider endpoints. До этого container network считается внешней доверительной границей, а не полной SSRF-защитой.

## Alternatives considered

### Запускать уже авторизованные CLI на host

Проще и сразу использует существующий auth state, но harness получает весь пользовательский workspace/environment и оставляет state между attempts. Отклонено: результаты хуже воспроизводятся, а blast radius существенно шире.

### Один долгоживущий container на модель

Снижает startup overhead, но переносит caches, conversation/session state и filesystem side effects между tasks/repeats. Отклонено ради независимости samples.

### Монтировать evaluator в harness container

Позволяет agent самостоятельно запускать hidden tests, но раскрывает oracle до финального ответа и делает benchmark gameable. Отклонено; harness видит только public task workspace.

### Передавать API keys через `docker run --env`

Удобно для большинства CLI, но environment может появляться в container metadata и diagnostic output. Отклонено для общей границы. Harness images должны читать scoped secret files и передавать значения только дочернему CLI process внутри container.

### Разрешить shell command templates

Гибко для разных CLIs, но превращает model ID/path placeholders в command-injection surface. Отклонено; runtime принимает только argv array и запрещает shell entrypoints.

## Consequences

- Для каждого harness нужен небольшой reviewed image/wrapper, умеющий читать auth/secret files и запускать CLI без shell.
- Существующая host authorization не означает container readiness; preflight должен отдельно проверить image и scoped credential mount.
- Per-attempt container startup и workspace copy увеличивают latency, но не смешиваются с provider TTFT и дают более чистую sample boundary.
- Actual image ID, runtime contract hash и network policy должны попасть в journal до публикации реальных результатов.
- Платный run остаётся заблокирован до точных model identifiers, egress policy и budget confirmation.
