# Security model

## Scope

RedactBench исполняет потенциально вредный код, созданный моделью. Его базовая гарантия: model output никогда не исполняется напрямую на host; hidden checks получают отдельную временную копию workspace в ограниченном Docker container.

Это hardening для локального исследовательского harness, не security boundary для публичного multi-tenant service. Пользователь, запускающий RedactBench, доверяет Docker daemon, выбранным images, task manifests, evaluator code, npm dependencies и локальному host.

## Trust boundaries

| Input/component | Trust | Почему |
|---|---|---|
| Suite/task/model YAML | Частично доверенный | Валидируется, но определяет images, prompts и checks |
| Workspace repository | Недоверенный | Может содержать prompt injection и вредный код |
| Model response | Недоверенный | Ограничивается размером и строгим response protocol |
| Evaluator scripts | Доверенный | Выполняются как grader и определяют correctness |
| Docker image | Доверенный supply-chain input | Содержит runtime checks; рекомендуется digest |
| Provider API | Внешняя система | Получает разрешённый prompt snapshot и возвращает untrusted stream |
| Journal/report | Чувствительные artifacts | Могут содержать model text, task titles и evidence output |

## Защита до provider request

- YAML ограничен 1 MiB и валидируется strict Zod schemas; неизвестные поля отклоняются.
- Paths должны быть normalized relative paths без `/`, backslash, NUL, пустых segments, `.` или `..`.
- Workspace snapshot игнорирует symlinks, `.git`, `.redactbench`, `node_modules`, `.env*`, common credential files и private-key extensions.
- На файл действует cap 128 KiB, на text snapshot — 1 MiB, на число файлов — 2000.
- Binary и oversized files не включаются содержимым, но получают hash/metadata.
- Evaluator directory никогда не сериализуется в model prompt.
- Repository content явно помечается как untrusted task data в system prompt.

Snapshot denylist снижает риск случайной утечки, но не заменяет secret scanning. Не помещайте credentials в benchmark workspace даже под нестандартными именами.

## Provider credentials и transport

Поддерживаются только фиксированные environment names:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
```

Ключи не входят в prompt, journal или report. Adapter endpoints фиксированы в коде, redirects запрещены, provider errors проходят credential-shaped redaction. Raw Authorization headers не логируются. `.env*`, `*.key` и `*.pem` исключены из Git.

RedactBench не загружает `.env` автоматически. Передавайте secrets через окружение процесса или отдельный secret manager. Не включайте shell tracing рядом с exports.

## Model response и patch

- Stream ограничен 4 MiB и 180s request timeout.
- Task задаёт меньший `maxBytes`; output без required envelope отклоняется.
- Text response сохраняется как data file, не выполняется.
- Unified diff запрещает absolute/parent paths, binary patches, symlinks, rename/copy и неполные headers.
- `git apply --check` выполняется до применения.
- Patch применяется только к fresh temporary copy; исходный task workspace не изменяется.
- Isolated workspace creation отклоняет symlinks и unsupported file types.
- Temporary directories удаляются в `finally` после attempt.

## Docker sandbox

Каждый check получает отдельный `docker run --rm`:

```text
--network none
--read-only
--cap-drop ALL
--security-opt no-new-privileges
--pids-limit 128
--memory 512m
--cpus 1
--user 65532:65532
--tmpfs /tmp:rw,noexec,nosuid,size=64m
```

Mounts:

- temporary workspace → `/workspace`, writable;
- evaluator → `/evaluator`, read-only.

В container попадают только `CI`, `HOME` и `REDACTBENCH_RESPONSE_FILE`. Provider keys и host environment не передаются. Check вызывается как argv без shell. Timeout инициирует `docker kill`; stdout/stderr ограничены task cap.

Если Docker недоступен, run завершается до provider calls. Небезопасного host fallback нет.

### Что Docker boundary не решает

- Docker daemon обычно обладает высокими host privileges; уязвимость runtime/kernel может разрушить isolation.
- Task-selected image может быть malicious. Проверяйте publisher/digest и используйте отдельную benchmark-машину для неизвестных images.
- Writable bind mount позволяет generated code менять только temporary workspace, но evaluator code может читать его полностью.
- `/evaluator` доступен процессу во время проверки. Модель не видит checks до ответа, однако generated code может читать grader at runtime. Для соревнования с adversarial submissions вынесите oracle в отдельный process/service, недоступный submission container.
- CPU/memory/PID/time caps ограничивают, но не исключают все side channels или host resource pressure.

## Context Recovery checkpoint

Phase-1 state записывается в journal вместе с hashes, commit SHA и snapshot hash. Resume перед phase 2 повторно создаёт temporary workspace и проверяет совпадение snapshot/commit; mismatch даёт `JOURNAL_INVALID`.

Phase-2 prompt содержит surviving notes и Git summary. Они считаются untrusted data и могут содержать prompt injection от phase 1. System prompt явно требует не считать их инструкциями более высокого уровня, но абсолютной защиты от model-level prompt injection не существует. Не используйте model notes для host commands.

## Journal и report

- Journal entry hash включает previous hash; sequence и chain проверяются при каждом open.
- Append вызывает fsync. Неполный последний JSONL fragment после crash безопасно обрезается.
- `run.json`, journal и report записываются с owner-only file mode там, где это поддерживает OS.
- Dashboard использует React text escaping и не принимает raw model HTML.
- Local report server добавляет CSP, `nosniff`, `DENY` framing, no-referrer и запрещает methods кроме GET/HEAD.
- Request path проходит containment validation; encoded traversal получает 404.
- Server слушает только `127.0.0.1` и не предоставляет authentication/TLS.

Не публикуйте `reports/` автоматически. Check output может содержать source snippets, secrets из ошибочно подготовленного task или provider-supplied error data.

## Supply-chain и reproducibility

- `package-lock.json` должен устанавливаться через `npm ci`.
- Проверяйте `npm audit --audit-level=high`, но не считайте audit полной гарантией.
- OCI digest предпочтительнее tag; фактический image ID сохраняется как evidence.
- Pricing и provider model strings — versioned config inputs, а не динамические значения.
- Обновление dependencies, API versions, scoring semantics или images требует нового reviewed run.

## Security checklist для task author

- [ ] В workspace/evaluator/image нет credentials и private data.
- [ ] Check использует argv, а не строковый shell/eval.
- [ ] Model text читается как data и не рендерится/исполняется.
- [ ] Image закреплён digest и получен из доверенного registry.
- [ ] Timeout/output caps минимальны для задачи.
- [ ] Никакая проверка не требует внешней сети.
- [ ] Failure output не раскрывает hidden secrets.
- [ ] Плохой fixture не может писать за пределами `/workspace`.
- [ ] Report просмотрен перед публикацией.

## Сообщение об уязвимости

Публичного security contact в этом локальном MVP пока нет. Не публикуйте exploit details вместе с чувствительными artifacts; передайте минимальный reproduction владельцу репозитория приватным каналом.
