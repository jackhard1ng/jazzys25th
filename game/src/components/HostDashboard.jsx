import { useState, useMemo } from 'react';
import useGame from '../hooks/useGame';
import Timer from './Timer';
import PortraitWall from './PortraitWall';
import { selectPrompts } from '../prompts';
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
    gameState, config, votes, scrolls, murderVotes,
    connected,
  } = useGame();

  const { phase, round, timerEnd, murderTarget, banishedPlayer, shieldBlocked, winCondition, currentScrollIndex, paused } = gameState;

  const [newPlayerName, setNewPlayerName] = useState('');
  const [shieldTarget, setShieldTarget] = useState('');
  const [revealedRoles, setRevealedRoles] = useState({});
  const [usedPrompts, setUsedPrompts] = useState(new Set());
  const [endgameRevealed, setEndgameRevealed] = useState([]);

  // ============================================================
  // VOTE TALLY
  // ============================================================
  const voteTally = useMemo(() => {
    const tally = {};
    alivePlayers.forEach(p => { tally[p.name] = 0; });
    Object.values(votes).forEach(v => {
      if (tally[v.target] !== undefined) tally[v.target]++;
    });
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [votes, alivePlayers]);

  const maxVotes = voteTally.length > 0 ? Math.max(...voteTally.map(([, c]) => c), 1) : 1;

  // ============================================================
  // SCROLLS FOR ROUNDTABLE (game-related responses from current round)
  // ============================================================
  const roundScrolls = useMemo(() => {
    const roundData = scrolls[round] || {};
    const messages = [];
    Object.values(roundData).forEach(playerScrolls => {
      if (playerScrolls.responses) {
        playerScrolls.responses.forEach(r => {
          if (r.isGame) {
            messages.push(r.text);
          }
        });
      }
    });
    // Shuffle so they're truly anonymous
    for (let i = messages.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [messages[i], messages[j]] = [messages[j], messages[i]];
    }
    return messages;
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
    if (names.length < config.numTraitors + 2) {
      alert(`Need at least ${config.numTraitors + 2} players to start with ${config.numTraitors} traitors.`);
      return;
    }

    // Random assignment — host doesn't know who the traitors are
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    const traitorNames = shuffled.slice(0, config.numTraitors);

    await assignRoles(traitorNames);
    await updateGameState({ phase: 'roleReveal', round: 1 });
  }

  // Start a new day — begins with the challenge (shield opportunity)
  async function handleStartDay() {
    await clearVotes();
    await clearTraitorChat();
    await set(ref(db, 'game/murderVotes'), {});
    await updateGameState({
      phase: 'challenge',
      murderTarget: null,
      banishedPlayer: null,
      shieldBlocked: false,
      currentScrollIndex: -1,
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
      prompts: prompts.map(p => ({ text: p.text, isGame: p.isGame })),
    });

    await updateGameState({
      phase: 'night',
    });
    await startTimer(config.nightDuration);
  }

  async function handleEndNight() {
    await clearTimer();
    await set(ref(db, 'game/nightPhase'), { active: false, prompts: [] });

    // Determine murder target from traitor votes
    // On the show, traitors must reach UNANIMOUS agreement — if they split votes, no murder
    const tally = {};
    Object.values(murderVotes).forEach(v => {
      tally[v.target] = (tally[v.target] || 0) + 1;
    });

    let target = null;
    const targets = Object.keys(tally);
    if (targets.length === 1) {
      // All traitors who voted agreed on the same person
      target = targets[0];
    }
    // If traitors voted for different people, no murder happens

    // Store murder target but don't apply yet — murder reveal comes after banishment
    await updateGameState({
      phase: 'roundtable',
      murderTarget: target || null,
      shieldBlocked: false,
      currentScrollIndex: -1,
    });
  }

  async function handleAdvanceToRoundtable() {
    await updateGameState({ phase: 'roundtable', currentScrollIndex: -1 });
  }

  async function handleNextScroll() {
    const nextIdx = (currentScrollIndex ?? -1) + 1;
    await updateGameState({ currentScrollIndex: nextIdx });
  }

  async function handleSkipScroll() {
    const nextIdx = (currentScrollIndex ?? -1) + 1;
    await updateGameState({ currentScrollIndex: nextIdx });
  }

  async function handleStartVoting() {
    await clearVotes();
    await updateGameState({ phase: 'voting' });
    await startTimer(90); // 1.5 min to vote
  }

  async function handleRevealVotes() {
    await clearTimer();
    // Find player with most votes
    if (voteTally.length > 0 && voteTally[0][1] > 0) {
      await updateGameState({
        phase: 'banishmentReveal',
        banishedPlayer: voteTally[0][0],
      });
    }
  }

  async function handleConfirmBanishment() {
    const name = banishedPlayer;
    if (!name) return;
    // On The Traitors show, banished players do NOT reveal their role
    await updatePlayerStatus(name, 'banished');

    // Move to murder phase — apply the traitors' kill
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
    handleStartDay();
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
  // ADVANCE AFTER MURDER REVEAL — check win conditions & finale trigger
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
    } else if (alive.length <= (config.finaleThreshold || 5)) {
      // Trigger the finale — like on the TV show
      await updateGameState({ phase: 'finale_roundtable' });
    } else {
      await updateGameState({ phase: 'lobby_between_rounds' });
    }
  }

  // ============================================================
  // FINALE FLOW — mirrors The Traitors TV show endgame
  // ============================================================

  // Finale roundtable → vote to banish (no role reveal)
  async function handleFinaleStartVoting() {
    await clearVotes();
    await updateGameState({ phase: 'finale_voting' });
    await startTimer(90);
  }

  // Finale reveal votes and banish
  async function handleFinaleRevealVotes() {
    await clearTimer();
    if (voteTally.length > 0 && voteTally[0][1] > 0) {
      await updateGameState({
        phase: 'finale_banishment',
        banishedPlayer: voteTally[0][0],
      });
    }
  }

  // Finale banishment confirmed — no role reveal, move to decision phase
  async function handleFinaleBanishment() {
    const name = banishedPlayer;
    if (!name) return;
    await updatePlayerStatus(name, 'banished');

    // Check win conditions and auto-end at 2 players
    const snap = await get(playersRef);
    const updatedPlayers = snap.val() || {};
    const alive = Object.values(updatedPlayers).filter(p => p.status === 'alive');
    const aliveT = alive.filter(p => p.role === 'traitor');
    const aliveF = alive.filter(p => p.role === 'faithful');

    if (aliveT.length === 0) {
      await updateGameState({ phase: 'endgame', winCondition: 'faithful' });
    } else if (aliveT.length >= aliveF.length) {
      await updateGameState({ phase: 'endgame', winCondition: 'traitors' });
    } else if (alive.length <= 2) {
      // Only 2 players left — game auto-ends (like the TV show)
      await updateGameState({ phase: 'endgame', winCondition: aliveT.length > 0 ? 'traitors' : 'faithful' });
    } else {
      // Move to the "do you think there are still traitors?" decision
      await clearVotes();
      await updateGameState({ phase: 'finale_decision', banishedPlayer: null });
    }
  }

  // Players have voted on whether traitors remain
  // If ANY player votes "still traitors" → another finale vote
  // If ALL vote "all faithful" → reveal and determine winner
  async function handleFinaleDecisionResult() {
    const voteValues = Object.values(votes);
    const anyThinkTraitors = voteValues.some(v => v.target === 'still_traitors');

    if (anyThinkTraitors) {
      // At least one person thinks there's a traitor — vote again
      await clearVotes();
      await updateGameState({ phase: 'finale_roundtable' });
    } else {
      // Everyone thinks they're all faithful — reveal time!
      // Check if there are actually any traitors left
      const snap = await get(playersRef);
      const updatedPlayers = snap.val() || {};
      const alive = Object.values(updatedPlayers).filter(p => p.status === 'alive');
      const aliveT = alive.filter(p => p.role === 'traitor');

      if (aliveT.length === 0) {
        await updateGameState({ phase: 'endgame', winCondition: 'faithful' });
      } else {
        await updateGameState({ phase: 'endgame', winCondition: 'traitors' });
      }
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
        Jazzy's Birthday — {phase === 'lobby' ? 'Waiting for Players' : `Day ${round}`}
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
              <div className="config-item">
                <label>Number of Traitors</label>
                <input
                  type="number"
                  className="number-input"
                  min={2} max={5}
                  value={config.numTraitors}
                  onChange={e => updateGameConfig({ numTraitors: parseInt(e.target.value) || 3 })}
                />
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
              <div className="config-item">
                <label>Finale Trigger (players left)</label>
                <input
                  type="number"
                  className="number-input"
                  min={3} max={8}
                  value={config.finaleThreshold || 5}
                  onChange={e => updateGameConfig({ finaleThreshold: parseInt(e.target.value) || 5 })}
                />
              </div>
            </div>

            {/* Roles are randomly assigned — host is safe to play */}
            <div style={{
              marginBottom: 20, padding: 12, background: 'var(--dark-gray)', borderRadius: 8,
              textAlign: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: '0.8rem', color: 'var(--text-dim)', letterSpacing: 1 }}>
                Roles will be randomly assigned — the host can play too
              </span>
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleStartGame}
              disabled={playerList.length < 4}
              style={{ width: '100%' }}
            >
              Start the Game ({playerList.length} players)
            </button>
          </div>
        </div>
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
            <button className="btn btn-primary btn-lg" onClick={handleStartDay} style={{ marginTop: 20 }}>
              Begin Day 1
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
            MISSION / CHALLENGE
          </div>
          <p style={{ fontSize: '1.3rem', color: 'var(--text-dim)', marginBottom: 10 }}>
            The winner earns a shield — protection from murder for one night.
          </p>
          <p style={{ fontSize: '1rem', color: 'var(--text-dim)', marginBottom: 30, fontStyle: 'italic' }}>
            Take your time — discuss, socialize, and play the challenge before moving on.
          </p>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="panel" style={{ maxWidth: 400, margin: '20px auto' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 10, letterSpacing: 2 }}>
              AWARD SHIELD
            </h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <select
                className="select"
                value={shieldTarget}
                onChange={e => setShieldTarget(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Select winner...</option>
                {alivePlayers.filter(p => !p.shield).map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <button
                className="btn btn-gold btn-sm"
                onClick={() => { handleAwardShield(shieldTarget); setShieldTarget(''); }}
                disabled={!shieldTarget}
              >
                Award
              </button>
            </div>
          </div>

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleStartNight}>
              Proceed to Night Phase
            </button>
            <button className="btn btn-dark" onClick={handleStartNight}>
              Skip Challenge
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          ROUNDTABLE — ANONYMOUS SCROLL READING
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
            <p style={{ color: 'var(--text-dim)', marginTop: 5 }}>Anonymous scrolls from the night...</p>
          </div>

          {/* Current scroll */}
          {currentScrollIndex >= 0 && currentScrollIndex < roundScrolls.length ? (
            <div className="scroll-message" key={currentScrollIndex}>
              "{roundScrolls[currentScrollIndex]}"
            </div>
          ) : currentScrollIndex >= roundScrolls.length && roundScrolls.length > 0 ? (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-dim)', fontSize: '1.3rem', letterSpacing: 2 }}>
                All scrolls have been read.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-dim)', fontSize: '1.1rem' }}>
                {roundScrolls.length} scroll{roundScrolls.length !== 1 ? 's' : ''} to read. Press "Next Scroll" to begin.
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', margin: '15px 0', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', fontSize: '0.85rem' }}>
            Scroll {Math.max(0, (currentScrollIndex ?? -1) + 1)} of {roundScrolls.length}
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button
              className="btn btn-gold"
              onClick={handleNextScroll}
              disabled={currentScrollIndex >= roundScrolls.length}
            >
              Next Scroll
            </button>
            <button
              className="btn btn-dark"
              onClick={handleSkipScroll}
              disabled={currentScrollIndex >= roundScrolls.length}
            >
              Skip
            </button>
            <button className="btn btn-primary" onClick={handleStartVoting}>
              Begin Banishment Vote
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          VOTING PHASE
          ============================================================ */}
      {phase === 'voting' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              color: 'var(--crimson-light)',
              letterSpacing: 4,
            }}>
              BANISHMENT VOTE
            </div>
            <p style={{ color: 'var(--text-dim)', marginTop: 5 }}>
              Cast your votes — who shall be banished?
            </p>
            <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-heading)', marginTop: 10, letterSpacing: 2 }}>
              {Object.keys(votes).length} / {alivePlayers.length} VOTES CAST
            </div>
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button
              className="btn btn-primary"
              onClick={handleRevealVotes}
            >
              Reveal Votes
            </button>
            <button className="btn btn-dark" onClick={handlePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          BANISHMENT REVEAL
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

          {/* Vote results bars */}
          <div style={{ maxWidth: 600, margin: '0 auto 30px' }}>
            {voteTally.map(([name, count]) => (
              <div className="vote-bar" key={name}>
                <span className="name" style={{
                  color: name === banishedPlayer ? 'var(--crimson-light)' : 'var(--text)',
                  fontWeight: name === banishedPlayer ? 700 : 400,
                }}>
                  {name}
                </span>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ width: `${(count / maxVotes) * 100}%` }}
                  />
                </div>
                <span className="count">{count}</span>
              </div>
            ))}
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
                fontSize: '1rem',
                color: 'var(--text-dim)',
                letterSpacing: 2,
                marginBottom: 30,
              }}>
                Their loyalty remains unknown...
              </div>

              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleConfirmBanishment()}
              >
                Continue to Night
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
              Day {round} Complete
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2 }}>
              {alivePlayers.length} players remain
            </div>
          </div>

          <div className="host-controls">
            <button className="btn btn-primary btn-lg" onClick={handleNextRound}>
              Begin Day {round + 1}
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
          FINALE — ROUNDTABLE (discussion before vote)
          ============================================================ */}
      {phase === 'finale_roundtable' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            color: 'var(--gold)',
            letterSpacing: 4,
            animation: 'candleFlicker 3s infinite',
            margin: '30px 0 10px',
          }}>
            THE FINAL ROUNDTABLE
          </div>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '1.1rem',
            color: 'var(--text-dim)',
            letterSpacing: 2,
            marginBottom: 20,
          }}>
            {alivePlayers.length} players remain. Discuss who you trust.
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-lg" onClick={handleFinaleStartVoting}>
              Begin Banishment Vote
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          FINALE — VOTING
          ============================================================ */}
      {phase === 'finale_voting' && (
        <div className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              color: 'var(--crimson-light)',
              letterSpacing: 4,
            }}>
              FINALE — BANISHMENT VOTE
            </div>
            <p style={{ color: 'var(--text-dim)', marginTop: 5 }}>
              Vote to banish — their role will NOT be revealed.
            </p>
            <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-heading)', marginTop: 10, letterSpacing: 2 }}>
              {Object.keys(votes).length} / {alivePlayers.length} VOTES CAST
            </div>
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleFinaleRevealVotes}>
              Reveal Votes
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          FINALE — BANISHMENT REVEAL (no role reveal)
          ============================================================ */}
      {phase === 'finale_banishment' && (
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

          {/* Vote results bars */}
          <div style={{ maxWidth: 600, margin: '0 auto 30px' }}>
            {voteTally.map(([name, count]) => (
              <div className="vote-bar" key={name}>
                <span className="name" style={{
                  color: name === banishedPlayer ? 'var(--crimson-light)' : 'var(--text)',
                  fontWeight: name === banishedPlayer ? 700 : 400,
                }}>
                  {name}
                </span>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ width: `${(count / maxVotes) * 100}%` }}
                  />
                </div>
                <span className="count">{count}</span>
              </div>
            ))}
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
                marginBottom: 10,
              }}>
                YOU HAVE BEEN BANISHED
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1rem',
                color: 'var(--text-dim)',
                letterSpacing: 2,
                marginBottom: 30,
              }}>
                Their loyalty remains a mystery...
              </div>

              <button
                className="btn btn-primary btn-lg"
                onClick={handleFinaleBanishment}
              >
                Continue
              </button>
            </div>
          )}

          <PortraitWall players={players} revealedRoles={revealedRoles} />
        </div>
      )}

      {/* ============================================================
          FINALE — DECISION: "Do you think there are still traitors?"
          ============================================================ */}
      {phase === 'finale_decision' && (
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2rem',
            color: 'var(--gold)',
            letterSpacing: 4,
            animation: 'candleFlicker 3s infinite',
            margin: '30px 0 10px',
          }}>
            THE FIRE OF TRUTH
          </div>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '1.1rem',
            color: 'var(--text-dim)',
            letterSpacing: 2,
            marginBottom: 10,
          }}>
            Each player must decide:
          </div>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: '1.2rem',
            color: 'var(--text)',
            marginBottom: 20,
            maxWidth: 500,
            margin: '0 auto 20px',
          }}>
            Do you believe there are still traitors among you?<br />
            If <strong style={{ color: 'var(--crimson-light)' }}>anyone</strong> says yes → another banishment vote.<br />
            If <strong style={{ color: 'var(--gold)' }}>everyone</strong> says all faithful → roles are revealed.
          </div>

          <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-heading)', marginTop: 10, letterSpacing: 2, marginBottom: 20 }}>
            {Object.keys(votes).length} / {alivePlayers.length} DECISIONS MADE
          </div>

          <PortraitWall players={players} revealedRoles={revealedRoles} />

          <div className="host-controls" style={{ marginTop: 20 }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleFinaleDecisionResult}
              disabled={Object.keys(votes).length < alivePlayers.length}
            >
              Reveal Decisions
            </button>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {alivePlayers.map(p => {
                const isRevealed = endgameRevealed.includes(p.name);
                return (
                  <button
                    key={p.name}
                    className={`btn btn-sm ${isRevealed
                      ? (p.role === 'traitor' ? 'btn-primary' : 'btn-gold')
                      : 'btn-dark'}`}
                    onClick={() => handleEndgameReveal(p.name)}
                    disabled={isRevealed}
                  >
                    {isRevealed ? (p.role === 'traitor' ? '🗡️ ' : '✨ ') : ''}{p.name}
                    {isRevealed ? ` — ${p.role.toUpperCase()}` : ''}
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
