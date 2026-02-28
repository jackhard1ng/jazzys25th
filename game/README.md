# The Traitors — Jazzy's Birthday Party Game

A real-time multiplayer party game web app inspired by The Traitors (Peacock TV).
Players are secretly assigned as Faithful or Traitors, then compete through
discussion, anonymous messaging, voting, and secret coordination.

## Quick Start

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add Project** → name it (e.g., "jazzys-traitors") → Create
3. In the project dashboard, click **Build → Realtime Database**
4. Click **Create Database** → choose region → Start in **test mode**
5. Go to **Project Settings** (gear icon) → scroll to **Your apps** → click the web icon (`</>`)
6. Register app (name: "traitors-game") → copy the `firebaseConfig` object

### 2. Add Your Firebase Config

Open `src/firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 3. Set Firebase Security Rules

In Firebase Console → Realtime Database → **Rules** tab, paste:

```json
{
  "rules": {
    "game": {
      ".read": true,
      ".write": true
    }
  }
}
```

> **Note:** These are open rules for a party game. The game is short-lived and
> doesn't store sensitive data. For a production app you'd want authentication.

### 4. Install & Run

```bash
cd game
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.

### 5. Deploy (for the party)

Build and deploy to any static hosting:

```bash
npm run build
```

The `dist/` folder can be deployed to:

- **Netlify:** Drag & drop the `dist` folder at [app.netlify.com](https://app.netlify.com)
- **Vercel:** `npx vercel --prod` from the `game/` directory
- **GitHub Pages:** Push `dist/` contents to a `gh-pages` branch

All players connect to the same URL on their phones.

---

## How to Run on Party Night

### Setup (Before Guests Arrive)

1. Deploy the app and get the URL
2. Open `YOUR_URL/host` on the TV/laptop (this is the **Host Dashboard**)
3. Have the host (Jack) control the dashboard

### Game Flow

1. **Players Join:** Each guest opens the URL on their phone, enters their name
2. **Host Adds Players:** The host checks off who's present from the pre-loaded list
3. **Configure:** Set number of traitors (default 3), timer duration, etc.
4. **Start Game:** Host presses "Start" — all phones simultaneously show role reveals
5. **Night Phase:** Everyone types on their phones (answering prompts). Traitors secretly chat and vote on a murder target.
6. **Murder Reveal:** TV shows who was killed (or if a shield blocked it)
7. **Challenge Round:** Play a drinking game IRL. Host awards a shield to the winner.
8. **Roundtable:** TV displays anonymous messages from night phase. Group discusses.
9. **Banishment Vote:** Everyone votes on their phone. TV reveals results dramatically.
10. **Banishment Reveal:** The banished player verbally reveals their role IRL. Host confirms on dashboard.
11. **Repeat** rounds 5-10 until a win condition is met
12. **Endgame:** All remaining players reveal roles one by one

### Win Conditions

- **Faithful Win:** All traitors have been banished
- **Traitors Win:** Living traitors equal or outnumber living faithful

---

## Game Settings (Configurable by Host)

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Number of Traitors | 3 | 2-5 | How many traitors in the game |
| Night Phase Duration | 150s (2.5min) | 60-240s | Time for night phase prompts |
| Prompts Per Round | 4 | 3-6 | Number of prompts each round |
| Min Character Count | 15 | 10-30 | Minimum characters per response |
| Shields Enabled | Yes | On/Off | Whether the shield system is active |

---

## Architecture

```
/host          → Host Dashboard (TV/laptop screen)
/              → Player Screen (mobile phones)
```

- **Frontend:** React + Vite (single-page app)
- **Backend:** Firebase Realtime Database (free tier, real-time sync)
- **No install required:** Everything runs in the mobile browser

### Key Files

```
src/
├── firebase.js          # Firebase config & database operations
├── prompts.js           # All prompt pools + selection logic
├── hooks/
│   ├── useGame.js       # Main game state subscription hook
│   └── useTimer.js      # Countdown timer hook
├── components/
│   ├── HostDashboard.jsx  # TV/host screen with all controls
│   ├── PlayerScreen.jsx   # Mobile player experience
│   ├── NightPhase.jsx     # Prompt system + traitor chat
│   ├── VotingScreen.jsx   # Banishment voting
│   ├── SpectatorMode.jsx  # Eliminated player view
│   ├── PortraitWall.jsx   # Shield-shaped portrait grid
│   └── Timer.jsx          # Countdown timer display
└── index.css            # All styles (gothic/medieval theme)
```

---

## Troubleshooting

**"Connecting to the realm..." stuck**
- Check that your Firebase config in `src/firebase.js` is correct
- Make sure your Realtime Database is created (not just Firestore)
- Check Firebase Console → Realtime Database → Rules are set to allow read/write

**Players can't join**
- Verify everyone is on the same URL
- Check WiFi connectivity
- Try refreshing the page

**Timer not syncing**
- Firebase uses server timestamps. Ensure all devices have reasonable clock accuracy.
- The timer syncs from Firebase, so minor clock drift is handled.

**Game state is stale / weird**
- The host can press "Reset" in the bottom toolbar to start fresh
- This clears all game data in Firebase

**Too many connections on free tier**
- Firebase free tier allows 100 simultaneous connections
- 25 players + 1 host = 26 connections, well within limits
- If testing with many browser tabs, you may hit the limit

---

## The Anonymous Prompt System (How It Works)

The core mechanic: during night phase, ALL players type on their phones simultaneously.
This provides perfect cover for traitors to secretly communicate.

- **Faithful players** answer 4-5 prompts (mix of game-related and random/fun)
- **Traitors** see the same prompt interface but can skip prompts and access a secret chat tab
- **Game-related responses** get displayed anonymously on the TV during roundtable
- **Fun/random responses** are never shown — they're purely cover activity
- **Players can't tell** which prompts will be read and which won't
- **Minimum character counts** prevent people from just mashing keys

After completing prompts, faithful players get bonus prompts to keep them typing for the full duration. No one can leave the night phase screen early.

---

Happy Birthday Jazzy! 🥂🗡️
