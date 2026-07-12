# RedactBench

RedactBench — локальный воспроизводимый полигон для сравнения coding-моделей. Он отправляет одинаковые задачи напрямую в OpenAI, Anthropic или Google, принимает текст либо unified diff, запускает скрытые проверки в изолированных Docker-контейнерах, измеряет latency/usage/cost и собирает статический интерактивный отчёт.

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

## Быстрый запуск

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
└── run.json        # текущая агрегированная проекция

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
- [Визуальная спецификация](design/DESIGN.md)

## Честные ограничения v0.2

- Обычный coding-attempt — один запрос с полным patch, а не интерактивный tool loop `inspect → edit → run → observe`.
- Context Recovery — два stateless patch-запроса. Вторая фаза получает post-phase-1 snapshot, Git summary и заметки, но не conversation history.
- Demo содержит по одной deterministic smoke-задаче на каждую из восьми категорий. Это проверка ширины harness, а не репрезентативный production corpus.
- 95% interval описывает разброс полных repeat-level suite scores. Он отсутствует при `n < 2`, не является тестом статистической значимости и не компенсирует drift provider, сети или hardware.
- Стоимость корректна только при наличии provider usage и вручную зафиксированного pricing.
- Journal сохраняет config/prompt/response hashes и Docker image IDs, но ещё не фиксирует полный hardware fingerprint.
- Docker boundary рассчитана на локальный benchmark, а не на hostile multi-tenant execution service.
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
