# RedactBench

RedactBench — локальный воспроизводимый полигон для сравнения coding-моделей. Он запускает одинаковые задачи через Codex, Grok Build, Cursor Agent, AGY или OpenCode, выполняет каждый agent attempt в отдельном Docker-контейнере, запускает скрытые проверки в независимых grader-контейнерах, измеряет latency/usage/cost и собирает статический интерактивный отчёт. Прямые API adapters OpenAI, Anthropic и Google сохранены для custom runs.

Отдельная категория **Context Recovery** проверяет продолжение работы после принудительного сброса истории: первая фаза оставляет изменённый репозиторий, Git-коммит и заметки, а вторая получает новый stateless-запрос и должна сохранить сделанное и завершить задачу.

Проект вдохновлён [BridgeBench](https://www.bridgemind.ai/bridgebench), но не связан с BridgeMind и не пытается воспроизвести их закрытый набор задач или scorer.

## Что уже работает

- восемь категорий: `algorithms`, `debugging`, `refactoring`, `security`, `ui`, `reasoning`, `hallucination`, `context-recovery`;
- прямые streaming adapters для OpenAI Responses, Anthropic Messages и Gemini GenerateContent;
- детерминированный fixture-provider для бесплатных end-to-end прогонов;
- weighted hidden checks в Docker без сети/capabilities; каждый check получает собственную копию итогового workspace;
- строгий patch/text protocol, временный workspace и защита от path/symlink escape;
- hash-chained JSONL journal, resume и восстановление между фазами Context Recovery;
- TTFT, output tokens/s, стоимость и cost per correct при наличии usage/pricing;
- repeat-level SD/SE/95% Student-t interval по полным повторам и явные `repeat/concurrency/seed`;
- React-dashboard с weighted-фильтрами, reliability, деталями checks, импортом и экспортом отчёта;
- deterministic smoke-suite по всем восьми категориям.
- целевое поле из 11 model/harness связок и команда `redactbench start`, которая делает preflight, build/prepare, run/resume, report packaging и terminal summary.

## Целевой benchmark одной командой

Нужны Node.js 22+, Git, работающий Docker daemon и уже установленные host CLI: Codex `0.144.1`, Grok `0.2.93`, Cursor Agent `2026.07.09-a3815c0`, AGY `1.1.1`, OpenCode `1.17.13`. Host CLI используются только как источник зафиксированных binaries и локального auth state; каждый model attempt всё равно выполняется в новом контейнере.

```bash
npm ci
npm run build
npm link
redactbench start --dry-run
```

`--dry-run` валидирует target field, 8 задач, 11 bindings, Docker daemon, host CLIs, образы, сети и только наличие credentials. Он не запускает harness containers и не делает model/API requests. В готовом окружении итог должен показывать `Credentials 6/6`, `Images 5/5`, `Networks 6/6`.

OAuth-профили по умолчанию берутся из минимальных allowlisted файлов:

| Harness | Источник |
|---|---|
| Codex | `~/.codex/auth.json` |
| Grok Build | `~/.grok/auth.json` |
| Cursor Agent | `~/.config/cursor/auth.json` |
| AGY | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

Для GLM 5.2 Max и Hy3 High нужны два отдельных файла, содержащих только соответствующий перевыпущенный ключ:

```bash
install -d -m 700 ~/.config/redactbench/secrets
$EDITOR ~/.config/redactbench/secrets/zai-api-key
$EDITOR ~/.config/redactbench/secrets/openrouter-api-key
chmod 600 ~/.config/redactbench/secrets/*
```

Ключи, когда-либо отправленные в чат или лог, считаются раскрытыми: перед benchmark их нужно отозвать и создать заново. RedactBench не принимает значения ключей в YAML, argv или Docker environment; `start` копирует secret-файлы во временное owner-only хранилище и монтирует их read-only только в соответствующий OpenCode container.

После зелёного dry-run целевой прогон запускается буквально так:

```bash
redactbench start
```

По умолчанию это `11 × 8 × repeat 1 = 88` attempts с concurrency `1` и seed `20260712`. Отсутствующие images и provider bridge networks создаются автоматически. Команда сначала печатает `completed/total`, затем одну sanitized progress-строку после каждой durable записи attempt в journal. Resume сразу показывает уже завершённое число и не выдаёт старые attempts за новые. По завершении печатаются leaderboard, run ID и путь к `runs/<run-id>/report/index.html`. Для надёжного resume используйте один и тот же ID:

```bash
redactbench start --run-id target-2026-07-13
```

`--repeat 3` полезнее статистически, но примерно утраивает число модельных попыток и расход. Перед платным прогоном отдельно подтвердите бюджет. User-defined bridge networks изолируют containers друг от друга, но не являются destination allowlist; для adversarial repositories нужен provider-filtered egress proxy/firewall, описанный в threat model.

## Быстрый fixture demo

Нужны Node.js 22+, Git и работающий Docker daemon. При первом прогоне Docker может скачать `node:22-alpine`; сами hidden checks запускаются с `--network none`.

```bash
npm ci
npm run bench:demo
npm run bench:report
npm run redactbench -- serve --report reports/demo --port 4173
```

Откройте `http://127.0.0.1:4173`. Demo делает 24 attempts и 96 проверок без API-ключей и обращений к модельным провайдерам. Повторный `npm run bench:demo` возобновляет run `demo` и не повторяет уже завершённые attempts.

Фактический эталонный demo-run:

| Fixture model | Score |
|---|---:|
| Fixture Strong | 100.0% |
| Fixture Fast | 59.1% |
| Fixture Cautious | 32.4% |

Это regression fixtures самого harness, а не оценка реальных моделей. При стандартном `--repeat 1` dashboard показывает `n=1` без выдуманного доверительного интервала; для оценки вариативности используйте как минимум `--repeat 3`.

## Запуск реальных моделей

Скопируйте [models.example.yaml](models.example.yaml), удалите неиспользуемых providers, замените placeholder model IDs на зафиксированные версии моделей и при необходимости добавьте проверенный pricing. Цена не загружается автоматически: это намеренно versioned input конкретного прогона.

Ключи читаются только из окружения:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
```

Можно использовать только ключи тех providers, которые присутствуют в `models.yaml`.

```bash
npm run build
npm run redactbench -- validate \
  --suite benchmarks/demo/suite.yaml \
  --models models.yaml

npm run redactbench -- run \
  --suite benchmarks/demo/suite.yaml \
  --models models.yaml \
  --run-id comparison-001 \
  --repeat 3 \
  --concurrency 1 \
  --seed 42

npm run redactbench -- report \
  --journal runs/comparison-001/journal.jsonl \
  --out reports/comparison-001

npm run redactbench -- serve \
  --report reports/comparison-001 \
  --port 4173
```

`run` проверяет конфигурацию, credentials и Docker до первого модельного запроса. `--task` и `--model` можно передавать несколько раз для ограниченного прогона. Concurrency ограничен диапазоном 1–8, repeat — 1–100.

## Команды

| Команда | Назначение |
|---|---|
| `redactbench start [--dry-run]` | Подготовить и запустить всё целевое поле, затем собрать и вывести результат |
| `npm run redactbench -- validate …` | Проверить suite, tasks, models и fixtures без запуска Docker/API |
| `npm run redactbench -- run …` | Запустить или продолжить benchmark run |
| `npm run redactbench -- report …` | Собрать self-contained static report из journal |
| `npm run redactbench -- serve …` | Отдать report с CSP на локальном `127.0.0.1` |
| `npm run bench:demo` | Собрать проект и запустить deterministic fixture demo |
| `npm run bench:report` | Собрать dashboard для demo journal |
| `npm test` | Unit, contract и integration tests |
| `npm run test:browser` | Production build + desktop/mobile Playwright smoke |
| `npm run lint` | ESLint без warnings |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | CLI и static dashboard production build |

CLI возвращает стабильные exit codes: config `2`, provider `3`, sandbox/timeout `4`, patch `5`, journal `6`, attempt `7`.

## Выходные данные

```text
runs/<run-id>/
├── journal.jsonl   # append-only source of truth с hash chain
├── run.json        # текущая агрегированная проекция
├── start.json      # target field, image IDs и network readiness
└── report/
    ├── index.html  # self-contained entrypoint результата
    ├── assets/
    └── report.json

reports/<run-id>/
├── index.html
├── assets/
└── report.json
```

`runs/`, `reports/`, `.redactbench/` и `tmp/` исключены из Git: там могут находиться ответы моделей и фрагменты исследуемого репозитория.

## Как устроен attempt

```text
suite + task + model config
        ↓
deterministic repository snapshot (evaluator исключён)
        ↓
direct streaming provider request
        ↓
strict text answer или validated unified diff
        ↓
fresh temporary post-response workspace
        ↓
fresh clone per hidden check → Docker → weighted score
        ↓
fsync hash-chained journal → report/dashboard
```

Категория определяет срез leaderboard, а конкретный способ оценки задаёт автор task через детерминированные checks. RedactBench v1 не использует встроенный LLM-as-a-judge и не притворяется, что один универсальный grader одинаково оценивает алгоритмы, безопасность и UI.

## Документация

- [Методология и формулы](docs/methodology.md)
- [Создание suite и tasks](docs/task-authoring.md)
- [Threat model и hardening](docs/security.md)
- [ADR-001: direct providers, deterministic checks, journal](docs/decisions/001-direct-providers-and-journal.md)
- [ADR-002: Context Recovery v1](docs/decisions/002-context-recovery-v1.md)
- [ADR-003: независимые checks и repeat uncertainty](docs/decisions/003-check-isolation-and-repeat-uncertainty.md)
- [ADR-004: Docker-only harness execution](docs/decisions/004-docker-harness-boundary.md)
- [ADR-005: one-command target orchestration](docs/decisions/005-one-command-target-orchestration.md)
- [Визуальная спецификация](design/DESIGN.md)

## Честные ограничения v0.3

- Обычный coding-attempt — один запрос с полным patch, а не интерактивный tool loop `inspect → edit → run → observe`.
- Context Recovery — два stateless patch-запроса. Вторая фаза получает post-phase-1 snapshot, Git summary и заметки, но не conversation history.
- Demo содержит по одной deterministic smoke-задаче на каждую из восьми категорий. Это проверка ширины harness, а не репрезентативный production corpus.
- 95% interval описывает разброс полных repeat-level suite scores. Он отсутствует при `n < 2`, не является тестом статистической значимости и не компенсирует drift provider, сети или hardware.
- Стоимость корректна только при наличии provider usage и вручную зафиксированного pricing.
- Journal сохраняет config/prompt/response hashes и Docker image IDs, но ещё не фиксирует полный hardware fingerprint.
- Docker boundary рассчитана на локальный benchmark, а не на hostile multi-tenant execution service.
- Provider bridge networks пока не фильтруют destination egress. Встроенные agent sandboxes ограничивают filesystem/tool access, но не заменяют host firewall или egress proxy для adversarial repositories.
- Hosted leaderboard, аккаунты, БД и автоматическое скачивание произвольных репозиториев не входят в MVP.

## Разработка

Работайте в feature-ветке, добавляйте тест до изменения поведения и не коммитьте generated runs, reports или credentials. Минимальная проверка перед PR:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```

Лицензия: MIT.
