import { useEffect, useRef } from 'react';

// ============================================================
// SPECTATOR MODE — For eliminated players
// Shows traitor identities and live traitor chat
// ============================================================
export default function SpectatorMode({ player, players, gameState, traitorChat }) {
  const chatEndRef = useRef(null);
  const playerList = Object.values(players);
  const traitors = playerList.filter(p => p.role === 'traitor');
  const aliveTraitors = traitors.filter(p => p.status === 'alive');
  const chatMessages = Object.values(traitorChat || {}).sort((a, b) => a.timestamp - b.timestamp);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [traitorChat]);

  return (
    <div className="player-screen" style={{ paddingTop: 50 }}>
      {/* Spectator bar */}
      <div className="spectator-bar">
        You have been eliminated — Spectator Mode
      </div>

      {/* Warning */}
      <div className="panel panel-crimson" style={{ marginBottom: 15, textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.85rem',
          color: 'var(--crimson-light)',
          letterSpacing: 1,
        }}>
          You now know the truth. DO NOT reveal this to living players.
        </p>
      </div>

      {/* Traitor identities */}
      <div className="panel" style={{ marginBottom: 15 }}>
        <h3 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.9rem',
          color: 'var(--crimson-light)',
          letterSpacing: 2,
          marginBottom: 10,
        }}>
          THE TRAITORS AMONG YOU
        </h3>
        {traitors.map(t => (
          <div key={t.name} style={{
            padding: '6px 0',
            color: t.status === 'alive' ? 'var(--crimson-light)' : 'var(--text-dim)',
            fontFamily: 'var(--font-heading)',
            letterSpacing: 1,
          }}>
            🗡️ {t.name}
            {t.status !== 'alive' && (
              <span style={{ fontSize: '0.8rem', marginLeft: 8, color: 'var(--text-dim)' }}>
                ({t.status})
              </span>
            )}
          </div>
        ))}
        <div style={{
          marginTop: 10,
          fontSize: '0.85rem',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 1,
        }}>
          {aliveTraitors.length} traitor{aliveTraitors.length !== 1 ? 's' : ''} remain
        </div>
      </div>

      {/* Live game info */}
      <div className="panel" style={{ marginBottom: 15 }}>
        <h3 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.9rem',
          color: 'var(--gold)',
          letterSpacing: 2,
          marginBottom: 10,
        }}>
          GAME STATUS — Day {gameState.round}
        </h3>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
          Phase: <span style={{ color: 'var(--text)', textTransform: 'uppercase' }}>{gameState.phase}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {playerList.map(p => (
            <span
              key={p.name}
              style={{
                padding: '3px 10px',
                borderRadius: 12,
                fontSize: '0.8rem',
                fontFamily: 'var(--font-heading)',
                letterSpacing: 1,
                background: p.status === 'alive'
                  ? (p.role === 'traitor' ? 'rgba(139,0,0,0.3)' : 'rgba(212,175,55,0.15)')
                  : 'rgba(255,255,255,0.05)',
                color: p.status === 'alive'
                  ? (p.role === 'traitor' ? 'var(--crimson-light)' : 'var(--text)')
                  : 'var(--text-dim)',
                border: `1px solid ${p.role === 'traitor' ? 'var(--crimson-dark)' : 'var(--stone)'}`,
                textDecoration: p.status !== 'alive' ? 'line-through' : 'none',
              }}
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Traitor chat (voyeur mode) */}
      <div className="panel panel-crimson" style={{ marginBottom: 15 }}>
        <h3 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.9rem',
          color: 'var(--crimson-light)',
          letterSpacing: 2,
          marginBottom: 10,
        }}>
          TRAITOR CHAT (LIVE)
        </h3>
        <div className="traitor-chat" style={{ maxHeight: 250 }}>
          {chatMessages.length === 0 ? (
            <div style={{ padding: 15, textAlign: 'center', color: 'var(--text-dim)', fontStyle: 'italic' }}>
              {gameState.phase === 'night' ? 'Watching for traitor messages...' : 'Chat is only active during night phase.'}
            </div>
          ) : (
            chatMessages.map((msg, i) => (
              <div key={i} className="msg">
                <div className="sender">{msg.sender}</div>
                <div className="text">{msg.message}</div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Eliminated info */}
      <div style={{ textAlign: 'center', padding: 15 }}>
        <span style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.8rem',
          color: 'var(--text-dim)',
          letterSpacing: 1,
        }}>
          {player.name} — {player.status === 'murdered' ? 'Murdered' : 'Banished'}
          {' '}({player.role === 'traitor' ? 'Traitor' : 'Faithful'})
        </span>
      </div>
    </div>
  );
}
