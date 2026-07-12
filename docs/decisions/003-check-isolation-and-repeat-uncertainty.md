# ADR-003: Независимые checks и repeat-level uncertainty

## Status

Accepted

## Date

2026-07-12

## Context

До scorer `1.1.0` все hidden checks одного attempt последовательно использовали один writable workspace. Check мог оставить файл, cache или изменённый source и тем самым изменить результат следующих checks. Кроме того, JSON report не переносил suite task weight к attempt, dashboard после фильтра использовал простое среднее, а один point estimate не показывал вариативность повторов.

Требования к изменению:

- score не зависит от порядка и side effects checks;
- JSON report достаточен для точного weighted-пересчёта без исходного suite YAML;
- uncertainty не считает задачи одного repeat независимыми наблюдениями;
- незавершённый run не получает искусственно узкий interval;
- при одном repeat интерфейс не изображает нулевую вариативность.

## Decision

1. После model response создаётся один post-response attempt workspace. Перед каждым hidden check он клонируется заново; sandbox получает только эту копию, которая удаляется после check.
2. Ошибка создания или удаления check workspace становится check `error`, а не необработанным падением run.
3. `taskWeight` сохраняется в каждом report attempt. Aggregate и dashboard-filtered scores используют `Σ(score × weight) / Σ(weight)`.
4. Статистическое наблюдение — полный weighted suite score одного repeat. Repeat участвует в overall statistics только при наличии всех ожидаемых tasks; category statistics требуют полного набора tasks своей категории.
5. При `n >= 2` report хранит sample SD, `SE = s/√n` и двухсторонний 95% Student-t interval `mean ± t × SE`, ограниченный `[0, 1]`. При `n < 2` SD, SE и interval равны `null`.
6. Critical values следуют [формуле NIST для confidence limits среднего](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm) и [таблице Student-t](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm). Между опубликованными degrees of freedom выбирается меньшая строка, чтобы interval не становился уже из-за интерполяции.
7. Report и dashboard показывают repeat count, concurrency и seed рядом с метриками. Изменение получает demo scorer version `1.1.0`.

## Alternatives considered

### Один writable workspace на attempt

Быстрее и требует меньше копирований, но делает score зависимым от порядка checks и допускает ложные pass/fail из-за evaluator side effects. Отклонено: correctness benchmark важнее этой оптимизации.

### Считать каждый task score отдельным статистическим sample

Даёт большое `n` даже при одном provider repeat, но смешивает задачи разной сложности и создаёт псевдорепликацию. Отклонено: независимая единица генерации — полный repeat, а не task внутри него.

### Включать частичные repeats

Позволяет раньше показать interval для незавершённого run, но набор и веса задач между samples различаются. Отклонено. Если существует полный repeat, и point score, и uncertainty используют только полные repeats; provisional partial score разрешён лишь пока полного repeat ещё нет и interval всё равно отсутствует.

### Normal z interval или bootstrap

Z interval плохо отражает неизвестную дисперсию при малом числе repeats. Bootstrap при типичных `n=2..5` нестабилен и сложнее воспроизводимо объяснить. Student-t выбран как прозрачный small-sample interval для среднего, при этом документация явно не называет его тестом превосходства моделей.

### Показывать `±0` при одном repeat

Выглядит определённо, но означает лишь отсутствие наблюдаемого разброса из-за отсутствия повторов. Отклонено; UI показывает `n=1` и рекомендует `--repeat 3+`.

## Consequences

- Большие repositories выполняют дополнительное filesystem copying на каждый check; оптимизация допустима только без изменения isolation semantics.
- Interval описывает наблюдаемую repeat-вариативность и не компенсирует provider/model drift, зависимость облачных ответов, hardware, region или network effects.
- Старые report JSON остаются читаемыми через conservative defaults (`taskWeight=1`, `concurrency=1`, `seed=null`, empty statistics), но не приобретают ретроспективно вычисленную uncertainty.
- Новые consumers могут воспроизвести filtered score из одного report JSON.
- Любое будущее изменение sample unit, weighting или interval method требует нового scorer version и ADR, даже если `schemaVersion` остаётся совместимым.
