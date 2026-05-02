import { useState, useEffect, useRef } from 'react';
import useGame from '../hooks/useGame';
import Timer from './Timer';
import NightPhase from './NightPhase';
import SpectatorMode from './SpectatorMode';
import PlayerPortrait from './PlayerPortrait';
import { PRESET_PLAYERS } from '../presetPlayers';
import { addPlayer, recruitTraitor, updateGameState } from '../firebase';

// ============================================================
// PLAYER SCREEN — the mobile phone experience
// Handles: Join → Lobby → Role Reveal → Night → Day → Vote → etc.
// ============================================================
export default function PlayerScreen() {
  const {
    players, playerList, alivePlayers,
    gameState, config, traitorChat, murderVotes, nightPhase,
    connected,
  } = useGame();

  const { phase, round, timerEnd, murderTarget, banishedPlayer, shieldBlocked, winCondition } = gameState;

  const [playerName, setPlayerName] = useState(() => localStorage.getItem('traitors_name') || '');
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [showRole, setShowRole] = useState(false);
  // Stable per-device session id. Only the device that first claimed
  // a portrait can re-claim it on refresh — so leftover localStorage
  // from earlier testing won't hijack someone else's pick.
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current === null) {
    let sid = localStorage.getItem('traitors_session_id');
    if (!sid) {
      sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('traitors_session_id', sid);
    }
    sessionIdRef.current = sid;
  }
  const mySessionId = sessionIdRef.current;

  const player = players[playerName] || null;
  const isAlive = player?.status === 'alive';
  const isTraitor = player?.role === 'traitor';
  const isFaithful = player?.role === 'faithful';

  // Auto-rejoin ONLY when the player record in Firebase has the same
  // sessionId this device stored when it originally picked the portrait.
  // Without this guard, any phone with leftover localStorage would
  // hijack a portrait the moment someone else picked it.
  useEffect(() => {
    if (joined) return;
    if (!playerName) return;
    const p = players[playerName];
    if (!p) return;
    if (p.sessionId && p.sessionId === mySessionId) {
      setJoined(true);
    }
  }, [playerName, players, joined, mySessionId]);

  // Role reveal animation
  useEffect(() => {
    if (phase === 'roleReveal' && player?.role && !roleRevealed) {
      setShowRole(false);
      const timer = setTimeout(() => {
        setShowRole(true);
        setRoleRevealed(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [phase, player?.role, roleRevealed]);

  async function handleJoinWithName(rawName) {
    const name = String(rawName || '').trim();
    if (!name) return;
    const existing = players[name];
    const ownedByMe = existing?.sessionId && existing.sessionId === mySessionId;
    if (existing && !ownedByMe) {
      alert(`${name} is already in the game on another device.`);
      return;
    }
    const success = await addPlayer(name, mySessionId);
    if (success || ownedByMe) {
      setPlayerName(name);
      localStorage.setItem('traitors_name', name);
      setJoined(true);
    }
  }

  async function handleCustomNameSubmit() {
    await handleJoinWithName(nameInput);
    setNameInput('');
  }

  // ============================================================
  // GAME-IN-PROGRESS GATE — lobby locks once play begins
  // ============================================================
  if (!joined && phase !== 'lobby') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.8rem',
          color: 'var(--gold)',
          letterSpacing: 4,
          marginBottom: 15,
          animation: 'candleFlicker 3s infinite',
        }}>
          THE GAME HAS BEGUN
        </div>
        <p style={{ color: 'var(--text-dim)', maxWidth: 320 }}>
          The lobby is closed. Watch the TV with the others — the next game begins after this one ends.
        </p>
      </div>
    );
  }

  // ============================================================
  // JOIN SCREEN — portrait gallery picker
  // ============================================================
  if (!joined) {
    return (
      <PortraitPickerJoin
        connected={connected}
        players={players}
        nameInput={nameInput}
        setNameInput={setNameInput}
        onPick={handleJoinWithName}
        onCustomSubmit={handleCustomNameSubmit}
        mySessionId={mySessionId}
      />
    );
  }

  // ============================================================
  // SPECTATOR MODE (eliminated players)
  // ============================================================
  if (player && !isAlive && phase !== 'lobby' && phase !== 'endgame') {
    return <SpectatorMode player={player} players={players} gameState={gameState} />;
  }

  // ============================================================
  // LOBBY — Waiting for game to start
  // ============================================================
  if (phase === 'lobby') {
    return (
      <div className="player-screen" style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.8rem',
          color: 'var(--gold)',
          letterSpacing: 4,
          animation: 'candleFlicker 3s infinite',
          marginBottom: 10,
        }}>
          The Traitors
        </div>

        <div className="panel" style={{ margin: '24px 0', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2, marginBottom: 14, fontSize: '0.85rem' }}>
            WELCOME
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <PlayerPortrait name={playerName} photo={player?.photo} width={180} />
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: '1rem', marginBottom: 6 }}>
            Waiting for the game to begin…
          </p>
          <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-heading)', fontSize: '0.8rem', letterSpacing: 2 }}>
            {playerList.length} PLAYER{playerList.length !== 1 ? 'S' : ''} CONNECTED
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
          padding: '0 8px',
        }}>
          {playerList.map(p => (
            <div key={p.name} style={{ width: 64 }}>
              <PlayerPortrait name={p.name} photo={p.photo} width={64} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // TRAITOR REVEAL — TV is playing the count animation.
  // Phone shows ambient suspense; role pops on phase === 'roleReveal'.
  // ============================================================
  if (phase === 'traitorReveal') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="fade-in" style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.4rem',
            color: 'var(--crimson-light)',
            letterSpacing: 4,
            marginBottom: 10,
            animation: 'candleFlicker 3s infinite',
          }}>
            FATES ARE BEING SEALED
          </div>
          <p style={{ color: 'var(--text-dim)', marginTop: 10 }}>
            Watch the TV…
          </p>
        </div>
      </div>
    );
  }

  // ============================================================
  // ROLE REVEAL
  // ============================================================
  if (phase === 'roleReveal') {
    return (
      <div className="player-screen" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: showRole
          ? 'radial-gradient(ellipse at center, rgba(212,175,55,0.15), var(--black))'
          : 'var(--black)',
        transition: 'background 1s ease',
      }}>
        {!showRole ? (
          <div className="fade-in" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              color: 'var(--text-dim)',
              letterSpacing: 4,
              animation: 'pulse 1.5s infinite',
            }}>
              Your fate is being decided...
            </div>
          </div>
        ) : (
          <div className="fade-in-scale" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1rem',
              color: 'var(--text-dim)',
              letterSpacing: 3,
              marginBottom: 20,
            }}>
              You are a...
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '3rem',
              color: 'var(--gold)',
              letterSpacing: 6,
              textShadow: '0 0 30px rgba(212,175,55,0.6)',
              marginBottom: 20,
            }}>
              {isTraitor ? 'TRAITOR' : 'FAITHFUL'}
            </div>

            {isTraitor && (
              <div className="panel" style={{ maxWidth: 300, margin: '20px auto', textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: 1, marginBottom: 8 }}>
                  YOUR FELLOW TRAITORS:
                </div>
                {playerList.filter(p => p.role === 'traitor' && p.name !== playerName).map(p => (
                  <div key={p.name} style={{ padding: '4px 0', color: 'var(--text)', fontFamily: 'var(--font-heading)', letterSpacing: 1 }}>
                    {p.name}
                  </div>
                ))}
              </div>
            )}

            {isFaithful && (
              <p style={{ color: 'var(--text-dim)', maxWidth: 300, margin: '10px auto' }}>
                Trust no one. Find the traitors before they eliminate you all.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // RECRUITMENT — three views depending on who you are:
  //   1. Lone surviving traitor: pick a faithful to convert
  //   2. The just-recruited player: dramatic "YOU ARE A TRAITOR" reveal
  //   3. Everyone else: ambient "darkness gathers" screen
  // ============================================================
  if (phase === 'recruitment') {
    return (
      <RecruitmentPhone
        player={player}
        playerName={playerName}
        players={players}
        alivePlayers={alivePlayers}
        gameState={gameState}
      />
    );
  }

  // ============================================================
  // NIGHT PHASE
  // ============================================================
  if (phase === 'night') {
    return (
      <NightPhase
        player={player}
        playerName={playerName}
        isTraitor={isTraitor}
        alivePlayers={alivePlayers}
        config={config}
        nightPhase={nightPhase}
        timerEnd={timerEnd}
        round={round}
        traitorChat={traitorChat}
        murderVotes={murderVotes}
      />
    );
  }

  // ============================================================
  // MURDER REVEAL (player view)
  // ============================================================
  if (phase === 'murderReveal') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {shieldBlocked ? (
          <div className="fade-in-scale" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.8rem',
              color: 'var(--gold)',
              letterSpacing: 4,
              animation: 'shieldBlock 1s ease, candleFlicker 3s infinite',
            }}>
              A SHIELD WAS PLAYED
            </div>
            <p style={{ color: 'var(--text-dim)', marginTop: 15, fontSize: '1.2rem' }}>
              No one was murdered.
            </p>
          </div>
        ) : murderTarget ? (
          <div className="fade-in" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1rem',
              color: 'var(--text-dim)',
              letterSpacing: 3,
              marginBottom: 20,
            }}>
              The traitors have struck...
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.5rem',
              color: 'var(--crimson-light)',
              textShadow: '0 0 30px rgba(139,0,0,0.8)',
              animation: 'fadeInScale 1s ease',
            }}>
              {murderTarget}
            </div>
            <p style={{ color: 'var(--crimson-light)', marginTop: 10, fontSize: '1.2rem' }}>
              has been murdered.
            </p>
            {murderTarget === playerName && (
              <div className="panel panel-crimson" style={{ marginTop: 20 }}>
                <p style={{ color: 'var(--crimson-light)', fontFamily: 'var(--font-heading)', letterSpacing: 2 }}>
                  YOU HAVE BEEN MURDERED
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="fade-in" style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--text-dim)', letterSpacing: 3 }}>
              No one was murdered.
            </div>
          </div>
        )}

        {player?.shield && (
          <div style={{ marginTop: 15, textAlign: 'center' }}>
            <span className="role-badge faithful">🛡️ You have a shield</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // CHALLENGE ROUND (player view)
  // ============================================================
  if (phase === 'challenge') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2rem',
          color: 'var(--gold)',
          letterSpacing: 4,
          animation: 'candleFlicker 3s infinite',
          textAlign: 'center',
        }}>
          CHALLENGE ROUND
        </div>
        <p style={{ color: 'var(--text-dim)', marginTop: 15, textAlign: 'center', maxWidth: 300 }}>
          Compete for a shield. Watch the TV for instructions.
        </p>
        {player?.shield && (
          <div style={{ marginTop: 20 }}>
            <span className="role-badge faithful">🛡️ You have a shield</span>
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <span className="role-badge faithful">
            {isTraitor ? 'Traitor' : 'Faithful'}
          </span>
        </div>
      </div>
    );
  }

  // ============================================================
  // ROUNDTABLE (player view)
  // ============================================================
  if (phase === 'roundtable') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.8rem',
          color: 'var(--gold)',
          letterSpacing: 4,
          animation: 'candleFlicker 3s infinite',
          textAlign: 'center',
        }}>
          THE ROUNDTABLE
        </div>
        <p style={{ color: 'var(--text-dim)', marginTop: 15, textAlign: 'center', maxWidth: 300 }}>
          Discuss. Debate. Deceive. Watch the TV for anonymous scrolls.
        </p>
        <Timer timerEnd={timerEnd} />
        <div style={{ marginTop: 20 }}>
          <span className="role-badge faithful">
            {isTraitor ? 'Traitor' : 'Faithful'}
          </span>
        </div>
        {player?.shield && (
          <div style={{ marginTop: 10 }}>
            <span className="role-badge faithful">🛡️ Shield Active</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // IRL VOTE — paper voting in the room. Phone just says wait.
  // ============================================================
  if (phase === 'irlVote') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="fade-in" style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.6rem',
            color: 'var(--crimson-light)',
            letterSpacing: 4,
            marginBottom: 15,
          }}>
            VOTE ON PAPER
          </div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            Write your banishment vote on a slip. The room will tap the result on the TV.
          </p>
          <span className="role-badge faithful">
            {isTraitor ? 'Traitor' : 'Faithful'}
          </span>
        </div>
      </div>
    );
  }

  // ============================================================
  // BANISHMENT REVEAL (player view)
  // ============================================================
  if (phase === 'banishmentReveal') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {banishedPlayer && (
          <div className="fade-in" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1rem',
              color: 'var(--text-dim)',
              letterSpacing: 3,
              marginBottom: 15,
            }}>
              THE VOTES ARE IN
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.5rem',
              color: 'var(--crimson-light)',
              textShadow: '0 0 30px rgba(139,0,0,0.8)',
            }}>
              {banishedPlayer}
            </div>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.2rem',
              color: 'var(--text)',
              letterSpacing: 3,
              marginTop: 10,
            }}>
              HAS BEEN BANISHED
            </div>
            {banishedPlayer === playerName && (
              <div className="panel panel-crimson" style={{ marginTop: 20 }}>
                <p style={{ color: 'var(--crimson-light)', fontFamily: 'var(--font-heading)', letterSpacing: 2 }}>
                  YOU HAVE BEEN BANISHED
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // BETWEEN ROUNDS
  // ============================================================
  if (phase === 'lobby_between_rounds') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '1.3rem',
          color: 'var(--gold)',
          letterSpacing: 3,
          textAlign: 'center',
        }}>
          Round {round} Complete
        </div>
        <p style={{ color: 'var(--text-dim)', marginTop: 15, textAlign: 'center' }}>
          Waiting for the next round...
        </p>
        <div style={{ marginTop: 20 }}>
          <span className="role-badge faithful">
            {isTraitor ? 'Traitor' : 'Faithful'}
          </span>
        </div>
        {player?.shield && (
          <div style={{ marginTop: 10 }}>
            <span className="role-badge faithful">🛡️ Shield Active</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // ENDGAME (player view)
  // ============================================================
  if (phase === 'endgame') {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2rem',
          color: 'var(--gold)',
          letterSpacing: 6,
          animation: 'candleFlicker 3s infinite',
          textAlign: 'center',
          marginBottom: 20,
        }}>
          THE GAME IS OVER
        </div>

        {winCondition === 'faithful' ? (
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.5rem',
            color: 'var(--gold)',
            letterSpacing: 4,
            textAlign: 'center',
          }}>
            The Faithful Have Prevailed.
          </div>
        ) : (
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.5rem',
            color: 'var(--crimson-light)',
            letterSpacing: 4,
            textAlign: 'center',
            textShadow: '0 0 20px rgba(139,0,0,0.6)',
          }}>
            The Traitors Have Taken Control.
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <span className="role-badge faithful">
            You were: {isTraitor ? 'TRAITOR' : 'FAITHFUL'}
          </span>
        </div>

        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.3rem',
          color: 'var(--gold)',
          marginTop: 30,
          animation: 'candleFlicker 3s infinite',
        }}>
          Happy Birthday Jazzy! 🥂
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="player-screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="cinematic-text" style={{ fontSize: '1.5rem' }}>
        Awaiting the host...
      </div>
    </div>
  );
}

// ============================================================
// PORTRAIT PICKER JOIN
// "Pick your portrait" gallery, with a custom-name fallback for
// guests who aren't on the preset roster.
// ============================================================
function PortraitPickerJoin({ connected, players, nameInput, setNameInput, onPick, onCustomSubmit, mySessionId }) {
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 12px 40px' }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1.8rem',
        color: 'var(--gold)',
        textAlign: 'center',
        letterSpacing: 4,
        animation: 'candleFlicker 3s infinite',
        marginBottom: 6,
      }}>
        The Traitors
      </div>
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '0.85rem',
        color: 'var(--text-dim)',
        textAlign: 'center',
        letterSpacing: 2,
        marginBottom: 24,
      }}>
        Jazzy's Birthday
      </div>

      {!showCustom ? (
        <>
          <h2 style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--gold)',
            fontSize: '1rem',
            letterSpacing: 3,
            textAlign: 'center',
            marginBottom: 18,
          }}>
            TAP YOUR PORTRAIT
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 14,
            width: '100%',
            maxWidth: 600,
            marginBottom: 24,
          }}>
            {PRESET_PLAYERS.map(name => {
              const existing = players[name];
              const taken = !!existing;
              const isMine = taken && existing.sessionId && existing.sessionId === mySessionId;
              const disabled = taken && !isMine;
              return (
                <button
                  key={name}
                  onClick={() => !disabled && onPick(name)}
                  disabled={disabled}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    position: 'relative',
                    width: '100%',
                    transition: 'transform 0.15s, filter 0.15s',
                  }}
                  onTouchStart={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.96)'; }}
                  onTouchEnd={e => { e.currentTarget.style.transform = ''; }}
                >
                  <PlayerPortrait
                    name={name}
                    width="100%"
                    faded={disabled}
                    glow={isMine}
                  />
                  {disabled && (
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%) rotate(-12deg)',
                      background: 'var(--crimson-light, #dc143c)',
                      color: 'var(--black, #0a0a0a)',
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.75rem',
                      letterSpacing: 2,
                      padding: '4px 12px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}>
                      TAKEN
                    </div>
                  )}
                  {isMine && (
                    <div style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      background: 'var(--gold)',
                      color: 'var(--black, #0a0a0a)',
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.65rem',
                      letterSpacing: 1.5,
                      padding: '2px 6px',
                      borderRadius: 3,
                      pointerEvents: 'none',
                    }}>
                      YOU
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setShowCustom(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--stone, #3a3a3a)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.8rem',
              letterSpacing: 2,
              padding: '10px 20px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            I DON'T SEE MYSELF
          </button>
        </>
      ) : (
        <div className="panel" style={{ width: '100%', maxWidth: 360 }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2, marginBottom: 14, textAlign: 'center', fontSize: '0.9rem' }}>
            ENTER YOUR NAME
          </h3>
          <input
            className="input"
            placeholder="Your name..."
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onCustomSubmit()}
            autoFocus
            style={{ marginBottom: 12, textAlign: 'center', fontSize: '1.1rem' }}
          />
          <button
            className="btn btn-primary btn-lg"
            onClick={onCustomSubmit}
            disabled={!nameInput.trim()}
            style={{ width: '100%', marginBottom: 10 }}
          >
            Join
          </button>
          <button
            onClick={() => setShowCustom(false)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.75rem',
              letterSpacing: 2,
              padding: 8,
              cursor: 'pointer',
            }}
          >
            ← BACK TO PORTRAITS
          </button>
        </div>
      )}

      {!connected && (
        <p style={{ color: 'var(--crimson-light)', marginTop: 20, fontFamily: 'var(--font-heading)', fontSize: '0.85rem' }}>
          Connecting to server...
        </p>
      )}
    </div>
  );
}


// ============================================================
// RECRUITMENT PHONE — three branches by player role/state
// ============================================================
function RecruitmentPhone({ player, playerName, players, alivePlayers, gameState }) {
  const recruitedName = gameState?.recruitedPlayer || null;
  const isLoneTraitor = player?.role === "traitor" && !recruitedName;
  const wasJustRecruited = recruitedName === playerName;

  // Lone traitor: pick UI
  if (isLoneTraitor) {
    const candidates = alivePlayers.filter(p => p.role !== "traitor");
    return (
      <div className="player-screen" style={{ padding: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.6rem",
            color: "var(--crimson-light)",
            letterSpacing: 4,
            textShadow: "0 0 20px rgba(139,0,0,0.7)",
            marginBottom: 8,
            animation: "candleFlicker 3s infinite",
          }}>
            YOU STAND ALONE
          </div>
          <p style={{ color: "var(--gold-pale, #f0d080)", fontStyle: "italic", fontSize: "1rem", marginBottom: 6 }}>
            The traitor council has fallen. Choose a faithful to convert to your cause.
          </p>
          <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
            Choose wisely. They will know everything.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {candidates.map(p => (
            <button
              key={p.name}
              onClick={async () => {
                await recruitTraitor(p.name);
                await updateGameState({ recruitedPlayer: p.name });
              }}
              style={{
                background: "transparent",
                border: "2px solid transparent",
                borderRadius: 6,
                padding: 3,
                cursor: "pointer",
              }}
              onTouchStart={e => { e.currentTarget.style.borderColor = "var(--crimson-light)"; }}
            >
              <PlayerPortrait name={p.name} photo={p.photo} width={90} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Just-recruited player: dramatic conversion screen
  if (wasJustRecruited) {
    return (
      <div className="player-screen" style={{
        background: "radial-gradient(ellipse at center, rgba(139,0,0,0.4), var(--black))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}>
        <div className="fade-in-scale" style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.9rem",
            color: "var(--text-dim)",
            letterSpacing: 4,
            marginBottom: 18,
          }}>
            DARKNESS HAS FOUND YOU
          </div>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2.4rem, 9vw, 3.6rem)",
            color: "var(--crimson-light)",
            letterSpacing: 6,
            textShadow: "0 0 40px rgba(139,0,0,0.95), 0 0 80px rgba(220,20,60,0.5)",
            marginBottom: 14,
            animation: "candleFlicker 2s infinite",
          }}>
            YOU ARE A TRAITOR
          </div>
          <p style={{
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            color: "var(--gold-pale, #f0d080)",
            fontSize: "1.1rem",
            maxWidth: 320,
            lineHeight: 1.5,
            marginBottom: 14,
          }}>
            You have been recruited to the traitor council. Trust no one. Suspect everyone.
          </p>
          <p style={{
            fontFamily: "var(--font-heading)",
            color: "var(--gold)",
            fontSize: "0.8rem",
            letterSpacing: 3,
          }}>
            REVEAL NOTHING.
          </p>
        </div>
      </div>
    );
  }

  // Everyone else: ambient screen
  return (
    <div className="player-screen" style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    }}>
      <div className="fade-in" style={{ textAlign: "center" }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.4rem",
          color: "var(--crimson-light)",
          letterSpacing: 4,
          marginBottom: 8,
          animation: "candleFlicker 3s infinite",
        }}>
          DARKNESS GATHERS
        </div>
        <p style={{ color: "var(--text-dim)", fontStyle: "italic", maxWidth: 320 }}>
          The traitor council is being replenished. Watch the TV.
        </p>
      </div>
    </div>
  );
}
