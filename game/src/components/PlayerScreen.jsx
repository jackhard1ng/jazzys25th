import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import useGame from '../hooks/useGame';
import useTimer from '../hooks/useTimer';
import Timer from './Timer';
import NightPhase from './NightPhase';
import VotingScreen from './VotingScreen';
import SpectatorMode from './SpectatorMode';
import { addPlayer, updatePlayerPhoto } from '../firebase';

// Per-browser session ID — proves "I'm the same person who joined as this name"
// so a different device can't accidentally take over your identity.
function getSessionId() {
  let id = localStorage.getItem('traitors_session');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('traitors_session', id);
  }
  return id;
}

// ============================================================
// PLAYER SCREEN — the mobile phone experience
// Handles: Join → Lobby → Role Reveal → Night → Day → Vote → etc.
// ============================================================
export default function PlayerScreen() {
  const {
    players, playerList, alivePlayers,
    gameState, config, votes, traitorChat, murderVotes, nightPhase,
    connected,
  } = useGame();

  const { phase, round, timerEnd, murderTarget, banishedPlayer, shieldBlocked, winCondition } = gameState;

  const [playerName, setPlayerName] = useState(() => localStorage.getItem('traitors_name') || '');
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const sessionId = getSessionId();
  const player = players[playerName] || null;
  const isAlive = player?.status === 'alive';
  const isTraitor = player?.role === 'traitor';
  const isFaithful = player?.role === 'faithful';

  // Auto-rejoin only if THIS browser owns the player record (matching sessionId).
  // This prevents accidentally inheriting someone else's identity when a stale
  // name lingers in localStorage.
  useEffect(() => {
    if (!playerName || joined) return;
    const existing = players[playerName];
    if (!existing) return;
    if (!existing.sessionId || existing.sessionId === sessionId) {
      setJoined(true);
    } else {
      // Someone else owns this name — clear the stale localStorage and force re-entry.
      localStorage.removeItem('traitors_name');
      setPlayerName('');
    }
  }, [playerName, players, joined, sessionId]);

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

  async function handleJoin() {
    const name = nameInput.trim();
    if (!name) return;
    setJoinError('');
    const result = await addPlayer(name, sessionId);
    if (result.ok) {
      setPlayerName(name);
      localStorage.setItem('traitors_name', name);
      setJoined(true);
    } else if (result.reason === 'taken') {
      setJoinError(`"${name}" is already in the game on another device. Pick a different name (try adding your last initial).`);
    }
  }

  // Compress and upload photo
  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !playerName) return;
    setUploadingPhoto(true);
    try {
      const dataUrl = await compressImage(file, 150, 0.7);
      await updatePlayerPhoto(playerName, dataUrl);
    } catch (err) {
      console.error('Photo upload failed:', err);
    }
    setUploadingPhoto(false);
  }

  function compressImage(file, maxSize, quality) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          // Crop to square from center
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          canvas.width = maxSize;
          canvas.height = maxSize;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // JOIN SCREEN
  // ============================================================
  if (!joined) {
    return (
      <div className="player-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2rem',
          color: 'var(--gold)',
          textAlign: 'center',
          letterSpacing: 4,
          animation: 'candleFlicker 3s infinite',
          marginBottom: 10,
        }}>
          The Traitors
        </div>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '1rem',
          color: 'var(--text-dim)',
          textAlign: 'center',
          letterSpacing: 2,
          marginBottom: 40,
        }}>
          Jazzy's Birthday
        </div>

        <div className="panel" style={{ width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', marginBottom: 15, textAlign: 'center', letterSpacing: 2 }}>
            ENTER THE GAME
          </h2>
          <input
            className="input"
            placeholder="Enter your name..."
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            autoFocus
            style={{ marginBottom: 15, textAlign: 'center', fontSize: '1.3rem' }}
          />
          <button
            className="btn btn-primary btn-lg"
            onClick={handleJoin}
            disabled={!nameInput.trim()}
            style={{ width: '100%' }}
          >
            Join
          </button>
          {joinError && (
            <p style={{
              color: 'var(--crimson-light)',
              marginTop: 12,
              fontFamily: 'var(--font-heading)',
              fontSize: '0.8rem',
              letterSpacing: 1,
              textAlign: 'center',
            }}>
              {joinError}
            </p>
          )}
        </div>

        {!connected && (
          <p style={{ color: 'var(--crimson-light)', marginTop: 20, fontFamily: 'var(--font-heading)', fontSize: '0.85rem' }}>
            Connecting to server...
          </p>
        )}

        <Link
          to="/host"
          style={{
            marginTop: 30,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.7rem',
            letterSpacing: 2,
            textDecoration: 'none',
            opacity: 0.6,
          }}
        >
          HOST DASHBOARD →
        </Link>
      </div>
    );
  }

  // ============================================================
  // SPECTATOR MODE (eliminated players)
  // ============================================================
  if (player && !isAlive && phase !== 'lobby' && phase !== 'endgame') {
    return <SpectatorMode player={player} players={players} gameState={gameState} traitorChat={traitorChat} />;
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

        <div className="panel" style={{ margin: '30px 0' }}>
          <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2, marginBottom: 5 }}>
            Welcome, {playerName}
          </div>
          <p style={{ color: 'var(--text-dim)' }}>Waiting for the host to start the game...</p>
          <div style={{ marginTop: 15, color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', fontSize: '0.85rem' }}>
            {playerList.length} player{playerList.length !== 1 ? 's' : ''} connected
          </div>
        </div>

        {/* Photo upload */}
        <div className="panel" style={{ margin: '0 0 30px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--gold)', letterSpacing: 2, marginBottom: 10, fontSize: '0.85rem' }}>
            ADD YOUR HEADSHOT
          </div>
          {player?.photo ? (
            <div style={{ marginBottom: 10 }}>
              <img
                src={player.photo}
                alt={playerName}
                style={{
                  width: 100, height: 100, borderRadius: '50%',
                  border: '3px solid var(--gold-dark)',
                  objectFit: 'cover',
                }}
              />
            </div>
          ) : (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 10 }}>
              Upload a photo so everyone knows who you are
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={handlePhotoUpload}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              className="btn btn-sm btn-gold"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? 'Uploading...' : player?.photo ? 'Change Photo' : 'Take Selfie'}
            </button>
          </div>
        </div>

        <div className="player-list" style={{ justifyContent: 'center' }}>
          {playerList.map(p => (
            <div key={p.name} className="player-chip">
              {p.photo ? (
                <img src={p.photo} alt={p.name} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span className="dot" />
              )}
              {p.name}
            </div>
          ))}
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
  // VOTING
  // ============================================================
  if (phase === 'voting') {
    return (
      <VotingScreen
        playerName={playerName}
        alivePlayers={alivePlayers}
        votes={votes}
        timerEnd={timerEnd}
        isTraitor={isTraitor}
        hasShield={player?.shield}
      />
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
