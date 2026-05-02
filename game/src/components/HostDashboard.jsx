import { useState, useMemo, useEffect } from 'react';
import useGame from '../hooks/useGame';
import Timer from './Timer';
import PortraitWall from './PortraitWall';
import PlayerPortrait from './PlayerPortrait';
import { PRESET_PLAYERS } from '../presetPlayers';
import { selectPrompts, pickTraitorCount } from '../prompts';
import {
  resetGame, updateGameState, updateGameConfig, assignRoles,
  addPlayer, removePlayer, clearVotes, clearTraitorChat,
  updatePlayerStatus, updatePlayerShield, startTimer, clearTimer,
  set, ref, db, update, get, playersRef, stateRef,
} from '../firebase';

export default function HostDashboard() {
  const {
    players, playerList, alivePlayers,
    gameState, config, scrolls, murderVotes,
    connected,
  } = useGame();

  const { phase, round, timerEnd, murderTarget, banishedPlayer, shieldBlocked, winCondition, rolledTraitorCount, paused } = gameState;

  const [newPlayerName, setNewPlayerName] = useState('');
  const [revealedRoles, setRevealedRoles] = useState({});
  const [usedPrompts, setUsedPrompts] = useState(new Set());
  const [endgameRevealed, setEndgameRevealed] = useState([]);
  // Two-stage murder reveal: PRESS TO REVEAL → animation
  const [murderRevealed, setMurderRevealed] = useState(false);
  useEffect(() => {
    if (phase !== 'murderReveal') setMurderRevealed(false);
  }, [phase]);
  // Round 3 has TWO missions back-to-back. Track which one we're on.
  const [missionStage, setMissionStage] = useState(1);
  useEffect(() => {
    if (phase !== 'challenge') setMissionStage(1);
  }, [phase, round]);

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

  // Soft reset: clears game state (roles, votes, scrolls, etc.) but KEEPS the
  // current roster of players logged in so they don't have to rejoin.
  async function handleResetGame() {
    if (!window.confirm('Reset to the lobby? Players stay joined; their roles, votes, and round progress are cleared.')) return;
    setRevealedRoles({});
    setUsedPrompts(new Set());
    setEndgameRevealed([]);
    await resetGame();
  }

  // Hard reset: also removes every player. Only use if starting completely fresh.
  async function handleWipeGame() {
    if (!window.confirm('FULL WIPE: this will also remove every player from the game. Continue?')) return;
    setRevealedRoles({});
    setUsedPrompts(new Set());
    setEndgameRevealed([]);
    await resetGame({ wipePlayers: true });
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

    // Player-count-aware traitor pick. Prevents the "7 players, 4
    // traitors, game ends after round 1 at parity" disaster.
    let count = pickTraitorCount(names.length);
    // Hard safety cap: traitors must always be strictly fewer than
    // (faithful - 1) so the faithful have at least one banishment
    // of margin before parity ends the game.
    const maxAllowed = Math.max(1, Math.floor((names.length - 1) / 2));
    if (count > maxAllowed) count = maxAllowed;

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

  // Step 1 of banishment: just reveal the role on the screen.
  // Player gets marked banished in DB, role pops in revealedRoles.
  // Phase stays on banishmentReveal so the room can savor the moment.
  async function handleConfirmBanishment() {
    const name = banishedPlayer;
    if (!name) return;
    const snap = await get(playersRef);
    const currentPlayers = snap.val() || {};
    const role = currentPlayers[name]?.role || 'faithful';
    await updatePlayerStatus(name, 'banished');
    setRevealedRoles(prev => ({ ...prev, [name]: role }));
  }

  // Step 2 of banishment: apply the murder + advance to murder reveal.
  // Round 7+: no murder, loop back to roundtable for the next banishment.
  async function handleContinueAfterBanishment() {
    if (round >= 7) {
      // Round 7+ is sequential banishments only — no murder.
      // Check end-of-game first; otherwise return to roundtable for the next banishment cycle.
      const snap = await get(playersRef);
      const alive = Object.values(snap.val() || {}).filter(p => p.status === 'alive');
      const aliveT = alive.filter(p => p.role === 'traitor');
      const aliveF = alive.filter(p => p.role === 'faithful');
      if (aliveT.length === 0) {
        await updateGameState({ phase: 'endgame', winCondition: 'faithful' });
      } else if (aliveT.length >= aliveF.length) {
        await updateGameState({ phase: 'endgame', winCondition: 'traitors' });
      } else if (alive.length <= 2) {
        // 2 left and the room hasn't manually ended → auto-end. Traitors
        // win at parity; otherwise faithful win (no traitor remaining).
        await updateGameState({
          phase: 'endgame',
          winCondition: aliveT.length > 0 ? 'traitors' : 'faithful',
        });
      } else {
        await updateGameState({ phase: 'roundtable', banishedPlayer: null });
      }
      return;
    }

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
    const next = round + 1;
    await updateGameState({ round: next });
    if (next >= 7) {
      // Final phase: skip night entirely, go straight to challenge.
      // No more murders from here on; only sequential banishments.
      await updateGameState({ phase: 'challenge', murderTarget: null });
    } else {
      handleStartNight();
    }
  }

  // Manual "the room agrees to end the game" button for round 7.
  // Win condition follows the show: any traitor still alive → traitors win.
  async function handlePlayersEndGame() {
    if (!window.confirm('End the game now? The remaining players choose to stop banishing.')) return;
    const snap = await get(playersRef);
    const alive = Object.values(snap.val() || {}).filter(p => p.status === 'alive');
    const aliveT = alive.filter(p => p.role === 'traitor');
    const winner = aliveT.length > 0 ? 'traitors' : 'faithful';
    await updateGameState({ phase: 'endgame', winCondition: winner });
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
  // PAUSE — actually pauses the night auto-end and shifts the timer
  // forward by however long we were paused. So "Pause" + "Resume"
  // gives the room a real breather without the timer ticking.
  // ============================================================
  async function handlePause() {
    if (!paused) {
      await updateGameState({ paused: true, pausedAt: Date.now() });
    } else {
      const pausedDur = gameState.pausedAt ? Date.now() - gameState.pausedAt : 0;
      const updates = { paused: false, pausedAt: null };
      if (timerEnd && pausedDur > 0) {
        updates.timerEnd = timerEnd + pausedDur;
      }
      await updateGameState(updates);
    }
  }

  // ============================================================
  // NIGHT auto-advance when timer expires + 3s grace.
  // Hostless: nobody has to click "End Night."
  // Pausing the game blocks this — perfect for "give the traitors
  // another minute" moments.
  // ============================================================
  useEffect(() => {
    if (phase !== 'night' || !timerEnd) return;
    if (paused) return; // pause halts the auto-end
    const remaining = timerEnd - Date.now();
    const t = setTimeout(() => {
      if (typeof handleEndNight === 'function') handleEndNight();
    }, Math.max(0, remaining) + 3000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timerEnd, paused]);

  // ============================================================
  // ADVANCE AFTER MURDER REVEAL — check win conditions / recruitment
  //   - 0 traitors → faithful win
  //   - traitor parity → traitors win
  //   - 1 traitor left at end of rounds 1-6 → recruitment phase
  //   - otherwise next round
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
    } else if (aliveT.length === 1 && round >= 1 && round <= 6) {
      // Lone traitor recruits a faithful before round (round+1) starts
      await updateGameState({ phase: 'recruitment', recruitedPlayer: null });
    } else {
      await updateGameState({ phase: 'lobby_between_rounds' });
    }
  }

  // ============================================================
  // RECRUITMENT auto-advance — once the lone traitor picks, give the
  // dramatic phone animation a few seconds, then continue.
  // ============================================================
  useEffect(() => {
    if (phase !== 'recruitment') return;
    if (!gameState.recruitedPlayer) return;
    const t = setTimeout(() => {
      updateGameState({ phase: 'lobby_between_rounds', recruitedPlayer: null });
    }, 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gameState.recruitedPlayer]);

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
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleEndNight}>
              End Night Phase
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          MURDER REVEAL
          Two stages — click to reveal so the room can hold the moment.
          ============================================================ */}
      {phase === 'murderReveal' && !murderRevealed && (
        <div className="fade-in" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
            color: 'var(--text-dim)',
            letterSpacing: 4,
            marginBottom: 14,
            animation: 'candleFlicker 3s infinite',
          }}>
            THE NIGHT HAS ENDED
          </div>
          <p style={{ color: 'var(--gold-pale, #f0d080)', fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.2rem', marginBottom: 36 }}>
            The traitors have made their choice.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => setMurderRevealed(true)}
            style={{
              fontSize: '1.1rem',
              padding: '14px 36px',
              letterSpacing: 3,
            }}
          >
            🗡️ Reveal the Victim
          </button>
        </div>
      )}

      {phase === 'murderReveal' && murderRevealed && (
        <div className="fade-in">
          {shieldBlocked ? (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2rem, 5vw, 3rem)',
                color: 'var(--gold)',
                letterSpacing: 4,
                animation: 'shieldBlock 1s ease, candleFlicker 3s infinite',
                marginBottom: 20,
              }}>
                A SHIELD HAS BEEN PLAYED
              </div>
              {murderTarget && (
                <div style={{ position: 'relative', display: 'inline-block', margin: '0 auto 20px' }}>
                  <PlayerPortrait name={murderTarget} photo={players[murderTarget]?.photo} width={220} glow />
                  <div style={{
                    position: 'absolute',
                    top: -10,
                    right: -10,
                    fontSize: '3rem',
                    filter: 'drop-shadow(0 0 14px rgba(218,165,32,1))',
                  }}>🛡️</div>
                </div>
              )}
              <div style={{ fontSize: '1.4rem', color: 'var(--text)', margin: '14px 0' }}>
                The traitors targeted <strong style={{ color: 'var(--gold)' }}>{murderTarget}</strong>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: 3 }}>
                BUT THE SHIELD HELD.
              </div>
            </div>
          ) : murderTarget && players[murderTarget]?.status === 'banished' ? (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.8rem',
                color: 'var(--text-dim)',
                letterSpacing: 4,
                marginBottom: 24,
              }}>
                The traitors targeted...
              </div>
              <div style={{ display: 'inline-block', margin: '0 auto 14px' }}>
                <PlayerPortrait name={murderTarget} photo={players[murderTarget]?.photo} width={220} faded />
              </div>
              <div className="cinematic-name">{murderTarget}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--gold)', marginTop: 14, letterSpacing: 3 }}>
                BUT THEY WERE ALREADY BANISHED.
              </div>
            </div>
          ) : murderTarget ? (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.8rem',
                color: 'var(--text-dim)',
                letterSpacing: 4,
                marginBottom: 24,
              }}>
                The traitors have struck…
              </div>
              <div style={{ position: 'relative', display: 'inline-block', margin: '0 auto 16px' }}>
                <PlayerPortrait
                  name={murderTarget}
                  photo={players[murderTarget]?.photo}
                  width={260}
                  faded
                  border="3px solid var(--crimson-light)"
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '6rem',
                  transform: 'rotate(-22deg)',
                  filter: 'drop-shadow(0 0 18px rgba(139,0,0,0.95))',
                  pointerEvents: 'none',
                }}>🗡️</div>
              </div>
              <div className="cinematic-name" style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2rem, 6vw, 3.4rem)',
                color: 'var(--crimson-light)',
                textShadow: '0 0 30px rgba(139,0,0,0.8)',
                letterSpacing: 4,
              }}>
                {murderTarget}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.6rem',
                color: 'var(--crimson-light)',
                marginTop: 10,
                letterSpacing: 3,
              }}>
                HAS BEEN MURDERED.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--text-dim)', letterSpacing: 4 }}>
                The traitors could not agree…
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--gold)', marginTop: 15, letterSpacing: 3 }}>
                NO ONE WAS MURDERED.
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
            {round === 3 ? `MISSION ${missionStage} OF 2` : 'CHALLENGE ROUND'}
          </div>
          <p style={{ fontSize: '1.3rem', color: 'var(--text-dim)', marginBottom: 30 }}>
            {round === 3 && missionStage === 1
              ? 'The first mission. Award a shield to the winner — then run a second mission.'
              : round === 3 && missionStage === 2
              ? 'The second mission. Award another shield to a different winner.'
              : 'The winner earns a shield — protection from murder for one night.'}
          </p>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="panel" style={{ maxWidth: 720, margin: '20px auto' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 4, letterSpacing: 2, textAlign: 'center' }}>
              AWARD A SHIELD
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 14, textAlign: 'center' }}>
              Tap the drinking-game winner. Shielded players are protected from murder tonight and won't appear in the traitors' target list.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  onClick={() => p.shield ? handleRemoveShield(p.name) : handleAwardShield(p.name)}
                  style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    borderRadius: 6,
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                  title={p.shield ? 'Tap to remove shield' : 'Tap to award shield'}
                >
                  <PlayerPortrait name={p.name} photo={p.photo} width={110} glow={p.shield} />
                  {p.shield && (
                    <div style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      fontSize: '1.4rem',
                      filter: 'drop-shadow(0 0 8px rgba(218,165,32,0.9))',
                      pointerEvents: 'none',
                    }}>🛡️</div>
                  )}
                </button>
              ))}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
              Tapping a shielded player removes the shield (in case you tapped the wrong person).
            </p>
          </div>

          <div className="host-controls" style={{ marginTop: 20 }}>
            {round === 1 ? (
              <>
                <p style={{ color: 'var(--gold-pale, #f0d080)', fontFamily: 'var(--font-heading)', fontSize: '0.8rem', letterSpacing: 2, textAlign: 'center', width: '100%', marginBottom: 10, fontStyle: 'italic' }}>
                  No banishment on the first night — the traitors strike unopposed.
                </p>
                <button className="btn btn-primary" onClick={handleNoBanishment}>
                  Reveal the Night's Outcome
                </button>
              </>
            ) : round === 3 && missionStage === 1 ? (
              <>
                <button className="btn btn-primary" onClick={() => setMissionStage(2)}>
                  Begin Second Mission
                </button>
                <button className="btn btn-dark" onClick={() => setMissionStage(2)}>
                  Skip to Second Mission
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleAdvanceToRoundtable}>
                  Proceed to Roundtable
                </button>
                <button className="btn btn-dark" onClick={handleAdvanceToRoundtable}>
                  Skip Challenge
                </button>
              </>
            )}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  onClick={() => handleSelectBanished(p.name)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    borderRadius: 6,
                    transition: 'transform 0.2s, filter 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.filter = 'drop-shadow(0 0 14px rgba(220,20,60,0.6))'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.filter = ''; }}
                >
                  <PlayerPortrait name={p.name} photo={p.photo} width={130} />
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

          {banishedPlayer && (() => {
            const revealedRole = revealedRoles[banishedPlayer];
            const wasRevealed = !!revealedRole;
            const roleColor = revealedRole === 'traitor' ? 'var(--crimson-light)' : 'var(--gold)';
            return (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: 16 }}>
                  <PlayerPortrait
                    name={banishedPlayer}
                    photo={players[banishedPlayer]?.photo}
                    width={260}
                    border={wasRevealed ? `4px solid ${roleColor}` : '3px solid var(--text-dim)'}
                    glow={wasRevealed}
                    faded={wasRevealed}
                  />
                  {/* X overlay always */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '8rem',
                    fontFamily: 'var(--font-display)',
                    color: 'var(--crimson-light)',
                    textShadow: '0 0 20px rgba(139,0,0,0.95)',
                    pointerEvents: 'none',
                  }}>✕</div>
                  {/* Role badge after reveal */}
                  {wasRevealed && (
                    <div style={{
                      position: 'absolute',
                      bottom: -14,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: roleColor,
                      color: 'var(--black, #0a0a0a)',
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.95rem',
                      letterSpacing: 4,
                      padding: '6px 18px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      animation: 'fadeInScale 0.6s ease',
                    }}>
                      {revealedRole === 'traitor' ? '🗡️ TRAITOR' : '✨ FAITHFUL'}
                    </div>
                  )}
                </div>

                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2rem, 6vw, 3.4rem)',
                  color: 'var(--crimson-light)',
                  textShadow: '0 0 30px rgba(139,0,0,0.8)',
                  letterSpacing: 4,
                  marginTop: 24,
                }}>
                  {banishedPlayer}
                </div>
                <div style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '1.4rem',
                  color: 'var(--text)',
                  letterSpacing: 3,
                  marginBottom: 20,
                }}>
                  HAS BEEN BANISHED
                </div>

                {!wasRevealed ? (
                  <>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1.3rem',
                      color: 'var(--gold)',
                      letterSpacing: 3,
                      marginBottom: 24,
                    }}>
                      REVEAL THEIR LOYALTY
                    </div>
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={() => handleConfirmBanishment()}
                    >
                      Reveal Role
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1.5rem',
                      color: roleColor,
                      letterSpacing: 4,
                      marginTop: 18,
                      marginBottom: 24,
                      animation: 'fadeInUp 0.8s ease',
                    }}>
                      {revealedRole === 'traitor'
                        ? 'A TRAITOR HAS FALLEN.'
                        : 'AN INNOCENT HAS BEEN LOST.'}
                    </div>
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={handleContinueAfterBanishment}
                    >
                      Continue
                    </button>
                  </>
                )}
              </div>
            );
          })()}

          <PortraitWall players={players} revealedRoles={revealedRoles} />
        </div>
      )}

      {/* ============================================================
          RECRUITMENT — TV display while the lone traitor picks
          ============================================================ */}
      {phase === 'recruitment' && (
        <div className="fade-in" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.8rem, 5vw, 2.8rem)',
            color: 'var(--crimson-light)',
            letterSpacing: 5,
            textShadow: '0 0 28px rgba(139,0,0,0.8)',
            animation: 'candleFlicker 2s infinite',
            marginBottom: 24,
          }}>
            {gameState.recruitedPlayer
              ? 'A NEW TRAITOR HAS BEEN CHOSEN'
              : 'A NEW TRAITOR IS BEING CHOSEN…'}
          </div>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontStyle: 'italic',
            color: 'var(--gold-pale, #f0d080)',
            fontSize: '1.2rem',
            maxWidth: 560,
            margin: '0 auto 24px',
            lineHeight: 1.6,
          }}>
            {gameState.recruitedPlayer
              ? 'The traitor council has been replenished. Trust no one.'
              : 'The remaining traitor must convert one of the faithful to their cause.'}
          </p>
          {gameState.recruitedPlayer && (
            <p style={{
              fontFamily: 'var(--font-heading)',
              color: 'var(--text-dim)',
              letterSpacing: 2,
              fontSize: '0.85rem',
              marginTop: 30,
            }}>
              CHECK YOUR PHONE…
            </p>
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

          {/* Shield management — between rounds, in case the host missed
              awarding a shield during the challenge or wants to adjust. */}
          <div className="panel" style={{ maxWidth: 720, margin: '20px auto' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 4, letterSpacing: 2, fontSize: '0.9rem', textAlign: 'center' }}>
              SHIELD MANAGEMENT
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12, textAlign: 'center' }}>
              Tap to add or remove a shield before the next night begins.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {alivePlayers.map(p => (
                <button
                  key={p.name}
                  onClick={() => p.shield ? handleRemoveShield(p.name) : handleAwardShield(p.name)}
                  style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <PlayerPortrait name={p.name} photo={p.photo} width={90} glow={p.shield} />
                  {p.shield && (
                    <div style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      fontSize: '1.2rem',
                      filter: 'drop-shadow(0 0 6px rgba(218,165,32,0.9))',
                      pointerEvents: 'none',
                    }}>🛡️</div>
                  )}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
              {alivePlayers.map(p => {
                const isRevealed = endgameRevealed.includes(p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => handleEndgameReveal(p.name)}
                    disabled={isRevealed}
                    style={{
                      position: 'relative',
                      background: 'transparent',
                      border: 'none',
                      cursor: isRevealed ? 'default' : 'pointer',
                      padding: 4,
                      transition: 'transform 0.2s',
                    }}
                  >
                    <PlayerPortrait
                      name={p.name}
                      photo={p.photo}
                      width={110}
                      border={isRevealed
                        ? `3px solid ${p.role === 'traitor' ? 'var(--crimson-light)' : 'var(--gold)'}`
                        : undefined}
                      glow={isRevealed}
                    />
                    {isRevealed && (
                      <div style={{
                        position: 'absolute',
                        bottom: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: p.role === 'traitor' ? 'var(--crimson-light)' : 'var(--gold)',
                        color: 'var(--black, #0a0a0a)',
                        fontFamily: 'var(--font-heading)',
                        fontSize: '0.7rem',
                        letterSpacing: 2,
                        padding: '3px 10px',
                        borderRadius: 3,
                        whiteSpace: 'nowrap',
                      }}>
                        {p.role === 'traitor' ? '🗡️ ' : '✨ '}{p.role.toUpperCase()}
                      </div>
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
          {phase === 'night' && (
            <button className="btn btn-sm btn-dark" onClick={handlePause}>
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}
          {round >= 7 && phase !== 'lobby_between_rounds' && (
            <button
              className="btn btn-sm"
              onClick={handlePlayersEndGame}
              style={{
                background: 'rgba(218,165,32,0.2)',
                border: '1px solid var(--gold)',
                color: 'var(--gold)',
                fontFamily: 'var(--font-heading)',
                letterSpacing: 1.5,
              }}
            >
              End the Game
            </button>
          )}
          <button className="btn btn-sm btn-dark" onClick={handleResetGame}>
            Reset
          </button>
          <button className="btn btn-sm btn-dark" onClick={handleWipeGame} title="Full wipe — also removes all players">
            Wipe
          </button>
        </div>
      )}

      {/* Paused indicator — visible during night when paused */}
      {paused && phase === 'night' && (
        <div style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(218,165,32,0.2)',
          border: '1px solid var(--gold)',
          color: 'var(--gold)',
          padding: '6px 18px',
          borderRadius: 20,
          fontFamily: 'var(--font-heading)',
          fontSize: '0.85rem',
          letterSpacing: 3,
          zIndex: 60,
          backdropFilter: 'blur(8px)',
        }}>
          ⏸ NIGHT PAUSED
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
