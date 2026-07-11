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
