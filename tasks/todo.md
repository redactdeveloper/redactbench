# Чек-лист реализации RedactBench

## Задача 1: Инициализировать проверяемый TypeScript-пакет

**Описание:** Создать самостоятельный Git/npm-проект на Node 22 с ESM, strict TypeScript, Vitest, ESLint, Vite/React entrypoint, безопасным `.gitignore` и едиными командами качества.

**Критерии приёмки:**

- [x] `npm ci` воспроизводимо устанавливает lockfile без секретов и generated output.
- [x] `npm test`, `npm run lint`, `npm run typecheck` и пустая production-сборка доступны как отдельные команды.
- [x] `.env`, ключи, runs/reports и временные workspace исключены из Git.

**Проверка:**

- [x] `npm test` — 1 test passed.
- [x] `npm run lint` — 0 warnings/errors.
- [x] `npm run typecheck` — passed.
- [x] `npm audit --audit-level=high` — 0 vulnerabilities.

**Зависимости:** Нет.

**Вероятно затронутые файлы:** `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`.

**Оценка размера:** Medium — 5 файлов.

## Задача 2: Зафиксировать версионированные контракты

**Описание:** Сначала тестами описать и затем реализовать Zod-схемы задач, suite, моделей, evaluator checks, attempts, journal и report с понятными path-aware ошибками.

**Критерии приёмки:**

- [x] Валидный минимальный task/model config разбирается в типизированный объект.
- [x] Неизвестные категории, provider variants, absolute/escaping paths, shell-строки и неограниченные ресурсы отклоняются.
- [x] Schema version и error code сохраняются стабильными и документированными.

**Проверка:**

- [x] RED: `npm test -- tests/contracts.test.ts` упал на отсутствующем `src/config.js`.
- [x] GREEN: `npm test -- tests/contracts.test.ts` — 13 tests passed.
- [x] `npm run typecheck` — passed.

**Зависимости:** Задача 1.

**Вероятно затронутые файлы:** `src/contracts.ts`, `src/errors.ts`, `src/config.ts`, `tests/contracts.test.ts`, `tests/fixtures/minimal-suite.yaml`.

**Оценка размера:** Medium — 5 файлов.

## Задача 3: Создать prompt snapshot и response protocol

**Описание:** Детерминированно сериализовать разрешённые файлы workspace в prompt, исключая evaluator/секреты, и безопасно извлекать patch/notes/text из ограниченного model response.

**Критерии приёмки:**

- [x] Один и тот же workspace даёт одинаковый prompt hash и стабильный порядок файлов.
- [x] Symlink/`..`, слишком большие файлы и denylisted secret names не попадают в prompt.
- [x] Parser принимает корректный envelope и отклоняет oversized/ambiguous/unsafe diff.

**Проверка:**

- [x] RED/GREEN: 11 tests passed; ambiguous duplicate envelope был пойман до GREEN.
- [x] Fixture snapshot не содержит sibling `evaluator/`, `.env`, private key content или symlink target.

**Зависимости:** Задача 2.

**Вероятно затронутые файлы:** `src/prompt.ts`, `src/response.ts`, `tests/prompt.test.ts`, `tests/response.test.ts`, `tests/fixtures/workspace/`.

**Оценка размера:** Medium — 5 путей.

## Контрольная точка после задач 1–3

- [x] Все unit-тесты проходят — 25 tests в 4 файлах.
- [x] Typecheck/lint чистые.
- [x] Контракты, prompt hash и response envelope готовы к провайдерам.

## Задача 4: Реализовать SSE transport и OpenAI adapter

**Описание:** Добавить streaming HTTP transport с timeout/byte cap/redaction и прямой OpenAI Responses adapter, который измеряет TTFT по первому text delta и читает финальный usage.

**Критерии приёмки:**

- [ ] SSE parser корректно переживает chunk boundaries, comments, multi-line data и неизвестные события.
- [ ] OpenAI adapter использует фиксированный HTTPS host, `store: false`, env key и возвращает text/usage/timing.
- [ ] HTTP/API ошибки не раскрывают Authorization header или body с секретами.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/sse.test.ts tests/providers/openai.test.ts`.
- [ ] Typecheck подтверждает единый `ProviderAdapter` contract.

**Зависимости:** Задачи 2–3.

**Вероятно затронутые файлы:** `src/providers/types.ts`, `src/providers/sse.ts`, `src/providers/openai.ts`, `tests/sse.test.ts`, `tests/providers/openai.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 5: Добавить Anthropic, Gemini и fixture adapters

**Описание:** Реализовать остальные provider variants на том же transport и детерминированный fixture adapter для бесплатных end-to-end тестов.

**Критерии приёмки:**

- [ ] Anthropic собирает `text_delta`, input/output usage и игнорирует ping/новые event types.
- [ ] Gemini собирает streamed candidate parts и `usageMetadata` через фиксированный official endpoint.
- [ ] Fixture adapter отдаёт фазовые ответы по task/attempt без сети и таймеров.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/providers`.
- [ ] Provider fixtures соответствуют примерам официальной документации.

**Зависимости:** Задача 4.

**Вероятно затронутые файлы:** `src/providers/anthropic.ts`, `src/providers/google.ts`, `src/providers/fixture.ts`, `src/providers/index.ts`, `tests/providers/other.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 6: Изолировать hidden checks в Docker

**Описание:** Сначала abuse-тестами, затем кодом создать evaluator, который запускает только argv-команды в ограниченном Docker container и возвращает weighted partial score.

**Критерии приёмки:**

- [ ] Container получает только временный workspace и read-only evaluator, без API keys и сети.
- [ ] Timeout, output cap, CPU/memory/PID, cap-drop и no-new-privileges применяются к каждому check.
- [ ] Pass/fail/error/timeout различаются, а веса нормализуются детерминированно.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/evaluator.test.ts tests/security.test.ts`.
- [ ] Docker integration подтверждает отсутствие сети и запись только в workspace.

**Зависимости:** Задачи 2–3.

**Вероятно затронутые файлы:** `src/sandbox/docker.ts`, `src/evaluator.ts`, `src/process.ts`, `tests/evaluator.test.ts`, `tests/security.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 7: Провести один attempt end-to-end

**Описание:** Связать snapshot, provider, response parser, безопасное применение diff и evaluator в rollback-friendly attempt runner.

**Критерии приёмки:**

- [ ] Исходный workspace не изменяется; каждый attempt работает в новой временной копии.
- [ ] Patch сначала проходит containment и `git apply --check`, затем применяется один раз.
- [ ] Результат содержит artifacts, provider metrics, check results, score и безопасную ошибку при сбое.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/attempt.test.ts`.
- [ ] Fixture integration исправляет sample bug и проходит hidden checks в Docker.

**Зависимости:** Задачи 3–6.

**Вероятно затронутые файлы:** `src/attempt.ts`, `src/workspace.ts`, `src/patch.ts`, `tests/attempt.test.ts`, `tests/fixtures/attempt-task/`.

**Оценка размера:** Medium — 5 путей.

## Контрольная точка после задач 4–7

- [ ] Один настоящий benchmark attempt завершается полным/частичным score.
- [ ] TTFT, tokens/sec и usage основаны на streaming fixtures.
- [ ] Host и исходный workspace остаются неизменными.

## Задача 8: Добавить журнал, resume и агрегацию

**Описание:** Сделать append-only JSONL источником истины, восстановление run state и детерминированный leaderboard с category/cost/performance метриками.

**Критерии приёмки:**

- [ ] Journal дописывается атомарно и сохраняет config/prompt/scorer/image fingerprints.
- [ ] Resume пропускает только завершённые attempt IDs и продолжает незавершённые.
- [ ] Aggregator считает category score, total score, TTFT, output tokens/sec, cost и cost-per-correct с явными null при отсутствии данных.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/journal.test.ts tests/aggregate.test.ts`.
- [ ] Повторная агрегация одного journal byte-for-byte стабильна кроме generated timestamp.

**Зависимости:** Задача 7.

**Вероятно затронутые файлы:** `src/journal.ts`, `src/run.ts`, `src/aggregate.ts`, `tests/journal.test.ts`, `tests/aggregate.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 9: Реализовать Context Recovery

**Описание:** Добавить двухфазную стратегию: применить phase-1 patch, записать notes и локальный commit, затем вызвать provider с пустой conversation history и recovery bundle.

**Критерии приёмки:**

- [ ] Вторая фаза не получает сообщения/скрытое состояние первой, кроме разрешённых repo/log/notes/task artifacts.
- [ ] Уже корректное изменение сохраняется; повтор, rollback и invalidation отмечаются измеримыми penalties.
- [ ] Финальный score использует те же hidden checks, а recovery time хранится отдельно.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/context-recovery.test.ts`.
- [ ] Fixture spy подтверждает ровно два независимых provider requests.

**Зависимости:** Задачи 7–8.

**Вероятно затронутые файлы:** `src/context-recovery.ts`, `src/git-state.ts`, `src/run.ts`, `tests/context-recovery.test.ts`, `tests/fixtures/recovery-task/`.

**Оценка размера:** Medium — 5 путей.

## Задача 10: Собрать стабильный CLI

**Описание:** Предоставить команды `validate`, `run`, `report`, `serve`, preflight Docker/keys/budget и машинно-читаемые exit codes.

**Критерии приёмки:**

- [ ] `validate` ничего не исполняет и показывает все config errors до выхода.
- [ ] `run` поддерживает filters, repeat, seed, resume и bounded concurrency с безопасными defaults.
- [ ] `report/serve` не требуют provider keys и работают с существующим journal.

**Проверка:**

- [ ] RED/GREEN: `npm test -- tests/cli.test.ts`.
- [ ] `node dist/cli.js --help` и ошибочные команды возвращают ожидаемые exit codes.

**Зависимости:** Задачи 8–9.

**Вероятно затронутые файлы:** `src/cli.ts`, `src/commands/validate.ts`, `src/commands/run.ts`, `src/commands/report.ts`, `tests/cli.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Контрольная точка после задач 8–10

- [ ] Run можно прервать/продолжить.
- [ ] Context Recovery доказуемо stateless между фазами.
- [ ] CLI surface документирован help-текстом и contract tests.

## Задача 11: Добавить честный demo-suite

**Описание:** Создать небольшие задачи Debugging, Hallucination и Context Recovery с видимыми workspace и скрытыми deterministic checks, плюс fixture-model responses.

**Критерии приёмки:**

- [ ] Debugging sample проверяет non-index IDs, missing user и empty array.
- [ ] Hallucination sample требует возражения ложной предпосылке и проверяет evidence markers.
- [ ] Recovery sample требует продолжить незавершённую multi-file правку без отката phase 1.

**Проверка:**

- [ ] `npm run bench:demo` завершает все samples без внешних API.
- [ ] Изменение fixture на плохой ответ снижает ожидаемый score.

**Зависимости:** Задачи 7–10.

**Вероятно затронутые файлы:** `benchmarks/demo/suite.yaml`, `benchmarks/demo/debugging-get-user/`, `benchmarks/demo/hallucination/`, `benchmarks/demo/context-recovery/`, `models.fixture.yaml`.

**Оценка размера:** Medium — 5 путей.

## Задача 12: Реализовать визуальную систему dashboard

**Описание:** На основе принятого Image Gen concept создать React app shell, tokens, типографику и реальные report components без декоративных fake metrics.

**Критерии приёмки:**

- [ ] Первый viewport, leaderboard table, summary strip и model selection совпадают с концептом.
- [ ] Любые model/task strings выводятся как escaped text, не через HTML injection.
- [ ] Desktop layout не превращает таблицу в карточную сетку и имеет логичную keyboard/focus структуру.

**Проверка:**

- [ ] Component tests проходят: `npm test -- dashboard`.
- [ ] `npm run build:dashboard`.
- [ ] Screenshot первого viewport сопоставлен с concept через `view_image`.

**Зависимости:** Задача 8 и принятый визуальный концепт.

**Вероятно затронутые файлы:** `dashboard/index.html`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/styles.css`, `dashboard/src/components/Leaderboard.tsx`.

**Оценка размера:** Medium — 5 файлов.

## Задача 13: Подключить report states и responsive interaction

**Описание:** Добавить category filters, сортировку, detail/recovery panel, empty/error states, mobile table treatment и packaging статического отчёта.

**Критерии приёмки:**

- [ ] Filters/sort/detail меняют реальный UI state и доступны с клавиатуры.
- [ ] Context Recovery показывает phase scores, recovery time и penalties, а отсутствующие данные не подменяются нулём.
- [ ] Report работает с `file`-совместимым static server, CSP и viewport 390×844 без horizontal page overflow.

**Проверка:**

- [ ] Component tests: `npm test -- dashboard`.
- [ ] Browser smoke: desktop 1440×900 и mobile 390×844, console errors/warnings = 0.
- [ ] Финальный screenshot сопоставлен с concept по минимум пяти точкам.

**Зависимости:** Задачи 10–12.

**Вероятно затронутые файлы:** `dashboard/src/App.tsx`, `dashboard/src/components/RecoveryPanel.tsx`, `dashboard/src/report.ts`, `src/report-package.ts`, `tests/report.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 14: Оформить документацию и финальную приёмку

**Описание:** Написать README, methodology, task-authoring и security docs с воспроизводимым quickstart, затем выполнить чистую установку и полный review.

**Критерии приёмки:**

- [ ] Новый пользователь запускает demo и открывает report по документированным командам.
- [ ] Документация честно отделяет реализованный patch protocol от будущего полного tool loop.
- [ ] Указаны версии schema/scorer, threat model, provider env names и правила скрытых проверок.

**Проверка:**

- [ ] Чистый `npm ci && npm test && npm run lint && npm run typecheck && npm run build`.
- [ ] `npm audit --audit-level=high` без high/critical.
- [ ] `npm run bench:demo` и browser smoke проходят после clean build.
- [ ] Финальный code review не содержит unresolved critical/high findings.

**Зависимости:** Задачи 1–13.

**Вероятно затронутые файлы:** `README.md`, `docs/methodology.md`, `docs/task-authoring.md`, `docs/security.md`, `CHANGELOG.md`.

**Оценка размера:** Medium — 5 файлов.

## Финальная Definition of Done

- [ ] Все 14 задач и контрольные точки отмечены выполненными с фактическими командами/результатами.
- [ ] Никакие API-ключи, `.env`, generated runs, reports или временные QA-файлы не закоммичены.
- [ ] Git history состоит из проверенных атомарных срезов или явно документировано, почему коммиты были недоступны.
- [ ] Полный demo run воспроизводится без сети провайдеров.
- [ ] Dashboard визуально и функционально проверен в реальном браузере.
- [ ] Известные ограничения перечислены без выдачи их за завершённые возможности.
