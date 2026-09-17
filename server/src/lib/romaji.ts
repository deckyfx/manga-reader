const COMPOUNDS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja",  じゅ: "ju",  じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

const SINGLES: Record<string, string> = {
  あ: "a",  い: "i",   う: "u",   え: "e",  お: "o",
  か: "ka", き: "ki",  く: "ku",  け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su",  せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni",  ぬ: "nu",  ね: "ne", の: "no",
  は: "ha", ひ: "hi",  ふ: "fu",  へ: "he", ほ: "ho",
  ま: "ma", み: "mi",  む: "mu",  め: "me", も: "mo",
  や: "ya", ゆ: "yu",  よ: "yo",
  ら: "ra", り: "ri",  る: "ru",  れ: "re", ろ: "ro",
  わ: "wa", を: "wo",  ん: "n",
  が: "ga", ぎ: "gi",  ぐ: "gu",  げ: "ge", ご: "go",
  ざ: "za", じ: "ji",  ず: "zu",  ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji",  づ: "zu",  で: "de", ど: "do",
  ば: "ba", び: "bi",  ぶ: "bu",  べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi",  ぷ: "pu",  ぺ: "pe", ぽ: "po",
  ー: "-",
};

/** Katakana → hiragana so one table covers both scripts (tokenizer readings are katakana). */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function nextRomaji(s: string, pos: number): { roma: string; len: number } | null {
  const two = s.slice(pos, pos + 2);
  if (two.length === 2 && COMPOUNDS[two]) return { roma: COMPOUNDS[two], len: 2 };
  const one = SINGLES[s[pos]];
  return one ? { roma: one, len: 1 } : null;
}

/** Converts a hiragana/katakana reading to Hepburn-style romaji; unknown characters pass through. */
export function kanaToRomaji(reading: string): string {
  const s = toHiragana(reading);
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "っ") {
      // Sokuon doubles the following consonant
      const next = nextRomaji(s, i + 1);
      if (next && !"aeiou".includes(next.roma[0])) out += next.roma[0];
      i++;
      continue;
    }
    const n = nextRomaji(s, i);
    if (n) {
      out += n.roma;
      i += n.len;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}
