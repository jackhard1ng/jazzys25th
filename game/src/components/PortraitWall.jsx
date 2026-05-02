import PlayerPortrait from './PlayerPortrait';

// ============================================================
// PORTRAIT WALL — Gallery of framed portraits on the TV
// Each headshot already includes a gold frame and name label,
// so we just lay them out and overlay status (murdered/banished/
// shielded/role-revealed) on top.
// ============================================================

export default function PortraitWall({ players, revealedRoles = {} }) {
  const sorted = Object.values(players).sort(
    (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)
  );

  if (sorted.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'center',
      padding: '12px 0',
    }}>
      {sorted.map(player => {
        const revealed = revealedRoles[player.name];
        const isMurdered = player.status === 'murdered';
        const isBanished = player.status === 'banished';
        const isAlive = player.status === 'alive';

        const frameColor = revealed === 'traitor' ? 'var(--crimson-light, #dc143c)'
          : revealed === 'faithful' ? 'var(--gold)'
          : isMurdered ? 'var(--crimson, #8b0000)'
          : isBanished ? 'var(--stone-light, #555)'
          : null;

        return (
          <div key={player.name} style={{
            position: 'relative',
            display: 'inline-block',
          }}>
            <PlayerPortrait
              name={player.name}
              photo={player.photo}
              width={90}
              border={frameColor ? `2px solid ${frameColor}` : undefined}
              glow={isAlive && !!player.shield}
              faded={isMurdered || isBanished}
            />

            {/* Shield indicator */}
            {player.shield && isAlive && (
              <div style={{
                position: 'absolute',
                top: -6,
                right: -6,
                fontSize: '1.3rem',
                animation: 'shieldPulse 2s infinite',
                zIndex: 2,
                filter: 'drop-shadow(0 0 6px rgba(218,165,32,0.8))',
              }}>
                🛡️
              </div>
            )}

            {/* Murdered overlay (X-ed dagger) */}
            {isMurdered && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2.5rem',
                transform: 'rotate(-25deg)',
                color: 'var(--crimson-light)',
                filter: 'drop-shadow(0 0 8px rgba(139,0,0,0.9))',
                pointerEvents: 'none',
              }}>
                🗡️
              </div>
            )}

            {/* Banished overlay (X) */}
            {isBanished && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '4rem',
                fontFamily: 'var(--font-display)',
                color: 'var(--crimson-light)',
                textShadow: '0 0 14px rgba(139,0,0,0.9)',
                pointerEvents: 'none',
              }}>
                ✕
              </div>
            )}

            {/* Role reveal label */}
            {revealed && (
              <div style={{
                position: 'absolute',
                bottom: -4,
                left: '50%',
                transform: 'translateX(-50%)',
                background: revealed === 'traitor' ? 'var(--crimson-light)' : 'var(--gold)',
                color: 'var(--black, #0a0a0a)',
                fontFamily: 'var(--font-heading)',
                fontSize: '0.6rem',
                letterSpacing: 2,
                padding: '2px 8px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>
                {revealed.toUpperCase()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
