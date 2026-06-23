"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import PartySocket from "partysocket";
import Timer from "@/components/Timer";
import { connectToRoom } from "@/lib/party-client";
import { playBuzz, playCorrect, playIncorrect, playOpen, unlockAudio } from "@/lib/sounds";
import { buzzHaptic } from "@/lib/haptics";
import type { RoomState, ServerMessage, Team } from "@/lib/types";

const PRESET_TEAMS = [
  "Alpha", "Bravo", "Charlie", "Delta",
  "Echo", "Foxtrot", "Golf", "Hotel",
];

export default function SharedPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = (params.roomCode as string).toUpperCase();

  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [setupMode, setSetupMode] = useState(true);
  const [teamCount, setTeamCount] = useState(4);
  const [teamNames, setTeamNames] = useState<string[]>(PRESET_TEAMS.slice(0, 4));
  const wsRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    unlockAudio();

    const ws = connectToRoom(roomCode);
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

    return () => ws.close();
  }, [roomCode]);

  const send = useCallback(
    (msg: Record<string, unknown>) => {
      wsRef.current?.send(JSON.stringify(msg));
    },
    []
  );

  function startGame() {
    const names = teamNames.slice(0, teamCount).filter((n) => n.trim());
    if (names.length < 2) return;
    send({ type: "team:join-shared", teamNames: names });
    setSetupMode(false);
  }

  if (setupMode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <h1 className="text-3xl font-black">SHARED MODE</h1>
        <p className="text-zinc-500 text-sm text-center">
          All teams play on this one screen.
        </p>

        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">
              Number of teams
            </label>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setTeamCount(n);
                    setTeamNames((prev) => {
                      const next = [...prev];
                      while (next.length < n) next.push(PRESET_TEAMS[next.length] || `Team ${next.length + 1}`);
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
            onClick={startGame}
            className="w-full py-3 bg-white text-black font-bold rounded-xl
              hover:bg-zinc-200 active:scale-95 transition-all"
          >
            START
          </button>

          <button
            onClick={() => router.push("/")}
            className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
          >
            Back
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

  const teams = state.teams;
  const cols = teams.length <= 4 ? 2 : teams.length <= 6 ? 3 : 4;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="font-black text-lg hover:text-zinc-300 transition-colors"
          >
            BUZZ
          </button>
          <span className="text-zinc-600 text-xs">{roomCode}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs">Q{state.questionNumber}</span>
          {state.answerTimerEnd && (
            <Timer
              endsAt={state.answerTimerEnd}
              totalSeconds={state.config.answerTimerSeconds}
            />
          )}
        </div>
      </div>

      {/* Buzz Grid */}
      <div
        className="flex-1 grid gap-2 p-2"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
        }}
      >
        {teams.map((team) => (
          <SharedBuzzTile
            key={team.id}
            team={team}
            phase={state.phase}
            buzzQueue={state.buzzQueue}
            currentBuzzer={state.currentBuzzer}
            onBuzz={() => {
              buzzHaptic();
              playBuzz();
              send({ type: "team:buzz", teamId: team.id });
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2 p-2 border-t border-zinc-800/50">
        {state.phase === "open" ? (
          <button
            onClick={() => send({ type: "host:lock-buzzer" })}
            className="flex-1 py-2 bg-zinc-700 text-white font-bold rounded-lg text-sm"
          >
            LOCK
          </button>
        ) : (
          <button
            onClick={() => send({ type: "host:open-buzzer" })}
            className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg text-sm"
          >
            OPEN
          </button>
        )}
        {state.currentBuzzer && (
          <>
            <button
              onClick={() =>
                send({
                  type: "host:correct",
                  points: state.config.pointsPerQuestion,
                })
              }
              aria-label="Correct"
              className="flex-1 py-2 bg-green-900/50 text-green-400 font-bold rounded-lg text-sm border border-green-800"
            >
              ✓
            </button>
            <button
              onClick={() => send({ type: "host:incorrect" })}
              aria-label="Incorrect"
              className="flex-1 py-2 bg-red-900/50 text-red-400 font-bold rounded-lg text-sm border border-red-800"
            >
              ✗
            </button>
          </>
        )}
        <button
          onClick={() => send({ type: "host:reset-buzzers" })}
          className="py-2 px-3 bg-zinc-800 text-zinc-400 font-bold rounded-lg text-sm"
        >
          RST
        </button>
        <button
          onClick={() => send({ type: "host:new-question" })}
          className="py-2 px-3 bg-zinc-800 text-zinc-400 font-bold rounded-lg text-sm"
        >
          NEXT
        </button>
      </div>
    </div>
  );
}

function SharedBuzzTile({
  team,
  phase,
  buzzQueue,
  currentBuzzer,
  onBuzz,
}: {
  team: Team;
  phase: string;
  buzzQueue: { teamId: string; position: number }[];
  currentBuzzer: string | null;
  onBuzz: () => void;
}) {
  const myBuzz = buzzQueue.find((b) => b.teamId === team.id);
  const isCurrent = currentBuzzer === team.id;
  const canBuzz = phase === "open" && !myBuzz;

  return (
    <button
      onTouchStart={(e) => {
        e.preventDefault();
        if (canBuzz) onBuzz();
      }}
      onMouseDown={() => {
        if (canBuzz) onBuzz();
      }}
      disabled={!canBuzz}
      className={`rounded-xl flex flex-col items-center justify-center gap-1
        select-none touch-manipulation transition-all duration-150
        ${canBuzz ? "active:scale-95" : ""}
        ${isCurrent ? "ring-2 ring-white" : ""}
      `}
      style={{
        backgroundColor: canBuzz
          ? team.color
          : myBuzz
          ? `${team.color}33`
          : `${team.color}11`,
        opacity: canBuzz ? 1 : myBuzz ? 0.7 : 0.3,
      }}
    >
      <span className="text-lg sm:text-xl font-black text-white drop-shadow">
        {team.name}
      </span>
      {myBuzz && (
        <span className="text-sm font-bold text-white/80">
          #{myBuzz.position}
        </span>
      )}
      {team.score > 0 && (
        <span className="text-xs text-white/60">{team.score} pts</span>
      )}
    </button>
  );
}
