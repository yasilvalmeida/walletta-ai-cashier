// End-of-order detection.
//
// Two flavors:
//   isFinalizeSpeech  — permissive substring match on the user's turn,
//                       used by useConversation to fire the receipt
//                       modal once the cart has items. "I'll take a
//                       matcha, that's all" should match even though
//                       the turn also carries a cart add.
//   isPureFinalize    — strict equality match on a small list of
//                       standalone closes, used server-side in
//                       /api/chat to decide whether to force an
//                       add_to_cart tool call. "matcha, that's all"
//                       must NOT count as pure, since the matcha needs
//                       adding; only bare "that's all" / "done" /
//                       "checkout" qualify.
//
// Nova-3 smart_format usually yields the apostrophe form ("that's"),
// but iOS dictation and some accent paths drop it. Both variants are
// accepted here to keep the receipt modal reliable across devices.

const FINALIZE_PHRASES = [
  "that's all",
  "thats all",
  "that is all",
  "that's it",
  "thats it",
  "checkout",
  "check out",
  "pay",
  "i'm done",
  "im done",
  "i am done",
  "i'm good",
  "im good",
  "all set",
  "no thanks",
  "no thank you",
];

const PURE_FINALIZE = new Set([
  "done",
  "that's all",
  "thats all",
  "that is all",
  "that's it",
  "thats it",
  "no, that's all",
  "no, that's all.",
  "no. that's all.",
  "no thanks",
  "no thank you",
  "checkout",
  "check out",
  "pay",
  "i'm done",
  "im done",
  "i am done",
  "all set",
]);

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

export function isFinalizeSpeech(userText: string): boolean {
  const lower = normalize(userText);
  if (!lower) return false;
  if (lower === "done") return true;
  if (lower.endsWith(" done")) return true;
  return FINALIZE_PHRASES.some((p) => lower.includes(p));
}

export function isPureFinalize(userText: string): boolean {
  const lower = normalize(userText).replace(/\s+/g, " ");
  return PURE_FINALIZE.has(lower);
}
