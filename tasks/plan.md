# План реализации: RedactBench

## Обзор

RedactBench — локальный воспроизводимый полигон для сравнения кодинг-моделей на одинаковых заданиях. CLI напрямую вызывает API OpenAI, Anthropic и Google Gemini, измеряет TTFT, длительность, скорость и стоимость, применяет ответ модели к изолированной копии рабочего каталога, запускает скрытые проверки в Docker и сохраняет append-only журнал. Из того же журнала строится интерактивный HTML-dashboard. Отдельный трек `context-recovery` выполняется двумя независимыми запросами: после первой фазы модель теряет историю диалога и получает только изменённый репозиторий, локальную Git-историю, заметки и краткую исходную задачу.

## Зафиксированные предположения

- Проект создаётся с нуля в `/home/ivan/myprojets/redactbench` и получает собственный Git-репозиторий.
- Целевой рантайм — Node.js 22+, TypeScript, npm и Docker; внешняя база данных не нужна.
- Первый релиз — качественный локальный MVP: CLI + статический отчёт, без аккаунтов, облачного оркестратора и публичного leaderboard-сервера.
- Секреты читаются только из стандартных переменных окружения и никогда не попадают в манифест, prompt, журнал или отчёт.
- Пользователь явно попросил реализацию в этом же запросе, поэтому после фиксации плана работа продолжается инкрементально; отдельная пауза на подтверждение технического плана не требуется.
- Стоимость задаётся рядом с конкретной моделью в конфигурации запуска. RedactBench не зашивает изменчивый прайс провайдера в код.

## Критерии успеха проекта

- Одна команда валидирует suite, другая запускает одинаковые задания на выбранных моделях, третья строит/открывает отчёт.
- OpenAI, Anthropic и Gemini вызываются напрямую по официальным HTTPS endpoint’ам со streaming; fixture-provider позволяет полностью проверить harness без API-ключей.
- Ответы моделей не исполняются на host: patch проходит валидацию, а проверки запускаются в Docker без сети, capabilities и привилегий, с лимитами времени, памяти, CPU, PID и вывода.
- Скрытые проверки возвращают частичный взвешенный балл; категории включают algorithms, debugging, refactoring, security, ui, reasoning, hallucination и context-recovery.
- Каждый attempt сохраняет prompt hash, provider/model, schema/scorer version, timing, token usage, цену, проверки и финальный score в append-only JSONL.
- Прерванный run можно продолжить без повторного вызова уже завершённых пар `task × model × repeat`.
- Context Recovery действительно делает второй stateless API-вызов и фиксирует время восстановления, повтор/откат уже выполненной работы и итоговый test score.
- Demo-suite выполняется fixture-моделью end-to-end и создаёт настоящий отчёт; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` и browser smoke завершаются успешно.

## Архитектурные решения

- **Один npm-пакет, два entrypoint.** `src/` содержит CLI/harness, `dashboard/` — React/Vite-интерфейс. Общий контракт отчёта импортируется обоими слоями.
- **Contract-first + Zod.** Suite, task, model config, provider result, journal event и report имеют версионированные схемы. Все YAML/JSON, env и ответы внешних API валидируются на границе.
- **Прямой REST + общий SSE parser.** Небольшие адаптеры обращаются к фиксированным официальным endpoint’ам. Это исключает aggregator latency и лишние SDK-зависимости, а общий parser допускает неизвестные будущие SSE-события.
- **Строгий response envelope.** Для patch-задач prompt требует блоки `<redactbench_patch>` и `<redactbench_notes>`. Parser ограничивает размер и принимает только unified diff; текстовые задачи сохраняют raw answer как данные.
- **Docker обязателен для evaluator.** Команды представлены массивом argv и никогда не проходят через shell. В MVP нет небезопасного host fallback.
- **Task-owned hidden evaluator.** Каталог задачи разделён на `workspace/` (виден модели) и `evaluator/` (не попадает в prompt, монтируется read-only только во время проверки).
- **Append-only journal как источник истины.** `journal.jsonl` дописывается после каждого устойчивого состояния; `run.json` — производная проекция, которую можно перестроить.
- **Детерминированная агрегация.** Общий балл — взвешенное среднее task score; по категориям показывается отдельный score. TTFT, generation time, output tokens/sec, total cost и cost-per-correct не смешиваются в один непрозрачный рейтинг.
- **Статический dashboard.** Команда report копирует собранный frontend и кладёт рядом `report.json`; встроенный локальный server отдаёт файлы с CSP и без внешних запросов.
- **Context Recovery как отдельная стратегия run.** Первая фаза применяет patch и сохраняет заметки/commit; вторая создаёт новый provider request только со snapshot текущего repo, `git log`, notes и краткой задачей.

## Поток данных и зависимости

```text
task.yaml + workspace + model config
              │
              v
       schema validation
              │
              v
     deterministic prompt snapshot ──> direct provider SSE
                                           │
                                           v
                                  response envelope parser
                                           │
                                           v
                                   isolated repo copy
                                           │
                         ┌─────────────────┴─────────────────┐
                         │                                   │
                         v                                   v
                apply validated patch              raw answer file
                         │                                   │
                         └──────────────┬────────────────────┘
                                        v
                              Docker hidden checks
                                        │
                                        v
                              append-only journal
                                        │
                         ┌──────────────┴──────────────┐
                         v                             v
                  resumable state                report aggregate
                                                       │
                                                       v
                                                React dashboard

context-recovery:
phase 1 request -> patch + notes -> local commit -> RESET -> repo + log + notes -> phase 2 request -> checks
```

## Публичные контракты

- `schemaVersion: 1` обязателен в suite/task/model/report.
- Category — закрытый enum; неизвестная категория отклоняется с указанием YAML path.
- Provider — discriminated union `fixture | openai | anthropic | google`.
- Команда проверки — непустой `argv: string[]`, относительный `cwd`, положительные timeout/weight и Docker image.
- Journal event содержит стабильный `attemptId`; повторная запись с тем же ID не считается новым attempt при агрегации.
- Ошибки CLI имеют стабильный code (`CONFIG_INVALID`, `PROVIDER_ERROR`, `PATCH_REJECTED`, `SANDBOX_ERROR`, `CHECK_TIMEOUT`) и безопасное пользовательское сообщение.
- Новые поля добавляются только как optional; breaking change требует новой `schemaVersion`.

## Threat model и защитные границы

| Граница | Угроза | Мера |
|---|---|---|
| YAML/JSON задачи | path traversal, command injection, resource abuse | Zod, canonical path containment, argv без shell, caps на размеры/таймауты |
| Ответ провайдера | prompt injection, огромный ответ, malicious diff | output/token/byte caps, строгий envelope, unified-diff validation, отсутствие eval |
| Patch модели | запись вне workspace, symlink escape | временная копия, запрет absolute/`..` paths, `git apply --check`, повторная containment-проверка |
| Hidden evaluator | чтение секретов/сети/host | Docker `--network none`, env allowlist, read-only evaluator, cap-drop, no-new-privileges, лимиты |
| Docker image | supply-chain drift | warning/error для unpinned images в strict mode, journal сохраняет фактический image ID |
| API credentials | утечка в prompt/log/report | фиксированные env names, redaction ошибок/headers, секреты не сериализуются |
| Report content | XSS через model output | React text escaping, model answer не рендерится как HTML, CSP |
| Стоимость/DoS | бесконечные повторы и дорогие ответы | max attempts, max output tokens, timeout, concurrency cap, предварительная оценка budget |

## Список задач

### Фаза 1: контракты и вертикальный smoke path

- [ ] Задача 1: Инициализировать пакет, Git, строгий TypeScript и тестовый контур.
- [ ] Задача 2: Зафиксировать схемы suite/task/model/report и диагностические ошибки.
- [ ] Задача 3: Реализовать prompt snapshot и безопасный response-envelope parser.

### Контрольная точка: основа

- [ ] Невалидные манифесты и опасные пути отклоняются тестами.
- [ ] Fixture-response превращается в patch/answer без внешней сети.
- [ ] Typecheck, lint и unit-тесты проходят.

### Фаза 2: вызов моделей и проверка решений

- [ ] Задача 4: Реализовать SSE transport и адаптер OpenAI Responses.
- [ ] Задача 5: Добавить прямые адаптеры Anthropic Messages и Gemini GenerateContent.
- [ ] Задача 6: Создать безопасный Docker evaluator и weighted checks.
- [ ] Задача 7: Связать provider → patch → evaluator в одном attempt runner.

### Контрольная точка: рабочий benchmark

- [ ] Fixture attempt проходит полный путь и получает частичный/полный балл из реальных hidden checks.
- [ ] Provider contract tests подтверждают TTFT, usage и устойчивость к неизвестным SSE events.
- [ ] Docker-проверка не имеет сети и не может писать за пределы временного workspace.

### Фаза 3: воспроизводимость и Context Recovery

- [ ] Задача 8: Добавить append-only journal, run metadata, resume и агрегацию.
- [ ] Задача 9: Реализовать двухфазный Context Recovery с настоящим reset истории.
- [ ] Задача 10: Собрать CLI-команды `validate`, `run`, `report`, `serve`.

### Контрольная точка: агентный сценарий

- [ ] Resume не повторяет завершённые attempts.
- [ ] Context Recovery сохраняет phase-1 commit/notes, выполняет новый request и завершает hidden tests.
- [ ] Прерывание между фазами восстанавливается из журнала.

### Фаза 4: suite, dashboard и документация

- [ ] Задача 11: Добавить demo-задачи Debugging, Hallucination и Context Recovery.
- [ ] Задача 12: Создать полноэкранный React dashboard по принятому Image Gen концепту.
- [ ] Задача 13: Подключить report packaging, фильтры/сравнение и responsive states.
- [ ] Задача 14: Описать authoring, provider config, безопасность и методологию.

### Контрольная точка: готово

- [ ] `npm run bench:demo` создаёт run, journal и открываемый статический report без API-ключей.
- [ ] Полный набор тестов, lint, typecheck, build, npm audit и browser smoke чистые.
- [ ] Dashboard проверен на desktop/mobile, console не содержит ошибок, core filters работают.
- [ ] Реализация прошла финальный multi-axis code review; все критические/высокие замечания устранены.

## Риски и меры

| Риск | Влияние | Мера |
|---|---|---|
| Streaming events меняются | Высокое | Игнорировать неизвестные event types, валидировать только используемые поля, contract fixtures по официальным форматам |
| Модель не соблюдает envelope | Среднее | Явная ошибка `PATCH_REJECTED`, сохранение raw artifact, возможность повторного attempt без молчаливого исполнения текста |
| Docker отсутствует/daemon выключен | Высокое | Preflight до платных API-вызовов; fail-fast без небезопасного fallback |
| Hidden checks можно прочитать во время исполнения | Среднее | Это не раскрывает их модели до ответа; evaluator read-only, сеть отключена, результат ограничен. Для adversarial generated programs позже нужен отдельный grader process |
| Цена модели устарела | Среднее | Прайс хранится в versioned model config и journal, не в коде |
| UI browser image слишком тяжёлый | Среднее | Core harness поддерживает task-owned Docker image; browser suites помечаются extended и не входят в быстрый demo |
| Context Recovery в MVP не имеет полноценного tool loop | Среднее | Честно фиксировать двухвызовный patch protocol как v1; tool-driven inspect/edit/run/observe оставить расширением контракта |

## Что сознательно не входит в MVP

- Публичный hosted leaderboard, аккаунты, multi-tenant auth и удалённая БД.
- Автоматическое скачивание произвольных GitHub-репозиториев.
- Выполнение generated code прямо на host.
- LLM-as-a-judge как основной источник балла; MVP предпочитает детерминированные проверки.
- Универсальный agent tool loop для каждого провайдера и локальные GPU/energy метрики.
- Автоматическое обновление цен без versioned review.

## Проверенные первичные источники

- BridgeBench methodology/roadmap: https://www.bridgemind.ai/bridgebench
- OpenAI Responses streaming events: https://platform.openai.com/docs/api-reference/responses-streaming
- Anthropic Messages streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- Gemini streamed content generation: https://ai.google.dev/api/generate-content

## Открытые вопросы после MVP

- Нужен ли hosted coordinator для общедоступных воспроизводимых прогонов.
- Следует ли стандартизировать OCI image digest и hardware fingerprint как обязательные поля schema v2.
- Какой browser evaluator принять базовым для UI suite: Playwright image, CDP service или отдельный trusted grader.
- Нужна ли поддержка tool-use trace для полноценного `inspect → edit → run → observe` вместо patch protocol.

---

# План повышения точности RedactBench v0.2

## Цель

Уменьшить систематическое смещение результатов, показывать статистическую неопределённость и расширить demo с 3 до всех 8 заявленных категорий. Улучшение должно менять доказательность результатов, а не только presentation.

## Найденные источники неточности

1. Все hidden checks одного attempt используют один writable workspace; ранний check способен изменить состояние позднего.
2. Dashboard пересчитывает filtered score простым средним и теряет suite task weights.
3. Один point estimate не показывает вариативность повторов и может создавать ложную точность ranking.
4. Journal знает `seed/concurrency`, но report/dashboard их не показывают рядом с performance metrics.
5. Demo-suite покрывает только Debugging, Hallucination и Context Recovery, поэтому общий score не представляет весь заявленный category surface.

## Архитектурные решения

- Каждый hidden check получает fresh clone одинакового post-model workspace; mutations check-а удаляются после его завершения.
- `taskWeight` становится явной частью report attempt, чтобы UI и downstream consumers воспроизводили scorer без догадок.
- Неопределённость считается по полным repeat-level suite scores, а не по смеси задач разной сложности.
- Для `n >= 2` используется двухсторонний 95% Student-t interval `mean ± t × s/√n`, ограниченный диапазоном `[0, 1]`; при одном repeat interval равен `null`, а UI не изображает точность.
- t critical values берутся из NIST table; между опубликованными степенями свободы выбирается ближайшее меньшее значение, что даёт консервативно более широкий interval.
- Demo расширяется одной детерминированной smoke-задачей на каждую отсутствующую категорию; это проверяет harness breadth, но не объявляется production leaderboard suite.

Источник статистической формулы и critical values:

- https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm
- https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm

## Dependency graph

```text
check-level workspace isolation
          │
          v
weighted report attempts ─→ repeat statistics ─→ dashboard reliability UI
          │                         │
          └──────────────┬──────────┘
                         v
               expanded 8-category suite
                         │
                         v
              scorer/docs/fresh verification
```

## Инкременты

### Задача 15: Изолировать каждый hidden check

- Fresh clone создаётся до sandbox call и удаляется в `finally`.
- Check mutation не видна следующему check и исходному evaluated workspace.
- Clone/setup failure становится check `error`, а не падением всего run.

Проверка: evaluator unit regression + Docker integration + полный test suite.

### Задача 16: Добавить weighted repeat statistics

- Report attempt содержит authoritative `taskWeight`.
- Общий и filtered score используют одинаковую weighted formula.
- Model/category statistics содержат complete repeat count, sample SD, SE и 95% CI; `n=1` не имеет CI.

Проверка: exact aggregation fixtures для unequal weights, incomplete repeats, n=1/n=3 и CI bounds.

### Задача 17: Показать условия и неопределённость в dashboard

- Report включает repeat/concurrency/seed.
- Leaderboard и selected model показывают CI только при достаточном числе repeats.
- При `repeat=1` UI рекомендует `--repeat 3+`, не рисует `±0`.

Проверка: component tests + 1536/1440/390 browser smoke без overflow/errors.

### Задачи 18–22: Расширить demo до 8 категорий

- 18 Algorithms: edge cases, ties и input immutability.
- 19 Refactoring: behavior preservation плюс проверяемое удаление shared mutable state.
- 20 Security: path traversal/absolute/NUL defense с valid-path regression.
- 21 UI: semantic controls, state change и keyboard-safe markup/script behavior.
- 22 Reasoning: cross-file root cause, evidence и actionable fix без model judge.

Каждая задача получает сильный, частичный и слабый fixture response и минимум три независимых checks.

### Задача 23: Переверсионировать scorer и провести final audit

- Demo scorer становится `1.1.0`, package — `0.2.0`.
- README/methodology/security/task-authoring/changelog отражают новые guarantees и ограничения.
- Fresh demo даёт 24 attempts, все checks независимы, journal verified.
- Clean install, unit/integration, lint, typecheck, build, audit и browser smoke проходят.

## Риски

| Риск | Влияние | Мера |
|---|---|---|
| Copy-per-check замедлит большие repos | Среднее | Явно измерить demo; correctness default важнее throughput, оптимизацию оставить profile-driven |
| t interval неверно интерпретируют как гарантию | Высокое | Называть repeat-level descriptive CI и документировать independence/normality assumptions |
| Неполный run исказит interval | Высокое | В statistics включать только repeats с полным expected task set |
| Новые smoke tasks создадут ложное ощущение широкого leaderboard | Среднее | Маркировать suite как deterministic demo/harness regression, не как representative production corpus |
| UI category task трудно оценить без браузера | Среднее | Проверять semantic/interactive contract детерминированно; визуальное качество оставить отдельному browser-image suite |

## Definition of Done v0.2

- [x] Check order не влияет на workspace state и score.
- [x] JSON report достаточно для точного повторения weighted filtering и интерпретации run conditions.
- [x] CI появляется только при двух или более полных repeats.
- [x] Demo содержит все 8 categories и различает strong/partial/weak fixtures.
- [x] Документация не выдаёт smoke coverage или t interval за более сильное доказательство.
- [ ] Все проверки чистые, worktree содержит только атомарные commits.

## Фактический результат v0.2

- Package `0.2.0`, schema `1`, demo scorer `1.1.0`.
- Fresh run: 24 attempts, 96 independent Docker checks, 8 categories, journal verified, 0 attempt errors.
- Fixture scores: Strong 100.0%, Fast 59.1%, Cautious 32.4%.
- При стандартном repeat=1 report хранит `sampleCount: 1` и `confidence95: null`; это ожидаемое честное состояние, а не отсутствие данных из-за ошибки.

---

# План Docker-first benchmark surface v0.3

## Цель

Подготовить честную поверхность будущего сравнительного прогона для одиннадцати заданных provider+model+harness entrants. До фактического запуска UI показывает roster и readiness, но не выдумывает score. Любой agent attempt выполняется только в отдельном Docker container; host CLI разрешён для auth/preflight, но не как benchmark execution fallback.

## Зафиксированная матрица

1. GPT-5.6 Sol Max — OpenAI / Codex
2. GPT-5.6 Terra Max — OpenAI / Codex
3. GPT-5.6 Luna Max — OpenAI / Codex
4. GPT-5.5 xHigh — OpenAI / Codex
5. Grok 4.5 High — xAI / Grok Build
6. Grok Build — xAI / Grok Build
7. Cursor Composer 2.5 — Cursor / Cursor Agent
8. Gemini 3.5 Flash High — Google / AGY
9. Gemini 3.1 Pro High — Google / AGY
10. GLM 5.2 Max — Z.AI / OpenCode
11. Hy3 High — OpenRouter / OpenCode (последнее указание заменяет первоначальный Claude Code harness)

## Архитектурные решения

- Entrant identity — это provider route + model profile + harness; одинаковая модель в другом harness или через другого router была бы отдельной строкой.
- Roster и runtime binding разделены: roster можно отрисовать до появления container image, но runnable preflight требует pinned/локально собранный image и command contract.
- Harness container получает writable copy workspace, provider network и только allowlisted credential references. Hidden evaluator туда не монтируется.
- Grader остаётся вторым контуром: `network none`, fresh workspace clone на check, evaluator read-only.
- Один container соответствует `entrant × task × repeat`. Context Recovery запускает phase 1 и phase 2 в разных containers.
- API keys никогда не хранятся в YAML/report/journal/image/command line. Поддерживаются только env names или узкие read-only auth mounts.
- До завершения attempt score равен отсутствующему значению (`Not run`), а не нулю.

## Dependency graph

```text
typed field roster
        │
        ├──→ static entrant surface (no fake scores)
        │
        └──→ Docker harness runtime contract
                       │
                       ├──→ credential/image preflight
                       └──→ per-harness adapters
                                      │
                                      v
                              paid benchmark runs
```

## Инкременты

### Задача 24: Версионированный roster contract

- Добавить strict schema для field, entrant и harness identity.
- Зафиксировать ровно 11 entrants в source-controlled manifest без credentials.
- Проверять порядок, unique IDs и отсутствие неизвестных harness variants.

### Задача 25: Docker execution contract

- Описать container image, argv template, limits, network policy и credential references отдельно от entrant.
- Runner/preflight отклоняет отсутствие Docker binding и никогда не исполняет harness на host.
- Harness container не получает evaluator directory или полный host environment.

### Задача 26: Entrant surface

- Добавить dashboard-раздел с 11 entrants, provider/harness badges, profile и состоянием `Not run`/readiness.
- Не смешивать fixture demo leaderboard с целевой матрицей.
- Проверить keyboard, 390/768/1440 layouts и отсутствие fake metrics.

### Задача 27: Readiness и безопасные credentials

- Проверять только наличие нужного env/profile/image без печати значения или содержимого auth-файла.
- Для Codex, Grok, Cursor и AGY использовать отдельные read-only auth mounts; для GLM/OpenRouter — env allowlist.
- Секрет, попавший в чат, должен быть перевыпущен до платного запуска.

### Задача 28: Harness adapters и первый dry-run

- Реализовывать adapters по одному: Codex → Grok → Cursor → AGY → OpenCode.
- Каждый adapter проходит бесплатный/local dry-run container contract до model calls.
- Платный run начинается только после явного preflight budget и подтверждённых model IDs.

### Задача 29: Единая команда `redactbench start`

- Один entrypoint выполняет preflight, запускает или возобновляет run, упаковывает dashboard report и печатает итоговую таблицу.
- Defaults указывают на target field/runtime manifest и benchmark suite; flags позволяют переопределить run ID, repeats, concurrency, seed и output root.
- `--dry-run` выполняет полный безопасный preflight и показывает план без запуска harness containers и без model/API calls.
- Ошибка любого preflight происходит до первого model request; успешный run оставляет journal, JSON report и статический dashboard в одном run directory.

### Задача 30: Наблюдаемый долгий run

- Run engine публикует typed progress events при готовности очереди, после durable `attempt.completed` и после полного завершения.
- Первый event показывает `completed/total` и отличает новый run от resume; завершённые attempts повторно не исполняются и не репортятся как новые.
- CLI печатает только model/task labels, status и score; prompt, response, provider errors и credentials в progress output не попадают.
- `--dry-run` остаётся без attempt-progress и без model/API calls.

### Следующие инкременты после задачи 30

- Задача 31: автоматически предлагать/возобновлять последний незавершённый target run без смешивания конфигураций.
- Задача 32: добавить generation budget envelope; egress readiness оставить отдельным security slice, потому что bridge network не является allowlist.

### Задача 32: Generation budget envelope

- План отдельно считает attempts и верхнюю границу вызовов `adapter.generate`; Context Recovery считается как две generations.
- Normal run fail-closed до Docker/credentials/provider activity, если план превышает `--max-generations`.
- Default cap `100` пропускает базовый план `99`, но repeat `2+` требует явного повышения лимита.
- Dry-run не падает, а показывает `READY/BLOCKED`, чтобы лимит можно было подобрать без model/API calls.
- Envelope не называется dollar/token budget: agent CLI может выполнять несколько внутренних model turns внутри одной generation.

## Definition of Done поверхности

- [x] Manifest содержит ровно 11 согласованных entrants и не содержит secrets.
- [x] UI показывает roster/readiness без score до запуска.
- [x] Любая executable binding имеет `execution: docker`; host fallback отсутствует.
- [x] Hidden evaluator недоступен harness container.
- [x] Contract/component/security tests, typecheck, lint, build и browser smoke чистые.
- [x] `redactbench start --dry-run` доказывает готовность orchestration без model/API calls.
- [x] Долгий `redactbench start` показывает durable progress и корректный resume count.
- [x] Default generation envelope пропускает базовый план и блокирует неявное увеличение matrix до preflight.

---

# План повышения измерительной точности v0.4

## Цель

Не позволять сбоям провайдера или benchmark-инфраструктуры выглядеть как слабость модели и уменьшить временной drift между моделями в долгом прогоне.

## Dependency graph

```text
attempt error taxonomy
        ↓
run validity summary → public rank gate → methodology
        ↓
balanced block scheduler → deterministic order tests
```

## Задача 33: Отделить валидность прогона от качества модели

**Критерии приёмки:**

- Report детерминированно считает provider, infrastructure и model-output failures.
- Наличие provider/infrastructure failure делает run непригодным для финального публичного ranking, не скрывая сохранённый task score.
- Public leaderboard показывает invalid-run state и не присваивает Rank.

**Проверка:** aggregate contract tests, component test, browser smoke, methodology consistency.

## Задача 34: Сбалансировать порядок попыток

**Критерии приёмки:**

- Scheduler строит блоки `task × repeat` и детерминированно меняет порядок моделей внутри блоков.
- Одинаковый seed воспроизводит порядок; разные seeds меняют его.
- До начала следующего блока каждая модель получает ровно одну попытку текущей задачи и repeat.

**Проверка:** exact scheduling unit tests и run-resume regression.

## Риски

| Риск | Влияние | Мера |
|---|---|---|
| Ошибка модели ошибочно считается infrastructure failure | Высокое | Классифицировать по стабильному error code, а не по тексту сообщения |
| Invalid run теряет диагностические данные | Высокое | Сохранять attempts и scores; блокировать только утверждение final rank |
| Block scheduling увеличивает correlation | Среднее | Перемешивать blocks и вращать model order детерминированно по seed |

---

# План независимого Magnum release-suite

## Цель

Создать отдельный от demo релизный корпус. Каждая задача владеет собственными `workspace`, `evaluator`, fixtures и hidden checks. Публичный suite допускается к запуску только при достаточном количестве независимых задач в каждой категории.

## Архитектурные решения

- `demo` остаётся быстрым regression smoke и никогда не становится публичным корпусом.
- `release` является отдельным suite purpose с минимум тремя задачами на каждую из восьми категорий.
- Два task manifest не могут находиться в одном task directory или ссылаться на общий workspace/evaluator через symlink.
- Checks одной задачи не используются другой задачей; общими могут быть только pinned runtime images.
- Release suite запускается с `repeat >= 3`; меньший repeat разрешён только для authoring/validation, но не для финальной публикации.

## Dependency graph

```text
suite purpose contract
        ↓
independence + category coverage validation
        ↓
benchmarks/silver task corpus
        ↓
fixture calibration → paid release run
```

## Задача 35: Контракт release-suite

- Добавить `purpose: smoke | release`.
- Для release требовать минимум три task на каждую категорию.
- Отклонять shared task directories и symlink aliases.

## Задача 36: Независимый Silver corpus

- Создать `benchmarks/silver` отдельно от `benchmarks/demo`.
- Добавить по три независимых task на восемь категорий.
- Для каждой task иметь strong/partial/adversarial calibration cases.

Задача 36 выполняется восемью независимыми срезами:

1. 36A Algorithms: interval merge, dependency ordering, bounded allocation.
2. 36B Debugging: stale memoization, sparse pagination, async cleanup.
3. 36C Refactoring: state ownership, dependency boundary, error normalization.
4. 36D Security: archive containment, tenant authorization, webhook verification.
5. 36E UI: modal focus, sortable table semantics, async form state.
6. 36F Reasoning: retry amplification, transaction boundary, configuration precedence.
7. 36G Pushback: false runtime guarantee, impossible complexity claim, invalid cryptographic premise.
8. 36H Context Recovery: parser migration, cache split, request-policy extraction.

Каждый срез сначала подключается к отдельному `authoring-suite.yaml` с `purpose: smoke`. Финальный `suite.yaml` с `purpose: release` создаётся только после готовности всех 24 tasks, поэтому неполный corpus нельзя случайно опубликовать.

## Задача 37: Publication gate

- Финальный public Rank требует release purpose, repeat `3+`, valid run и полный category coverage.
- Smoke/filtered runs остаются видимыми, но маркируются non-publishable.
- CLI и dashboard объясняют конкретную причину блокировки.

## Контрольные точки

- После задачи 35: contract/definition tests, demo обратно совместим.
- После каждых двух категорий задачи 36: targeted fixture validation и независимый filesystem audit.
- После задачи 37: fresh full fixture run, 3 repeats, browser и methodology audit.

---

# План нового Magnum Gold benchmark

## Цель

Создать `benchmarks/gold` как новый release-корпус, который не наследует задания, prompts, workspace, evaluator code или calibration fixtures Silver. Gold проверяет работу с небольшими реалистичными репозиториями и неоднозначными failure modes, а не повторяет набор изолированных функций Silver под другими именами.

## Зафиксированные границы

- Silver остаётся без изменений и не является шаблоном для копирования Gold-задач.
- Gold получает собственные task IDs, директории, исходные дефекты, hidden checks и calibration solutions; symlink, import или filesystem dependency на `benchmarks/silver` запрещены.
- После появления первой задачи используется только `benchmarks/gold/authoring-suite.yaml` с `purpose: smoke`; `suite.yaml` с `purpose: release` появляется последним. Пустой manifest не создаётся, потому что текущий suite contract требует минимум одну задачу.
- Первая реализация охватывает Gold contract и один полный category slice. Остальные категории добавляются только после проверки, что первый slice действительно различает strong, partial и unsafe решения.
- Незакоммиченные изменения Silver считаются пользовательской работой и не изменяются в рамках Gold.

## Архитектурные решения

- **Corpus identity.** Gold использует отдельный suite ID и `scorerVersion: 3.0.0-dev`, чтобы результаты нельзя было смешать с Silver даже при одинаковой модели и конфигурации запуска.
- **Реалистичные вертикальные задачи.** Каждая задача содержит 2–4 связанных source/config/test artifacts и требует понять существующее поведение; задача не сводится к реализации одной функции по исчерпывающему prompt.
- **Атомарное оценивание.** Минимум четыре hidden checks разделяют основное поведение, edge cases, сохранение совместимости и нежелательные побочные изменения, поэтому partial solution получает объяснимый промежуточный score.
- **Независимая калибровка.** Для каждой задачи есть `strong`, `partial` и `adversarial` fixture; evaluator принимает fixture path только в authoring tests, а production path по-прежнему проверяет workspace модели.
- **Запрет содержательного клонирования.** Gold audit проверяет реальные пути, отсутствие ссылок на Silver, уникальность task IDs и нормализованные prompt/workspace fingerprints. Совпадение инфраструктурного boilerplate evaluator допустимо только там, где оно неизбежно для запуска проверки.

## Dependency graph

```text
Gold identity + independence audit
                ↓
first category task 1 → calibration
                ↓
first category task 2 → calibration
                ↓
first category task 3 → calibration
                ↓
category checkpoint and difficulty review
                ↓
remaining seven category slices
                ↓
Gold release suite → publication gate → docs
```

## Задача 38: Зафиксировать Gold identity и anti-reuse gate

**Описание:** Добавить переиспользуемый audit и тестовые filesystem fixtures, которые доказывают физическую и содержательную независимость будущего Gold-корпуса. Реальный authoring manifest добавляется вместе с первой задачей, чтобы каждый инкремент оставался валидным.

**Критерии приёмки:**

- Audit отклоняет symlink, realpath за пределами Gold, импорт/ссылку на `benchmarks/silver`, повтор task ID и точное совпадение нормализованного prompt или workspace file.
- Audit принимает независимые temporary Gold fixtures и может применяться к реальному корпусу после появления первой задачи.
- Проверка не требует изменения общего suite schema и не ломает существующие demo/Silver manifests.

**Проверка:** targeted Gold audit tests, затем `npm run typecheck` и существующие definition contract tests.

**Зависимости:** задача 35.

**Вероятно затронутые файлы:** `src/corpus-independence.ts`, `tests/gold-independence.test.ts`.

**Оценка размера:** Small — 2 файла.

## Задачи 39A–39C: Первый Gold slice — Debugging

Первой категорией будет debugging, потому что она быстрее выявит, способен ли новый формат оценивать диагностику по связанному репозиторию, а не угадывание алгоритма по полному контракту.

### Задача 39A: Восстановление checkpoint после оборванной записи

Модель получает небольшой importer, где crash между записью data и checkpoint вызывает пропуск строк после resume. Решение должно восстановить порядок durable write, сохранить идемпотентность и не перечитывать уже подтверждённые записи.

**Критерии приёмки:** задача создаёт первый smoke-only authoring manifest с отдельными suite ID и `scorerVersion: 3.0.0-dev`; happy-path resume, injected crash, повторный resume и backward-compatible checkpoint parsing оцениваются отдельными checks; strong/partial/adversarial fixtures дают разные профили.

**Проверка:** evaluator modes, manifest load и calibration matrix test.

**Зависимости:** задача 38.

**Оценка размера:** Medium — одна независимая task directory и один targeted test update.

### Задача 39B: Устранение гонки refresh в expiring cache

Модель получает cache с параллельным refresh, где истёкшее значение создаёт несколько loader calls и поздний reject удаляет более новое значение. Решение должно дедуплицировать in-flight work без изменения public API.

**Критерии приёмки:** concurrent miss, stale rejection, TTL boundary и error retry проверяются независимо; evaluator подтверждает отсутствие глобальной сериализации разных keys.

**Проверка:** deterministic fake-clock evaluator и calibration matrix test.

**Зависимости:** задача 38 и checkpoint после 39A.

**Оценка размера:** Medium — одна независимая task directory и один targeted test update.

### Задача 39C: Исправление DST-сдвига recurring scheduler

Модель получает scheduler, который вычисляет следующий локальный запуск прибавлением 24 часов и ошибается на переходах DST. Решение должно сохранить wall-clock intent, корректно обработать skipped/duplicated local time и не менять UTC-only schedules.

**Критерии приёмки:** spring-forward, fall-back, обычная дата и UTC regression оцениваются отдельно; invalid timezone остаётся явной ошибкой.

**Проверка:** pinned timezone data, table-driven evaluator и calibration matrix test.

**Зависимости:** задача 38 и checkpoint после 39B.

**Оценка размера:** Medium — одна независимая task directory и один targeted test update.

## Контрольная точка после задач 38–39C

- Authoring suite загружает ровно три новые debugging-задачи и остаётся `purpose: smoke`.
- Все strong fixtures получают 100%, а partial/adversarial fixtures расходятся хотя бы по двум атомарным checks в каждой задаче.
- Gold independence audit не находит ссылок, task IDs, prompts или workspace contents из Silver.
- Targeted tests, полный unit suite, lint, typecheck и build проходят до расширения корпуса.
- Результаты калибровки просматриваются человеком; слишком простая или хрупкая задача переписывается до следующей категории.

## Задача 40: Добавить остальные семь категорий

Каждая категория реализуется отдельным срезом из трёх новых задач с тем же calibration gate. Конкретные сценарии фиксируются перед началом среза, чтобы не создавать 21 задание по предположениям до проверки первого формата.

- Algorithms: stateful/streaming constraints вместо задач Silver на сортировку и greedy selection.
- Refactoring: изменение module boundaries с сохранением observable behavior.
- Security: confused-deputy, canonicalization и replay scenarios, не повторяющие repository injection Silver.
- UI: accessibility и asynchronous interaction в небольших React workspaces.
- Reasoning: diagnosis artifacts с проверяемым patch outcome, а не эссе с ключевыми словами.
- Hallucination: работа с локальной API/documentation evidence и корректный pushback на ложные предпосылки.
- Context Recovery: multi-file продолжение после reset с измеримым сохранением уже выполненной работы.

**Критерии приёмки:** 24 независимые Gold tasks, по три на каждую schema category; у каждой есть объяснимая calibration matrix и собственные artifacts.

**Проверка:** checkpoint после каждой категории, полный independence audit после каждых двух категорий.

**Зависимости:** контрольная точка 38–39C.

**Оценка размера:** XL-программа, обязательное разбиение на 21 task-sized increments перед реализацией.

## Задача 41: Собрать Gold release-suite и publication path

**Описание:** Создать release manifest только после прохождения всех corpus gates, подключить Gold identity к publication decision и описать воспроизводимый запуск без переименования Silver results.

**Критерии приёмки:** Gold release содержит 24 задачи и проходит category/independence validation; publishable run требует `repeat >= 3`, полный валидный run и scorer `3.x`; UI и CLI явно показывают Gold как отдельный benchmark.

**Проверка:** fixture release run, aggregation/publication tests, browser smoke и methodology audit.

**Зависимости:** задачи 37 и 40.

**Оценка размера:** Medium — manifest, typed publication metadata, tests и docs отдельными инкрементами.

## Риски и меры

| Риск | Влияние | Мера |
|---|---|---|
| Gold становится переименованным Silver | Высокое | Anti-reuse audit плюс ручная проверка сценария до реализации каждой категории |
| Hidden checks проверяют конкретную реализацию | Высокое | Проверять observable behavior и держать минимум две независимо написанные strong fixtures на сложных задачах |
| Calibration fixtures раскрывают hidden cases модели | Среднее | Fixtures остаются в evaluator и никогда не входят в prompt/workspace snapshot |
| Три debugging-задачи требуют слишком много harness changes | Среднее | Первый slice использует текущий patch protocol и pinned runtime; расширение contracts выносится в отдельную будущую задачу |
| Новый корпус смешивается с незавершённым Silver | Высокое | Отдельные directory, corpus/scorer identity и отсутствие release manifest до полного Gold gate |

## Открытый вопрос для контрольной точки

- После первого debugging slice решить по фактической calibration matrix, сохранять ли размер Gold на уровне 24 задач или увеличить число реплик только в категориях с высокой дисперсией.

## Фактический результат первого Gold slice

- Реализован independence audit и три независимые debugging-задачи: durable checkpoint, expiring cache refresh race и local-time scheduler.
- Strong fixtures проходят 4/4 checks во всех задачах; partial/adversarial профили соответственно разделяются как `3/4 vs 3/4` по разным checks, `2/4 vs 2/4` и `2/4 vs 1/4`.
- Полный unit suite: 169 tests passed; typecheck и production build прошли.
- Targeted Gold lint чистый. Общий lint останавливается на ранее существовавшем `structuredClone` в незакоммиченном Silver evaluator; этот файл не изменялся в Gold-инкрементах.

## Фактический результат Gold Algorithms slice

- Добавлены три новые stateful/streaming задачи: chunk-safe JSONL decoder, watermarked event-time buffer и persistent deficit scheduler.
- Calibration profiles: JSONL `4/4, 3/4, 1/4`; event buffer `4/4, 2/4, 0/4`; deficit scheduler `4/4, 1/4, 1/4` с разными failed checks.
- Gold authoring suite теперь содержит шесть независимых задач в двух полных категориях и остаётся `purpose: smoke`.
- Checkpoint: 184 tests passed, typecheck, targeted Gold lint и production build прошли; independence audit не нашёл reuse Silver.
