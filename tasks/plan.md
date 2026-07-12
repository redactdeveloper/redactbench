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

## Definition of Done поверхности

- [ ] Manifest содержит ровно 11 согласованных entrants и не содержит secrets.
- [ ] UI показывает roster/readiness без score до запуска.
- [ ] Любая executable binding имеет `execution: docker`; host fallback отсутствует.
- [ ] Hidden evaluator недоступен harness container.
- [ ] Contract/component/security tests, typecheck, lint, build и browser smoke чистые.
