import type * as Party from "partykit/server";

// Inline types to avoid import issues with PartyKit bundling

interface RoomConfig {
  answerTimerSeconds: number;
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

type RoomPhase = "lobby" | "ready" | "open" | "buzzed" | "answering";

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
  hostConnected: boolean;
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
  secondChanceMode: "queue",
  buzzLockout: true,
  trackPoints: true,
};

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
  hostConnectionId: string | null = null;
  connectionToPlayer: Map<string, string> = new Map(); // connectionId -> playerId
  timerTimeout: ReturnType<typeof setTimeout> | null = null;
  firstBuzzTime: number | null = null;

  constructor(readonly room: Party.Room) {}

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
    this.broadcast({ type: "state", state: this.getState() });
  }

  onConnect(connection: Party.Connection) {
    this.send(connection, { type: "state", state: this.getState() });
  }

  onClose(connection: Party.Connection) {
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
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {
      case "host:join":
        this.handleHostJoin(sender);
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
        this.handleCorrect(sender, (msg.points as number) ?? 10);
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
    }
  }

  handleHostJoin(sender: Party.Connection) {
    this.hostConnectionId = sender.id;
    this.broadcastState();
  }

  handleSetupTeams(sender: Party.Connection, teamNames: string[]) {
    if (sender.id !== this.hostConnectionId) return;

    this.teams.clear();

    for (let i = 0; i < teamNames.length; i++) {
      const name = teamNames[i]?.trim();
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
    for (let i = 0; i < teamNames.length; i++) {
      const name = teamNames[i]?.trim();
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
    if (this.phase !== "open") return;

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

    const now = Date.now();
    if (this.firstBuzzTime === null) {
      this.firstBuzzTime = now;
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
    this.broadcast({ type: "timer:expired" });
    this.processIncorrect();
  }

  handleOpenBuzzer(sender: Party.Connection) {
    if (sender.id !== this.hostConnectionId) return;

    this.phase = "open";
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "buzz:opened" });
    this.broadcastState();
  }

  handleLockBuzzer(sender: Party.Connection) {
    if (sender.id !== this.hostConnectionId) return;

    this.phase = "ready";
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "buzz:locked" });
    this.broadcastState();
  }

  handleCorrect(sender: Party.Connection, points: number) {
    if (sender.id !== this.hostConnectionId) return;
    if (!this.currentBuzzer) return;

    const team = this.teams.get(this.currentBuzzer);
    if (team && this.config.trackPoints) {
      team.score += points;
    }

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcast({ type: "correct", teamId: this.currentBuzzer, points });

    this.phase = "ready";
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.broadcastState();
  }

  handleIncorrect(sender: Party.Connection) {
    if (sender.id !== this.hostConnectionId) return;

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

        if (this.config.answerTimerSeconds > 0) {
          this.answerTimerEnd = Date.now() + this.config.answerTimerSeconds * 1000;
          this.broadcast({ type: "timer:start", endsAt: this.answerTimerEnd });

          this.timerTimeout = setTimeout(() => {
            this.handleTimerExpiry();
          }, this.config.answerTimerSeconds * 1000);
        }
      } else {
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
      this.broadcast({ type: "buzz:opened" });
    }

    this.broadcastState();
  }

  handleReset(sender: Party.Connection) {
    if (sender.id !== this.hostConnectionId) return;

    this.phase = "ready";
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcastState();
  }

  handleNewQuestion(sender: Party.Connection) {
    if (sender.id !== this.hostConnectionId) return;

    this.questionNumber++;
    this.buzzQueue = [];
    this.currentBuzzer = null;
    this.currentBuzzerPlayer = null;
    this.answerTimerEnd = null;
    this.firstBuzzTime = null;
    this.phase = "ready";

    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    this.broadcastState();
  }

  handleUpdateConfig(sender: Party.Connection, updates: Partial<RoomConfig>) {
    if (sender.id !== this.hostConnectionId) return;
    this.config = { ...this.config, ...updates };
    this.broadcastState();
  }

  handleAwardPoints(sender: Party.Connection, teamId: string, points: number) {
    if (sender.id !== this.hostConnectionId) return;
    const team = this.teams.get(teamId);
    if (team) {
      team.score += points;
      this.broadcastState();
    }
  }
}

BuzzerServer satisfies Party.Worker;
