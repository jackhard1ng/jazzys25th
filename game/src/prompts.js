// ============================================================
// PROMPT POOLS — three modes
//   'signed'   → shown on TV, name always attached. Owning your take.
//   'optional' → shown on TV. Player chooses anonymous or signed.
//   'filler'   → NEVER shown on TV. Pure cover so people are typing
//                while the traitors confer in the secret chat.
// ============================================================

// Always-signed: the answer is fun BECAUSE you have to own it.
export const SIGNED_PROMPTS = [
  "What's your read on the room right now?",
  "Make a confident accusation — and own it.",
  "Who is your strongest ally so far, and why?",
  "Compliment the player you most suspect (be sincere).",
  "Predict who will be murdered tonight.",
  "Defend your strongest ally from suspicion.",
  "Tell us why you should be trusted (be convincing).",
  "Share an observation about another player's behavior.",
  "Who at the table is playing the best game right now?",
  "Pay a genuine compliment to another player.",
  "If you had to bet money, who is a traitor?",
  "What's the most suspicious thing you've heard tonight, and who said it?",
];

// Optional: shown on TV, but the player can choose to sign or stay anonymous.
// These are deliberately spicy — anonymity gives cover to faithful AND traitors.
export const OPTIONAL_PROMPTS = [
  "Name someone you suspect and explain why.",
  "Write an accusation against anyone.",
  "Who do you think is secretly a traitor — and what gave them away?",
  "Who has been too quiet tonight?",
  "Who has been deflecting suspicion onto others?",
  "What alliance do you think exists that nobody is talking about?",
  "Describe suspicious behavior you noticed this round.",
  "If you had to vote out one person RIGHT NOW, who?",
  "Who would you protect from murder if you could, and why?",
  "Who is the last person you'd suspect — and why might you be wrong?",
  "Whose body language is off tonight?",
  "Plant a seed of doubt about anyone.",
];

// Filler: NEVER shown publicly. Everyone types so traitors have cover.
const FUN_PROMPTS = [
  "What's your favorite food and why?",
  "What's the most embarrassing thing that's happened to you this year?",
  "Rank the top 3 best dressed people at this party.",
  "Who at this party is the worst liar?",
  "What's a hot take you have that would start an argument?",
  "If you could swap lives with anyone at this party for a day, who?",
  "What's a secret talent nobody here knows about?",
  "Describe your perfect Sunday in 2 sentences.",
  "What song would play if you walked into a room in slow motion?",
  "If this group was on a deserted island, who dies first?",
  "What's the last lie you told?",
  "Who at this party would survive an actual horror movie?",
];

const RANDOM_PROMPTS = [
  "What's your go-to karaoke song?",
  "What's the worst date you've ever been on?",
  "If you could only eat one meal for the rest of your life, what is it?",
  "What's a movie everyone loves that you secretly hate?",
  "What's the most unhinged thing you've ever done while drunk?",
  "If you had to delete every app on your phone except 3, which do you keep?",
  "What's a hill you will die on?",
  "Describe your worst roommate experience in one sentence.",
  "What's your most irrational fear?",
  "If you won the lottery tomorrow, what's the first thing you buy?",
  "What's the most overrated restaurant or bar in Tulsa?",
  "What's a conspiracy theory you kind of believe?",
  "What's the worst fashion trend you participated in?",
  "If your life had a theme song, what would it be?",
  "What's something you're weirdly competitive about?",
  "What's a skill you wish you had?",
  "Describe your toxic trait in one sentence.",
  "What's the craziest thing on your bucket list?",
  "If you could time travel to one year, which year and why?",
  "What's the most money you've ever wasted on something stupid?",
  "What reality TV show would you actually go on?",
  "What's a compliment you got once that you still think about?",
  "What's your Roman Empire — the thing you think about constantly?",
  "If you had to pick a new first name, what would it be?",
  "What's the most chaotic group chat you're in and why?",
];

const FILLER_PROMPTS = [...FUN_PROMPTS, ...RANDOM_PROMPTS];

// ============================================================
// PROMPT SELECTION
// Each round picks: 1 signed + 1 optional + (count - 2) filler.
// If count < 2, gracefully degrades to filler-only.
// Returns array of { text, mode } objects, shuffled.
// ============================================================
export function selectPrompts(count, usedPrompts = new Set()) {
  const picked = [];

  if (count >= 1) {
    picked.push({ text: pickFresh(SIGNED_PROMPTS, usedPrompts), mode: 'signed' });
  }
  if (count >= 2) {
    picked.push({ text: pickFresh(OPTIONAL_PROMPTS, usedPrompts), mode: 'optional' });
  }

  const fillerNeeded = Math.max(0, count - picked.length);
  const fillerPool = FILLER_PROMPTS.filter(p => !usedPrompts.has(p));
  const candidates = fillerPool.length >= fillerNeeded ? fillerPool : FILLER_PROMPTS;
  const shuffledFiller = shuffle([...candidates]);
  for (let i = 0; i < fillerNeeded && i < shuffledFiller.length; i++) {
    picked.push({ text: shuffledFiller[i], mode: 'filler' });
  }

  return shuffle(picked);
}

function pickFresh(pool, usedPrompts) {
  const fresh = pool.filter(p => !usedPrompts.has(p));
  const candidates = fresh.length > 0 ? fresh : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// TRAITOR COUNT — weighted random
//   80% → 4 traitors
//   15% → 3 traitors
//    5% → 5 traitors (rare chaos)
// ============================================================
export function pickTraitorCount() {
  const r = Math.random();
  if (r < 0.05) return 5;
  if (r < 0.20) return 3;
  return 4;
}
