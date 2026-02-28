import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, update, push, remove, onDisconnect, serverTimestamp } from 'firebase/database';

// ============================================================
// FIREBASE CONFIGURATION
// Replace these values with your Firebase project config.
// Go to: Firebase Console → Project Settings → Your apps → Web app
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA10gaHhXSenxR30r2vMvgKLY3Laque-rI",
  authDomain: "jazzy-s-25th.firebaseapp.com",
  databaseURL: "https://jazzy-s-25th-default-rtdb.firebaseio.com",
  projectId: "jazzy-s-25th",
  storageBucket: "jazzy-s-25th.firebasestorage.app",
  messagingSenderId: "152769764617",
  appId: "1:152769764617:web:8ac076038068b13313c7d8",
  measurementId: "G-KZ46GVN46M"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ============================================================
// DATABASE REFERENCES
// ============================================================
export const gameRef = ref(db, 'game');
export const playersRef = ref(db, 'game/players');
export const stateRef = ref(db, 'game/state');
export const configRef = ref(db, 'game/config');
export const nightRef = ref(db, 'game/nightPhase');
export const votesRef = ref(db, 'game/votes');
export const scrollsRef = ref(db, 'game/scrolls');
export const traitorChatRef = ref(db, 'game/traitorChat');
export const murderVotesRef = ref(db, 'game/murderVotes');

export const getPlayerRef = (name) => ref(db, `game/players/${name}`);
export const getScrollRef = (round, name) => ref(db, `game/scrolls/${round}/${name}`);
export const getVoteRef = (name) => ref(db, `game/votes/${name}`);
export const getMurderVoteRef = (name) => ref(db, `game/murderVotes/${name}`);

// ============================================================
// CORE DATABASE OPERATIONS
// ============================================================

// Initialize/reset the entire game
export async function resetGame() {
  await set(gameRef, {
    state: {
      phase: 'lobby', // lobby, roleReveal, night, murderReveal, challenge, roundtable, voting, banishmentReveal, endgame
      round: 0,
      timerEnd: null,
      timerDuration: null,
      murderTarget: null,
      banishedPlayer: null,
      shieldBlocked: false,
      winCondition: null, // null, 'faithful', 'traitors'
      revealQueue: [],
      currentScrollIndex: -1,
      paused: false,
    },
    config: {
      numTraitors: 3,
      nightDuration: 150, // seconds (2.5 min)
      promptsPerRound: 4,
      minCharCount: 15,
      shieldsEnabled: true,
      finaleThreshold: 5, // trigger finale when this many players remain
    },
    players: {},
    votes: {},
    scrolls: {},
    traitorChat: {},
    murderVotes: {},
    nightPhase: { active: false },
  });
}

// Add a player to the game
export async function addPlayer(name) {
  const sanitized = name.trim();
  if (!sanitized) return false;
  const playerRef = getPlayerRef(sanitized);
  const snapshot = await get(playerRef);
  if (snapshot.exists()) return false; // already exists
  await set(playerRef, {
    name: sanitized,
    role: null, // 'faithful' or 'traitor'
    status: 'alive', // alive, murdered, banished
    shield: false,
    connected: true,
    joinedAt: Date.now(),
  });
  return true;
}

// Remove a player
export async function removePlayer(name) {
  await remove(getPlayerRef(name));
}

// Update game state
export async function updateGameState(updates) {
  await update(stateRef, updates);
}

// Update game config
export async function updateGameConfig(updates) {
  await update(configRef, updates);
}

// Assign roles to players
export async function assignRoles(traitorNames) {
  const snapshot = await get(playersRef);
  if (!snapshot.exists()) return;
  const players = snapshot.val();
  const updates = {};
  Object.keys(players).forEach(name => {
    updates[`${name}/role`] = traitorNames.includes(name) ? 'traitor' : 'faithful';
  });
  await update(playersRef, updates);
}

// Submit a player's prompt responses (scrolls)
export async function submitScrolls(round, playerName, responses) {
  await set(getScrollRef(round, playerName), {
    responses,
    submittedAt: Date.now(),
  });
}

// Submit a banishment vote
export async function submitVote(voterName, targetName) {
  await set(getVoteRef(voterName), {
    target: targetName,
    submittedAt: Date.now(),
  });
}

// Submit a murder vote (traitor only)
export async function submitMurderVote(traitorName, targetName) {
  await set(getMurderVoteRef(traitorName), {
    target: targetName,
    submittedAt: Date.now(),
  });
}

// Send a traitor chat message
export async function sendTraitorMessage(senderName, message) {
  const msgRef = push(traitorChatRef);
  await set(msgRef, {
    sender: senderName,
    message,
    timestamp: Date.now(),
  });
}

// Clear votes for new round
export async function clearVotes() {
  await set(votesRef, {});
  await set(murderVotesRef, {});
}

// Clear traitor chat for new round
export async function clearTraitorChat() {
  await set(traitorChatRef, {});
}

// Update a player's status
export async function updatePlayerStatus(name, status) {
  await update(getPlayerRef(name), { status });
}

// Update a player's shield
export async function updatePlayerShield(name, hasShield) {
  await update(getPlayerRef(name), { shield: hasShield });
}

// Update player role (for host manual override or endgame reveal)
export async function updatePlayerRole(name, role) {
  await update(getPlayerRef(name), { role });
}

// Update player photo (base64 data URL)
export async function updatePlayerPhoto(name, photoDataUrl) {
  await update(getPlayerRef(name), { photo: photoDataUrl });
}

// Set murder target
export async function setMurderTarget(target) {
  await update(stateRef, { murderTarget: target });
}

// Start timer
export async function startTimer(durationSeconds) {
  const end = Date.now() + (durationSeconds * 1000);
  await update(stateRef, { timerEnd: end, timerDuration: durationSeconds });
}

// Clear timer
export async function clearTimer() {
  await update(stateRef, { timerEnd: null, timerDuration: null });
}

// Subscribe helpers
export { onValue, ref, db, update, get, set, push };
