import { useState } from 'react';
import Timer from './Timer';
import { submitVote } from '../firebase';

// ============================================================
// VOTING SCREEN — Banishment vote on player phones
// ============================================================
export default function VotingScreen({ playerName, alivePlayers, votes, timerEnd, isTraitor, hasShield }) {
  const [selectedTarget, setSelectedTarget] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const myVote = votes[playerName];
  const hasVoted = !!myVote || submitted;

  async function handleVote() {
    if (!selectedTarget || selectedTarget === playerName) return;
    await submitVote(playerName, selectedTarget);
    setSubmitted(true);
  }

  return (
    <div className="player-screen" style={{ paddingBottom: 100 }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.5rem',
          color: 'var(--crimson-light)',
          letterSpacing: 3,
          marginBottom: 10,
        }}>
          BANISHMENT VOTE
        </div>
        <Timer timerEnd={timerEnd} />
        <p style={{ color: 'var(--text-dim)', marginTop: 10 }}>
          Choose one person to banish from the game.
        </p>
      </div>

      {!hasVoted ? (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alivePlayers
              .filter(p => p.name !== playerName)
              .map(p => (
                <button
                  key={p.name}
                  onClick={() => setSelectedTarget(p.name)}
                  style={{
                    padding: '14px 20px',
                    background: selectedTarget === p.name
                      ? 'linear-gradient(135deg, var(--crimson), var(--crimson-dark))'
                      : 'var(--dark-gray)',
                    border: `2px solid ${selectedTarget === p.name ? 'var(--crimson-light)' : 'var(--stone)'}`,
                    borderRadius: 8,
                    color: 'var(--text)',
                    fontFamily: 'var(--font-heading)',
                    fontSize: '1.1rem',
                    letterSpacing: 2,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: `2px solid ${selectedTarget === p.name ? 'var(--crimson-light)' : 'var(--stone)'}`,
                    background: selectedTarget === p.name ? 'var(--crimson-light)' : 'transparent',
                    flexShrink: 0,
                  }} />
                  {p.name}
                  {p.shield && <span style={{ marginLeft: 'auto' }}>🛡️</span>}
                </button>
              ))
            }
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleVote}
            disabled={!selectedTarget}
            style={{ width: '100%', marginTop: 20 }}
          >
            Cast Vote
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--gold)',
            letterSpacing: 2,
            marginBottom: 10,
          }}>
            VOTE CAST
          </div>
          <p style={{ color: 'var(--text-dim)' }}>
            You voted to banish <strong style={{ color: 'var(--crimson-light)' }}>
              {myVote?.target || selectedTarget}
            </strong>
          </p>
          <div style={{
            marginTop: 20,
            fontFamily: 'var(--font-heading)',
            color: 'var(--text-dim)',
            fontSize: '0.85rem',
            letterSpacing: 1,
            animation: 'pulse 2s infinite',
          }}>
            Waiting for all votes...
          </div>
        </div>
      )}

      {/* Role + Shield indicators */}
      <div style={{ position: 'fixed', bottom: 20, left: 0, right: 0, textAlign: 'center' }}>
        <span className="role-badge faithful">
          {isTraitor ? 'Traitor' : 'Faithful'}
        </span>
        {hasShield && (
          <span className="role-badge faithful" style={{ marginLeft: 8 }}>🛡️ Shield</span>
        )}
      </div>
    </div>
  );
}
