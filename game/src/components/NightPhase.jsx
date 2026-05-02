import { useState, useEffect, useRef } from 'react';
import Timer from './Timer';
import PlayerPortrait from './PlayerPortrait';
import useTimer from '../hooks/useTimer';
import {
  submitScrolls, sendTraitorMessage, submitMurderVote,
  onValue, ref, db,
} from '../firebase';

// ============================================================
// NIGHT PHASE
// Faithful: Answer prompts (4-5 per round, mix of game + filler)
// Traitors: Same UI but prompts are optional, plus secret chat + murder vote
// ============================================================
export default function NightPhase({
  player, playerName, isTraitor, alivePlayers, config,
  nightPhase, timerEnd, round, traitorChat, murderVotes,
}) {
  const prompts = nightPhase?.prompts || [];
  const { timeLeft, isExpired } = useTimer(timerEnd);

  // Prompt responses (parallel arrays: text + signed flag) — one entry per prompt
  const [responses, setResponses] = useState([]);
  const [signedFlags, setSignedFlags] = useState([]);
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [bonusMode, setBonusMode] = useState(false);

  // Traitor chat tab. Default to the SCROLLS view so traitors see the
  // questions immediately (and so faithful, looking over a shoulder, see
  // the same first screen as the traitor). Traitors can flip to the
  // chat / murder-vote tab themselves.
  const [showTraitorChat, setShowTraitorChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [murderTarget, setMurderTarget] = useState('');
  const chatEndRef = useRef(null);

  // Reset all per-round state whenever the round number changes (or the
  // host kicks off a fresh set of prompts mid-round). Without this, a
  // player who finished round 1 would still see the "all submitted"
  // screen when round 2's prompts arrive — they'd have to refresh.
  useEffect(() => {
    setResponses(new Array(prompts.length).fill(''));
    setSignedFlags(new Array(prompts.length).fill(false));
    setAllSubmitted(false);
    setBonusMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, prompts.length]);

  // Auto-scroll traitor chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [traitorChat]);

  // Bonus prompts for faithful players who finish early
  const BONUS_PROMPTS = [
    "Write a message to be read at tomorrow's roundtable: make an accusation.",
    "If you could whisper a warning to one person, what would you say?",
    "What's your gut feeling about who is a traitor right now?",
    "Write a secret message that could save the faithful.",
  ];
  const [bonusIdx, setBonusIdx] = useState(0);
  const [bonusText, setBonusText] = useState('');

  function buildScrollData(textArr, signArr) {
    return prompts.map((p, i) => {
      const mode = p.mode || (p.isGame ? 'optional' : 'filler');
      const signed = mode === 'signed' ? true
        : mode === 'optional' ? !!signArr[i]
        : false;
      return {
        text: textArr[i] || '',
        mode,
        prompt: p.text,
        signed,
      };
    });
  }

  function updateResponse(i, text) {
    setResponses(prev => {
      const next = [...prev];
      next[i] = text;
      return next;
    });
  }

  function updateSigned(i, signed) {
    setSignedFlags(prev => {
      const next = [...prev];
      next[i] = signed;
      return next;
    });
  }

  function handleSubmitAll() {
    submitScrolls(round, playerName, buildScrollData(responses, signedFlags));
    setAllSubmitted(true);
    if (!isTraitor) setBonusMode(true);
  }

  // Auto-submit whatever is typed when the timer hits zero.
  useEffect(() => {
    if (!isExpired || allSubmitted || prompts.length === 0) return;
    submitScrolls(round, playerName, buildScrollData(responses, signedFlags));
    setAllSubmitted(true);
  }, [isExpired]);

  function handleBonusSubmit() {
    if (!bonusText.trim()) return;
    // Bonus prompts are anonymous-optional scrolls (always anonymous here).
    submitScrolls(round, `${playerName}_bonus_${bonusIdx}`, [{
      text: bonusText,
      mode: 'optional',
      prompt: BONUS_PROMPTS[bonusIdx],
      signed: false,
    }]);
    setBonusText('');
    setBonusIdx(bonusIdx + 1);
  }

  async function handleSendChat() {
    if (!chatInput.trim()) return;
    await sendTraitorMessage(playerName, chatInput.trim());
    setChatInput('');
  }

  async function handleMurderVote(target) {
    setMurderTarget(target);
    await submitMurderVote(playerName, target);
  }

  // Get traitor chat messages as sorted array
  const chatMessages = Object.values(traitorChat || {}).sort((a, b) => a.timestamp - b.timestamp);

  // Get murder vote status
  const murderVoteEntries = Object.entries(murderVotes || {});
  const myMurderVote = murderVotes?.[playerName]?.target || murderTarget;

  // Murder targets: alive, non-traitor, and NOT shielded (shields are
  // earned in the challenge round and protect that player from murder).
  const validTargets = alivePlayers.filter(p => p.role !== 'traitor' && !p.shield);
  const shieldedFaithful = alivePlayers.filter(p => p.role !== 'traitor' && p.shield);

  return (
    <div className="player-screen" style={{
      background: 'radial-gradient(ellipse at center, rgba(15,15,15,1), var(--black))',
      paddingBottom: isTraitor ? 80 : 100,
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 15 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.3rem',
          color: 'var(--gold)',
          letterSpacing: 3,
          marginBottom: 5,
        }}>
          Night Phase
        </div>
        <Timer timerEnd={timerEnd} />
        <div style={{ marginTop: 8 }}>
          <span className="role-badge faithful">
            {isTraitor ? 'Traitor' : 'Faithful'}
          </span>
        </div>
      </div>

      {/* ============================================================
          TRAITOR: Toggle between prompts and secret chat
          ============================================================ */}
      {isTraitor && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 15 }}>
          <button
            onClick={() => setShowTraitorChat(false)}
            style={{
              flex: 1,
              padding: '10px',
              background: !showTraitorChat ? 'var(--dark-gray)' : 'transparent',
              border: '1px solid var(--stone)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: !showTraitorChat ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.8rem',
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            SCROLLS
          </button>
          <button
            onClick={() => setShowTraitorChat(true)}
            style={{
              flex: 1,
              padding: '10px',
              background: showTraitorChat ? 'rgba(212,175,55,0.15)' : 'transparent',
              border: `1px solid ${showTraitorChat ? 'var(--gold)' : 'var(--stone)'}`,
              borderRadius: '0 8px 8px 0',
              color: showTraitorChat ? 'var(--gold)' : 'var(--text-dim)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.8rem',
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            SECRET
          </button>
        </div>
      )}

      {/* ============================================================
          PROMPT INTERFACE (visible to all, identical UI)
          ============================================================ */}
      {(!isTraitor || !showTraitorChat) && (
        <div className="fade-in">
          {!allSubmitted && prompts.length > 0 ? (
            <div>
              <div style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '0.75rem',
                color: 'var(--text-dim)',
                letterSpacing: 2,
                textAlign: 'center',
                marginBottom: 12,
              }}>
                {prompts.length} SCROLL{prompts.length !== 1 ? 'S' : ''} — ANSWER ANY OR ALL
              </div>

              {prompts.map((p, i) => {
                const mode = p?.mode;
                const badge = mode === 'signed'
                  ? { label: 'PUBLIC · SIGNED', color: 'var(--gold)' }
                  : mode === 'optional'
                    ? { label: 'PUBLIC · YOU CHOOSE', color: 'var(--crimson-light)' }
                    : { label: 'PRIVATE · COVER', color: 'var(--text-dim)' };
                return (
                  <div key={i} className="panel" style={{ marginBottom: 12 }}>
                    <div style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.65rem',
                      letterSpacing: 2,
                      color: badge.color,
                      border: `1px solid ${badge.color}`,
                      borderRadius: 4,
                      marginBottom: 8,
                      opacity: 0.9,
                    }}>
                      {badge.label}
                    </div>

                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: '1.15rem',
                      fontStyle: 'italic',
                      color: 'var(--gold)',
                      marginBottom: 10,
                      lineHeight: 1.4,
                    }}>
                      "{p?.text}"
                    </div>

                    <textarea
                      className="input"
                      placeholder="Write your response..."
                      value={responses[i] || ''}
                      onChange={e => updateResponse(i, e.target.value)}
                      rows={3}
                      style={{ marginBottom: 8 }}
                    />

                    {mode === 'optional' && (
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontFamily: 'var(--font-heading)',
                        fontSize: '0.75rem',
                        letterSpacing: 1,
                        color: signedFlags[i] ? 'var(--gold)' : 'var(--text-dim)',
                        cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={!!signedFlags[i]}
                          onChange={e => updateSigned(i, e.target.checked)}
                          style={{ accentColor: 'var(--gold)', width: 16, height: 16 }}
                        />
                        {signedFlags[i] ? `Signed as ${playerName}` : 'Anonymous (tap to sign)'}
                      </label>
                    )}
                    {mode === 'signed' && (
                      <div style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '0.7rem',
                        letterSpacing: 1,
                        color: 'var(--gold)',
                      }}>
                        This scroll will display your name on the TV.
                      </div>
                    )}
                    {mode === 'filler' && (
                      <div style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '0.7rem',
                        letterSpacing: 1,
                        color: 'var(--text-dim)',
                      }}>
                        Private — never displayed. Skip if you want.
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                className="btn btn-primary btn-lg"
                onClick={handleSubmitAll}
                style={{ width: '100%', marginTop: 4 }}
              >
                Submit All Scrolls
              </button>
            </div>
          ) : allSubmitted && !isTraitor ? (
            /* WAITING / BONUS PROMPTS for faithful */
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontFamily: 'var(--font-heading)',
                color: 'var(--gold)',
                letterSpacing: 2,
                marginBottom: 15,
              }}>
                All scrolls submitted.
              </div>

              {bonusMode && bonusIdx < BONUS_PROMPTS.length && (
                <div className="panel fade-in-up" style={{ marginBottom: 15 }}>
                  <div style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '0.75rem',
                    color: 'var(--gold-dark)',
                    letterSpacing: 1,
                    marginBottom: 8,
                  }}>
                    BONUS SCROLL
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '1.1rem',
                    fontStyle: 'italic',
                    color: 'var(--gold)',
                    marginBottom: 10,
                  }}>
                    "{BONUS_PROMPTS[bonusIdx]}"
                  </div>
                  <textarea
                    className="input"
                    placeholder="Write your response..."
                    value={bonusText}
                    onChange={e => setBonusText(e.target.value)}
                    rows={3}
                    style={{ marginBottom: 10 }}
                  />
                  <button
                    className="btn btn-gold"
                    onClick={handleBonusSubmit}
                    disabled={!bonusText.trim()}
                    style={{ width: '100%' }}
                  >
                    Submit Bonus Scroll
                  </button>
                </div>
              )}

              {(!bonusMode || bonusIdx >= BONUS_PROMPTS.length) && (
                <div style={{ padding: 30 }}>
                  <div style={{
                    fontFamily: 'var(--font-heading)',
                    color: 'var(--text-dim)',
                    letterSpacing: 2,
                    animation: 'pulse 2s infinite',
                  }}>
                    Waiting for all scrolls to be submitted...
                  </div>
                  {/* Ambient animation */}
                  <div style={{
                    marginTop: 20,
                    fontSize: '3rem',
                    animation: 'candleFlicker 4s infinite',
                    opacity: 0.3,
                  }}>
                    🕯️
                  </div>
                </div>
              )}
            </div>
          ) : allSubmitted && isTraitor ? (
            <div style={{ textAlign: 'center', padding: 15 }}>
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1 }}>
                Scrolls submitted. Use the Secret tab to coordinate.
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* ============================================================
          TRAITOR SECRET CHAT + MURDER VOTE
          ============================================================ */}
      {isTraitor && showTraitorChat && (
        <div className="fade-in">
          {/* Chat messages */}
          <div className="traitor-chat" style={{ marginBottom: 15 }}>
            {chatMessages.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                The traitor council is in session...
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

          {/* Chat input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              className="input"
              placeholder="Message your fellow traitors..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendChat()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSendChat}>
              Send
            </button>
          </div>

          {/* Murder Vote */}
          <div className="panel">
            <h3 style={{
              fontFamily: 'var(--font-heading)',
              color: 'var(--gold)',
              fontSize: '0.85rem',
              letterSpacing: 2,
              marginBottom: 10,
            }}>
              MURDER VOTE
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 10 }}>
              Vote early, change your mind freely. Majority rules. Ties at the end → cpu picks at random from the tied targets.
            </p>

            {validTargets.length === 0 ? (
              <p style={{ color: 'var(--crimson-light)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                No valid targets — every faithful is shielded tonight.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                {validTargets.map(p => {
                  const selected = myMurderVote === p.name;
                  return (
                    <button
                      key={p.name}
                      onClick={() => handleMurderVote(p.name)}
                      style={{
                        background: 'transparent',
                        border: selected ? '2px solid var(--crimson-light)' : '2px solid transparent',
                        borderRadius: 6,
                        padding: 3,
                        cursor: 'pointer',
                        transition: 'transform 0.15s',
                      }}
                    >
                      <PlayerPortrait name={p.name} photo={p.photo} width={80} glow={selected} />
                    </button>
                  );
                })}
              </div>
            )}

            {shieldedFaithful.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: 1.5, marginBottom: 6 }}>
                  PROTECTED TONIGHT
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                  {shieldedFaithful.map(p => (
                    <div key={p.name} style={{ position: 'relative' }}>
                      <PlayerPortrait name={p.name} photo={p.photo} width={64} faded />
                      <div style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        fontSize: '1rem',
                        filter: 'drop-shadow(0 0 6px rgba(218,165,32,0.8))',
                      }}>🛡️</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Show current murder vote status */}
            {murderVoteEntries.length > 0 && (
              <div style={{ marginTop: 10, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                {murderVoteEntries.map(([voter, vote]) => (
                  <div key={voter} style={{ padding: '2px 0' }}>
                    <span style={{ color: 'var(--gold)' }}>{voter}</span>
                    {' → '}
                    <span style={{ color: 'var(--text)' }}>{vote.target}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
