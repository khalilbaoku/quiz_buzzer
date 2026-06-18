"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PartySocket from "partysocket";
import BuzzButton from "@/components/BuzzButton";
import Timer from "@/components/Timer";
import { playBuzz, playCorrect, playIncorrect, playOpen, unlockAudio } from "@/lib/sounds";
import type { RoomState, ServerMessage, BuzzEntry } from "@/lib/types";

export default function PlayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomCode = (params.roomCode as string).toUpperCase();
  const teamCode = searchParams.get("tc") || "";
  const playerName = searchParams.get("name") || "";

  const [state, setState] = useState<RoomState | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myTeamColor, setMyTeamColor] = useState<string>("#ffffff");
  const [myTeamName, setMyTeamName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    unlockAudio();

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
    const ws = new PartySocket({ host, room: roomCode });
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      ws.send(JSON.stringify({
        type: "player:join",
        teamCode,
        playerName,
      }));
    });

    ws.addEventListener("close", () => setConnected(false));

    ws.addEventListener("message", (evt) => {
      const msg: ServerMessage = JSON.parse(evt.data);

      switch (msg.type) {
        case "state":
          setState(msg.state);
          break;
        case "joined": {
          const joined = msg as unknown as {
            teamId: string; teamName: string; teamColor: string; playerId: string;
          };
          setMyTeamId(joined.teamId);
          setMyPlayerId(joined.playerId);
          setMyTeamColor(joined.teamColor);
          setMyTeamName(joined.teamName);
          setError(null);
          break;
        }
        case "buzz":
          if ((msg as { entry: BuzzEntry }).entry.playerId === myPlayerId) {
            // My buzz confirmed
          } else {
            playBuzz();
          }
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
        case "error":
          setError((msg as { message: string }).message);
          break;
      }
    });

    // Screen wake lock
    if ("wakeLock" in navigator) {
      (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } })
        .wakeLock.request("screen").catch(() => {});
    }

    return () => {
      ws.close();
    };
  }, [roomCode, teamCode, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBuzz = useCallback(() => {
    if (!wsRef.current) return;
    playBuzz();
    wsRef.current.send(JSON.stringify({ type: "team:buzz" }));
  }, []);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-red-400 text-lg font-bold mb-2">Error</div>
          <div className="text-zinc-400">{error}</div>
          <button
            onClick={() => window.history.back()}
            className="mt-4 text-zinc-500 text-sm hover:text-zinc-300"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!state || !myTeamId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-zinc-500 animate-pulse">Connecting...</div>
          <div className="text-zinc-700 text-sm mt-2">{roomCode}</div>
        </div>
      </div>
    );
  }

  const myTeam = state.teams.find((t) => t.id === myTeamId);
  const myBuzz = state.buzzQueue.find((b) => b.teamId === myTeamId);
  const myBuzzPosition = myBuzz?.position ?? null;
  const currentBuzzerIsMe = state.currentBuzzer === myTeamId;
  const teamColor = myTeamColor || myTeam?.color || "#ffffff";

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ height: "100dvh" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: teamColor }}
          />
          <div className="flex flex-col">
            <span className="font-bold text-sm">{playerName}</span>
            <span className="text-zinc-500 text-xs">{myTeamName || myTeam?.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.config.trackPoints && myTeam && (
            <span className="text-zinc-400 text-sm">
              <span className="font-bold text-white">{myTeam.score}</span> pts
            </span>
          )}
          <span className="text-zinc-600 text-xs">{roomCode}</span>
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
        </div>
      </div>

      {/* Timer */}
      {state.answerTimerEnd && currentBuzzerIsMe && (
        <div className="py-4">
          <Timer
            endsAt={state.answerTimerEnd}
            totalSeconds={state.config.answerTimerSeconds}
          />
        </div>
      )}

      {/* Buzz Button */}
      <BuzzButton
        phase={state.phase}
        onBuzz={handleBuzz}
        myBuzzPosition={myBuzzPosition}
        currentBuzzerIsMe={currentBuzzerIsMe}
        teamColor={teamColor}
      />

      {/* Question number */}
      <div className="text-center pb-4">
        <span className="text-zinc-700 text-xs">Q{state.questionNumber}</span>
      </div>
    </div>
  );
}
