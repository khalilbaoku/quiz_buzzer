import type * as Party from "partykit/server";

// Inline types to avoid import issues with PartyKit bundling

interface RoomConfig {
  answerTimerSeconds: number;
  pointsPerQuestion: number;
  secondChanceMode: "queue" | "reset";
  buzzLockout: boolean;
  trackPoints: boolean;
}

interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  code: string;
}

interface Player {
  id: string;
  name: string;
  teamId: string;
  connected: boolean;
}

interface BuzzEntry {
  teamId: string;
  teamName: string;
  teamColor: string;
  playerId: string;
  playerName: string;
  timestamp: number;
  position: number;
}

type RoomPhase = "lobby" | "ready" | "open" | "buzzed" | "expired" | "answering";

interface QuestionResult {
  questionNumber: number;
  buzzQueue: BuzzEntry[];
  winnerTeamId: string | null;
  winnerPlayerId: string | null;
  points: number;
  corrected: boolean;
}

interface RoomState {
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

// Shape persisted to Cloudflare Durable Object storage so state survives
// when the room has no active connections (hibernation).
interface SavedState {
  config: RoomConfig;
  teams: Team[];
  players: Player[];
  phase: RoomPhase;
  questionNumber: number;
  questionHistory: QuestionResult[];
  hostPin: string | null;
}

const TEAM_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#f43f5e",
];

const TEAM_CODES = [
  "A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "J9", "K0",
];

const DEFAULT_CONFIG: RoomConfig = {
  answerTimerSeconds: 15,
  pointsPerQuestion: 10,
  secondChanceMode: "queue",
  buzzLockout: true,
  trackPoints: true,
};

const BUZZ_COLLECTION_WINDOW_MS = 1000;
const MAX_NAME_LENGTH = 30;

// Rate limiting: each connection may send at most this many messages per window.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5000;

export default class BuzzerServer implements Party.Server {
  config: RoomConfig = { ...DEFAULT_CONFIG };
  teams: Map<string, Team> = new Map();
  players: Map<string, Player> = new Map();
  phase: RoomPhase = "lobby";
  buzzQueue: BuzzEntry[] = [];
  currentBuzzer: string | null = null;
  currentBuzzerPlayer: string | null = null;
  answerTimerEnd: number | null = null;
  questionNumber: number = 1;
  questionHistory: QuestionResult[] = [];
  hostConnectionId: string | null = null;
  hostPin: string | null = null;
  connectionToPlayer: Map<string, string> = new Map();
  timerTimeout: ReturnType<typeof setTimeout> | null = null;
  firstBuzzTime: number | null = null;
  acceptingBuzzesUntil: number | null = null;

  // Sliding-window rate limiter: connectionId -> sorted list of message timestamps
  messageTimes: Map<string, number[]> = new Map();

  constructor(readonly room: Party.Room) {}

  generatePin(): string {
    return Math.floor(100_000 + Math.random() * 900_000).toString();
  }

  // Called by PartyKit before any connections arrive, including after the room
  // wakes from hibernation. Restores persisted state so a host page-refresh or
  // brief period with no connections does not wipe teams, scores, and history.
  async onStart() {
    const saved = await this.room.storage.get<SavedState>("gameState");
    if (!saved) return;

    this.config = saved.config;
    this.questionNumber = saved.questionNumber;
    this.questionHistory = saved.questionHistory;
    this.hostPin = saved.hostPin ?? null;

    for (const team of saved.teams) {
      this.teams.set(team.id, team);
    }
    for (const player of saved.players) {
      // All players start as disconnected; they reconnect via WebSocket
      this.players.set(player.id, { ...player, connected: false });
    }

    // If the room was mid-question (open/buzzed/expired), reset to "ready".
    // The timer is not persisted and cannot be reliably restored, so the host
    // opens buzzers again when they reconnect.
    const unstablePhases: RoomPhase[] = ["open", "buzzed", "expired", "answering"];
    this.phase = unstablePhases.includes(saved.phase) ? "ready" : saved.phase;
  }

  // Persists essential game state to Cloudflare Durable Object storage.
  // Fire-and-forget (not awaited) — called after every state change.
  saveState() {
    void this.room.storage.put("gameState", {
      config: this.config,
      teams: Array.from(this.teams.values()),
      players: Array.from(this.players.values()),
      phase: this.phase,
      questionNumber: this.questionNumber,
      questionHistory: this.questionHistory,
      hostPin: this.hostPin,
    } satisfies SavedState);
  }

  // Returns true if this connection has exceeded the rate limit.
  // Uses a sliding window: messages older than RATE_LIMIT_WINDOW_MS are forgotten.
  isRateLimited(connectionId: string): boolean {
    const now = Date.now();
    const times = this.messageTimes.get(connectionId) ?? [];
    const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    recent.push(now);
    this.messageTimes.set(connectionId, recent);
    return recent.length > RATE_LIMIT_MAX;
  }

  // A connection is the host only if it has already authenticated with the correct PIN.
  // We track this by checking whether the server set hostConnectionId to this connection's id.
  isHost(sender: Party.Connection) {
    return sender.id === this.hostConnectionId;
  }

  getState(): RoomState {
    return {
      roomCode: this.room.id,
      config: this.config,
      teams: Array.from(this.teams.values()),
      players: Array.from(this.players.values()),
      phase: this.phase,
      buzzQueue: this.buzzQueue,
      currentBuzzer: this.currentBuzzer,
      currentBuzzerPlayer: this.currentBuzzerPlayer,
      answerTimerEnd: this.answerTimerEnd,
      questionNumber: this.questionNumber,
      questionHistory: this.questionHistory,
      hostConnected: this.hostConnectionId !== null,
    };
  }

  broadcast(msg: Record<string, unknown>) {
    this.room.broadcast(JSON.stringify(msg));
  }

  send(connection: Party.Connection, msg: Record<string, unknown>) {
    connection.send(JSON.stringify(msg));
  }

  broadcastState() {
    this.saveState();
    this.broadcast({ type: "state", state: this.getState() });
  }

  recalculateScores() {
    for (const team of this.teams.values()) {
      team.score = 0;
    }

    if (!this.config.trackPoints) return;

    for (const result of this.questionHistory) {
      if (!result.winnerTeamId) continue;
      const team = this.teams.get(result.winnerTeamId);
      if (team) {
        team.score += result.points;
      }
    }
  }

  recordQuestionResult(winnerTeamId: string | null, winnerPlayerId: string | null, points: number) {
    const existingIndex = this.questionHistory.findIndex(
      (result) => result.questionNumber === this.questionNumber
    );
    const existing = this.questionHistory[existingIndex];
    const result: QuestionResult = {
      questionNumber: this.questionNumber,
      buzzQueue: this.buzzQueue.map((entry) => ({ ...entry })),
      winnerTeamId,
      winnerPlayerId,
      points,
      corrected: existing ? true : false,
    };

    if (existingIndex >= 0) {
      this.questionHistory[existingIndex] = result;
    } else {
      this.questionHistory.push(result);
    }

    this.recalculateScores();
  }

  onConnect(connection: Party.Connection) {
    this.send(connection, { type: "state", state: this.getState() });
  }

  onClose(connection: Party.Connection) {
    // Clean up rate limit tracking for this connection
    this.messageTimes.delete(connection.id);

    if (connection.id === this.hostConnectionId) {
      this.hostConnectionId = null;
      this.broadcastState();
    }

    const playerId = this.connectionToPlayer.get(connection.id);
    if (playerId) {
      const player = this.players.get(playerId);
      if (player) {
        player.connected = false;
        this.broadcastState();
      }
      this.connectionToPlayer.delete(connection.id);
    }
  }

  onMessage(message: string, sender: Party.Connection) {
    if (this.isRateLimited(sender.id)) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {
      case "host:join":
        this.handleHostJoin(sender, msg.pin as string | undefined);
        break;
      case "host:setup-teams":
        this.handleSetupTeams(sender, msg.teamNames as string[]);
        break;
      case "player:join":
        this.handlePlayerJoin(sender, msg.teamCode as string, msg.playerName as string);
        break;
      case "team:join-shared":
        this.handleSharedJoin(sender, msg.teamNames as string[]);
        break;
      case "team:buzz":
        this.handleBuzz(sender, msg.teamId as string | undefined);
        break;
      case "host:open-buzzer":
        this.handleOpenBuzzer(sender);
        break;
      case "host:lock-buzzer":
        this.handleLockBuzzer(sender);
        break;
      case "host:correct":
        this.handleCorrect(sender, msg.points as number | undefined);
        break;
      case "host:incorrect":
        this.handleIncorrect(sender);
        break;
      case "host:reset-buzzers":
        this.handleReset(sender);
        break;
      case "host:new-question":
        this.handleNewQuestion(sender);
        break;
      case "host:update-config":
        this.handleUpdateConfig(sender, msg.config as Partial<RoomConfig>);
        break;
      case "host:award-points":
        this.handleAwardPoints(sender, msg.teamId as string, msg.points as number);
        break;
      case "host:reassign-question":
        this.handleReassignQuestion(
          sender,
          msg.questionNumber as number,
          msg.teamId as string | null,
          msg.points as number | undefined
        );
        break;
    }
  }

  handleHostJoin(sender: Party.Connection, pin?: string) {
    if (this.hostPin === null) {
      // First host to connect — generate a PIN and authenticate them immediately
      this.hostPin = this.generatePin();
      this.hostConnectionId = sender.id;
      this.send(sender, { type: "host:authenticated", pin: this.hostPin });
      this.broadcastState();
    } else if (pin === this.hostPin) {
      // Returning host presenting the correct PIN (e.g. after a page refresh)
      this.hostConnectionId = sender.id;
      this.send(sender, { type: "host:authenticated", pin: this.hostPin });
      this.broadcastState();
    } else {
      // Wrong or missing PIN — reject
      this.send(sender, {
        type: "error",
        message: "This room already has a host. Use the original host link (URL ending in #PIN) to rejoin.",
      });
    }
  }

  handleSetupTeams(sender: Party.Connection, teamNames: string[]) {
    if (!this.isHost(sender)) return;

    this.teams.clear();
    this.players.clear();
    this.connectionToPlayer.clear();
    this.questionHistory = [];
    this.questionNumber = 1;

    for (let i = 0; i < teamNames.length; i++) {
      // Truncate team names to MAX_NAME_LENGTH to protect UI layout
      const name = teamNames[i]?.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) continue;

      const teamId = `team_${i}`;
      const color = TEAM_COLORS[i % TEAM_COLORS.length];
      const code = TEAM_CODES[i % TEAM_CODES.length];

      this.teams.set(teamId, {
        id: teamId,
        name,
        color,
        score: 0,
        code,
      });
    }

    if (this.phase === "lobby") {
      this.phase = "ready";
    }

    this.broadcastState();
  }

  handlePlayerJoin(sender: Party.Connection, teamCode: string, playerName: string) {
    if (!teamCode?.trim() || !playerName?.trim()) {
      this.send(sender, { type: "error", message: "Team code and name required" });
      return;
    }

    const code = teamCode.trim().toUpperCase();
    const name = playerName.trim();

    if (name.length > MAX_NAME_LENGTH) {
      this.send(sender, {
        type: "error",
        message: `Name must be ${MAX_NAME_LENGTH} characters or fewer`,
      });
      return;
    }

    // Find team by code
    let targetTeam: Team | null = null;
    for (const team of this.teams.values()) {
      if (team.code.toUpperCase() === code) {
        targetTeam = team;
        break;
      }
    }

    if (!targetTeam) {
      this.send(sender, { type: "error", message: "Invalid team code" });
      return;
    }

    // Check if this connection already has a player (reconnect)
    const existingPlayerId = this.connectionToPlayer.get(sender.id);
    if (existingPlayerId) {
      const existing = this.players.get(existingPlayerId);
      if (existing) {
        existing.connected = true;
        this.send(sender, {
          type: "joined",
          teamId: targetTeam.id,
          teamName: targetTeam.name,
          teamColor: targetTeam.color,
          playerId: existingPlayerId,
        });
        this.broadcastState();
        return;
      }
    }

    // Check if player name already exists on this team (reconnect scenario)
    for (const [pId, player] of this.players) {
      if (player.teamId === targetTeam.id && player.name.toLowerCase() === name.toLowerCase()) {
        player.connected = true;
        this.connectionToPlayer.set(sender.id, pId);
        this.send(sender, {
          type: "joined",
          teamId: targetTeam.id,
          teamName: targetTeam.name,
          teamColor: targetTeam.color,
          playerId: pId,
        });
        this.broadcastState();
        return;
      }
    }

    // Create new player
    const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.players.set(playerId, {
      id: playerId,
      name,
      teamId: targetTeam.id,
      connected: true,
    });
    this.connectionToPlayer.set(sender.id, playerId);

    this.send(sender, {
      type: "joined",
      teamId: targetTeam.id,
      teamName: targetTeam.name,
      teamColor: targetTeam.color,
      playerId,
    });
    this.broadcastState();
  }

  handleSharedJoin(sender: Party.Connection, teamNames: string[]) {
    // For shared mode, host creates teams inline
    if (this.teams.size === 0) {
      this.questionHistory = [];
      this.questionNumber = 1;
    }

    for (let i = 0; i < teamNames.length; i++) {
      const name = teamNames[i]?.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) continue;

      // Skip duplicates
      let exists = false;
      for (const team of this.teams.values()) {
        if (team.name.toLowerCase() === name.toLowerCase()) {
          exists = true;
          break;
        }
      }
      if (exists) continue;

      const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const color = TEAM_COLORS[this.teams.size % TEAM_COLORS.length];
      const code = TEAM_CODES[this.teams.size % TEAM_CODES.length];

      this.teams.set(teamId, {
        id: teamId,
        name,
        color,
        score: 0,
        code,
      });
    }

    if (this.phase === "lobby") {
      this.phase = "ready";
    }

    this.broadcastState();
  }

  handleBuzz(sender: Party.Connection, teamIdOverride?: string) {
    const now = Date.now();
    const isCollectingFollowUpBuzzes =
      this.acceptingBuzzesUntil !== null &&
      now <= this.acceptingBuzzesUntil &&
      this.config.secondChanceMode === "queue";

    if (this.phase !== "open" && !isCollectingFollowUpBuzzes) return;

    // Determine who buzzed
    let teamId: string | undefined;
    let playerId: string | undefined;
    let playerName: string = "";

    if (teamIdOverride) {
      // Shared device mode — no individual player
      teamId = teamIdOverride;
      playerId = "shared";
      playerName = "Team";
    } else {
      // Individual player mode
      playerId = this.connectionToPlayer.get(sender.id);
      if (!playerId) return;

      const player = this.players.get(playerId);
      if (!player) return;

      teamId = player.teamId;
      playerName = player.name;
    }

    if (!teamId) return;
    const team = this.teams.get(teamId);
    if (!team) return;

    // Already buzzed by this team?
    if (this.buzzQueue.some((b) => b.teamId === teamId)) return;

    if (this.firstBuzzTime === null) {
      this.firstBuzzTime = now;
      this.acceptingBuzzesUntil = now + BUZZ_COLLECTION_WINDOW_MS;
    }

    const entry: BuzzEntry = {
      teamId,
      teamName: team.name,
      teamColor: team.color,
      playerId: playerId!,
      playerName,
      timestamp: now - this.firstBuzzTime,
      position: this.buzzQueue.length + 1,
    };

    this.buzzQueue.push(entry);
    this.broadcast({ type: "buzz", entry });

    // First buzz
    if (entry.position === 1) {
      this.currentBuzzer = teamId;
      this.currentBuzzerPlayer = playerId!;
      this.phase = "buzzed";

      if (this.config.answerTimerSeconds > 0) {
        this.answerTimerEnd = Date.now() + this.config.answerTimerSeconds * 1000;
        this.broadcast({ type: "timer:start", endsAt: this.answerTimerEnd });

        if (this.timerTimeout) clearTimeout(this.timerTimeout);
        this.timerTimeout = setTimeout(() => {
          this.handleTimerExpiry();
        }, this.config.answerTimerSeconds * 1000);
      }
    }

    this.broadcastState();
  }

  handleTimerExpiry() {
    if (this.phase !== "buzzed") return;
    this.phase = "expired";
    this.answerTimerEnd = null;
    this.timerTimeout = null;
    this.broadcast({ type: "timer:expired" });
    this.broadcastState();
  }

  handleOpenBuzzer(sender: Party.Connection) {
    if (!this.isHost(sender)) return;

    this.phase = "open";
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;
    this.acceptingBuzzesUntil = null;

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "buzz:opened" });
    this.broadcastState();
  }

  handleLockBuzzer(sender: Party.Connection) {
    if (!this.isHost(sender)) return;

    this.phase = "ready";
    this.acceptingBuzzesUntil = null;
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "buzz:locked" });
    this.broadcastState();
  }

  handleCorrect(sender: Party.Connection, points?: number) {
    if (!this.isHost(sender)) return;
    if (!this.currentBuzzer) return;

    const awardedPoints = Number.isFinite(points)
      ? points!
      : this.config.pointsPerQuestion;
    this.recordQuestionResult(this.currentBuzzer, this.currentBuzzerPlayer, awardedPoints);

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "correct", teamId: this.currentBuzzer, points: awardedPoints });

    this.phase = "ready";
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.acceptingBuzzesUntil = null;
    this.broadcastState();
  }

  handleIncorrect(sender: Party.Connection) {
    if (!this.isHost(sender)) return;

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.processIncorrect();
  }

  processIncorrect() {
    if (!this.currentBuzzer) return;

    this.broadcast({ type: "incorrect", teamId: this.currentBuzzer });

    if (this.config.secondChanceMode === "queue") {
      const currentIdx = this.buzzQueue.findIndex(
        (b) => b.teamId === this.currentBuzzer
      );
      const nextBuzz = this.buzzQueue[currentIdx + 1];

      if (nextBuzz) {
        this.currentBuzzer = nextBuzz.teamId;
        this.currentBuzzerPlayer = nextBuzz.playerId;
        this.phase = "buzzed";
        this.answerTimerEnd = null;

        if (this.config.answerTimerSeconds > 0) {
          this.answerTimerEnd = Date.now() + this.config.answerTimerSeconds * 1000;
          this.broadcast({ type: "timer:start", endsAt: this.answerTimerEnd });

          this.timerTimeout = setTimeout(() => {
            this.handleTimerExpiry();
          }, this.config.answerTimerSeconds * 1000);
        }
      } else {
        this.recordQuestionResult(null, null, 0);
        this.phase = "ready";
        this.currentBuzzer = null;
        this.currentBuzzerPlayer = null;
        this.answerTimerEnd = null;
      }
    } else {
      this.phase = "open";
      this.buzzQueue = [];
      this.currentBuzzer = null;
      this.currentBuzzerPlayer = null;
      this.answerTimerEnd = null;
      this.firstBuzzTime = null;
      this.acceptingBuzzesUntil = null;
      this.broadcast({ type: "buzz:opened" });
    }

    this.broadcastState();
  }

  handleReset(sender: Party.Connection) {
    if (!this.isHost(sender)) return;

    this.phase = "ready";
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;
    this.acceptingBuzzesUntil = null;

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcastState();
  }

  handleNewQuestion(sender: Party.Connection) {
    if (!this.isHost(sender)) return;

    this.questionNumber++;
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;
    this.acceptingBuzzesUntil = null;
    this.phase = "ready";

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcastState();
  }

  handleUpdateConfig(sender: Party.Connection, updates: Partial<RoomConfig>) {
    if (!this.isHost(sender)) return;
    this.config = {
      ...this.config,
      ...updates,
      pointsPerQuestion: Math.max(
        0,
        Number(updates.pointsPerQuestion ?? this.config.pointsPerQuestion)
      ),
    };
    this.recalculateScores();
    this.broadcastState();
  }

  handleAwardPoints(sender: Party.Connection, teamId: string, points: number) {
    if (!this.isHost(sender)) return;
    const team = this.teams.get(teamId);
    if (team) {
      team.score += points;
      this.broadcastState();
    }
  }

  handleReassignQuestion(
    sender: Party.Connection,
    questionNumber: number,
    teamId: string | null,
    points?: number
  ) {
    if (!this.isHost(sender)) return;
    if (!Number.isInteger(questionNumber) || questionNumber < 1) return;
    if (teamId !== null && !this.teams.has(teamId)) return;

    const existing = this.questionHistory.find(
      (result) => result.questionNumber === questionNumber
    );
    const winnerPlayerId =
      teamId === null
        ? null
        : existing?.buzzQueue.find((entry) => entry.teamId === teamId)?.playerId ?? null;
    const nextPoints = Math.max(
      0,
      Number(points ?? existing?.points ?? this.config.pointsPerQuestion)
    );
    const nextResult: QuestionResult = {
      questionNumber,
      buzzQueue: existing?.buzzQueue ?? [],
      winnerTeamId: teamId,
      winnerPlayerId,
      points: teamId === null ? 0 : nextPoints,
      corrected: true,
    };
    const existingIndex = this.questionHistory.findIndex(
      (result) => result.questionNumber === questionNumber
    );

    if (existingIndex >= 0) {
      this.questionHistory[existingIndex] = nextResult;
    } else {
      this.questionHistory.push(nextResult);
      this.questionHistory.sort((a, b) => a.questionNumber - b.questionNumber);
    }

    this.recalculateScores();
    this.broadcastState();
  }
}

BuzzerServer satisfies Party.Worker;
