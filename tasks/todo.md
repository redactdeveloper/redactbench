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

- [x] SSE parser корректно переживает chunk boundaries, comments, multi-line data и неизвестные события.
- [x] OpenAI adapter использует фиксированный HTTPS host, `store: false`, env key и возвращает text/usage/timing.
- [x] HTTP/API ошибки не раскрывают Authorization header или credential-shaped body content.

**Проверка:**

- [x] RED/GREEN: 6 targeted tests passed; полный набор — 31 test.
- [x] Typecheck подтверждает единый `ProviderAdapter` contract.

**Зависимости:** Задачи 2–3.

**Вероятно затронутые файлы:** `src/providers/types.ts`, `src/providers/sse.ts`, `src/providers/openai.ts`, `tests/sse.test.ts`, `tests/providers/openai.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 5: Добавить Anthropic, Gemini и fixture adapters

**Описание:** Реализовать остальные provider variants на том же transport и детерминированный fixture adapter для бесплатных end-to-end тестов.

**Критерии приёмки:**

- [x] Anthropic собирает `text_delta`, input/output usage и игнорирует ping/новые event types.
- [x] Gemini собирает streamed candidate parts и `usageMetadata` через фиксированный official endpoint.
- [x] Fixture adapter отдаёт keyed ответы без сети, таймеров или mutable cursor.

**Проверка:**

- [x] RED/GREEN: provider tests passed; полный набор — 35 tests.
- [x] Provider fixtures соответствуют примерам официальной документации OpenAI, Anthropic и Google.

**Зависимости:** Задача 4.

**Вероятно затронутые файлы:** `src/providers/anthropic.ts`, `src/providers/google.ts`, `src/providers/fixture.ts`, `src/providers/index.ts`, `tests/providers/other.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 6: Изолировать hidden checks в Docker

**Описание:** Сначала abuse-тестами, затем кодом создать evaluator, который запускает только argv-команды в ограниченном Docker container и возвращает weighted partial score.

**Критерии приёмки:**

- [x] Container получает только временный workspace и read-only evaluator, без API keys и сети.
- [x] Timeout, output cap, CPU/memory/PID, cap-drop и no-new-privileges применяются к каждому check.
- [x] Pass/fail/error/timeout различаются, а веса нормализуются детерминированно.

**Проверка:**

- [x] RED/GREEN: evaluator/security tests passed; полный набор — 40 tests.
- [x] Docker integration подтвердил отсутствие сети, read-only evaluator и запись только в workspace.

**Зависимости:** Задачи 2–3.

**Вероятно затронутые файлы:** `src/sandbox/docker.ts`, `src/evaluator.ts`, `src/process.ts`, `tests/evaluator.test.ts`, `tests/security.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 7: Провести один attempt end-to-end

**Описание:** Связать snapshot, provider, response parser, безопасное применение diff и evaluator в rollback-friendly attempt runner.

**Критерии приёмки:**

- [x] Исходный workspace не изменяется; каждый attempt работает в новой временной копии.
- [x] Patch сначала проходит containment и `git apply --check`, затем применяется один раз.
- [x] Результат содержит artifacts, provider metrics, check results, score и безопасную ошибку при сбое.

**Проверка:**

- [x] RED/GREEN: 3 unit tests и отдельный attempt integration test passed.
- [x] Fixture integration исправляет sample bug и проходит hidden checks в Docker.

**Зависимости:** Задачи 3–6.

**Вероятно затронутые файлы:** `src/attempt.ts`, `src/workspace.ts`, `src/patch.ts`, `tests/attempt.test.ts`, `tests/fixtures/attempt-task/`.

**Оценка размера:** Medium — 5 путей.

## Контрольная точка после задач 4–7

- [x] Один настоящий benchmark attempt завершается полным/частичным score.
- [x] TTFT, tokens/sec и usage основаны на streaming fixtures.
- [x] Host и исходный workspace остаются неизменными.

## Задача 8: Добавить журнал, resume и агрегацию

**Описание:** Сделать append-only JSONL источником истины, восстановление run state и детерминированный leaderboard с category/cost/performance метриками.

**Критерии приёмки:**

- [x] Journal дописывается с fsync и hash chain, сохраняя config/prompt/scorer/image fingerprints.
- [x] Resume пропускает только завершённые attempt IDs и продолжает незавершённые.
- [x] Aggregator считает category score, total score, TTFT, output tokens/sec, cost и cost-per-correct с явными null при отсутствии данных.

**Проверка:**

- [x] RED/GREEN: journal/aggregate/run tests passed; полный набор — 50 tests.
- [x] Повторная агрегация deduplicated journal стабильна, а generated timestamp передаётся явно.

**Зависимости:** Задача 7.

**Вероятно затронутые файлы:** `src/journal.ts`, `src/run.ts`, `src/aggregate.ts`, `tests/journal.test.ts`, `tests/aggregate.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 9: Реализовать Context Recovery

**Описание:** Добавить двухфазную стратегию: применить phase-1 patch, записать notes и локальный commit, затем вызвать provider с пустой conversation history и recovery bundle.

**Критерии приёмки:**

- [x] Вторая фаза не получает сообщения/скрытое состояние первой, кроме разрешённых repo/log/notes/task artifacts.
- [x] Уже корректное изменение сохраняется; повтор, rollback и invalidation отмечаются измеримыми penalties.
- [x] Финальный score использует те же hidden checks, а recovery time хранится отдельно.

**Проверка:**

- [x] RED/GREEN: core + crash-resume Context Recovery tests passed.
- [x] Fixture spy подтверждает два независимых requests; fault-injection resume — phase 1 не повторяется.

**Зависимости:** Задачи 7–8.

**Вероятно затронутые файлы:** `src/context-recovery.ts`, `src/git-state.ts`, `src/run.ts`, `tests/context-recovery.test.ts`, `tests/fixtures/recovery-task/`.

**Оценка размера:** Medium — 5 путей.

## Задача 10: Собрать стабильный CLI

**Описание:** Предоставить команды `validate`, `run`, `report`, `serve`, preflight Docker/keys/budget и машинно-читаемые exit codes.

**Критерии приёмки:**

- [x] `validate` ничего не исполняет и проверяет suite/task/model/fixture contracts до выхода.
- [x] `run` поддерживает filters, repeat, seed, resume и bounded concurrency 1–8 с безопасным default 1.
- [x] `report/serve` не требуют provider keys и работают с существующим journal.

**Проверка:**

- [x] RED/GREEN: 4 CLI contract tests и report-server security test passed.
- [x] `node dist/cli.js --help`/`--version` проверены на production build; ошибки имеют стабильные exit codes.

**Зависимости:** Задачи 8–9.

**Вероятно затронутые файлы:** `src/cli.ts`, `src/commands/validate.ts`, `src/commands/run.ts`, `src/commands/report.ts`, `tests/cli.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Контрольная точка после задач 8–10

- [x] Run можно прервать/продолжить, включая recovery checkpoint между фазами.
- [x] Context Recovery доказуемо stateless между фазами.
- [x] CLI surface документирован help-текстом и contract tests.

## Задача 11: Добавить честный demo-suite

**Описание:** Создать небольшие задачи Debugging, Hallucination и Context Recovery с видимыми workspace и скрытыми deterministic checks, плюс fixture-model responses.

**Критерии приёмки:**

- [x] Debugging sample проверяет ordered/sparse IDs, missing user и empty array.
- [x] Hallucination sample требует возражения ложной предпосылке, `undefined` и actionable evidence.
- [x] Recovery sample требует продолжить multi-file правку; rollback получает отдельный penalty.

**Проверка:**

- [x] `npm run bench:demo` завершил 9 attempts / 33 Docker checks без внешних API.
- [x] Fixture Strong/Fast/Cautious получили 100% / 62.2% / 37.8%; плохие ответы снижают score.

**Зависимости:** Задачи 7–10.

**Вероятно затронутые файлы:** `benchmarks/demo/suite.yaml`, `benchmarks/demo/debugging-get-user/`, `benchmarks/demo/hallucination/`, `benchmarks/demo/context-recovery/`, `models.fixture.yaml`.

**Оценка размера:** Medium — 5 путей.

## Задача 12: Реализовать визуальную систему dashboard

**Описание:** На основе принятого Image Gen concept создать React app shell, tokens, типографику и реальные report components без декоративных fake metrics.

**Критерии приёмки:**

- [x] Первый viewport, leaderboard table, summary strip и model selection совпадают с концептом.
- [x] Любые model/task strings выводятся как escaped text, не через HTML injection.
- [x] Desktop layout не превращает таблицу в карточную сетку и имеет логичную keyboard/focus структуру.

**Проверка:**

- [x] Component tests: 6 dashboard tests passed; полный набор — 69 tests.
- [x] `npm run build:dashboard` — production bundle собран.
- [x] Desktop/mobile screenshots сопоставлены с concept через `view_image`.

**Зависимости:** Задача 8 и принятый визуальный концепт.

**Вероятно затронутые файлы:** `dashboard/index.html`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/styles.css`, `dashboard/src/components/Leaderboard.tsx`.

**Оценка размера:** Medium — 5 файлов.

## Задача 13: Подключить report states и responsive interaction

**Описание:** Добавить category filters, сортировку, detail/recovery panel, empty/error states, mobile table treatment и packaging статического отчёта.

**Критерии приёмки:**

- [x] Filters/sort/detail меняют реальный UI state и доступны с клавиатуры.
- [x] Context Recovery показывает phase scores, recovery time и penalties, а отсутствующие данные не подменяются нулём.
- [x] Report работает с relative static assets, CSP и viewport 390×844 без horizontal page overflow.

**Проверка:**

- [x] Component tests: state changes, escaped labels, unknown costs и null sorting покрыты.
- [x] Browser smoke: 1536×1024, 1440×900 и 390×844; 3 passed, console/network errors = 0.
- [x] Финальный screenshot сопоставлен с concept: palette, rail/header, summary strip, semantic table, recovery timeline и responsive hierarchy.

**Зависимости:** Задачи 10–12.

**Вероятно затронутые файлы:** `dashboard/src/App.tsx`, `dashboard/src/components/RecoveryPanel.tsx`, `dashboard/src/report.ts`, `src/report-package.ts`, `tests/report.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 14: Оформить документацию и финальную приёмку

**Описание:** Написать README, methodology, task-authoring и security docs с воспроизводимым quickstart, затем выполнить чистую установку и полный review.

**Критерии приёмки:**

- [x] Новый пользователь запускает demo и открывает report по документированным командам.
- [x] Документация честно отделяет реализованный patch protocol от будущего полного tool loop.
- [x] Указаны версии schema/scorer, threat model, provider env names и правила скрытых проверок.

**Проверка:**

- [x] Clean-room: `npm ci`; 69 tests; lint/typecheck/build passed.
- [x] `npm audit --audit-level=high` — 0 vulnerabilities.
- [x] Fresh `npm run bench:demo`: 9 attempts / 33 Docker checks; browser smoke: 3 passed.
- [x] Финальный multi-axis review: все required findings исправлены, unresolved critical/high отсутствуют.

**Зависимости:** Задачи 1–13.

**Вероятно затронутые файлы:** `README.md`, `docs/methodology.md`, `docs/task-authoring.md`, `docs/security.md`, `CHANGELOG.md`.

**Оценка размера:** Medium — 5 файлов.

## Definition of Done v0.1

- [x] Все 14 задач и контрольные точки отмечены выполненными с фактическими командами/результатами.
- [x] Никакие API-ключи, `.env`, generated runs, reports или временные QA-файлы не закоммичены.
- [x] Git history состоит из проверенных атомарных срезов.
- [x] Полный demo run воспроизводится без обращений к модельным провайдерам.
- [x] Dashboard визуально и функционально проверен в реальном Chrome.
- [x] Известные ограничения перечислены без выдачи их за завершённые возможности.

---

## Задача 15: Изолировать каждый hidden check

**Описание:** Запускать каждый check на fresh clone одного и того же post-model workspace, чтобы check order и mutations не меняли score.

**Критерии приёмки:**

- [x] Второй check не видит файлы/правки, созданные первым.
- [x] Исходный evaluated workspace остаётся неизменным.
- [x] Clone/setup/cleanup errors безопасно отражаются в check result.

**Проверка:**

- [x] `tests/evaluator.test.ts` — 4 passed, включая mutation/setup/cleanup regressions.
- [x] Docker/attempt/context-recovery integration — 4 passed после изменения.

**Зависимости:** Задача 6.

**Вероятно затронутые файлы:** `src/evaluator.ts`, `tests/evaluator.test.ts`, `tests/docker.integration.test.ts`.

**Оценка размера:** Small — 3 файла.

## Задача 16: Добавить weighted repeat statistics

**Описание:** Сделать task weights доступными в report и добавить repeat-level SD/SE/95% CI по NIST Student-t formula.

**Критерии приёмки:**

- [x] Filtered и aggregate scores совпадают при unequal task weights.
- [x] Statistics используют только полные repeats и возвращают `null` CI при `n < 2`.
- [x] CI ограничен `[0,1]`, а zero variance даёт zero-width interval.

**Проверка:**

- [x] RED/GREEN: `statistics/aggregate/contracts` — 21 passed.
- [x] Старый report получает безопасные defaults; новый schema отклоняет противоречивую uncertainty metadata.

**Зависимости:** Задача 8.

**Вероятно затронутые файлы:** `src/statistics.ts`, `src/contracts.ts`, `src/aggregate.ts`, `tests/statistics.test.ts`, `tests/aggregate.test.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 17: Показать reliability и run conditions

**Описание:** Вывести repeat CI, sample count, concurrency и seed в report dashboard без ложной точности при одном repeat.

**Критерии приёмки:**

- [x] Leaderboard/summary используют authoritative task weights.
- [x] `repeat=1` показывает рекомендацию, а не `±0`.
- [x] Responsive table и page не получают horizontal overflow.

**Проверка:**

- [x] Dashboard component tests — 8 passed, включая unequal-weight 25% regression.
- [x] Playwright 1536×1024, 1440×900 и 390×844 — 3 passed без console/network errors.

**Зависимости:** Задача 16.

**Вероятно затронутые файлы:** `dashboard/src/App.tsx`, `dashboard/src/components/Leaderboard.tsx`, `dashboard/src/styles.css`, `tests/dashboard.test.tsx`, `tests/browser/dashboard.spec.ts`.

**Оценка размера:** Medium — 5 файлов.

## Задача 18: Добавить Algorithms smoke task

**Критерии приёмки:** edge cases, deterministic ties и input immutability оцениваются независимыми checks; три fixture tiers различаются.

**Проверка:** [x] targeted fixture run: Strong/Fast/Cautious = 100% / 66.7% / 33.3%.

## Задача 19: Добавить Refactoring smoke task

**Критерии приёмки:** behavior сохранён, shared mutable state удалён структурно, три fixture tiers различаются.

**Проверка:** [x] targeted fixture run: Strong/Fast/Cautious = 100% / 37.5% / 25%.

## Задача 20: Добавить Security smoke task

**Критерии приёмки:** valid path работает, traversal/absolute/NUL блокируются, три fixture tiers различаются.

**Проверка:** [x] targeted fixture run: Strong/Fast/Cautious = 100% / 62.5% / 50%; symlink escape отличает полный fix.

## Задача 21: Добавить UI smoke task

**Критерии приёмки:** semantic controls, state change и keyboard-safe behavior проверяются детерминированно, три fixture tiers различаются.

**Проверка:** [x] targeted fixture run: Strong/Fast/Cautious = 100% / 62.5% / 37.5%.

## Задача 22: Добавить Reasoning smoke task

**Критерии приёмки:** cross-file cause, exact evidence и actionable fix оцениваются без LLM judge, три fixture tiers различаются.

**Проверка:** [x] targeted fixture run: Strong/Fast/Cautious = 100% / 57.1% / 0%.

## Задача 23: Переверсионировать scorer и провести final audit

**Критерии приёмки:**

- [x] Package `0.2.0`, demo scorer `1.1.0`, docs/changelog актуальны.
- [x] Fresh demo: 8 categories × 3 models = 24 attempts / 96 checks, journal verified, 0 attempt errors.
- [ ] Clean install/tests/lint/typecheck/build/audit/browser smoke чистые.
- [ ] Final review не содержит unresolved critical/high findings.

## Definition of Done v0.2

- [x] Hidden checks независимы по filesystem state.
- [x] Weighted filtering совпадает с scorer.
- [x] Repeat uncertainty видна и корректно отсутствует при одном sample.
- [x] Demo покрывает все 8 categories.
- [x] Ограничения статистики и smoke coverage документированы.
- [ ] Worktree чист, изменения сохранены атомарными commits.

---

## Задача 24: Добавить roster contract для 11 entrants

**Критерии приёмки:**

- [x] Strict schema различает provider, model label, harness и stable entrant ID.
- [x] Manifest содержит ровно 11 согласованных связок в заданном порядке.
- [x] Duplicate IDs, неизвестный harness и credential-shaped поля отклоняются.

**Проверка:** [x] RED/GREEN `tests/field.test.ts` — 7 passed; typecheck/lint clean.

## Задача 25: Зафиксировать Docker-only harness execution

**Критерии приёмки:**

- [x] Runnable binding требует OCI image, argv template и bounded resources.
- [x] Harness workspace writable, evaluator отсутствует, credentials выдаются только scoped file mounts.
- [x] Host execution fallback и shell entrypoints отсутствуют и тестом отклоняются.

**Проверка:** [x] 13 exact contract/security tests + real Docker dry-run; typecheck/lint clean.

## Задача 26: Сделать entrant surface в dashboard

**Критерии приёмки:**

- [ ] Отображаются 11 models, их provider/harness и честный `Not run` state.
- [ ] Fixture demo results визуально отделены от target field.
- [ ] Surface доступна с клавиатуры и responsive без page overflow.

**Проверка:** component tests + Playwright 390/768/1440.

## Задача 27: Добавить credential/image readiness

**Критерии приёмки:**

- [ ] Проверяется наличие, но никогда не сериализуется значение секрета.
- [ ] Profile mounts read-only и scoped по harness.
- [ ] Exposed credentials перевыпущены до платного запуска.

**Проверка:** redaction/absence tests + manual preflight with names only.

## Задача 28: Подключить harness adapters инкрементально

**Критерии приёмки:**

- [ ] Codex, Grok, Cursor, AGY и OpenCode имеют отдельные container adapters.
- [ ] Context Recovery создаёт новый container для phase 2.
- [ ] Первый платный run требует budget confirmation и точных model identifiers.

**Проверка:** per-adapter dry-run, затем opt-in live smoke.
