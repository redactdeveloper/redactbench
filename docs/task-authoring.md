# Создание задач и suites

## Структура task

Рекомендуемый layout:

```text
benchmarks/my-suite/
├── suite.yaml
└── my-task/
    ├── task.yaml
    ├── workspace/        # то, что увидит модель
    │   └── source.mjs
    └── evaluator/        # не попадает в prompt
        └── check.mjs
```

Все paths в YAML относительны к owning config directory, используют `/`, не могут быть абсолютными, пустыми, содержать `.`/`..`, backslash или NUL. Symlinks в task inputs отклоняются или не попадают в snapshot.

## Минимальный patch task

```yaml
schemaVersion: 1
id: fix-lookup
title: Fix ID lookup
category: debugging
description: User ID does not equal the array index.
prompt: Return the matching user or undefined without changing the public signature.
tags: [javascript, smoke]
workspace: workspace
evaluator: evaluator
response:
  kind: patch
  maxBytes: 262144
checks:
  - id: sparse-ids
    label: Sparse IDs
    image: node:22-alpine@sha256:replace-with-reviewed-digest
    argv: [node, /evaluator/check.mjs, sparse]
    cwd: .
    weight: 2
    timeoutMs: 30000
    maxOutputBytes: 65536
```

Defaults: `workspace`, `evaluator`, patch response, 30s/check, 64 KiB output/check и weight 1. Ограничения: максимум 64 checks, 300s timeout, 1 MiB output и weight 100 на check.

Категория должна быть одной из:

```text
algorithms · debugging · refactoring · security
ui · reasoning · hallucination · context-recovery
```

## Text tasks

Для reasoning/hallucination task можно проверять plain answer:

```yaml
response:
  kind: text
  maxBytes: 8192
```

Ответ записывается в `/workspace/.redactbench/response.txt`. В контейнер также передаётся:

```text
REDACTBENCH_RESPONSE_FILE=/workspace/.redactbench/response.txt
```

Evaluator читает этот файл как untrusted text. Не интерпретируйте его как shell, HTML или JavaScript.

## Evaluator contract

Каждый check получает:

- `/workspace` — новую fresh copy одного состояния с применённым patch или response artifact;
- `/evaluator` — read-only task evaluator;
- `cwd` внутри `/workspace`;
- только `CI=1`, `HOME=/tmp` и `REDACTBENCH_RESPONSE_FILE`;
- disabled network и фиксированные CPU/memory/PID limits.

Правила результата:

| Результат процесса | Check status | Балл |
|---|---|---:|
| exit `0` | `passed` | полный weight |
| другой exit code | `failed` | 0 |
| timeout | `timeout` | 0 |
| Docker/output/sandbox error | `error` | 0 |

Пишите проверки атомарно: одна observable property на check. Это даёт понятный partial score и не скрывает четыре требования за одним exit code. Проверки идут последовательно, но filesystem state между ними не переносится. Check не должен готовить fixture для следующего check или полагаться на его side effects.

Evaluator и Docker image являются trusted benchmark inputs. Модель не видит evaluator до ответа, но её код может попытаться прочитать `/evaluator` уже во время check execution. Не помещайте туда credentials или данные, которые должны оставаться секретными от исполняемой программы; для adversarial contests нужен внешний trusted grader.

## Хорошая hidden проверка

```js
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL("/workspace/source.mjs").href;
const { getUser } = await import(moduleUrl);

assert.deepEqual(getUser([{ id: 100 }, { id: 300 }], 300), { id: 300 });
```

Не используйте wall-clock sleeps, внешнюю сеть, случайность без фиксированного seed или mutable global services. Если task действительно требует browser/database, упакуйте всё в pinned image и оставайтесь в network namespace контейнера.

## Context Recovery task

Context Recovery всегда использует patch response:

```yaml
schemaVersion: 1
id: recover-parser
title: Recover and finish parser
category: context-recovery
description: Complete two related files across a forced reset.
prompt: Make parsing and formatting reject invalid ports.
contextRecovery:
  enabled: true
  phase1Prompt: Implement parsing only and leave exact notes about remaining work.
  phase2Prompt: Preserve the parser and finish formatting from repo, Git and notes.
  maxPhase1OutputTokens: 2048
  notesRequired: true
checks:
  - id: parse
    image: node:22-alpine@sha256:replace-with-reviewed-digest
    argv: [node, /evaluator/check.mjs, parse]
    weight: 1
  - id: format
    image: node:22-alpine@sha256:replace-with-reviewed-digest
    argv: [node, /evaluator/check.mjs, format]
    weight: 1
```

Разделите первую и вторую фазу так, чтобы:

- phase 1 давала самостоятельный правильный инкремент;
- notes могли реально помочь восстановлению;
- phase 2 требовала понять surviving state, а не повторить тот же patch;
- checks отдельно доказывали сохранение phase-1 behavior и завершение phase 2.

## Suite manifest

```yaml
schemaVersion: 1
id: my-suite
title: My reproducible suite
description: Tasks for a fixed research question.
scorerVersion: 1.0.0
tasks:
  - manifest: my-task/task.yaml
    weight: 1
  - manifest: important-security-task/task.yaml
    weight: 2
```

Manifest path не может повторяться. Меняйте `scorerVersion`, если изменились checks, weights или scoring semantics так, что старые и новые результаты нельзя честно сравнивать.

Suite task weight сохраняется в каждом report attempt. Общий, category и dashboard-filtered scores используют одну формулу `Σ(score × weight) / Σ(weight)`.

При repeats RedactBench считает 95% Student-t interval по полному weighted suite score каждого завершённого repeat. Неполный repeat не участвует в uncertainty statistics; при `n < 2` interval равен `null`. Для сравнительного запуска задавайте `--repeat 3+` и фиксируйте `--seed`, scorer version, model IDs, Docker images и условия машины/сети.

## Model config

```yaml
schemaVersion: 1
models:
  - id: provider-model
    label: Provider model snapshot
    provider: openai
    model: replace-with-fixed-provider-model-id
    maxOutputTokens: 8192
    pricing:
      inputUsdPerMillion: 1.0
      cachedInputUsdPerMillion: 0.25
      outputUsdPerMillion: 4.0
```

Providers: `openai`, `anthropic`, `google`, `fixture`. Pricing optional; без него cost metrics будут `null`. Не копируйте цены из памяти: зафиксируйте дату и значения после проверки официальной страницы provider.

Для fixture model добавьте `fixtureFile`. Keys ответа:

```text
<task-id>:final
<context-recovery-task-id>:phase1
<context-recovery-task-id>:phase2
```

Каждый fixture response содержит `text`, `inputTokens`, `outputTokens`, `ttftMs`, `durationMs` и optional `cachedInputTokens`. `ttftMs` не может превышать `durationMs`.

## Проверка новой задачи

```bash
npm run redactbench -- validate \
  --suite benchmarks/my-suite/suite.yaml \
  --models models.fixture.yaml

npm run redactbench -- run \
  --suite benchmarks/my-suite/suite.yaml \
  --models models.fixture.yaml \
  --run-id authoring-smoke \
  --concurrency 1
```

Перед добавлением task проверьте как минимум:

- сильный fixture проходит все checks;
- отдельные намеренно плохие fixtures получают ожидаемый partial/zero score;
- исходный workspace не меняется после run;
- task не зависит от порядка файлов, locale, сети или текущего времени;
- check output объясняет failure без раскрытия credentials;
- image закреплён digest или его фактический ID зафиксирован и reviewed.
