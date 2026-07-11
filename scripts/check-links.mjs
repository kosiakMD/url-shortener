// check-links.mjs — ворота над посиланнями в документації.
//
// Навіщо. Документація тут — не додаток до коду, а вхід у нього: агент іде з `_epic.md` у
// `spec.md`, звідти в `openapi.yaml`. Одне бите посилання — і він не «побачить помилку», а
// тихо піде без контексту й дореконструює його з голови.
//
// Що перевіряємо:
//   1. Жодного [[wikilink]] — це синтаксис Obsidian. GitHub його НЕ рендерить: показує
//      квадратні дужки як текст. Посилання, яке виглядає посиланням лише в одному
//      редакторі, — це не посилання.
//   2. Кожне відносне markdown-посилання веде на файл, який існує.
//   3. Кожен `#якір` збігається із заголовком у файлі-цілі (за правилами GitHub).
//
//   npm run links:check
//   npm run links:check -- --file docs/roadmap.md   # лише один файл (так кличе post-edit хук)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';

import { repoRoot, Verdict } from './lib.mjs';

const REPO = repoRoot(import.meta.url);
const rel = (path) => relative(REPO, path);
const v = new Verdict('links:check');

// `.worktrees/` містить окремі checkout-и. Кожен із них проходить власні ворота; батьківський
// link-check не повинен приписувати собі документацію з іншої гілки.
const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees', 'playwright-report', 'test-results']);

// ⚠ Перший виняток. Шаблони лежать у docs/_templates/, а їхні відносні шляхи (`../spec.md`)
// правильні для МІСЦЯ ПРИЗНАЧЕННЯ — docs/features/<slug>/tasks/, куди їх копіюють. На місці
// вони биті за визначенням. Плюс у них плейсхолдери `<slug>`, яких не існує ніде.
const TEMPLATES = join(REPO, 'docs', '_templates');

// ⚠ Другий виняток. `loop/JOURNAL.md` пише АГЕНТ — це його чернетка, а не документація репо.
// Ці ворота обходять ФАЙЛОВУ СИСТЕМУ, а не git, тож `.gitignore` їх не стримує. А `links:check`
// входить у гейт лупа: агент, який чесно запише «спіткнувся на [[T2]]», завалить власний прогін
// і ніколи не здогадається чому — тести зелені, лінт зелений, впала документація, якої ніхто не
// писав. Ворота стережуть те, що читає людина, а не те, що модель нашкрябала собі на пам'ять.
const JOURNAL = join(REPO, 'loop', 'JOURNAL.md');

function mdFiles(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && path !== TEMPLATES) walk(path);
      } else if (entry.name.endsWith('.md') && path !== JOURNAL) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Якір GitHub із тексту заголовка: нижній регістр, пунктуація геть, пробіли на дефіси.
 *
 * ⚠ Подвійний дефіс — не помилка. `## 6.1 Security / privacy` → крапка й слеш зникають,
 * але два пробіли навколо слеша лишаються двома дефісами: `#61-security--privacy`. Саме
 * такий якір і генерує GitHub, тож «прибрати зайвий дефіс» означало б зламати посилання.
 */
const ghSlug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** Усі якорі файла — по одному на кожен `#`-заголовок. */
function anchorsOf(path) {
  const found = new Set();
  // Git checkout на Windows зазвичай дає CRLF. Якщо різати лише по `\n`, кожен
  // заголовок лишається з `\r`, і regex з `$` його вже не розпізнає.
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) found.add(ghSlug(heading[1]));
  }
  return found;
}

/**
 * Прозовий вигляд файла: без ```-блоків і без inline-коду, з тими самими номерами рядків.
 *
 * ⚠ Це не косметика, а визначення того, ЩО ми взагалі перевіряємо. Посилання — це те, що
 * рендериться посиланням. `[[wikilink]]` у бектиках і `[foo](bar)` у прикладі синтаксису
 * лишаються текстом, і ганятись за ними означало б забороняти доці описувати саму себе:
 * рядок «не пиши `[[wikilinks]]`» валив би ворота, які його ж і вимагають.
 */
function toProse(text) {
  let insideFence = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        insideFence = !insideFence;
        return '';
      }
      return insideFence ? '' : line.replace(/`[^`]*`/g, '');
    });
}

const WIKILINK = /\[\[[^\]]+\]\]/;
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL = /^(https?:|mailto:|#)/;

// ⚠ Лічильники, а не безумовний `v.ok.push()` наприкінці. Рядок «138 посилань на місці»,
// надрукований поруч із двома червоними, — це рівно та брехня, від якої ці ворота й стоять.
let links = 0;
let wikilinks = 0;
let broken = 0;

// `--file <шлях>` — перевірити ОДИН файл (так кличе PostToolUse-хук post-edit.mjs одразу
// після правки). Винятки ті самі, що й у повному обході: шаблони й журнал не перевіряємо —
// файл поза юрисдикцією воріт дає мовчазний OK, а не хибний провал.
const fileFlag = process.argv.indexOf('--file');
const single = fileFlag !== -1 ? resolve(REPO, process.argv[fileFlag + 1] ?? '') : null;

function filesToCheck() {
  if (!single) return mdFiles(REPO);
  if (!single.endsWith('.md') || !existsSync(single)) return [];
  if (single === JOURNAL || single.startsWith(TEMPLATES)) return [];
  return [single];
}

for (const file of filesToCheck()) {
  toProse(readFileSync(file, 'utf8')).forEach((line, i) => {
    if (WIKILINK.test(line)) {
      wikilinks += 1;
      v.fail(`${rel(file)}:${i + 1}: [[wikilink]] у прозі — GitHub покаже його як текст, а не як посилання`);
    }

    for (const [, href] of line.matchAll(MD_LINK)) {
      if (EXTERNAL.test(href)) continue; // зовнішнє або якір у цьому ж файлі
      links += 1;

      const [pathPart, anchor] = href.split('#');
      const target = resolve(dirname(file), pathPart);

      if (!existsSync(target)) {
        broken += 1;
        v.fail(`${rel(file)}:${i + 1}: посилання (${href}) веде в нікуди — ${pathPart} не існує`);
        continue;
      }
      if (!anchor || extname(target) !== '.md' || !statSync(target).isFile()) continue;

      if (!anchorsOf(target).has(anchor)) {
        broken += 1;
        v.fail(`${rel(file)}:${i + 1}: посилання (${href}) — заголовка #${anchor} у ${pathPart} немає`);
      }
    }
  });
}

if (wikilinks === 0) v.ok.push('жодного [[wikilink]] — уся дока рендериться на GitHub');
if (broken === 0) v.ok.push(`${links} відносних посилань: файли на місці, якорі збігаються із заголовками`);
v.ok.push('docs/_templates/ пропущено — його відносні шляхи правильні у теці призначення');
v.ok.push('loop/JOURNAL.md пропущено — це чернетка агента, а не документація репо');

v.report();
