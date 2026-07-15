# Методология RedactBench v1

## Цель

RedactBench сравнивает не красоту объяснения модели, а проверяемый результат на одном и том же наборе входных данных. Он отделяет четыре оси:

1. correctness — прошедшие детерминированные проверки;
2. performance — TTFT и скорость output;
3. economics — стоимость attempt и одного полностью правильного решения;
4. continuity — восстановление после потери conversation history.

Это локальный harness, а не опубликованный глобальный рейтинг. Сравнивать два результата корректно только при одинаковых suite/model configs, scorer version, repeat/seed, Docker images и сопоставимых условиях сети/машины.

## Единица оценки

Suite перечисляет versioned task manifests и их веса. Каждый attempt определяется кортежем:

```text
run ID × task ID × model ID × repeat number
```

Обычный attempt выполняет один stateless provider request. Context Recovery выполняет два stateless requests внутри одного attempt. Завершённый `attemptId` не запускается повторно при resume.

Порядок запуска строится блоками `task × repeat`. Внутри каждого блока каждая модель получает ровно одну попытку; порядок моделей циклически вращается между блоками. При наличии `seed` и блоки, и базовый порядок моделей перемешиваются детерминированно. Это распределяет временной/provider drift равномернее, чем одно глобальное случайное перемешивание. Resume сначала восстанавливает полный исходный schedule, а затем удаляет уже завершённые attempts, поэтому относительный порядок оставшейся работы не меняется.

Перед запросом RedactBench детерминированно сортирует и сериализует workspace. Из snapshot исключаются evaluator, `.git`, `.redactbench`, `node_modules`, symlinks и credential-shaped файлы. Binary/oversized files представлены только метаданными и SHA-256. Один и тот же разрешённый workspace даёт один prompt hash.

## Provider path

Запросы идут напрямую на фиксированные официальные API endpoints:

- OpenAI Responses: `https://api.openai.com/v1/responses`, streaming, `store: false`;
- Anthropic Messages: `https://api.anthropic.com/v1/messages`, streaming;
- Gemini GenerateContent: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`.

RedactBench принимает только streaming text. Unknown event types игнорируются, используемые event payloads валидируются. Redirects запрещены, request timeout — 180 секунд, response stream ограничен 4 MiB.

Direct API path убирает дополнительный routing layer, но не устраняет вариативность provider load, региональной сети и rate limits. Для серьёзного сравнения нужны repeats и одинаковое временное окно.

## Response protocol

Text task возвращает непустой plain text. Patch task должен вернуть ровно один envelope:

```text
<redactbench_patch>
diff --git a/file b/file
...
</redactbench_patch>
<redactbench_notes>
Что сделано, что осталось и как проверить.
</redactbench_notes>
```

Diff обязан быть текстовым unified Git diff с repository-relative `a/` и `b/` paths. Schema v1 отклоняет binary patches, symlinks, rename/copy records, absolute paths, `..`, неполные headers и prose вне envelope. Patch сначала проходит structural validation и `git apply --check`, затем один раз применяется к fresh temporary workspace.

## Hidden checks и task score

Каждый check — `argv` без shell, Docker image, timeout, output cap и положительный weight. Exit code `0` означает `passed`; non-zero — `failed`; timeout, sandbox/output errors — отдельные statuses и не дают баллов.

Формула task score:

```text
task_score = Σ(weight passed checks) / Σ(weight all checks)
```

Поэтому partial correctness видна явно. Task считается полностью правильным только при `score === 1`.

После применения ответа фиксируется один post-response workspace. Перед каждым check RedactBench создаёт новую writable копию этого состояния и удаляет её после проверки. Поэтому файл, созданный одним check, не виден следующему, порядок checks не меняет score, а исходный workspace attempt остаётся неизменным. Ошибка подготовки или удаления копии отражается как check `error`.

Проверки запускаются последовательно в контейнерах со следующей базовой политикой:

```text
network none · read-only root · cap-drop ALL · no-new-privileges
1 CPU · 512 MiB · 128 PIDs · non-root 65532:65532
read-only /evaluator · writable temporary /workspace · noexec /tmp
```

Docker image ID сохраняется в journal/report. Для строгой воспроизводимости task author должен использовать digest, а не mutable tag.

## Model и category score

Suite weight сначала применяется внутри каждого repeat:

```text
repeat_score = Σ(task_score × suite_task_weight) / Σ(suite_task_weight)
model_score = mean(complete repeat_scores)
```

Repeat считается полным, когда у модели есть attempt для каждой ожидаемой task; error-attempt остаётся в результате со score `0`, а не исчезает из знаменателя. Category score использует ту же формулу для полного набора tasks категории. Пока нет ни одного полного repeat, незавершённый report показывает provisional weighted score уже записанных attempts, но не строит interval.

`taskWeight` сохраняется рядом с каждым attempt в JSON report. Поэтому dashboard и внешние consumers пересчитывают отфильтрованный score той же weighted-формулой, а не простым средним задач.

## Валидность прогона и ошибки

Нулевой score attempt и пригодность всего run для публичного ranking — разные величины. Report классифицирует ошибки только по стабильному `error.code`, а не по тексту сообщения:

- `PATCH_REJECTED` означает невалидный ответ модели. Attempt получает ноль, но run остаётся пригодным для ranking;
- `PROVIDER_ERROR` означает сбой provider/harness transport и делает run непригодным для финального ranking;
- `ATTEMPT_ERROR`, `SANDBOX_ERROR` и неизвестные attempt-level errors считаются инфраструктурными и также блокируют ranking.

Invalid run сохраняет все attempts, checks, timing и scores для диагностики. CLI и публичная таблица показывают `Ranking withheld` вместо присвоения мест. После исправления внешней причины нужен новый run или контролируемый resume; удалять ошибочный attempt из журнала нельзя.

Check-level `failed`, `timeout` и `OUTPUT_LIMIT` остаются частью результата задания. Они могут быть следствием неправильного, зависающего или слишком шумного кода модели и сами по себе не делают run инфраструктурно невалидным. Check-level `DOCKER_ERROR`, `DOCKER_UNAVAILABLE` и `SANDBOX_ERROR`, напротив, увеличивают infrastructure failure count и блокируют ranking.

## Неопределённость повторов

Статистическое наблюдение — полный suite score одного repeat для одной модели. Сначала внутри repeat применяются task weights, затем по полным repeats считаются среднее, sample standard deviation `s`, standard error и двухсторонний 95% Student-t interval:

```text
SE = s / √n
CI95 = mean ± t(0.975, n - 1) × SE
```

Границы ограничиваются допустимым score `[0, 1]`. Repeat включается в общую статистику только если содержит все ожидаемые tasks; незавершённый repeat не сужает interval. Category statistics применяют то же правило к полному набору tasks этой категории.

При `n < 2` `standardDeviation`, `standardError` и `confidence95` равны `null`; dashboard явно предлагает `--repeat 3+` вместо изображения `±0`. Critical values берутся из таблицы NIST; между опубликованными степенями свободы выбирается меньшая, дающая консервативно более широкий interval.

Это описательный interval наблюдаемой repeat-вариативности, не тест превосходства моделей. Он не доказывает независимость облачных ответов, не учитывает смену provider snapshot, hardware/region/network drift и при малом `n` закономерно широк. Сравнение требует одинаковых suite/scorer/model configs и сопоставимых условий запуска; `repeatCount`, `concurrency` и `seed` выводятся в report рядом с результатом.

В v1 категория — способ группировки и контракт task. Сам grader принадлежит task. Например, security-task может проверить auth boundary и input validation отдельными scripts, а UI-task — использовать task-owned Playwright Docker image. Встроенного универсального LLM-judge нет.

## Performance и cost

### TTFT

`ttftMs` — время от начала HTTP request до первого непустого text delta. Metadata/reasoning events без output text не останавливают таймер.

### Output tokens/s

При наличии provider usage:

```text
output_tokens_per_second = output_tokens / (completion_time - first_text_time)
```

Это скорость видимой фазы генерации, не общая request throughput. При нулевом интервале или отсутствии usage значение — `null`, а dashboard показывает `—`.

### Стоимость

Pricing хранится в model config и не загружается автоматически:

```text
cost = (uncached_input × input_rate
      + cached_input × cached_rate
      + output × output_rate) / 1_000_000
```

Если cached rate не указан, используется обычный input rate. Если pricing или provider usage отсутствуют, cost — `null`, не ноль.

`costPerCorrectUsd` — полная известная стоимость модели в run, делённая на число attempts со score `1`. При нуле полностью правильных attempts или неизвестной стоимости значение — `null`.

## Context Recovery v1

Context Recovery — один attempt из двух независимых provider calls:

```text
initial snapshot
  → phase-1 request
  → validated patch + notes
  → local Git commit + journal checkpoint
  → forced conversation reset
  → post-phase-1 snapshot + task summary + notes + Git summary
  → phase-2 request
  → validated patch + final commit
  → hidden checks
```

Phase 2 не получает messages или скрытый in-memory state первой фазы. Разрешённый recovery bundle намеренно соответствует пользовательскому предложению: изменённый repo, Git summary, notes и краткое исходное задание. Если процесс падает после checkpoint, resume сверяет snapshot hash и commit SHA, а затем начинает с phase 2 без повторного provider call первой фазы.

Дополнительный score penalty:

```text
duplicate_penalty = min(0.25, 0.05 × duplicate_added_lines)
rollback_multiplier = rollback_detected ? 0.5 : 1

recovery_score = hidden_check_score
               × (1 - duplicate_penalty)
               × rollback_multiplier
```

Duplicate edit — значимая строка, которую phase 2 снова добавляет, хотя она уже присутствовала после phase 1. Rollback фиксируется, если phase-1 addition исчезла или phase-1 removal вернулась в final snapshot. Это консервативные line-based indicators, а не semantic diff proof.

Отдельно сохраняются `notesPreserved`, число слов заметок, `duplicateEdits`, `rollbackDetected`, passed checks и duration второго request (`recoveryMs`).

## Journal и воспроизводимость

JSONL journal — source of truth. Каждая запись включает sequence, timestamp, previous hash, payload и SHA-256 текущей записи. Append использует fsync. При открытии проверяются schema, непрерывность и hash chain; неполный последний fragment после crash отбрасывается, изменение завершённой строки приводит к `JOURNAL_INVALID`.

Run metadata хранит:

- suite/scorer/schema versions;
- модели и provider model strings;
- selected tasks, repeat, seed и concurrency;
- config/prompt/response/patch hashes;
- фактические Docker image IDs;
- полный attempt report и Context Recovery checkpoint.

Hardware fingerprint и provider-side sampling state пока не фиксируются. Поэтому «воспроизводимость» означает проверяемую конфигурацию и журнал, а не обещание побитово одинаковых ответов облачной модели.

## Demo как sanity check

Fixture providers не вызывают сеть и возвращают versioned text/usage/timing. Demo проверяет, что harness различает сильное, частичное и плохое решение. В v0.2 он выполняет 24 attempts и 96 checks:

- Algorithms: frequency ranking, deterministic ties, edge cases и immutability;
- Debugging: ordered/sparse IDs, missing user и empty array;
- Refactoring: behavior, instance isolation и удаление module-level mutable state;
- Security: valid nested paths, traversal, absolute paths, NUL и symlink escape;
- UI: native control, ARIA/hidden state и синхронизация interaction;
- Reasoning: cross-file cause, evidence, composite-key fix и regression proof;
- Hallucination: pushback против ложной предпосылки, `undefined`, actionable evidence;
- Context Recovery: parse/format behavior, сохранение phase-1 work и rollback penalty.

Эталонные Strong/Fast/Cautious fixtures получают 100.0% / 59.1% / 32.4%. Fixtures нужны для regression tests harness, а не для заявлений о качестве реальных моделей; одна smoke-задача на категорию не образует репрезентативный production corpus.

## Первичные источники

- [BridgeBench overview and roadmap](https://www.bridgemind.ai/bridgebench)
- [OpenAI Responses streaming API](https://platform.openai.com/docs/api-reference/responses-streaming)
- [Anthropic Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Gemini GenerateContent API](https://ai.google.dev/api/generate-content)
- [NIST confidence limits for the mean](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm)
- [NIST Student-t critical values](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm)
