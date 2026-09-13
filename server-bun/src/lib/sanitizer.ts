const RE_FURIGANA = /[（(《][\p{Script=Hiragana}\p{Script=Katakana}ー]+[）)》]/gu;
const RE_ARTIFACTS = /[・.．|｜_＿◆◇▲△▽▼●○□■✦✧※♦♠♣♥♡★☆→←↑↓]/gu;
const RE_DOUBLE_BAR = /ー{2,}/g;
const RE_MULTI_SPACE = /\s{2,}/g;
const RE_SENTENCE = /[^。！？!?]*[。！？!?]+/g;

/** Cleans raw manga OCR output: NFKC, strip furigana and visual noise, collapse elongation and whitespace. */
export function cleanMangaText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(RE_FURIGANA, "")
    .replace(RE_ARTIFACTS, "")
    .replace(RE_DOUBLE_BAR, "ー")
    .replace(/[\r\n]/g, "")
    .replace(RE_MULTI_SPACE, " ")
    .trim();
}

/** Splits on 。！？!? boundaries; a trailing fragment without a terminator is kept as the last sentence. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let pos = 0;
  for (const m of text.matchAll(RE_SENTENCE)) {
    const sentence = m[0].trim();
    if (sentence) sentences.push(sentence);
    pos = m.index + m[0].length;
  }
  const tail = text.slice(pos).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
