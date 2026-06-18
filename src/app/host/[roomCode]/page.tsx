"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import PartySocket from "partysocket";
import BuzzQueue from "@/components/BuzzQueue";
import ScoreBoard from "@/components/ScoreBoard";
import Timer from "@/components/Timer";
import RoomSettings from "@/components/RoomSettings";
import { playBuzz, playCorrect, playIncorrect, playOpen, unlockAudio } from "@/lib/sounds";
import type { RoomState, ServerMessage, RoomConfig } from "@/lib/types";

const DEFAULT_TEAM_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];

export default function HostPage() {
  const params = useParams();
  const roomCode = (params.roomCode as string).toUpperCase();

  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [setupMode, setSetupMode] = useState(true);
  const [teamCount, setTeamCount] = useState(4);
  const [teamNames, setTeamNames] = useState<string[]>(DEFAULT_TEAM_NAMES.slice(0, 4));
  const wsRef = useRef<PartySocket | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}`
    : "";

  useEffect(() => {
    unlockAudio();

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
    const ws = new PartySocket({ host, room: roomCode });
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "host:join" }));
    });

    ws.addEventListener("close", () => setConnected(false));

    ws.addEventListener("message", (evt) => {
      const msg: ServerMessage = JSON.parse(evt.data);

      switch (msg.type) {
        case "state":
          setState(msg.state);
          if (msg.state.teams.length > 0) {
            setSetupMode(false);
          }
          break;
        case "buzz":
          playBuzz();
          break;
        case "buzz:opened":
          playOpen();
          break;
        case "correct":
          playCorrect();
          break;
        case "incorrect":
        case "timer:expired":
          playIncorrect();
          break;
      }
    });

    return () => {
      ws.close();
    };
  }, [roomCode]);

  useEffect(() => {
    if (!joinUrl || !showQR) return;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(joinUrl, {
        width: 256,
        margin: 2,
        color: { dark: "#ffffff", light: "#00000000" },
      }).then((url: string) => setQrDataUrl(url));
    });
  }, [joinUrl, showQR]);

  const send = useCallback(
    (msg: Record<string, unknown>) => {
      wsRef.current?.send(JSON.stringify(msg));
    },
    []
  );

  function handleSetupTeams() {
    const names = teamNames.slice(0, teamCount).filter((n) => n.trim());
    if (names.length < 2) return;
    send({ type: "host:setup-teams", teamNames: names });
    setSetupMode(false);
  }

  function copyJoinInfo() {
    if (!state) return;
    const lines = [
      `Quiz Buzzer - Room: ${roomCode}`,
      `Go to: ${joinUrl}`,
      ``,
      `Teams:`,
      ...state.teams.map((t) => `  ${t.name} → Code: ${t.code}`),
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Setup mode
  if (setupMode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-black mb-1">SET UP TEAMS</h1>
          <p className="text-zinc-500 text-sm">
            Room: <span className="text-white font-bold tracking-[0.2em]">{roomCode}</span>
          </p>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Number of teams</label>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setTeamCount(n);
                    setTeamNames((prev) => {
                      const next = [...prev];
                      while (next.length < n)
                        next.push(DEFAULT_TEAM_NAMES[next.length] || `Team ${next.length + 1}`);
                      return next;
                    });
                  }}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${
                    teamCount === n
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {Array.from({ length: teamCount }).map((_, i) => (
            <input
              key={i}
              type="text"
              value={teamNames[i] || ""}
              onChange={(e) => {
                const next = [...teamNames];
                next[i] = e.target.value;
                setTeamNames(next);
              }}
              placeholder={`Team ${i + 1}`}
              className="w-full py-2 px-3 bg-zinc-900 border border-zinc-700 rounded-lg
                text-sm focus:outline-none focus:border-zinc-500"
            />
          ))}

          <button
            onClick={handleSetupTeams}
            className="w-full py-3 bg-white text-black font-bold rounded-xl
              hover:bg-zinc-200 active:scale-95 transition-all"
          >
            CREATE TEAMS
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-500 animate-pulse">Connecting...</div>
      </div>
    );
  }

  const currentBuzzEntry = state.currentBuzzer
    ? state.buzzQueue.find((b) => b.teamId === state.currentBuzzer)
    : null;
  const playersOnline = state.players.filter((p) => p.connected).length;

  return (
    <div className="flex-1 flex flex-col overflow-auto" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black tracking-tight">BUZZ</h1>
          <span className="text-zinc-500 text-sm">HOST</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 text-sm">Q{state.questionNumber}</span>
          <span className="text-zinc-500 text-xs">{playersOnline} online</span>
          <div
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
          />
        </div>
      </div>

      {/* Room Code + Team Codes */}
      <div className="px-4 py-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">Room Code</div>
            <div className="text-3xl font-black tracking-[0.2em]">{roomCode}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyJoinInfo}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg
                text-zinc-400 hover:text-white transition-colors"
            >
              {copied ? "Copied!" : "Copy Info"}
            </button>
            <button
              onClick={() => setShowQR(!showQR)}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg
                text-zinc-400 hover:text-white transition-colors"
            >
              QR
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {state.teams.map((team) => {
            const teamPlayers = state.players.filter((p) => p.teamId === team.id);
            const onlineCount = teamPlayers.filter((p) => p.connected).length;
            return (
              <div
                key={team.id}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-lg text-xs"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                <span className="text-zinc-400">{team.name}</span>
                <span className="font-bold text-white tracking-wider">{team.code}</span>
                <span className="text-zinc-600">{onlineCount}p</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* QR Modal */}
      {showQR && qrDataUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          onClick={() => setShowQR(false)}
        >
          <div className="text-center" onClick={(e) => e.stopPropagation()}>
            <img src={qrDataUrl} alt="QR" className="w-64 h-64 mx-auto" />
            <p className="text-zinc-400 text-sm mt-4">{joinUrl}</p>
            <p className="text-4xl font-black tracking-[0.3em] mt-2">{roomCode}</p>
            <div className="mt-4 space-y-1">
              {state.teams.map((t) => (
                <p key={t.id} className="text-sm">
                  <span style={{ color: t.color }}>{t.name}</span>
                  <span className="text-zinc-500"> → </span>
                  <span className="text-white font-bold">{t.code}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row overflow-auto">
        {/* Left: Scores + Players */}
        <div className="lg:w-72 p-4 border-b lg:border-b-0 lg:border-r border-zinc-800/50">
          <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Teams</h2>
          <ScoreBoard teams={state.teams} players={state.players} />
        </div>

        {/* Center: Buzz Queue + Controls */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  state.phase === "open"
                    ? "bg-green-500 animate-pulse"
                    : state.phase === "buzzed"
                    ? "bg-yellow-500"
                    : "bg-zinc-600"
                }`}
              />
              <span className="text-sm font-medium text-zinc-400 uppercase">
                {state.phase === "open"
                  ? "Buzzers Open"
                  : state.phase === "buzzed"
                  ? currentBuzzEntry
                    ? `${currentBuzzEntry.playerName} (${currentBuzzEntry.teamName}) answering`
                    : "Answering..."
                  : state.phase === "lobby"
                  ? "Waiting for teams"
                  : "Ready"}
              </span>
            </div>
          </div>

          {state.answerTimerEnd && (
            <div className="mb-4">
              <Timer endsAt={state.answerTimerEnd} totalSeconds={state.config.answerTimerSeconds} />
            </div>
          )}

          <div className="flex-1 mb-4">
            <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Buzz Order</h2>
            <BuzzQueue queue={state.buzzQueue} currentBuzzer={state.currentBuzzer} />
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              {state.phase === "open" ? (
                <button
                  onClick={() => send({ type: "host:lock-buzzer" })}
                  className="flex-1 py-3 px-4 bg-zinc-700 text-white font-bold rounded-xl
                    hover:bg-zinc-600 active:scale-[0.98] transition-all"
                >
                  LOCK BUZZERS
                </button>
              ) : (
                <button
                  onClick={() => send({ type: "host:open-buzzer" })}
                  className="flex-1 py-3 px-4 bg-green-600 text-white font-bold rounded-xl
                    hover:bg-green-500 active:scale-[0.98] transition-all"
                >
                  OPEN BUZZERS
                </button>
              )}
              <button
                onClick={() => send({ type: "host:reset-buzzers" })}
                className="py-3 px-4 bg-zinc-800 text-zinc-300 font-bold rounded-xl
                  hover:bg-zinc-700 active:scale-[0.98] transition-all border border-zinc-700"
              >
                RESET
              </button>
            </div>

            {state.currentBuzzer && (
              <div className="flex gap-2">
                <button
                  onClick={() => send({ type: "host:correct", points: 10 })}
                  className="flex-1 py-3 px-4 bg-green-600/20 text-green-400 font-bold rounded-xl
                    border border-green-600/30 hover:bg-green-600/30 active:scale-[0.98] transition-all"
                >
                  CORRECT
                </button>
                <button
                  onClick={() => send({ type: "host:incorrect" })}
                  className="flex-1 py-3 px-4 bg-red-600/20 text-red-400 font-bold rounded-xl
                    border border-red-600/30 hover:bg-red-600/30 active:scale-[0.98] transition-all"
                >
                  WRONG
                </button>
              </div>
            )}

            <button
              onClick={() => send({ type: "host:new-question" })}
              className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
            >
              Next Question
            </button>

            <RoomSettings
              config={state.config}
              onChange={(updates) => send({ type: "host:update-config", config: updates })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
