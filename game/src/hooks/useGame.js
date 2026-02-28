import { useState, useEffect, useCallback } from 'react';
import {
  onValue, gameRef, playersRef, stateRef, configRef, votesRef,
  scrollsRef, traitorChatRef, murderVotesRef, nightRef,
} from '../firebase';

// ============================================================
// useGame — subscribes to all Firebase game state
// Returns live game data: players, state, config, votes, etc.
// ============================================================
export default function useGame() {
  const [players, setPlayers] = useState({});
  const [gameState, setGameState] = useState({
    phase: 'lobby',
    round: 0,
    timerEnd: null,
    timerDuration: null,
    murderTarget: null,
    banishedPlayer: null,
    shieldBlocked: false,
    winCondition: null,
    revealQueue: [],
    currentScrollIndex: -1,
    paused: false,
  });
  const [config, setConfig] = useState({
    numTraitors: 3,
    nightDuration: 150,
    promptsPerRound: 4,
    minCharCount: 15,
    shieldsEnabled: true,
  });
  const [votes, setVotes] = useState({});
  const [scrolls, setScrolls] = useState({});
  const [traitorChat, setTraitorChat] = useState({});
  const [murderVotes, setMurderVotes] = useState({});
  const [nightPhase, setNightPhase] = useState({ active: false });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubs = [];

    unsubs.push(onValue(playersRef, (snap) => {
      setPlayers(snap.val() || {});
      setConnected(true);
    }));

    unsubs.push(onValue(stateRef, (snap) => {
      const val = snap.val();
      if (val) setGameState(val);
    }));

    unsubs.push(onValue(configRef, (snap) => {
      const val = snap.val();
      if (val) setConfig(val);
    }));

    unsubs.push(onValue(votesRef, (snap) => {
      setVotes(snap.val() || {});
    }));

    unsubs.push(onValue(scrollsRef, (snap) => {
      setScrolls(snap.val() || {});
    }));

    unsubs.push(onValue(traitorChatRef, (snap) => {
      setTraitorChat(snap.val() || {});
    }));

    unsubs.push(onValue(murderVotesRef, (snap) => {
      setMurderVotes(snap.val() || {});
    }));

    unsubs.push(onValue(nightRef, (snap) => {
      setNightPhase(snap.val() || { active: false });
    }));

    return () => unsubs.forEach(fn => fn());
  }, []);

  // Derived data
  const playerList = Object.values(players);
  const alivePlayers = playerList.filter(p => p.status === 'alive');
  const deadPlayers = playerList.filter(p => p.status !== 'alive');
  const traitors = playerList.filter(p => p.role === 'traitor');
  const aliveTraitors = traitors.filter(p => p.status === 'alive');
  const aliveFaithful = alivePlayers.filter(p => p.role === 'faithful');

  return {
    players, playerList, alivePlayers, deadPlayers, traitors, aliveTraitors, aliveFaithful,
    gameState, config, votes, scrolls, traitorChat, murderVotes, nightPhase, connected,
  };
}
