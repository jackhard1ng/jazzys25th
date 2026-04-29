import { useState, useEffect, useRef } from 'react';
import Timer from './Timer';
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

  // Prompt responses (parallel arrays: text + signed flag)
  const [responses, setResponses] = useState([]);
  const [signedFlags, setSignedFlags] = useState([]);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [signCurrent, setSignCurrent] = useState(false);
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [bonusMode, setBonusMode] = useState(false);

  // Traitor chat
  const [showTraitorChat, setShowTraitorChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [murderTarget, setMurderTarget] = useState('');
  const chatEndRef = useRef(null);

  const minChars = config.minCharCount || 15;

  // Initialize responses array when prompts load
  useEffect(() => {
    if (prompts.length > 0 && responses.length === 0) {
      setResponses(new Array(prompts.length).fill(''));
      setSignedFlags(new Array(prompts.length).fill(false));
      setCurrentPromptIdx(0);
      setCurrentText('');
      setSignCurrent(false);
      setAllSubmitted(false);
      setBonusMode(false);
    }
  }, [prompts.length]);

  // When advancing to a new prompt, reset the per-prompt sign toggle.
  useEffect(() => {
    setSignCurrent(false);
  }, [currentPromptIdx]);

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

  function handleSubmitResponse() {
    if (currentText.length < minChars && !isTraitor) return;

    const newResponses = [...responses];
    const newSigned = [...signedFlags];
    newResponses[currentPromptIdx] = currentText;
    newSigned[currentPromptIdx] = signCurrent;
    setResponses(newResponses);
    setSignedFlags(newSigned);

    if (currentPromptIdx < prompts.length - 1) {
      setCurrentPromptIdx(currentPromptIdx + 1);
      setCurrentText('');
    } else {
      submitScrolls(round, playerName, buildScrollData(newResponses, newSigned));
      setAllSubmitted(true);
      if (!isTraitor) setBonusMode(true);
    }
  }

  function handleSkipPrompt() {
    if (!isTraitor) return;
    const newResponses = [...responses];
    const newSigned = [...signedFlags];
    newResponses[currentPromptIdx] = '';
    newSigned[currentPromptIdx] = false;
    setResponses(newResponses);
    setSignedFlags(newSigned);

    if (currentPromptIdx < prompts.length - 1) {
      setCurrentPromptIdx(currentPromptIdx + 1);
      setCurrentText('');
    } else {
      submitScrolls(round, playerName, buildScrollData(newResponses, newSigned));
      setAllSubmitted(true);
    }
  }

  // Auto-submit whatever is typed when the timer hits zero.
  useEffect(() => {
    if (!isExpired || allSubmitted || prompts.length === 0) return;
    const finalText = [...responses];
    const finalSigned = [...signedFlags];
    finalText[currentPromptIdx] = currentText; // capture in-progress prompt
    finalSigned[currentPromptIdx] = signCurrent;
    submitScrolls(round, playerName, buildScrollData(finalText, finalSigned));
    setAllSubmitted(true);
  }, [isExpired]);

  function handleBonusSubmit() {
    if (bonusText.length < minChars) return;
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

  // Non-traitor targets for murder (alive, non-traitor)
  const validTargets = alivePlayers.filter(p => p.role !== 'traitor');

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
            <div className="panel" style={{ marginBottom: 15 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}>
                <span style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.75rem',
                  color: 'var(--text-dim)',
                  letterSpacing: 1,
                }}>
                  SCROLL {currentPromptIdx + 1} OF {prompts.length}
                </span>
                <span style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.75rem',
                  color: currentText.length >= minChars ? 'var(--green-light)' : 'var(--text-dim)',
                  letterSpacing: 1,
                }}>
                  {currentText.length}/{minChars} MIN
                </span>
              </div>

              {/* Mode badge */}
              {(() => {
                const mode = prompts[currentPromptIdx]?.mode;
                const badge = mode === 'signed'
                  ? { label: 'PUBLIC · SIGNED', color: 'var(--gold)' }
                  : mode === 'optional'
                    ? { label: 'PUBLIC · YOU CHOOSE', color: 'var(--crimson-light)' }
                    : { label: 'PRIVATE · COVER', color: 'var(--text-dim)' };
                return (
                  <div style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    fontFamily: 'var(--font-heading)',
                    fontSize: '0.65rem',
                    letterSpacing: 2,
                    color: badge.color,
                    border: `1px solid ${badge.color}`,
                    borderRadius: 4,
                    marginBottom: 10,
                    opacity: 0.9,
                  }}>
                    {badge.label}
                  </div>
                );
              })()}

              {/* Prompt text */}
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: '1.2rem',
                fontStyle: 'italic',
                color: 'var(--gold)',
                marginBottom: 12,
                lineHeight: 1.4,
              }}>
                "{prompts[currentPromptIdx]?.text}"
              </div>

              {/* Response input */}
              <textarea
                className="input"
                placeholder="Write your response..."
                value={currentText}
                onChange={e => setCurrentText(e.target.value)}
                rows={3}
                style={{ marginBottom: 10 }}
              />

              {/* Sign-name UI: optional prompts only. Signed prompts are always signed. */}
              {prompts[currentPromptIdx]?.mode === 'optional' && (
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.8rem',
                  letterSpacing: 1,
                  color: signCurrent ? 'var(--gold)' : 'var(--text-dim)',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={signCurrent}
                    onChange={e => setSignCurrent(e.target.checked)}
                    style={{ accentColor: 'var(--gold)', width: 16, height: 16 }}
                  />
                  {signCurrent ? `Signed as ${playerName}` : 'Anonymous (tap to sign)'}
                </label>
              )}
              {prompts[currentPromptIdx]?.mode === 'signed' && (
                <div style={{
                  marginBottom: 10,
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.75rem',
                  letterSpacing: 1,
                  color: 'var(--gold)',
                }}>
                  This scroll will display your name on the TV.
                </div>
              )}
              {prompts[currentPromptIdx]?.mode === 'filler' && (
                <div style={{
                  marginBottom: 10,
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.75rem',
                  letterSpacing: 1,
                  color: 'var(--text-dim)',
                }}>
                  This scroll is private — never displayed.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitResponse}
                  disabled={!isTraitor && currentText.length < minChars}
                  style={{ flex: 1 }}
                >
                  {currentPromptIdx < prompts.length - 1 ? 'Next' : 'Submit All'}
                </button>
                {isTraitor && (
                  <button
                    className="btn btn-dark btn-sm"
                    onClick={handleSkipPrompt}
                  >
                    Skip
                  </button>
                )}
              </div>

              {/* Progress dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                {prompts.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: i < currentPromptIdx ? 'var(--gold)'
                        : i === currentPromptIdx ? 'var(--gold-bright, #FFD700)'
                        : 'var(--stone)',
                      transition: 'background 0.3s',
                    }}
                  />
                ))}
              </div>
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
                    disabled={bonusText.length < minChars}
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
              All traitors must agree on a target. Majority rules.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {validTargets.map(p => (
                <button
                  key={p.name}
                  className={`btn btn-sm ${myMurderVote === p.name ? 'btn-primary' : 'btn-dark'}`}
                  onClick={() => handleMurderVote(p.name)}
                  style={{ fontSize: '0.8rem', position: 'relative' }}
                >
                  {p.name}
                  {p.shield && <span style={{ marginLeft: 4 }}>🛡️</span>}
                </button>
              ))}
            </div>

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
