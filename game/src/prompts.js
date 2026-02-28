// ============================================================
// PROMPT POOLS
// Game-related prompts get displayed at roundtable (anonymous)
// Fun/random prompts are cover — never displayed publicly
// ============================================================

export const GAME_PROMPTS = [
  "Name someone you trust and explain why",
  "Name someone you suspect and explain why",
  "If you were a traitor, who would you target first and why?",
  "Describe suspicious behavior you noticed this round",
  "Who is playing the best game right now and why?",
  "Write an anonymous accusation against anyone",
  "If you could save one person from banishment, who and why?",
  "Who do you think is secretly a traitor and what gave them away?",
  "Defend yourself without naming yourself — why should people trust you?",
  "What alliance do you think exists that nobody is talking about?",
  "Who has been too quiet tonight?",
  "Who has been deflecting suspicion onto others?",
];

export const FUN_PROMPTS = [
  "What's your favorite food and why?",
  "What's the most embarrassing thing that's happened to you this year?",
  "Rank the top 3 best dressed people at this party",
  "Who at this party is the worst liar?",
  "What's a hot take you have that would start an argument?",
  "If you could swap lives with anyone at this party for a day, who?",
  "What's a secret talent nobody here knows about?",
  "Describe your perfect Sunday in 2 sentences",
  "What song would play if you walked into a room in slow motion?",
  "If this group was on a deserted island, who dies first?",
  "What's the last lie you told?",
  "Who at this party would survive an actual horror movie?",
];

export const RANDOM_PROMPTS = [
  "What's your go-to karaoke song?",
  "What's the worst date you've ever been on?",
  "If you could only eat one meal for the rest of your life, what is it?",
  "What's a movie everyone loves that you secretly hate?",
  "What's the most unhinged thing you've ever done while drunk?",
  "If you had to delete every app on your phone except 3, which do you keep?",
  "What's a hill you will die on?",
  "Describe your worst roommate experience in one sentence",
  "What's your most irrational fear?",
  "If you won the lottery tomorrow, what's the first thing you buy?",
  "What's the most overrated restaurant or bar in Tulsa?",
  "What's a conspiracy theory you kind of believe?",
  "What's the worst fashion trend you participated in?",
  "If your life had a theme song, what would it be?",
  "What's something you're weirdly competitive about?",
  "What's a skill you wish you had?",
  "Describe your toxic trait in one sentence",
  "What's the craziest thing on your bucket list?",
  "If you could time travel to one year, which year and why?",
  "What's the most money you've ever wasted on something stupid?",
  "What reality TV show would you actually go on?",
  "What's a compliment you got once that you still think about?",
  "What's your Roman Empire — the thing you think about constantly?",
  "If you had to pick a new first name, what would it be?",
  "What's the most chaotic group chat you're in and why?",
];

// Combine fun + random into one "filler" pool
const FILLER_PROMPTS = [...FUN_PROMPTS, ...RANDOM_PROMPTS];

// ============================================================
// PROMPT SELECTION
// Picks prompts for a round, skewing heavily toward filler.
// Returns array of { text, isGame } objects.
// usedPrompts: Set of already-used prompt texts this game.
// ============================================================
export function selectPrompts(count, usedPrompts = new Set()) {
  // 1-2 game prompts, rest are filler
  const numGame = Math.min(Math.floor(Math.random() * 2) + 1, count); // 1 or 2
  const numFiller = count - numGame;

  const availableGame = GAME_PROMPTS.filter(p => !usedPrompts.has(p));
  const availableFiller = FILLER_PROMPTS.filter(p => !usedPrompts.has(p));

  // If we've used all prompts, allow repeats from the larger pools
  const gamePool = availableGame.length >= numGame ? availableGame : GAME_PROMPTS;
  const fillerPool = availableFiller.length >= numFiller ? availableFiller : FILLER_PROMPTS;

  const picked = [];

  // Pick game prompts
  const shuffledGame = shuffle([...gamePool]);
  for (let i = 0; i < numGame && i < shuffledGame.length; i++) {
    picked.push({ text: shuffledGame[i], isGame: true });
  }

  // Pick filler prompts
  const shuffledFiller = shuffle([...fillerPool]);
  for (let i = 0; i < numFiller && i < shuffledFiller.length; i++) {
    picked.push({ text: shuffledFiller[i], isGame: false });
  }

  // Shuffle the final list so game/filler are interleaved randomly
  return shuffle(picked);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
