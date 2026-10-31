import { getEncoding } from "js-tiktoken";
import ranks from "js-tiktoken/ranks/cl100k_base";
import { conflict } from "./store.ts";

// The JS BPE implementation is quadratic for long indivisible pieces. Bound each
// piece before encoding; ordinary punctuation/paragraphs remain natural boundaries.
export function contextTokens(text: string): number {
  for (const match of text.matchAll(new RegExp(ranks.pat_str, "ug"))) {
    if (Buffer.byteLength(match[0]) > 8192)
      throw conflict("材料中的连续文本过长，请分段或缩小范围后重试");
  }
  return getEncoding("cl100k_base").encode(text, [], []).length;
}
