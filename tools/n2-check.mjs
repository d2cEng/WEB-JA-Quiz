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
      if (alt.length === ko.length) { ex = d === "。" ? alt.map(s => s + "。") : alt; break; }
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

/* ---- 검사 ---- */
const SHORT_EXAMPLE = 8;   // 이보다 짧은 예문은 문맥이 약해 文脈規定이 애매해진다

function analyse(words) {
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

  for (const w of words) {
    const label = `${w.kanji || ""}(${w.hiragana || ""})`;
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
      if (usable.filter(x => x.id !== w.id).length >= 3) can.yoho++;
      if (n2HasKanji(w) && ex.slice(loc.i, loc.i + loc.len) === nForm(w.kanji)) can.hyoki++;
      if (ex.length <= SHORT_EXAMPLE) issues.push(["품질", label, `예문이 짧아 문맥이 약함(${ex.length}자) — "${ex}" · 文脈規定이 애매해짐`]);
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
  console.log(`\n=== ${f} — ${r.n}단어 ===`);
  console.log(`  생성 가능  漢字読み ${pct(r.can.yomi, r.n)}%  表記 ${pct(r.can.hyoki, r.n)}%  ` +
              `文脈規定 ${pct(r.can.bunmyaku, r.n)}%  用法 ${pct(r.can.yoho, r.n)}%  言い換え 100%`);
  // ❌ 막힘 = 문제를 못 만든다 / 💡 품질 = 만들어지지만 쉽거나 어색해진다
  const block = [], qual = [];
  if (pct(r.can.bunmyaku, r.n) < 80)
    block.push(`文脈規定·用法 생성률 ${pct(r.can.bunmyaku, r.n)}% — 예문 보강 필요 ` +
               `(예문없음 ${r.why.noExample}, 표제어불일치 ${r.why.exampleLacksWord}, 활용형 ${r.why.stemOnly})`);
  if (r.thinPos > r.usableN * 0.3 && r.usableN)
    qual.push(`품사 쏠림 (${r.topPos[0]} 최다) — ${r.thinPos}/${r.usableN}단어가 用法 오답을 다른 품사에서 못 뽑음. ` +
              `같은 품사끼리 바꿔 「家がいい。」처럼 말이 되는 오답이 섞인다. 다른 품사 단어를 3개 이상 넣으면 해결`);
  if (r.dupKo.length) qual.push(`한글 뜻 중복 ${r.dupKo.length}종 — 보기 후보가 줄어듦 (예: ${r.dupKo[0][0].slice(0, 20)})`);
  const shortEx = r.issues.filter(i => i[0] === "품질" && i[2].includes("짧아")).length;
  if (shortEx) qual.push(`짧은 예문 ${shortEx}개 — 文脈規定 문맥이 약해 정답이 애매해짐`);

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
