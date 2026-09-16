#!/usr/bin/env node
/* 단어장 N2 문제 생성 적합성 검사기
 *
 *   node tools/n2-check.mjs                 # data/ 전체 검사
 *   node tools/n2-check.mjs data/foo.json   # 특정 파일만
 *   node tools/n2-check.mjs --list          # 문제 있는 단어를 하나씩 나열
 *
 * 앱(index.html)의 N2 문제 생성 조건을 그대로 옮겨 와서, 각 단어장이
 * 어떤 유형을 몇 % 만들 수 있는지와 그 원인을 알려준다.
 * 자세한 작성 규칙은 docs/단어장-N2-작성가이드.md 참고.
 */
import fs from "node:fs";
import path from "node:path";

/* ---- index.html의 생성 조건과 동일한 로직 (바뀌면 함께 고칠 것) ---- */
const KANJI = /[一-龯]/;
const nForm = s => String(s || "").replace(/[〜～\s]/g, "").split("・")[0].trim();
const hasKanji = s => KANJI.test(String(s || ""));

// korean·example을 쉼표로 1:1 대응시켜 뜻 묶음을 만든다 (deriveMeanings와 동일)
function deriveMeanings(koreanStr, exampleStr) {
  const ko = String(koreanStr || "").split(/[,，]/).map(s => s.trim()).filter(Boolean);
  let ex = String(exampleStr || "").split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (ko.length > 1 && ex.length < ko.length) {
    for (const d of ["、", "。"]) {
      if (String(exampleStr).indexOf(d) < 0) continue;
      const alt = String(exampleStr).split(d).map(s => s.trim()).filter(Boolean);
      if (alt.length !== ko.length) continue;
      // 「、」는 문장 안에서도 쓰이므로 조각이 전부 온전한 문장일 때만 인정 (앱과 동일)
      if (d === "、" && !alt.every(x => /[。!?！？]$/.test(x))) continue;
      ex = d === "。" ? alt.map(s => s + "。") : alt; break;
    }
  }
  return ko.length ? ko.map((k, i) => ({ korean: k, example: (ex[i] || "").trim() }))
                   : [{ korean: "", example: (ex[0] || "").trim() }];
}

function n2HasKanji(w) { const k = nForm(w.kanji); return !!k && k !== nForm(w.hiragana) && hasKanji(k); }

// 예문 안에서 표제어 위치. exact=표제어 그대로, false=활용해서 어간만 일치
function n2Locate(w, ex) {
  if (!ex) return null;
  const k = nForm(w.kanji), h = nForm(w.hiragana);
  if (k && hasKanji(k) && ex.includes(k)) return { i: ex.indexOf(k), len: k.length, exact: true };
  if (h && h.length >= 2 && ex.includes(h)) return { i: ex.indexOf(h), len: h.length, exact: true };
  if (k && hasKanji(k) && k.length >= 2) {
    for (let cut = 1; cut <= 2 && k.length - cut >= 1; cut++) {
      const stem = k.slice(0, -cut);
      if (hasKanji(stem) && ex.includes(stem)) return { i: ex.indexOf(stem), len: stem.length, exact: false };
    }
  }
  return null;
}
function n2Example(w) {
  for (const m of w.meanings) {
    const ex = (m.example || "").trim();
    if (ex && n2Locate(w, ex)) return ex;
  }
  return "";
}

/* ---- 스키마 (docs/단어장-데이터-구조.md 와 같은 내용) ---- */
const WORD_FIELDS = ["id", "kanji", "hiragana", "korean", "level", "pos", "example"];
const REQUIRED = ["kanji", "hiragana", "korean"];
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const POS_CANON = ["1그룹동사", "2그룹동사", "3그룹동사", "い형용사", "な형용사", "명사", "부사",
                   "접속사", "조사", "감탄사", "연체사", "관용어", "복합동사", "연어", "사자성어", "속담"];
const POS_ALIAS = new Set([...POS_CANON,
  "group 1 verb","group1 verb","godan verb","godan","u verb","u-verb","五段動詞","五段",
  "group 2 verb","group2 verb","ichidan verb","ichidan","ru verb","ru-verb","一段動詞","一段",
  "group 3 verb","group3 verb","irregular verb","irregular","不規則動詞",
  "i adjective","i-adjective","i adj","i-adj","keiyoushi","形容詞",
  "na adjective","na-adjective","na adj","na-adj","keiyoudoushi","形容動詞",
  "noun","名詞","adverb","副詞","conjunction","接続詞","particle","助詞","interjection","感動詞",
  "rentaishi","pre-noun adjectival","prenominal","adnominal","連体詞",
  "관용구","idiom","idiomatic","慣用句","compound verb","compound","複合動詞",
  "collocation","連語","four character idiom","yojijukugo","四字熟語","proverb","ことわざ","諺"]);
// 앱의 normalizePos와 동일: 공백·밑줄만 정규화하고, 하이픈 표기는 표에 그대로 들어 있다
const posKnown = v => {
  const raw = String(v || "").trim();
  return POS_ALIAS.has(raw.toLowerCase().replace(/[\s_]+/g, " ")) || POS_ALIAS.has(raw);
};

// 최상위가 배포용 단어장 형식인지 검사
function checkTopLevel(book) {
  const out = [];
  if (!Array.isArray(book.words) || !book.words.length) out.push(["막힘", "(파일)", "words 배열이 없거나 비어 있음 — 로드 거부됨"]);
  if (book.version == null) out.push(["정보", "(파일)", "version 없음 — 관례상 1을 넣습니다"]);
  for (const k of ["selected", "schedule", "progress", "excluded", "log"])
    if (k in book) out.push(["품질", "(파일)", `최상위에 '${k}' 있음 — 내보내기(백업) 형식입니다. 배포용 단어장에서는 빼세요`]);
  return out;
}

// 단어 하나의 구조(필드명·타입·허용값) 검사
function checkShape(w, label, keys) {
  const out = [];
  for (const k of keys) {
    if (k === "meanings") { out.push(["정보", label, "meanings는 앱이 자동 생성 — 파일에서 빼세요"]); continue; }
    if (!WORD_FIELDS.includes(k)) out.push(["품질", label, `모르는 필드 '${k}' — 앱이 무시함 (오타 확인)`]);
  }
  for (const k of REQUIRED)
    if (!String(w[k] ?? "").trim()) out.push(["막힘", label, `필수 필드 '${k}' 없음`]);
  if (w.id != null && typeof w.id !== "number") out.push(["품질", label, `id가 숫자가 아님 (${typeof w.id})`]);
  for (const k of ["kanji", "hiragana", "korean", "level", "pos", "example"])
    if (k in w && typeof w[k] !== "string") out.push(["품질", label, `'${k}'가 문자열이 아님 (${typeof w[k]})`]);
  if (w.level && !LEVELS.includes(w.level)) out.push(["품질", label, `level '${w.level}' — N5~N1 이 아님`]);
  if (w.pos && !posKnown(w.pos)) out.push(["품질", label, `pos '${w.pos}' — 표준값/별칭에 없음`]);
  if (/[、]/.test(w.korean || "")) out.push(["품질", label, "korean에 전각 쉼표 「、」 — 구분자는 반각 ','"]);
  return out;
}

/* ---- 검사 ---- */
// 文脈規定은 표제어를 （　）로 지운 뒤 남는 글자가 단서다.
// 그래서 예문 전체 길이가 아니라 '표제어를 뺀 나머지' 길이로 문맥을 잰다.
// (표제어가 긴 관용어는 예문이 짧아도 단서가 충분할 수 있고, 그 반대도 있다)
const SHORT_CONTEXT = 3;

function analyse(words) {
  // 정규화 전에 원래 키를 기록해 둔다 (meanings를 붙인 뒤 검사하면 전부 오탐이 된다)
  const origKeys = new WeakMap();
  words.forEach(w => origKeys.set(w, Object.keys(w)));
  words.forEach((w, i) => {
    if (w.id == null) w.id = i + 1;
    w.meanings = deriveMeanings(w.korean, w.example);
  });
  const n = words.length;
  const can = { yomi: 0, hyoki: 0, bunmyaku: 0, yoho: 0, iikae: n };
  const why = { noExample: 0, exampleLacksWord: 0, stemOnly: 0, noKanji: 0 };
  const issues = [];

  // 用法 오답 후보: 예문에 표제어가 그대로 든 단어
  const usable = words.filter(w => { const e = n2Example(w); const l = e && n2Locate(w, e); return l && l.exact; });

  const idSeen = new Map();
  for (const w of words) {
    const label = `${w.kanji || ""}(${w.hiragana || ""})`;
    issues.push(...checkShape(w, label, origKeys.get(w) || []));
    if (w.id != null) {
      if (idSeen.has(w.id)) issues.push(["막힘", label, `id ${w.id} 중복 — ${idSeen.get(w.id)} 와 겹침`]);
      else idSeen.set(w.id, label);
    }
    const rawEx = w.meanings.map(m => m.example).filter(Boolean).join("");
    const ex = n2Example(w);
    const loc = ex ? n2Locate(w, ex) : null;

    if (!n2HasKanji(w)) why.noKanji++;
    // 막힘 — 문장형 문제(文脈規定·用法·表記)를 아예 만들 수 없는 경우
    if (!rawEx) { why.noExample++; issues.push(["막힘", label, "예문 없음 — 文脈規定·用法·表記 모두 불가"]); }
    else if (!ex) { why.exampleLacksWord++; issues.push(["막힘", label, `예문에 표제어가 없음 — "${rawEx.slice(0, 24)}"`]); }
    else if (!loc.exact) { why.stemOnly++; issues.push(["막힘", label, "활용형이라 어간만 일치 — 表記·文脈規定·用法 불가"]); }

    if (n2HasKanji(w)) can.yomi++;
    if (ex && loc && loc.exact) {
      can.bunmyaku++;
      // 用法은 정답·오답 문장 모두 문맥이 있어야 한다 (앱의 n2HasContext와 동일)
      const ctxOk = x => { const e = n2Example(x); const l = e && n2Locate(x, e); return l && l.exact && (e.length - l.len) >= 3; };
      if (ctxOk(w) && usable.filter(x => x.id !== w.id && ctxOk(x)).length >= 3) can.yoho++;
      if (n2HasKanji(w) && ex.slice(loc.i, loc.i + loc.len) === nForm(w.kanji)) can.hyoki++;
      const ctx = ex.length - loc.len;   // （　）를 뺀 나머지 단서
      if (ctx <= SHORT_CONTEXT) issues.push(["품질", label, `빈칸 빼면 단서가 ${ctx}자뿐 — "${ex}" · 文脈規定이 애매해짐`]);
    }
    if (!w.pos) issues.push(["품질", label, "품사(pos) 없음 — 보기 고르기 품질이 떨어짐"]);
    if (!w.level) issues.push(["정보", label, "레벨(level) 없음"]);
    const nk = w.meanings.length, ne = w.meanings.filter(m => m.example).length;
    if (nk > 1 && ne && ne < nk) issues.push(["정보", label, `뜻 ${nk}개인데 예문 ${ne}개 — 쉼표 1:1 대응 확인`]);
  }

  // 품사 쏠림: 用法 오답을 '다른 품사'에서 3개 못 뽑으면 어색한 문제가 된다
  const posOf = new Map();
  for (const w of usable) posOf.set(w.pos || "(없음)", (posOf.get(w.pos || "(없음)") || 0) + 1);
  let thinPos = 0;
  for (const w of usable) {
    const other = usable.filter(x => x.id !== w.id && x.pos && w.pos && x.pos !== w.pos).length;
    if (other < 3) thinPos++;
  }
  const top = [...posOf.entries()].sort((a, b) => b[1] - a[1])[0] || ["-", 0];

  // 한글 뜻 중복 — 보기 후보에서 서로 걸러져 선택지가 줄어든다
  const koCount = new Map();
  for (const w of words) { const k = w.meanings.map(m => m.korean).join(", "); koCount.set(k, (koCount.get(k) || 0) + 1); }
  const dupKo = [...koCount.entries()].filter(([, v]) => v > 1);

  return { n, can, why, issues, thinPos, usableN: usable.length, topPos: top, dupKo };
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

const args = process.argv.slice(2);
const listMode = args.includes("--list");
let files = args.filter(a => !a.startsWith("--"));
if (!files.length) {
  const dir = "data";
  files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "wordbooks.json").map(f => path.join(dir, f));
}

let bad = 0;
for (const f of files) {
  let book;
  try { book = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.log(`\n❌ ${f} — JSON 오류: ${e.message}`); bad++; continue; }
  const words = book.words;
  if (!Array.isArray(words) || !words.length) { console.log(`\n⚠️  ${f} — words 배열이 비어 있음`); continue; }

  const r = analyse(words);
  r.issues.unshift(...checkTopLevel(book));
  console.log(`\n=== ${f} — ${r.n}단어 ===`);
  console.log(`  생성 가능  漢字読み ${pct(r.can.yomi, r.n)}%  表記 ${pct(r.can.hyoki, r.n)}%  ` +
              `文脈規定 ${pct(r.can.bunmyaku, r.n)}%  用法 ${pct(r.can.yoho, r.n)}%  言い換え 100%`);
  // ❌ 막힘 = 문제를 못 만든다 / 💡 품질 = 만들어지지만 쉽거나 어색해진다
  const block = [], qual = [];
  // 구조 오류(필수 필드 누락·id 중복·타입 오류)는 내용 품질보다 먼저 잡는다
  const shapeBlock = r.issues.filter(i => i[0] === "막힘" && !/예문|활용형/.test(i[2]));
  if (shapeBlock.length) block.push(`구조 오류 ${shapeBlock.length}건 — 예: ${shapeBlock[0][1]} ${shapeBlock[0][2]}`);
  const unknownF = r.issues.filter(i => i[2].startsWith("모르는 필드"));
  if (unknownF.length) qual.push(`모르는 필드 ${unknownF.length}건 — 오타 확인 (${unknownF[0][2].match(/'([^']+)'/)?.[1]})`);
  const badPos = r.issues.filter(i => i[2].startsWith("pos '"));
  if (badPos.length) qual.push(`표준값 아닌 pos ${badPos.length}건 — 보기 선정 품질 저하`);
  if (pct(r.can.bunmyaku, r.n) < 80) {
    const conj = r.why.stemOnly + r.why.exampleLacksWord;   // 예문이 활용형이라 못 잡는 경우
    // 원인이 '예문 없음'이면 진짜 보강이 필요하고, '활용형'이면 敬語처럼 정중형이
    // 자연스러운 단어장에서 어쩔 수 없이 낮게 나오는 것이라 대응이 다르다
    const cause = r.why.noExample > conj
      ? "예문 보강 필요"
      : "예문이 활용형이라 표제어와 안 맞음 (敬語처럼 정중형이 자연스러운 주제는 낮게 나오는 게 정상)";
    block.push(`文脈規定·用法 생성률 ${pct(r.can.bunmyaku, r.n)}% — ${cause} ` +
               `(예문없음 ${r.why.noExample}, 표제어불일치 ${r.why.exampleLacksWord}, 활용형 ${r.why.stemOnly})`);
  }
  if (r.thinPos > r.usableN * 0.3 && r.usableN)
    qual.push(`품사 쏠림 (${r.topPos[0]} 최다) — ${r.thinPos}/${r.usableN}단어가 用法 오답을 다른 품사에서 못 뽑음. ` +
              `같은 품사끼리 바꿔 「家がいい。」처럼 말이 되는 오답이 섞인다. 다른 품사 단어를 3개 이상 넣으면 해결`);
  if (r.dupKo.length) qual.push(`한글 뜻 중복 ${r.dupKo.length}종 — 보기 후보가 줄어듦 (예: ${r.dupKo[0][0].slice(0, 20)})`);
  const shortEx = r.issues.filter(i => i[0] === "품질" && i[2].includes("단서가")).length;
  if (shortEx) qual.push(`단서 부족 예문 ${shortEx}개 — 빈칸을 빼면 문맥이 거의 없어 정답이 애매해짐`);

  block.forEach(m => console.log(`  ❌ ${m}`));
  qual.forEach(m => console.log(`  💡 ${m}`));
  if (!block.length && !qual.length) console.log("  ✅ N2 문제 생성에 적합");
  if (block.length) bad++;

  const counts = { 막힘: 0, 품질: 0, 정보: 0 };
  r.issues.forEach(i => counts[i[0]]++);
  if (listMode && r.issues.length) {
    console.log(`  --- 개별 항목 (막힘 ${counts.막힘} · 품질 ${counts.품질} · 정보 ${counts.정보}) ---`);
    for (const [sev, w, msg] of r.issues) console.log(`    [${sev}] ${w.padEnd(18)} ${msg}`);
  } else if (counts.막힘 || counts.품질) {
    console.log(`  (개별 항목 막힘 ${counts.막힘} · 품질 ${counts.품질} — --list 로 자세히 보기)`);
  }
}
console.log(`\n검사한 파일 ${files.length}개 · 예문 보강이 필요한 파일 ${bad}개`);
