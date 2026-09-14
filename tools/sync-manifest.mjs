#!/usr/bin/env node
/* 단어장 매니페스트(data/wordbooks.json)의 rev 갱신
 *
 *   node tools/sync-manifest.mjs          # 바뀐 파일의 rev를 새로 써 넣는다
 *   node tools/sync-manifest.mjs --check  # 쓰지 않고 어긋난 것만 알려준다 (CI용)
 *
 * rev는 단어 내용에서 계산한 해시라 사람이 올릴 필요가 없다.
 * 앱은 이 값을 보고 "이 단어장에 새 버전이 있다"를 판단해,
 * 학습 진도를 지우지 않고 단어만 갈아 끼운다.
 * 단어장을 고쳤으면 반드시 이걸 돌린 뒤 커밋할 것.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = "data", MANIFEST = path.join(DIR, "wordbooks.json");

// 앱(hashStr)과 같은 방식 — djb2 계열 + 길이
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h * 33) ^ str.charCodeAt(i)) >>> 0);
  return h.toString(36) + ":" + str.length;
}
// 단어 내용만으로 rev를 만든다. 들여쓰기·키 순서·표시 이름이 바뀌어도
// 실제 단어가 그대로면 rev는 그대로 → 불필요한 업데이트 알림이 뜨지 않는다.
function revOf(words) {
  const norm = words.map(w => [w.kanji, w.hiragana, w.korean, w.level, w.pos, w.example]
    .map(x => String(x ?? "")).join(""));
  return hashStr(norm.join(""));
}

const check = process.argv.includes("--check");
const man = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
let changed = 0, missing = 0;

for (const wb of man.wordbooks || []) {
  const p = path.join(DIR, wb.file);
  if (!fs.existsSync(p)) { console.log(`❌ 파일 없음: ${wb.file}`); missing++; continue; }
  let words;
  try { words = JSON.parse(fs.readFileSync(p, "utf8")).words || []; }
  catch (e) { console.log(`❌ JSON 오류: ${wb.file} — ${e.message}`); missing++; continue; }
  const rev = revOf(words);
  if (wb.rev === rev) continue;
  console.log(`${wb.rev ? "↻ 변경" : "＋ 신규"}  ${wb.file.padEnd(24)} ${wb.rev || "(없음)"} → ${rev}  (${words.length}단어)`);
  wb.rev = rev; changed++;
}

if (missing) { console.log(`\n파일 문제 ${missing}건 — 먼저 해결하세요.`); process.exit(1); }
if (!changed) { console.log("모든 rev가 최신입니다."); process.exit(0); }
if (check) {
  console.log(`\n갱신 필요 ${changed}건. 'node tools/sync-manifest.mjs' 를 돌린 뒤 커밋하세요.`);
  process.exit(1);
}
fs.writeFileSync(MANIFEST, JSON.stringify(man, null, 2));
console.log(`\n${changed}건 갱신해 ${MANIFEST}에 저장했습니다.`);
