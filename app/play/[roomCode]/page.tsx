"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PartySocket from "partysocket";
import { AnimatePresence, motion } from "framer-motion";
import BuzzButton from "@/components/BuzzButton";
import BuzzQueue from "@/components/BuzzQueue";
import Timer from "@/components/Timer";
import { connectToRoom } from "@/lib/party-client";
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
  const [resultBanner, setResultBanner] = useState<{
    kind: "correct" | "incorrect" | "expired";
    teamId: string | null;
  } | null>(null);
  const wsRef = useRef<PartySocket | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentBuzzerRef = useRef<string | null>(null);

  useEffect(() => {
    unlockAudio();

    const ws = connectToRoom(roomCode);
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
          currentBuzzerRef.current = msg.state.currentBuzzer;
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
          if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
          setResultBanner({ kind: "correct", teamId: msg.teamId });
          playCorrect();
          bannerTimeoutRef.current = setTimeout(() => setResultBanner(null), 1800);
          break;
        case "incorrect":
          if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
          setResultBanner({ kind: "incorrect", teamId: msg.teamId });
          playIncorrect();
          bannerTimeoutRef.current = setTimeout(() => setResultBanner(null), 1800);
          break;
        case "timer:expired":
          if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
          setResultBanner({ kind: "expired", teamId: currentBuzzerRef.current });
          playIncorrect();
          bannerTimeoutRef.current = setTimeout(() => setResultBanner(null), 1800);
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
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
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
  const bannerTeam = resultBanner?.teamId
    ? state.teams.find((team) => team.id === resultBanner.teamId)
    : null;
  const statusText =
    state.phase === "open"
      ? "Buzzers open"
      : state.phase === "buzzed"
        ? currentBuzzerIsMe
          ? "Your turn"
          : "Waiting for answer"
        : state.phase === "expired"
          ? "Time ran out"
          : "Waiting to buzz";

  return (
    <div
      className="flex-1 flex flex-col overflow-auto"
      style={{ minHeight: "100dvh" }}
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

      <AnimatePresence>
        {resultBanner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none px-6"
          >
            <div className="rounded-2xl border border-zinc-700 bg-zinc-950/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
              <div
                className={`text-4xl sm:text-5xl font-black tracking-[0.2em] ${
                  resultBanner.kind === "correct"
                    ? "text-green-400"
                    : resultBanner.kind === "incorrect"
                      ? "text-red-400"
                      : "text-red-300"
                }`}
              >
                {resultBanner.kind === "correct"
                  ? "CORRECT"
                  : resultBanner.kind === "incorrect"
                    ? "INCORRECT"
                    : "TIME UP"}
              </div>
              <div className="mt-3 text-sm text-zinc-400">
                {bannerTeam ? bannerTeam.name : "Your team"}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 pb-3">
        <div
          className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
            state.phase === "open"
              ? "border-green-500/30 bg-green-500/10"
              : state.phase === "buzzed"
                ? "border-yellow-500/30 bg-yellow-500/10"
                : "border-zinc-700 bg-zinc-900/60"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                state.phase === "open"
                  ? "bg-green-400"
                  : state.phase === "buzzed"
                    ? "bg-yellow-400"
                    : "bg-zinc-500"
              }`}
            />
            <span className="text-sm font-bold tracking-[0.14em] uppercase text-zinc-100 truncate">
              {statusText}
            </span>
          </div>
          <span className="text-xs text-zinc-500 uppercase tracking-[0.18em]">
            Q{state.questionNumber}
          </span>
        </div>
      </div>

      {state.buzzQueue.length > 0 && (
        <div className="px-4 pb-4">
          <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Buzz Order
          </h2>
          <BuzzQueue
            queue={state.buzzQueue}
            currentBuzzer={state.currentBuzzer}
            compact
          />
        </div>
      )}

      {/* Question number */}
      <div className="text-center pb-4">
        <span className="text-zinc-700 text-xs">Q{state.questionNumber}</span>
      </div>
    </div>
  );
}
