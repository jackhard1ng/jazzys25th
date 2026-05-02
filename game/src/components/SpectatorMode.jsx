import PlayerPortrait from './PlayerPortrait';

// ============================================================
// SPECTATOR MODE — for eliminated players (murdered or banished)
// Show-accurate: the dead leave the castle and learn nothing
// new until endgame. They see only what the TV shows everyone:
// round number, who's been murdered/banished (status only).
// No traitor identities, no traitor chat, no role-colored chips.
// ============================================================
export default function SpectatorMode({ player, players, gameState }) {
  const playerList = Object.values(players);
  const aliveCount = playerList.filter(p => p.status === 'alive').length;
  const murderedCount = playerList.filter(p => p.status === 'murdered').length;
  const banishedCount = playerList.filter(p => p.status === 'banished').length;
  const wasMurdered = player.status === 'murdered';

  return (
    <div className="player-screen" style={{
      paddingTop: 40,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 20,
    }}>
      {/* Big elimination state */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(1.8rem, 6vw, 2.4rem)',
          color: 'var(--crimson-light)',
          letterSpacing: 5,
          textShadow: '0 0 24px rgba(139,0,0,0.6)',
          marginBottom: 8,
          animation: 'candleFlicker 3s infinite',
        }}>
          {wasMurdered ? 'MURDERED' : 'BANISHED'}
        </div>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.85rem',
          color: 'var(--text-dim)',
          letterSpacing: 3,
        }}>
          YOUR GAME IS OVER
        </div>
      </div>

      {/* Faded portrait of the player */}
      <div style={{ position: 'relative' }}>
        <PlayerPortrait name={player.name} photo={player.photo} width={180} faded />
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '4rem',
          color: 'var(--crimson-light)',
          textShadow: '0 0 14px rgba(139,0,0,0.9)',
          pointerEvents: 'none',
          transform: wasMurdered ? 'rotate(-25deg)' : 'none',
        }}>
          {wasMurdered ? '🗡️' : '✕'}
        </div>
      </div>

      {/* Atmospheric instruction */}
      <div className="panel" style={{ maxWidth: 360, textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-body)',
          fontStyle: 'italic',
          color: 'var(--parchment, #e8d5b0)',
          fontSize: '1.05rem',
          lineHeight: 1.5,
          marginBottom: 14,
        }}>
          {wasMurdered
            ? 'The traitors came for you in the night. Your story ends here.'
            : 'The roundtable has cast you out. Your fate has been sealed.'}
        </p>
        <p style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.8rem',
          color: 'var(--gold)',
          letterSpacing: 2,
        }}>
          WATCH THE REST UNFOLD ON THE TV
        </p>
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: '0.85rem',
          color: 'var(--text-dim)',
          marginTop: 14,
          fontStyle: 'italic',
        }}>
          Stay silent. Reveal nothing. The truth will surface at the end.
        </p>
      </div>

      {/* Light, non-spoilery status panel */}
      <div className="panel" style={{ maxWidth: 360 }}>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.8rem',
          color: 'var(--gold)',
          letterSpacing: 2,
          textAlign: 'center',
          marginBottom: 8,
        }}>
          ROUND {gameState.round || 1}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          fontFamily: 'var(--font-heading)',
          fontSize: '0.75rem',
          color: 'var(--text-dim)',
          letterSpacing: 1,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', color: 'var(--gold)', fontFamily: 'var(--font-display)' }}>{aliveCount}</div>
            <div>ALIVE</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', color: 'var(--crimson-light)', fontFamily: 'var(--font-display)' }}>{murderedCount}</div>
            <div>MURDERED</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{banishedCount}</div>
            <div>BANISHED</div>
          </div>
        </div>
      </div>
    </div>
  );
}
