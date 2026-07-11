# AGENTS.md — url-shortener

> Єдине джерело правди для будь-якого AI-агента в цьому репо (Claude Code, Codex,
> GitHub Copilot, Cursor, Antigravity). Кожен з цих інструментів автоматично читає
> цей файл (Claude — через `CLAUDE.md`, який сюди веде). Прочитай його перед будь-якою
> задачею. **Жоден плагін ставити не треба** — усі протоколи вже лежать у репо.

## Що це за проєкт

URL shortener на Node/Express/SQLite з живою frontend і трирівневим набором тестів.
Базова вертикаль (скоротити → перейти → лічильник) працює; частина ендпоінтів — заглушки
на `501`. Кожна наступна фіча приїжджає готовим SDD-пакетом під `docs/features/<slug>/`
і реалізується скілом `implement` по TDD.

## Команди

| Команда | Що робить |
|---|---|
| `npm run dev` | підняти сервер → http://localhost:3000 (frontend) |
| `npm run lint` | ESLint по всьому репо |
| `npm run test:unit` | лише unit (Vitest, project `unit`) — доменні функції над `openDb(':memory:')` |
| `npm run test:integration` | лише integration (Vitest, project `integration`) — HTTP через supertest |
| `npm run test:fast` | unit + integration разом, без браузера — **це і є per-task TDD ворота** |
| `npm run test:e2e` | E2E через обморду (Playwright, свій порт :3100 і своя база) |
| `npm test` | усі три рівні (`test:fast` + `test:e2e`) — підіймає браузер, довше |
| `npm run gate` | повні ворота репо: `lint` + `npm test` |
| `npm run doctor` | що є на цій машині (node, git, `claude`, `codex`, `node_modules`) |
| `npm run verify` | **усі детерміновані ворота однією командою, 0 токенів** — матриця + `exit 1` на червоному |
| `npm run tools:check` | крос-тулові ворота: вендоровані скіли й рев'юери не розійшлись |
| `npm run links:check` | посилання в доці: жодного `[[wikilink]]`, кожен шлях і якір живі |
| `npm run eval:self-test` | детермінований self-test behavioral grader-а, без виклику моделі |
| `npm run ralph` | сліпий луп: жене SDD-пакет фічі через ворота без людини. `-- --dry-run` показує беклог за 0 токенів |

**Після кожної правки — `npm run verify`.** Прапорці: `--skip-e2e` (без браузера, так ганяє
Windows у CI) і `--fail-fast` (зупинитись на першому червоному).

⚠ У `verify` немає «м'яких» пропусків. Зникне будь-який скрипт-ворота з `package.json` —
матриця почервоніє. Ворота, що мовчки скіпаються, гірші за їх відсутність: вони показують
зелене там, де ніхто нічого не перевірив.

Тестова база — in-memory: unit і integration тести ганяють `createApp(openDb(':memory:'))`.
E2E ганяє окрему файлову базу (`playwright.config.js` → `DB_PATH=data/e2e.db`).

**Per-task гейт — `npm run test:fast`.** `npm test` і `npm run gate` тягнуть Playwright і
підіймають браузер — ганяй їх рідше (перед комітом фічі), не після кожного кроку.

## Золоті правила (конвенції, які фіча має тримати)

Повний перелік — `docs/architecture-map.md`. Стисло:

- **Домен vs HTTP.** Нове доменне правило (валідація, expiry, dedup) → `src/shorten.js`.
  Роути в `src/app.js` лишаються тонкими: викликають домен і маплять результат у HTTP.
- **Тестування.** Усе через `createApp(openDb(':memory:'))`. Прецедент HTTP-шва:
  `tests/integration/shorten.test.js`; прецедент доменного: `tests/unit/shorten.test.js`.
- **Форма помилки.** `res.status(4xx).json({ error: '<short>' })`. Ніколи не кидати голий рядок.
- **Статус-коди.** 201 create · 302 redirect · 400 validation · 404 missing · 409 conflict ·
  410 expired · 429 rate-limit · 501 ще-не-зроблено.
- **Міграції.** Нова колонка → окрема ідемпотентна `ALTER TABLE` у `src/db.js`; базову схему не редагуємо.
- **Порядок роутів.** `/api/*` оголошуються ВИЩЕ за catch-all `GET /:code`, інакше catch-all
  перехоплює їх першим.
- **Без нових залежностей** у продукті, доки ADR фічі не скаже інакше.
- **TDD.** Кожна задача стартує з червоного тесту (див. протокол нижче).

## Як реалізовувати фічу

1. **Візьми специфікацію.** Кожна фіча — це готовий пакет під `docs/features/<slug>/`:
   `spec.md` (acceptance-критерії), `sad.md` (дизайн), `contracts/openapi.yaml` (HTTP-контракт),
   `adr/` (рішення), `tasks.json` + `tasks/` (задачі). Це звичайний markdown — читає будь-який
   агент, **жоден плагін не потрібен**. Черга фіч — у `docs/roadmap.md`. Готовий worked example —
   `base-vertical` (вже shipped).
2. **Прочитай таск цілком.** Кожен `tasks/T*.md` має GWT-критерії, покроковий чекліст,
   таблицю edge cases і Definition of Done. Питати нічого не треба — усе там.
3. **Жени по TDD скілом `implement`** (в інших інструментах — `sdd-implement`). Цикл
   `RED → GREEN → REFACTOR → GATE → COMMIT`, один acceptance-критерій за раз, тест-першим.
   Код до червоного тесту писати заборонено. Він сам підіймає субагентів: `test-author`
   (пише червоний тест) → `implementer` (робить зелений і рефакторить) → `reviewer`
   (незалежно рев'ює). Політика моделей по ролях — секція **Agents** усередині `implement/SKILL.md`.
4. **Тримай ворота зеленими.** Після кожного кроку — `npm run test:fast`. Наявні тести
   (`tests/unit/shorten.test.js`, `tests/integration/shorten.test.js`) мають лишатися зеленими.
5. **Закрий таск.** Онови `tasks/tracker.md` (`status: done`) і зішли PR на файл таска.

## Скіли (вендорені в репо — плагін ставити не треба)

У репо вендорено скіл `implement` (TDD-движок, самодостатній — уся політика в його `SKILL.md`
+ `references/`) і три його субагенти (`test-author` · `implementer` · `reviewer`). Їдуть із
клоном, окремими файлами під кожен інструмент, зміст однаковий (формат SKILL.md — відкритий
стандарт Agent Skills):

| Інструмент | Де лежать скіли | Як викликати | Субагенти |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `/implement <slug>` | `.claude/agents/` |
| Codex | `.agents/skills/sdd-implement/` | `$sdd-implement <slug>` | `.codex/agents/` |
| Copilot | `.github/skills/` | Agent Skills (авто) | `.github/agents/*.agent.md` |
| Cursor | `.cursor/skills/sdd-implement/` | `/` → `sdd-implement` | `.cursor/agents/` |
| Antigravity | `.agents/skills/sdd-implement/` | skill за описом (авто) | `.agents/skills/sdd-implement/agents/` |

Єдиний скіл, який **реалізує SDD-фічі**, — **`implement`** / **`sdd-implement`**. Специфікації
фіч у `docs/features/` авторовані за SDD, тож скіл читає їх напряму. Ворота (`npm run *`)
однакові в усіх інструментах і в CI: двигун змінний, ворота ні.

Окремо для [підзадачі behavioral eval](practice/task-3-skill-eval/behavioral/README.md) вендорено
малий скіл **`review-only`**. Він лише читає diff або названий файл, повертає cited findings і
фінальний `VERDICT`, але ніколи не редагує код. `npm run tools:check` стереже його read-only
контракт і синхронність чотирьох копій; живий eval викликає модель, тому до `verify` не входить.

## Луп

`loop/` — ранер, який жене **один SDD-пакет фічі** без людини за кермом. Він віддає агентові
статичний промпт (`loop/PROMPT.md`) у headless-режимі зі свіжим контекстом щоходу, після кожного
ходу ганяє гейт `lint + test:fast + links:check` і зупиняється, щойно стає марно.

```bash
git checkout -b feat/qr-codes                  # гілку створюєш ти, не скрипт
npm run ralph -- --dry-run                     # димова: беклог і зупинки; 0 токенів
npm run ralph -- --feature qr-codes --dry-run  # ціль, метрика; 0 токенів
npm run ralph -- --feature qr-codes            # справжній прогін
```

Ціль задається лише через `--feature <slug>`: чергу веде людина в `docs/roadmap.md`, ранер її не
читає. Три жорсткі зупинки — `MAX_ITER` · `K_FAILURES` · `NO_IMPROVEMENT`. Метрика прогресу —
`done`-рядки в трекері цільової фічі, тобто факт із диска, а не думка моделі про себе.

Гілка — рішення **людини**. Ранер у git не пише взагалі: він лише відмовляється стартувати
(`exit 2`), якщо HEAD стоїть на `main`.

**Пам'ять між ітераціями.** Агент наприкінці ходу дописує в `loop/JOURNAL.md`, що зробив і на
чому спіткнувся. Хук `.claude/hooks/loop-memory.mjs` на `SessionStart` виливає цей журнал у
контекст наступної ітерації — разом зі свіжими фактами з git і трекера, які рахує сам. Журнал —
самозвіт, факти — ні; вони лежать поруч, щоб розбіжність було видно.

**Стеля автономії — коміт у локальну гілку.** `git push` і `git checkout main` заборонені.
Подробиці, коди виходу й агент-агностика — [loop/README.md](loop/README.md).

## Хуки (Claude Code)

Заборони з промптів додатково стережуть **хуки** — скрипти в `.claude/hooks/`, які Claude Code
запускає сам на подіях сесії (реєстр — `.claude/settings.json`). Промпт лишається першим шаром
і єдиним для не-Claude агентів; хук — детермінований другий. Відмова інструмента з причиною —
це спрацювання запобіжника, а не збій.

| Подія | Файл | Що стереже |
|---|---|---|
| `SessionStart` | `loop-memory.mjs` | вливає журнал лупа + факти з git/трекера в контекст ітерації |
| `PreToolUse` (Bash) | `guard-bash.mjs` | у лупі: `git push`, перемикання гілок, нові npm-залежності, трейлер `SDD-Task:`; завжди: коміт на `main`, `--no-verify` |
| `PreToolUse` (Edit/Write) | `guard-files.mjs` | `docs/roadmap.md`; `DONE` проти трекера; у лупі — самі хуки й `settings.json` |
| `PostToolUse` (Edit/Write) | `post-edit.mjs` | одразу після правки: посилання в `*.md` (`links:check --file`), ESLint по зміненому файлу |
| `Stop` | `stop-journal.mjs` | у лупі: хід не завершується, доки не дописано `loop/JOURNAL.md` |

Строгість залежить від режиму: `RALPH_FEATURE` (виставляє ранер лупа) вмикає повну стелю;
в інтерактиві людини діють лише універсальні запобіжники. Самоперевірка без токенів і моделі —
`npm run hooks:test` (входить у `verify`); кожен хук ганяється й руками:
`node .claude/hooks/<file>.mjs --self-test`.

Як влаштовано, як додати новий хук і що робити, коли хук заблокував тебе, —
[.claude/hooks/README.md](.claude/hooks/README.md). Чому саме хуки і чому промпти
лишаються — [ADR 0003](docs/adr/0003-hooks-enforce-agent-prohibitions.md).

## Де що лежить

- `src/` — код (`shorten.js` домен · `app.js` роути · `db.js` БД · `server.js` вхід · `public/` frontend).
- `loop/` — ранер лупа (`ralph.mjs`), промпт одного ходу (`PROMPT.md`), журнал агента (`JOURNAL.md`, у git не потрапляє).
- `.claude/hooks/` — хук пам'яті лупа (`loop-memory.mjs`), зареєстрований у `.claude/settings.json`.
- `docs/features/<slug>/` — SDD-пакети фіч (spec · sad · contracts · adr · tasks).
- `docs/_templates/` — шаблони `task.md`, `_epic.md`, `tracker.md` для нових пакетів.
- `docs/roadmap.md` — черга фіч.
- `docs/architecture-map.md` — конвенції (читай першим).
- `docs/CONTEXT.md` — глосарій домену.
- `docs/adr/` — наскрізні рішення проєкту (не фічеві).
- `.claude/skills/` · `.agents/skills/` · `.cursor/skills/` · `.github/skills/` — вендорені
  `implement` і навчальний `review-only`.
- `scripts/` — ворота як скрипти (`verify.mjs` · `doctor.mjs` · `check-tools.mjs` · спільний
  `lib.mjs`). Чистий Node, без залежностей.
- `tests/unit/` · `tests/integration/` — Vitest (project `unit` / project `integration`).
- `tests/e2e/` — Playwright.

## Чого НЕ робити

- Не додавати фреймворки у frontend (vanilla HTML/CSS/JS).
- Не редагувати базову схему БД — тільки окремі міграції.
- Не писати код до червоного тесту.
- Не вимагати зовнішніх плагінів чи сервісів — усе має працювати з чистого клону.
- Не додавати npm-залежність, якщо ADR фічі цього прямо не дозволив.
- Не писати `[[wikilinks]]` у доці. Це синтаксис Obsidian, GitHub його не рендерить.
  Тільки `[текст](./відносний/шлях.md#якір)` — так бачать усі.
