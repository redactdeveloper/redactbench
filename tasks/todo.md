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

- [x] Отображаются 11 models, их provider/harness и честный `Not run` state.
- [x] Fixture demo results визуально отделены от target field.
- [x] Surface доступна с клавиатуры и responsive без page overflow.

**Проверка:** [x] 9 component tests; Playwright Chrome 390/768/1440/1536 — 4 passed, console/network errors и page overflow отсутствуют.

## Задача 27: Добавить credential/image readiness

**Критерии приёмки:**

- [x] Проверяется наличие, но никогда не сериализуется значение секрета.
- [x] Profile mounts read-only и scoped по harness.
- [ ] Exposed credentials перевыпущены до платного запуска.

**Проверка:** presence/size/mode/redaction tests; minimal allowlisted staging; production preflight выводит только два отсутствующих readiness name, без значений.

## Задача 28: Подключить harness adapters инкрементально

**Критерии приёмки:**

- [x] Codex, Grok, Cursor, AGY и OpenCode имеют отдельные container adapters.
- [x] Все 11 entrants привязаны к проверенным CLI model IDs/variants и отдельным Docker runtime definitions.
- [x] Context Recovery создаёт новый container для phase 2 и передаёт только checkpoint workspace/Git/notes.
- [ ] Первый платный run требует budget confirmation и точных model identifiers.

**Проверка:** binding/runtime contracts — 17 passed, включая real Docker dry-run; workspace adapter + Context Recovery contracts — 11 passed; пять pinned CLI images собраны и прошли non-root/read-only/no-network version smoke. Live model smoke оставлен на явно оплачиваемый прогон.

## Задача 29: Добавить `redactbench start`

**Критерии приёмки:**

- [x] Команда одной операцией выполняет preflight → run/resume → report packaging → terminal summary.
- [x] Безопасный `--dry-run` не запускает harness containers и не делает model/API calls.
- [x] Default paths соответствуют target field/runtime manifest и основной suite, но имеют CLI overrides.
- [x] Ошибка readiness возникает до первого платного запроса и не раскрывает credentials.

**Проверка:** 17 CLI/readiness/runner/orchestration tests; real build пяти pinned images; non-root/read-only CLI smoke; шесть provider bridges; production `start --dry-run` — 11 entrants / 8 tasks / 88 attempts, без model/API calls.

## Задача 30: Добавить durable progress для `redactbench start`

**Критерии приёмки:**

- [x] Run engine сообщает `ready`, каждую записанную попытку и `completed` с точным `completed/total`.
- [x] Resume начинает счётчик с уже записанных attempts и не выдаёт их за новые.
- [x] CLI progress не содержит prompt/response/error payload или credential values; `--dry-run` не создаёт progress events.

**Проверка:** RED/GREEN run-resume contract; durable journal assertion; CLI formatting/orchestration tests с OSC/control/bidi injection fixtures; полный gate — 128 tests, typecheck, lint, build, audit 0 vulnerabilities и Playwright 4/4.

**Зависимости:** задачи 29 и journal resume.

**Оценка размера:** Medium — `src/run.ts`, `src/commands/start.ts`, `src/cli.ts` и целевые tests, двумя атомарными инкрементами.

## Задача 32: Ограничить generation budget до платного запуска

**Критерии приёмки:**

- [x] План считает 99 generations для текущих 88 attempts, учитывая вторую Context Recovery phase.
- [x] `redactbench start` по умолчанию допускает не более 100 generations; превышение останавливается до Docker preflight и credentials.
- [x] `--dry-run` показывает `READY/BLOCKED`, а `--max-generations` позволяет явно повысить cap.
- [x] Документация не выдаёт generation cap за точный dollar/token limit внутренних agent turns.

**Проверка:** RED/GREEN plan/CLI boundary tests; default `99/100 READY`; `repeat 2` блокируется до preflight как `198/100`; host env сокращён до allowlist; production dry-run без model/API calls; полный gate — 131 tests, typecheck, lint, build, audit 0 vulnerabilities и Playwright 4/4.

**Зависимости:** target suite definition и задача 29.

**Оценка размера:** Medium — `src/commands/start.ts`, `src/cli.ts`, tests и docs.

## Задача 33: Отделить валидность прогона от качества модели

**Критерии приёмки:**

- [x] Report содержит typed validity summary по provider/infrastructure/model-output failures.
- [x] Provider/infrastructure failure запрещает final public Rank, но attempts остаются видимыми.
- [x] Dashboard явно объясняет invalid run и не выдаёт его за завершённый рейтинг.

**Проверка:** [x] RED/GREEN aggregate + public-table tests; полный gate — 140 tests, typecheck, lint, build и Playwright 8/8.

**Зависимости:** задачи 16, 30 и публичная live-таблица.

**Оценка размера:** Medium — contracts, aggregate, public table, tests и methodology.

## Задача 34: Добавить block-balanced scheduler

**Критерии приёмки:**

- [x] Jobs сгруппированы по `task × repeat`, внутри блока каждая модель встречается один раз.
- [x] Seed полностью воспроизводит block и model order.
- [x] Resume удаляет завершённые jobs без изменения относительного порядка оставшихся jobs.

**Проверка:** [x] Exact scheduler tests + run resume integration; полный gate — 140 tests, typecheck, lint, build и Playwright 8/8.

**Зависимости:** задача 33.

**Оценка размера:** Small — run scheduler и tests.

## Задача 35: Добавить контракт независимого release-suite

**Критерии приёмки:**

- [x] Suite различает `smoke` и `release`, сохраняя совместимость старых manifests.
- [x] Release suite требует минимум три задачи в каждой из восьми категорий.
- [x] Task manifests release-suite принадлежат разным реальным директориям и не используют symlink aliases.

**Проверка:** [x] RED/GREEN contracts + definition containment tests; demo validate остаётся зелёным.

**Оценка размера:** Medium — contracts, definition, tests и authoring docs.

## Задача 36: Создать независимый Silver corpus

**Критерии приёмки:**

- [ ] `benchmarks/silver` содержит 24 независимые задачи, по три на категорию.
- [ ] Каждая задача имеет собственные workspace/evaluator/checks и calibration fixtures.
- [ ] Ни одна задача не зависит от состояния, файлов или результата другой задачи.

**Проверка:** category-by-category fixture calibration и filesystem independence audit.

**Зависимости:** задача 35.

**Оценка размера:** XL, разбить на восемь category slices по 3–5 файлов каждый.

### Задача 36A: Algorithms slice

- [x] Три независимые директории: interval merge, dependency ordering, bounded allocation.
- [x] У каждой задачи минимум четыре атомарных hidden checks и собственный evaluator.
- [x] Authoring suite валидируется отдельно и не имеет `purpose: release`.

**Проверка:** [x] manifest validation, gold/partial/adversarial calibration, filesystem independence audit.

### Задачи 36B–36H

- [ ] 36B Debugging: три независимые задачи.
- [ ] 36C Refactoring: три независимые задачи.
- [ ] 36D Security: три независимые задачи.
- [ ] 36E UI: три независимые задачи.
- [ ] 36F Reasoning: три независимые задачи.
- [ ] 36G Pushback: три независимые задачи.
- [ ] 36H Context Recovery: три независимые задачи.

**Контрольная точка после каждой категории:** authoring suite валиден, strong fixtures проходят 100%, partial/adversarial решения различаются, директории не разделяются.

## Задача 37: Запретить публикацию нерелизных прогонов

**Критерии приёмки:**

- [ ] Public Rank требует release-suite, repeat `3+`, полный run и validForRanking.
- [ ] Smoke и filtered runs не теряются, но получают `Ranking withheld` с причиной.
- [ ] CLI и dashboard используют один typed publication decision.

**Проверка:** aggregation/start/dashboard contracts и полный browser gate.

**Зависимости:** задачи 35 и 36.

**Оценка размера:** Medium — report contract, aggregator, CLI и public table.

## Задача 38: Зафиксировать Gold identity и anti-reuse gate

**Описание:** Создать автоматическую проверку независимости будущего Gold-корпуса на temporary filesystem fixtures. Реальный authoring manifest появится вместе с первой задачей, потому что пустой suite нарушает текущий contract.

**Критерии приёмки:**

- [x] Audit отклоняет symlinks/realpaths вне Gold, ссылки на Silver, повтор task ID и точные normalized prompt/workspace duplicates.
- [x] Audit принимает независимые temporary Gold fixtures и применяется к реальному corpus в задаче 39A.
- [x] Общий suite schema и существующие manifests не меняются.

**Проверка:**

- [x] Targeted RED/GREEN: `npm test -- tests/gold-independence.test.ts` — 4 tests passed.
- [x] Regression: definition/contracts tests проходят без изменения старых manifests — 19 tests passed.
- [x] `npm run typecheck` проходит после инкремента.

**Зависимости:** задача 35.

**Вероятно затронутые файлы:** `src/corpus-independence.ts`, `tests/gold-independence.test.ts`.

**Оценка размера:** Small — 2 файла.

## Задача 39A: Добавить Gold debugging task про crash-safe checkpoint

**Описание:** Создать полностью новую multi-file задачу об importer resume после сбоя между durable data write и checkpoint update.

**Критерии приёмки:**

- [x] Workspace воспроизводит пропуск данных после injected crash, не раскрывая evaluator cases.
- [x] Первый `benchmarks/gold/authoring-suite.yaml` использует отдельные suite ID и `scorerVersion: 3.0.0-dev`, оставаясь smoke-only; release manifest отсутствует.
- [x] Четыре атомарных checks различают normal resume, crash resume, idempotency и legacy checkpoint compatibility.
- [x] Strong, partial и adversarial fixtures имеют разные pass/fail profiles: 4/4, 3/4 и 3/4 с разными failed checks.

**Проверка:** manifest load, evaluator mode tests и calibration matrix в `tests/gold-debugging.test.ts`.

**Зависимости:** задача 38.

**Вероятно затронутые файлы:** одна directory под `benchmarks/gold`, authoring manifest и targeted test.

**Оценка размера:** Medium; реализовать и проверить до 39B.

## Задача 39B: Добавить Gold debugging task про cache refresh race

**Описание:** Создать новую задачу о дедупликации concurrent refresh и защите свежего cache entry от позднего rejection.

**Критерии приёмки:**

- [x] Checks независимо покрывают concurrent miss, stale rejection, TTL boundary и retry после error.
- [x] Решение не сериализует независимые keys и не меняет public API.
- [x] Strong, partial и adversarial fixtures дают профили 4/4, 2/4 и 2/4.

**Проверка:** deterministic fake-clock evaluator и calibration matrix.

**Зависимости:** задача 38; review результата 39A.

**Вероятно затронутые файлы:** одна directory под `benchmarks/gold`, authoring manifest и targeted test.

**Оценка размера:** Medium; реализовать и проверить до 39C.

## Задача 39C: Добавить Gold debugging task про DST scheduler

**Описание:** Создать новую задачу о сохранении локального wall-clock времени recurring schedule на переходах DST.

**Критерии приёмки:**

- [x] Checks отдельно покрывают spring-forward, fall-back, обычную дату и UTC regression.
- [x] Invalid timezone остаётся явной ошибкой, а evaluator использует детерминированный injected timezone adapter.
- [x] Strong, partial и adversarial fixtures дают профили 4/4, 2/4 и 1/4.

**Проверка:** table-driven evaluator, manifest load и calibration matrix.

**Зависимости:** задача 38; review результата 39B.

**Вероятно затронутые файлы:** одна directory под `benchmarks/gold`, authoring manifest и targeted test.

**Оценка размера:** Medium.

## Контрольная точка Gold Debugging

- [x] Authoring suite содержит ровно три Gold debugging tasks и остаётся smoke-only.
- [x] Strong fixtures проходят 100%; partial/adversarial имеют различимые профили на каждой задаче.
- [x] Independence audit не находит содержательного или filesystem reuse Silver.
- [ ] Полные `npm test`, `npm run typecheck` и `npm run build` проходят; полный lint блокирует существующий Silver `structuredClone` в `benchmarks/silver/security-repository-injection/evaluator/check.mjs`, targeted Gold lint чистый.
- [ ] Человек подтвердил уровень сложности и качество scoring до расширения корпуса.

## Задача 40: Расширить Gold до восьми категорий

**Описание:** После первой контрольной точки отдельно спланировать и реализовать по три новые задачи для Algorithms, Refactoring, Security, UI, Reasoning, Hallucination и Context Recovery.

**Критерии приёмки:**

- [ ] Gold содержит 24 независимые задачи, по три на каждую категорию.
- [ ] Каждая задача имеет собственные workspace, evaluator, hidden checks и strong/partial/adversarial calibration fixtures.
- [ ] Ни один сценарий не повторяет Silver prompt, defect mechanism или expected patch.

**Проверка:** category checkpoints и полный independence audit после каждых двух категорий.

**Зависимости:** контрольная точка Gold Debugging.

**Оценка размера:** XL-программа; перед реализацией разбить на 21 Small/Medium task.

### Gold Algorithms slice

- [x] Streaming JSONL decoder проверяет произвольные chunk boundaries, split UTF-8, CRLF/blank lines и byte limits.
- [x] Event-time buffer проверяет watermark ordering, deterministic ties, late arrivals и duplicate IDs.
- [x] Deficit scheduler проверяет weighted service, persistent credit, lane FIFO и public input contract.
- [x] У всех трёх задач strong fixtures проходят 4/4, а partial/adversarial profiles различимы.
- [x] Полный checkpoint: 184 tests, typecheck, targeted Gold lint, build и independence audit проходят.

## Задача 41: Выпустить Gold release-suite

**Описание:** После завершения корпуса создать release manifest, включить Gold identity в publication decision и задокументировать отдельный запуск Gold.

**Критерии приёмки:**

- [ ] Release suite содержит 24 Gold tasks и проходит category/independence gates.
- [ ] Publishable Gold run требует `repeat >= 3`, valid full run и scorer `3.x`.
- [ ] CLI/dashboard не смешивают Gold и Silver результаты.

**Проверка:** fixture release run, aggregation/publication contracts, browser smoke и methodology audit.

**Зависимости:** задачи 37 и 40.

**Оценка размера:** Medium; разнести manifest, typed metadata и presentation на отдельные инкременты.
