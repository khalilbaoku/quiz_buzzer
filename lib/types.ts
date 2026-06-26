// ---- Room Config ----

export interface RoomConfig {
  answerTimerSeconds: number;
  pointsPerQuestion: number;
  secondChanceMode: "queue" | "reset";
  buzzLockout: boolean;
  trackPoints: boolean;
}

export const DEFAULT_CONFIG: RoomConfig = {
  answerTimerSeconds: 15,
  pointsPerQuestion: 10,
  secondChanceMode: "queue",
  buzzLockout: true,
  trackPoints: true,
};

// ---- Team ----

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  code: string; // short join code like "A1", "B2"
}

// ---- Player ----

export interface Player {
  id: string;
  name: string;
  teamId: string;
  connected: boolean;
}

// ---- Buzz Entry ----

export interface BuzzEntry {
  teamId: string;
  teamName: string;
  teamColor: string;
  playerId: string;
  playerName: string;
  timestamp: number;
  position: number;
}

// ---- Room Phase ----

export type RoomPhase = "lobby" | "ready" | "open" | "buzzed" | "expired" | "answering";

// ---- Question Result ----

export interface QuestionResult {
  questionNumber: number;
  buzzQueue: BuzzEntry[];
  winnerTeamId: string | null;
  winnerPlayerId: string | null;
  points: number;
  corrected: boolean;
}

// ---- Serialized Room State (sent to clients) ----

export interface RoomState {
  roomCode: string;
  config: RoomConfig;
  teams: Team[];
  players: Player[];
  phase: RoomPhase;
  buzzQueue: BuzzEntry[];
  currentBuzzer: string | null;
  currentBuzzerPlayer: string | null;
  answerTimerEnd: number | null;
  questionNumber: number;
  questionHistory: QuestionResult[];
  hostConnected: boolean;
}

// ---- Client -> Server Messages ----

export type ClientMessage =
  | { type: "host:join" }
  | { type: "host:setup-teams"; teamNames: string[] }
  | { type: "player:join"; teamCode: string; playerName: string }
  | { type: "team:join-shared"; teamNames: string[] }
  | { type: "team:buzz"; teamId?: string }
  | { type: "host:open-buzzer" }
  | { type: "host:lock-buzzer" }
  | { type: "host:correct"; points?: number }
  | { type: "host:incorrect" }
  | { type: "host:reset-buzzers" }
  | { type: "host:update-config"; config: Partial<RoomConfig> }
  | { type: "host:award-points"; teamId: string; points: number }
  | { type: "host:reassign-question"; questionNumber: number; teamId: string | null; points?: number }
  | { type: "host:new-question" };

// ---- Server -> Client Messages ----

export type ServerMessage =
  | { type: "state"; state: RoomState }
  | { type: "buzz"; entry: BuzzEntry }
  | { type: "timer:start"; endsAt: number }
  | { type: "timer:expired" }
  | { type: "buzz:opened" }
  | { type: "buzz:locked" }
  | { type: "correct"; teamId: string; points: number }
  | { type: "incorrect"; teamId: string }
  | { type: "joined"; teamId: string; teamName: string; teamColor: string; playerId: string }
  | { type: "host:authenticated"; pin: string }
  | { type: "error"; message: string };

// ---- Team Colors ----

export const TEAM_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#a855f7", // purple
  "#f97316", // orange
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#f43f5e", // rose
];
