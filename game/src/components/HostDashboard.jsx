import { useState, useMemo, useEffect } from 'react';
import useGame from '../hooks/useGame';
import Timer from './Timer';
import PortraitWall from './PortraitWall';
import PlayerPortrait from './PlayerPortrait';
import { selectPrompts, pickTraitorCount } from '../prompts';
import {
  resetGame, updateGameState, updateGameConfig, assignRoles,
  addPlayer, removePlayer, clearVotes, clearTraitorChat,
  updatePlayerStatus, updatePlayerShield, startTimer, clearTimer,
  set, ref, db, update, get, playersRef, stateRef,
} from '../firebase';

// ============================================================
// PRE-LOADED PLAYER LIST
// ============================================================
const PRESET_PLAYERS = [
  'Jack', 'Isabel', 'Keegan', 'Tatum', 'Sydney', 'Carson', 'Ellie',
  'Chandler', 'Josh', 'Gavin', 'Ryan', 'Bailey', 'Aubrey', 'Aaron',
  'Katie', 'Isabelle', 'Braxton', 'Isaac', 'Gaige', 'Shelley',
  'Gunner', 'Natalia', 'David', 'Hallie', 'Fred',
];

export default function HostDashboard() {
  const {
    players, playerList, alivePlayers,
    gameState, config, scrolls, murderVotes,
    connected,
  } = useGame();

  const { phase, round, timerEnd, murderTarget, banishedPlayer, shieldBlocked, winCondition, paused, rolledTraitorCount } = gameState;

  const [newPlayerName, setNewPlayerName] = useState('');
  const [revealedRoles, setRevealedRoles] = useState({});
  const [usedPrompts, setUsedPrompts] = useState(new Set());
  const [endgameRevealed, setEndgameRevealed] = useState([]);

  // ============================================================
  // ROUNDTABLE GROUPS — one bucket per public prompt, with a SAMPLE
  // of responses (not every player's response). Filler is never shown.
  // Each response = { text, author } where author is null when anonymous.
  // ============================================================
  const MAX_RESPONSES_PER_PROMPT = 6;
  const roundtableGroups = useMemo(() => {
    const roundData = scrolls[round] || {};
    const buckets = new Map(); // promptText → { mode, responses: [{text, author}] }

    Object.entries(roundData).forEach(([authorName, playerScrolls]) => {
      if (!playerScrolls?.responses) return;
      playerScrolls.responses.forEach(r => {
        if (!r || !r.text || !r.text.trim()) return;
        if (r.mode === 'filler') return;
        const promptKey = r.prompt || '(scroll)';
        if (!buckets.has(promptKey)) {
          buckets.set(promptKey, { mode: r.mode, responses: [] });
        }
        const isSigned = r.mode === 'signed' || (r.mode === 'optional' && r.signed);
        buckets.get(promptKey).responses.push({
          text: r.text,
          author: isSigned ? authorName : null,
        });
      });
    });

    // Shuffle + sample inside each bucket. Anonymous responses stay anonymous,
    // and not-everyone's-shown means traitors who skipped don't stick out.
    const groups = Array.from(buckets.entries()).map(([prompt, bucket]) => {
      const shuffled = [...bucket.responses];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const sampled = shuffled.slice(0, MAX_RESPONSES_PER_PROMPT);
      return {
        prompt,
        mode: bucket.mode,
        responses: sampled,
        totalCount: bucket.responses.length,
      };
    });
    // Signed prompts first, then optional
    groups.sort((a, b) => (a.mode === 'signed' ? -1 : 1) - (b.mode === 'signed' ? -1 : 1));
    return groups;
  }, [scrolls, round]);

  // ============================================================
  // GAME PHASE HANDLERS
  // ============================================================

  async function handleResetGame() {
    if (!window.confirm('Reset the entire game? This cannot be undone.')) return;
    setRevealedRoles({});
    setUsedPrompts(new Set());
    setEndgameRevealed([]);
    await resetGame();
  }

  async function handleAddPresetPlayer(name) {
    await addPlayer(name);
  }

  async function handleAddCustomPlayer() {
    if (newPlayerName.trim()) {
      await addPlayer(newPlayerName.trim());
      setNewPlayerName('');
    }
  }

  async function handleRemovePlayer(name) {
    await removePlayer(name);
  }

  async function handleStartGame() {
    const names = playerList.map(p => p.name);
    if (names.length < 5) {
      alert('Need at least 5 players to start.');
      return;
    }

    // Weighted random traitor count: 80% → 4, 15% → 3, 5% → 5
    let count = pickTraitorCount();
    // Safety cap if there aren't enough players for the rolled count
    if (count + 2 > names.length) count = Math.max(2, names.length - 2);

    const shuffled = [...names].sort(() => Math.random() - 0.5);
    const traitorNames = shuffled.slice(0, count);

    await updateGameConfig({ numTraitors: count });
    await assignRoles(traitorNames);
    // Lock the lobby and play the dramatic count reveal on the TV.
    // The traitorReveal phase auto-advances to roleReveal after ~8s.
    await updateGameState({
      phase: 'traitorReveal',
      round: 1,
      rolledTraitorCount: count,
    });
  }

  async function handleStartNight() {
    // Generate prompts for this round
    const prompts = selectPrompts(config.promptsPerRound, usedPrompts);
    const newUsed = new Set(usedPrompts);
    prompts.forEach(p => newUsed.add(p.text));
    setUsedPrompts(newUsed);

    // Store prompts in Firebase so players can read them
    await set(ref(db, 'game/nightPhase'), {
      active: true,
      prompts: prompts.map(p => ({ text: p.text, mode: p.mode })),
    });

    await clearVotes();
    await clearTraitorChat();
    await set(ref(db, 'game/murderVotes'), {});
    await updateGameState({
      phase: 'night',
      murderTarget: null,
      banishedPlayer: null,
      shieldBlocked: false,
    });
    await startTimer(config.nightDuration);
  }

  async function handleEndNight() {
    await clearTimer();
    await set(ref(db, 'game/nightPhase'), { active: false, prompts: [] });

    // Tally traitor murder votes. Ignore votes for shielded or non-alive
    // players in case a shield was awarded after the vote was cast.
    const validNames = new Set(
      alivePlayers.filter(p => !p.shield && p.role !== 'traitor').map(p => p.name)
    );
    const tally = {};
    Object.values(murderVotes).forEach(v => {
      if (v?.target && validNames.has(v.target)) {
        tally[v.target] = (tally[v.target] || 0) + 1;
      }
    });

    let target = null;
    const entries = Object.entries(tally);
    if (entries.length > 0) {
      const maxCount = Math.max(...entries.map(([, c]) => c));
      const tied = entries.filter(([, c]) => c === maxCount).map(([name]) => name);
      // Random tie-break (also handles single-leader as 1-element array).
      target = tied[Math.floor(Math.random() * tied.length)];
    }

    // Store murder target but don't apply yet — murder reveal comes after roundtable
    await updateGameState({
      phase: 'challenge',
      murderTarget: target || null,
      shieldBlocked: false,
    });
  }

  async function handleAdvanceToChallenge() {
    await updateGameState({ phase: 'challenge' });
  }

  async function handleAdvanceToRoundtable() {
    await updateGameState({ phase: 'roundtable' });
  }

  async function handleAdvanceToIRLVote() {
    await updateGameState({ phase: 'irlVote', banishedPlayer: null });
  }

  async function handleSelectBanished(name) {
    if (!name) return;
    await updateGameState({ phase: 'banishmentReveal', banishedPlayer: name });
  }

  async function handleNoBanishment() {
    // Group couldn't agree / paper vote tied with no clear loser. Skip banishment.
    let shieldWasBlocked = false;
    if (murderTarget) {
      const snap = await get(playersRef);
      const targetPlayer = (snap.val() || {})[murderTarget];
      if (targetPlayer?.status === 'alive') {
        if (targetPlayer.shield) {
          await updatePlayerShield(murderTarget, false);
          shieldWasBlocked = true;
        } else {
          await updatePlayerStatus(murderTarget, 'murdered');
        }
      }
    }
    await updateGameState({ phase: 'murderReveal', shieldBlocked: shieldWasBlocked, banishedPlayer: null });
  }

  async function handleConfirmBanishment() {
    const name = banishedPlayer;
    if (!name) return;
    // Auto-detect role from Firebase — host never needs to know
    const snap = await get(playersRef);
    const currentPlayers = snap.val() || {};
    const role = currentPlayers[name]?.role || 'faithful';
    await updatePlayerStatus(name, 'banished');
    setRevealedRoles(prev => ({ ...prev, [name]: role }));

    // Apply the murder now (murder reveal comes after banishment)
    let shieldWasBlocked = false;
    if (murderTarget) {
      const snap = await get(playersRef);
      const currentPlayers = snap.val() || {};
      const targetPlayer = currentPlayers[murderTarget];

      if (targetPlayer?.status === 'alive') {
        if (targetPlayer?.shield) {
          await updatePlayerShield(murderTarget, false);
          shieldWasBlocked = true;
        } else {
          await updatePlayerStatus(murderTarget, 'murdered');
        }
      }
      // If target was just banished, murder doesn't apply
    }

    await updateGameState({ phase: 'murderReveal', shieldBlocked: shieldWasBlocked });
  }

  async function handleNextRound() {
    await updateGameState({ round: round + 1 });
    handleStartNight();
  }

  async function handleAwardShield(playerName) {
    if (playerName) {
      await updatePlayerShield(playerName, true);
    }
  }

  async function handleRemoveShield(playerName) {
    if (playerName) {
      await updatePlayerShield(playerName, false);
    }
  }

  async function handleManualEliminate(playerName, type) {
    await updatePlayerStatus(playerName, type);
  }

  async function handlePause() {
    await updateGameState({ paused: !paused });
  }

  async function handleTriggerEndgame(winner) {
    await updateGameState({ phase: 'endgame', winCondition: winner });
  }

  async function handleEndgameReveal(playerName) {
    const player = players[playerName];
    if (!player) return;
    setEndgameRevealed(prev => [...prev, playerName]);
    setRevealedRoles(prev => ({ ...prev, [playerName]: player.role }));
  }

  // ============================================================
  // TRAITOR REVEAL → ROLE REVEAL auto-advance after animation
  // ============================================================
  useEffect(() => {
    if (phase !== 'traitorReveal') return;
    const t = setTimeout(() => {
      updateGameState({ phase: 'roleReveal' });
    }, 8500); // ~8.5s for the full slot + flicker animation
    return () => clearTimeout(t);
  }, [phase]);

  // ============================================================
  // NIGHT auto-advance when timer expires + 3s grace.
  // Hostless: nobody has to click "End Night."
  // ============================================================
  useEffect(() => {
    if (phase !== 'night' || !timerEnd) return;
    const remaining = timerEnd - Date.now();
    const t = setTimeout(() => {
      if (typeof handleEndNight === 'function') handleEndNight();
    }, Math.max(0, remaining) + 3000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timerEnd]);

  // ============================================================
  // ADVANCE AFTER MURDER REVEAL — check win conditions
  // ============================================================
  async function handleAdvanceAfterMurder() {
    const snap = await get(playersRef);
    const updatedPlayers = snap.val() || {};
    const alive = Object.values(updatedPlayers).filter(p => p.status === 'alive');
    const aliveT = alive.filter(p => p.role === 'traitor');
    const aliveF = alive.filter(p => p.role === 'faithful');

    if (aliveT.length === 0) {
      await updateGameState({ phase: 'endgame', winCondition: 'faithful' });
    } else if (aliveT.length >= aliveF.length) {
      await updateGameState({ phase: 'endgame', winCondition: 'traitors' });
    } else {
      await updateGameState({ phase: 'lobby_between_rounds' });
    }
  }

  // ============================================================
  // RENDER
  // ============================================================

  // Not connected yet
  if (!connected) {
    return (
      <div className="tv-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="cinematic-text">Connecting to the realm...</div>
      </div>
    );
  }

  return (
    <div className="tv-layout">
      {/* HEADER */}
      <div className="tv-title">The Traitors</div>
      <div className="tv-subtitle" style={{ marginBottom: 10 }}>
        Jazzy's Birthday — {phase === 'lobby' ? 'Waiting for Players' : `Round ${round}`}
      </div>

      {/* PAUSE INDICATOR */}
      {paused && (
        <div style={{ textAlign: 'center', padding: 10, background: 'rgba(212,175,55,0.2)', borderRadius: 8, margin: '10px 0' }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', color: 'var(--gold)', letterSpacing: 2 }}>⏸ GAME PAUSED</span>
        </div>
      )}

      {/* TIMER */}
      <Timer timerEnd={timerEnd} />

      {/* ============================================================
          LOBBY PHASE
          ============================================================ */}
      {phase === 'lobby' && (
        <div className="fade-in">
          <div className="panel" style={{ margin: '20px 0' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 15, letterSpacing: 2 }}>
              GAME SETUP
            </h2>

            {/* Preset player buttons */}
            <div style={{ marginBottom: 15 }}>
              <label style={{ fontFamily: 'var(--font-heading)', fontSize: '0.85rem', color: 'var(--text-dim)', letterSpacing: 1 }}>
                ADD PLAYERS FROM LIST:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {PRESET_PLAYERS.map(name => {
                  const inGame = !!players[name];
                  return (
                    <button
                      key={name}
                      className={`btn btn-sm ${inGame ? 'btn-gold' : 'btn-dark'}`}
                      onClick={() => inGame ? handleRemovePlayer(name) : handleAddPresetPlayer(name)}
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                    >
                      {inGame ? '✓ ' : ''}{name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Add custom player */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
              <input
                className="input"
                placeholder="Add custom player name..."
                value={newPlayerName}
                onChange={e => setNewPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCustomPlayer()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-dark btn-sm" onClick={handleAddCustomPlayer}>Add</button>
            </div>

            {/* Connected players */}
            <div style={{ marginBottom: 15 }}>
              <label style={{ fontFamily: 'var(--font-heading)', fontSize: '0.85rem', color: 'var(--text-dim)', letterSpacing: 1 }}>
                PLAYERS IN GAME ({playerList.length}):
              </label>
              <div className="player-list">
                {playerList.map(p => (
                  <div key={p.name} className="player-chip">
                    <span className="dot" />
                    {p.name}
                    <button className="remove-btn" onClick={() => handleRemovePlayer(p.name)}>×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Config */}
            <div className="config-grid" style={{ marginBottom: 20 }}>
              <div className="config-item" style={{ gridColumn: 'span 1' }}>
                <label>Number of Traitors</label>
                <div style={{
                  padding: '10px 12px',
                  background: 'var(--dark-gray)',
                  border: '1px solid var(--stone)',
                  borderRadius: 6,
                  color: 'var(--gold)',
                  fontFamily: 'var(--font-heading)',
                  letterSpacing: 2,
                  fontSize: '0.85rem',
                  textAlign: 'center',
                }}>
                  ⚄ RANDOM
                </div>
              </div>
              <div className="config-item">
                <label>Night Phase Duration (sec)</label>
                <input
                  type="number"
                  className="number-input"
                  min={60} max={240}
                  value={config.nightDuration}
                  onChange={e => updateGameConfig({ nightDuration: parseInt(e.target.value) || 150 })}
                />
              </div>
              <div className="config-item">
                <label>Prompts Per Round</label>
                <input
                  type="number"
                  className="number-input"
                  min={3} max={6}
                  value={config.promptsPerRound}
                  onChange={e => updateGameConfig({ promptsPerRound: parseInt(e.target.value) || 4 })}
                />
              </div>
              <div className="config-item">
                <label>Min Characters Per Response</label>
                <input
                  type="number"
                  className="number-input"
                  min={10} max={30}
                  value={config.minCharCount}
                  onChange={e => updateGameConfig({ minCharCount: parseInt(e.target.value) || 15 })}
                />
              </div>
            </div>

            {/* Hostless game info */}
            <div style={{
              marginBottom: 20, padding: 12, background: 'var(--dark-gray)', borderRadius: 8,
              textAlign: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: '0.8rem', color: 'var(--text-dim)', letterSpacing: 1 }}>
                No host needed — everyone plays. The lobby locks when the game begins.
              </span>
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleStartGame}
              disabled={playerList.length < 5}
              style={{ width: '100%' }}
            >
              Begin the Game ({playerList.length} players)
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          TRAITOR REVEAL — slot-machine count + portrait flicker
          ============================================================ */}
      {phase === 'traitorReveal' && (
        <TraitorRevealAnimation count={rolledTraitorCount} players={players} />
      )}

      {/* ============================================================
          ROLE REVEAL PHASE
          ============================================================ */}
      {phase === 'roleReveal' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div className="cinematic-overlay" style={{ position: 'relative', background: 'transparent', minHeight: 300 }}>
            <div className="cinematic-text">Roles have been assigned...</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.3rem', color: 'var(--text-dim)', margin: '20px 0' }}>
              All players: check your phones now.
            </p>
            <button className="btn btn-primary btn-lg" onClick={handleStartNight} style={{ marginTop: 20 }}>
              Begin Night Phase
            </button>
          </div>
          <PortraitWall players={players} />
        </div>
      )}

      {/* ============================================================
          NIGHT PHASE
          ============================================================ */}
      {phase === 'night' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', margin: '20px 0' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--crimson-light)', letterSpacing: 4, marginBottom: 10 }}>
              Night Has Fallen
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '1.2rem' }}>All players are writing their scrolls...</p>

            {/* Active player count */}
            <div style={{ margin: '15px 0', fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2 }}>
              {alivePlayers.length}/{alivePlayers.length} PLAYERS ACTIVE
            </div>

          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleEndNight}>
              End Night Phase
            </button>
            <button className="btn btn-dark" onClick={handlePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          MURDER REVEAL
          ============================================================ */}
      {phase === 'murderReveal' && (
        <div className="fade-in">
          {shieldBlocked ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '2.5rem',
                color: 'var(--gold)',
                letterSpacing: 4,
                animation: 'shieldBlock 1s ease, candleFlicker 3s infinite',
                marginBottom: 20,
              }}>
                A SHIELD HAS BEEN PLAYED
              </div>
              <div style={{ fontSize: '1.5rem', color: 'var(--text)', margin: '20px 0' }}>
                The traitors targeted <strong style={{ color: 'var(--gold)' }}>{murderTarget}</strong>
              </div>
              <div style={{ fontSize: '1.3rem', color: 'var(--gold)' }}>
                No one was murdered.
              </div>
            </div>
          ) : murderTarget && players[murderTarget]?.status === 'banished' ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.8rem',
                color: 'var(--text-dim)',
                letterSpacing: 4,
                marginBottom: 30,
              }}>
                The traitors targeted...
              </div>
              <div className="cinematic-name">{murderTarget}</div>
              <div style={{ fontSize: '1.3rem', color: 'var(--gold)', marginTop: 15 }}>
                But they were already banished.
              </div>
            </div>
          ) : murderTarget ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.8rem',
                color: 'var(--text-dim)',
                letterSpacing: 4,
                marginBottom: 30,
              }}>
                The traitors have struck...
              </div>
              <div className="cinematic-name">{murderTarget}</div>
              <div style={{ fontSize: '1.5rem', color: 'var(--crimson-light)', marginTop: 10 }}>
                has been murdered.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--text-dim)', letterSpacing: 4 }}>
                The traitors could not agree...
              </div>
              <div style={{ fontSize: '1.3rem', color: 'var(--gold)', marginTop: 15 }}>
                No one was murdered.
              </div>
            </div>
          )}

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-lg" onClick={handleAdvanceAfterMurder}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          CHALLENGE ROUND
          ============================================================ */}
      {phase === 'challenge' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            color: 'var(--gold)',
            letterSpacing: 4,
            animation: 'candleFlicker 3s infinite',
            margin: '30px 0',
          }}>
            CHALLENGE ROUND
          </div>
          <p style={{ fontSize: '1.3rem', color: 'var(--text-dim)', marginBottom: 30 }}>
            The winner earns a shield — protection from murder for one night.
          </p>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="panel" style={{ maxWidth: 720, margin: '20px auto' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 4, letterSpacing: 2, textAlign: 'center' }}>
              AWARD A SHIELD
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 14, textAlign: 'center' }}>
              Tap the drinking-game winner. Shielded players are protected from murder tonight and won't appear in the traitors' target list.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  className={`btn ${p.shield ? 'btn-gold' : 'btn-dark'}`}
                  onClick={() => p.shield ? handleRemoveShield(p.name) : handleAwardShield(p.name)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 12px',
                    minWidth: 100,
                  }}
                  title={p.shield ? 'Tap to remove shield' : 'Tap to award shield'}
                >
                  <PlayerPortrait name={p.name} photo={p.photo} size={64} glow={p.shield} />
                  <span style={{ fontSize: '0.8rem', letterSpacing: 1 }}>
                    {p.shield ? '🛡️ ' : ''}{p.name}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
              Tapping a shielded player removes the shield (in case you tapped the wrong person).
            </p>
          </div>

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleAdvanceToRoundtable}>
              Proceed to Roundtable
            </button>
            <button className="btn btn-dark" onClick={handleAdvanceToRoundtable}>
              Skip Challenge
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          ROUNDTABLE — ALL SIGNED + OPTIONAL RESPONSES ON THE TV
          (Discussion happens IRL while everyone reads.)
          ============================================================ */}
      {phase === 'roundtable' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              color: 'var(--gold)',
              letterSpacing: 4,
              animation: 'candleFlicker 3s infinite',
            }}>
              THE ROUNDTABLE
            </div>
            <p style={{ color: 'var(--text-dim)', marginTop: 5 }}>
              Read. Discuss. Accuse. (Vote on paper when you're ready.)
            </p>
          </div>

          {roundtableGroups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, fontFamily: 'var(--font-heading)', color: 'var(--text-dim)' }}>
              No public scrolls this round.
            </div>
          ) : (
            roundtableGroups.map((group, idx) => (
              <div key={idx} className="panel" style={{ margin: '20px 0' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}>
                  <div style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '0.75rem',
                    color: group.mode === 'signed' ? 'var(--gold)' : 'var(--crimson-light)',
                    letterSpacing: 2,
                  }}>
                    {group.mode === 'signed' ? 'SIGNED SCROLLS' : 'ANONYMOUS-OPTIONAL SCROLLS'}
                  </div>
                  {group.totalCount > group.responses.length && (
                    <div style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.7rem',
                      color: 'var(--text-dim)',
                      letterSpacing: 1.5,
                    }}>
                      A SAMPLE OF {group.responses.length} / {group.totalCount}
                    </div>
                  )}
                </div>
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontStyle: 'italic',
                  fontSize: '1.15rem',
                  color: 'var(--gold)',
                  marginBottom: 14,
                }}>
                  "{group.prompt}"
                </div>
                {group.responses.map((r, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    margin: '8px 0',
                    background: 'rgba(0,0,0,0.3)',
                    borderLeft: `3px solid ${r.author ? 'var(--gold)' : 'var(--stone-light, #555)'}`,
                    borderRadius: 4,
                  }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '1.05rem', color: 'var(--text)', lineHeight: 1.4 }}>
                      {r.text}
                    </div>
                    <div style={{
                      marginTop: 6,
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.7rem',
                      letterSpacing: 2,
                      color: r.author ? 'var(--gold)' : 'var(--text-dim)',
                    }}>
                      — {r.author || 'ANONYMOUS'}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-lg" onClick={handleAdvanceToIRLVote}>
              Begin Banishment Vote (Paper)
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          IRL PAPER VOTE — tap whoever the room banished
          ============================================================ */}
      {phase === 'irlVote' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              color: 'var(--crimson-light)',
              letterSpacing: 4,
            }}>
              CAST YOUR VOTES ON PAPER
            </div>
            <p style={{ color: 'var(--text-dim)', marginTop: 8, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              Write your banishment vote on a slip. When the room has agreed, tap the banished player below.
            </p>
          </div>

          <div className="panel" style={{ maxWidth: 880, margin: '20px auto' }}>
            <h3 style={{
              fontFamily: 'var(--font-heading)',
              color: 'var(--gold)',
              fontSize: '0.9rem',
              letterSpacing: 2,
              marginBottom: 12,
              textAlign: 'center',
            }}>
              WHO HAS BEEN BANISHED?
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  className="btn btn-dark"
                  onClick={() => handleSelectBanished(p.name)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 14px',
                    minWidth: 110,
                  }}
                >
                  <PlayerPortrait name={p.name} photo={p.photo} size={72} />
                  <span style={{ fontSize: '0.85rem', letterSpacing: 1 }}>{p.name}</span>
                </button>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-sm btn-dark" onClick={handleNoBanishment}>
                No banishment this round
              </button>
            </div>
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />
        </div>
      )}

      {/* ============================================================
          BANISHMENT REVEAL — paper vote already chosen, dramatic role reveal
          ============================================================ */}
      {phase === 'banishmentReveal' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              color: 'var(--text-dim)',
              letterSpacing: 3,
              marginBottom: 10,
            }}>
              THE VOTES ARE IN
            </div>
          </div>

          {banishedPlayer && (
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div className="cinematic-name" style={{ fontSize: '3rem' }}>
                {banishedPlayer}
              </div>
              <div style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.5rem',
                color: 'var(--text)',
                letterSpacing: 3,
                marginBottom: 20,
              }}>
                YOU HAVE BEEN BANISHED
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.3rem',
                color: 'var(--gold)',
                letterSpacing: 3,
                marginBottom: 30,
              }}>
                REVEAL YOUR LOYALTY
              </div>

              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleConfirmBanishment()}
              >
                Reveal Role
              </button>
            </div>
          )}

          <PortraitWall players={players} revealedRoles={revealedRoles} />
        </div>
      )}

      {/* ============================================================
          BETWEEN ROUNDS
          ============================================================ */}
      {phase === 'lobby_between_rounds' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div style={{ margin: '30px 0' }}>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-dim)', fontSize: '1.2rem', letterSpacing: 2, marginBottom: 5 }}>
              Round {round} Complete
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2 }}>
              {alivePlayers.length} players remain
            </div>
          </div>

          <div className="host-controls">
            <button className="btn btn-primary btn-lg" onClick={handleNextRound}>
              Begin Round {round + 1}
            </button>
            <button className="btn btn-dark" onClick={() => handleTriggerEndgame('faithful')}>
              Faithful Win (Manual)
            </button>
            <button className="btn btn-dark" onClick={() => handleTriggerEndgame('traitors')}>
              Traitors Win (Manual)
            </button>
          </div>

          {/* Shield management */}
          <div className="panel" style={{ maxWidth: 500, margin: '20px auto' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 10, letterSpacing: 2, fontSize: '0.9rem' }}>
              SHIELD MANAGEMENT
            </h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  className={`btn btn-sm ${p.shield ? 'btn-gold' : 'btn-dark'}`}
                  onClick={() => p.shield ? handleRemoveShield(p.name) : handleAwardShield(p.name)}
                  style={{ fontSize: '0.75rem' }}
                >
                  {p.shield ? '🛡️ ' : ''}{p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          ENDGAME
          ============================================================ */}
      {phase === 'endgame' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            color: 'var(--gold)',
            letterSpacing: 6,
            animation: 'candleFlicker 3s infinite',
            margin: '20px 0',
          }}>
            THE GAME IS OVER
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.5rem',
            color: 'var(--text-dim)',
            letterSpacing: 4,
            margin: '20px 0',
          }}>
            THE TRUTH WILL NOW BE REVEALED
          </div>

          {/* Reveal buttons for each living player */}
          <div style={{ margin: '20px 0' }}>
            <p style={{ color: 'var(--text-dim)', marginBottom: 15, fontFamily: 'var(--font-heading)', letterSpacing: 1 }}>
              Tap each player to reveal their role:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {alivePlayers.map(p => {
                const isRevealed = endgameRevealed.includes(p.name);
                return (
                  <button
                    key={p.name}
                    className={`btn ${isRevealed
                      ? (p.role === 'traitor' ? 'btn-primary' : 'btn-gold')
                      : 'btn-dark'}`}
                    onClick={() => handleEndgameReveal(p.name)}
                    disabled={isRevealed}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px 12px',
                      minWidth: 110,
                    }}
                  >
                    <PlayerPortrait name={p.name} photo={p.photo} size={64} />
                    <span style={{ fontSize: '0.8rem', letterSpacing: 1 }}>
                      {isRevealed ? (p.role === 'traitor' ? '🗡️ ' : '✨ ') : ''}{p.name}
                    </span>
                    {isRevealed && (
                      <span style={{ fontSize: '0.7rem', letterSpacing: 2 }}>
                        {p.role.toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          {/* Win announcement */}
          {endgameRevealed.length === alivePlayers.length && (
            <div style={{ margin: '30px 0', animation: 'fadeInUp 1s ease' }}>
              {winCondition === 'faithful' ? (
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2rem',
                  color: 'var(--gold)',
                  letterSpacing: 4,
                  animation: 'candleFlicker 3s infinite',
                }}>
                  The Faithful Have Prevailed.
                </div>
              ) : (
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2rem',
                  color: 'var(--crimson-light)',
                  letterSpacing: 4,
                  textShadow: '0 0 20px rgba(139,0,0,0.6)',
                }}>
                  The Traitors Have Taken Control.
                </div>
              )}
            </div>
          )}

          {/* Game stats */}
          <div className="endgame-stats" style={{ maxWidth: 500, margin: '20px auto' }}>
            <div className="stat-box">
              <div className="number">{round}</div>
              <div className="label">Rounds</div>
            </div>
            <div className="stat-box">
              <div className="number">{playerList.filter(p => p.status === 'murdered').length}</div>
              <div className="label">Murdered</div>
            </div>
            <div className="stat-box">
              <div className="number">{playerList.filter(p => p.status === 'banished' && p.role === 'traitor').length}</div>
              <div className="label">Traitors Caught</div>
            </div>
            <div className="stat-box">
              <div className="number">{playerList.length}</div>
              <div className="label">Total Players</div>
            </div>
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.8rem',
            color: 'var(--gold)',
            letterSpacing: 4,
            margin: '30px 0',
            animation: 'candleFlicker 3s infinite',
          }}>
            Happy Birthday Jazzy! 🥂
          </div>

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-dark" onClick={handleResetGame}>
              New Game
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          HOST TOOLBAR (always visible during active game)
          ============================================================ */}
      {phase !== 'lobby' && phase !== 'endgame' && (
        <div className="panel" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          borderRadius: '8px 8px 0 0',
          display: 'flex', gap: 8, flexWrap: 'wrap',
          padding: '10px 15px',
          background: 'rgba(26,26,26,0.95)',
          backdropFilter: 'blur(10px)',
          zIndex: 50,
        }}>
          <span style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '0.7rem',
            color: 'var(--gold)',
            letterSpacing: 1,
            alignSelf: 'center',
          }}>
            {alivePlayers.length} players alive
          </span>
          <button className="btn btn-sm btn-dark" onClick={handlePause}>
            {paused ? '▶' : '⏸'}
          </button>
          <button className="btn btn-sm btn-dark" onClick={handleResetGame}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TRAITOR REVEAL ANIMATION
// 1. Slot-machine of 3/4/5 spinning, locks on the rolled count.
// 2. Portrait flicker — random highlights, never resolving (mystery preserved).
// 3. "Check your phones" prompt before auto-advancing to roleReveal.
// ============================================================
function TraitorRevealAnimation({ count, players }) {
  const [stage, setStage] = useState('spinning');
  const [displayNum, setDisplayNum] = useState(3);
  const [flickerIdx, setFlickerIdx] = useState(0);
  const playerNames = Object.keys(players || {});

  // Stage 1: spin numbers for ~2.5s, then lock
  useEffect(() => {
    if (stage !== 'spinning') return;
    let i = 0;
    const id = setInterval(() => {
      setDisplayNum([3, 4, 5][i % 3]);
      i++;
    }, 80);
    const stopAt = setTimeout(() => {
      clearInterval(id);
      setDisplayNum(count);
      setStage('locked');
    }, 2500);
    return () => { clearInterval(id); clearTimeout(stopAt); };
  }, [stage, count]);

  // Stage 2: after lock pause, do portrait flicker for ~3.5s
  useEffect(() => {
    if (stage !== 'locked') return;
    const start = setTimeout(() => setStage('flickering'), 1200);
    return () => clearTimeout(start);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'flickering') return;
    const id = setInterval(() => {
      setFlickerIdx(Math.floor(Math.random() * Math.max(1, playerNames.length)));
    }, 90);
    const stopAt = setTimeout(() => {
      clearInterval(id);
      setStage('checkPhones');
    }, 3500);
    return () => { clearInterval(id); clearTimeout(stopAt); };
  }, [stage, playerNames.length]);

  return (
    <div className="fade-in" style={{ textAlign: 'center', padding: '40px 20px', minHeight: 400 }}>
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1rem',
        color: 'var(--text-dim)',
        letterSpacing: 4,
        marginBottom: 30,
      }}>
        AMONG YOU WALK…
      </div>

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(6rem, 22vw, 14rem)',
        color: stage === 'spinning' ? 'var(--text-dim)' : 'var(--crimson-light)',
        letterSpacing: 4,
        textShadow: stage !== 'spinning' ? '0 0 60px rgba(220,20,60,0.8), 0 0 120px rgba(139,0,0,0.5)' : 'none',
        transition: 'color 0.6s, text-shadow 0.6s',
        lineHeight: 1,
        animation: stage === 'locked' || stage === 'flickering' ? 'candleFlicker 3s infinite' : 'none',
      }}>
        {displayNum}
      </div>

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(1.2rem, 3vw, 2rem)',
        color: 'var(--crimson-light)',
        letterSpacing: 6,
        marginTop: 20,
        opacity: stage === 'spinning' ? 0.4 : 1,
        transition: 'opacity 0.6s',
      }}>
        TRAITORS
      </div>

      {(stage === 'flickering' || stage === 'checkPhones') && playerNames.length > 0 && (
        <div style={{
          marginTop: 40,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'center',
          maxWidth: 720,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          {playerNames.map((name, i) => {
            const isLit = stage === 'flickering' && i === flickerIdx;
            return (
              <div
                key={name}
                style={{
                  padding: '6px 14px',
                  background: isLit ? 'rgba(220,20,60,0.4)' : 'rgba(0,0,0,0.4)',
                  border: `1px solid ${isLit ? 'var(--crimson-light)' : 'var(--stone)'}`,
                  borderRadius: 6,
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.85rem',
                  letterSpacing: 1.5,
                  color: isLit ? 'var(--crimson-light)' : 'var(--text-dim)',
                  boxShadow: isLit ? '0 0 20px rgba(220,20,60,0.6)' : 'none',
                  transition: 'background 0.05s, color 0.05s, box-shadow 0.05s',
                }}
              >
                {name}
              </div>
            );
          })}
        </div>
      )}

      {stage === 'checkPhones' && (
        <div className="fade-in" style={{
          marginTop: 50,
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(1.4rem, 3vw, 2rem)',
          color: 'var(--gold)',
          letterSpacing: 4,
          animation: 'candleFlicker 3s infinite',
        }}>
          CHECK YOUR PHONES
        </div>
      )}
    </div>
  );
}
