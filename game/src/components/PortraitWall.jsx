import PlayerPortrait from './PlayerPortrait';

// ============================================================
// PORTRAIT WALL — Grid of shield-shaped player portraits
// Shows alive/murdered/banished status with visual indicators
// ============================================================

export default function PortraitWall({ players, revealedRoles = {} }) {
  const sorted = Object.values(players).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

  return (
    <div className="portrait-wall">
      {sorted.map(player => {
        const revealed = revealedRoles[player.name];
        let statusClass = player.status || 'alive';
        if (revealed === 'faithful') statusClass += ' banished-faithful revealed-faithful';
        if (revealed === 'traitor') statusClass += ' banished-traitor revealed-traitor';

        return (
          <div key={player.name} className={`portrait ${statusClass}`}>
            <div className="portrait-frame" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PlayerPortrait
                name={player.name}
                photo={player.photo}
                size="100%"
                rounded={false}
              />
            </div>
            {player.shield && <span className="shield-icon">🛡️</span>}
            <div className="name">{player.name}</div>
          </div>
        );
      })}
    </div>
  );
}
