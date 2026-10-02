import { useEffect, useRef } from "react";

declare global {
  interface Window {
    resetBestScores?: () => void;
  }
}

interface Spike {
  x: number;
  tall?: boolean;
}

interface Level {
  spikes: Spike[];
  end: number;
  speed: number;
  isChallenge: boolean;
}

type Screen =
  | "menu"
  | "playing"
  | "paused"
  | "settings"
  | "hotkeys"
  | "about"
  | "characterSelect"
  | "outlineSelect"
  | "controls";

type HotkeyAction = "jump" | "pause" | "mute";

type OutlineChoice = "white" | "black" | "none";

interface Character {
  name: string;
  color: string;
}

export default function JumpGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Synthesized sound effects (no network / hotlink dependency)
    type Sfx = {
      currentTime: number;
      volume: number;
      muted: boolean;
      play: () => Promise<void>;
    };

    let audioCtx: AudioContext | null = null;
    function getCtx(): AudioContext | null {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      if (!audioCtx) audioCtx = new Ctor();
      return audioCtx;
    }
    async function getReadyCtx(): Promise<AudioContext | null> {
      const ac = getCtx();
      if (!ac) return null;
      if (ac.state === "suspended") await ac.resume();
      return ac.state === "running" ? ac : null;
    }
    // Unlock audio on the first user gesture (browser autoplay policy)
    const unlockAudio = () => {
      void getReadyCtx();
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    function makeSfx(
      notes: { freq: number; start: number; dur: number }[],
      type: OscillatorType,
    ): Sfx {
      const sfx: Sfx = {
        currentTime: 0,
        volume: 1,
        muted: false,
        play: async () => {
          const ac = await getReadyCtx();
          if (!ac || sfx.muted || sfx.volume <= 0) return;
          const now = ac.currentTime;
          for (const n of notes) {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(n.freq, now + n.start);
            gain.gain.setValueAtTime(0.0001, now + n.start);
            gain.gain.exponentialRampToValueAtTime(
              Math.max(0.0002, sfx.volume),
              now + n.start + 0.01,
            );
            gain.gain.exponentialRampToValueAtTime(
              0.0001,
              now + n.start + n.dur,
            );
            osc.connect(gain).connect(ac.destination);
            osc.start(now + n.start);
            osc.stop(now + n.start + n.dur + 0.02);
          }
        },
      };
      return sfx;
    }

    const jumpSound = makeSfx(
      [
        { freq: 260, start: 0, dur: 0.08 },
        { freq: 390, start: 0.045, dur: 0.11 },
      ],
      "square",
    );
    const deathSound = makeSfx(
      [
        { freq: 200, start: 0, dur: 0.18 },
        { freq: 120, start: 0.1, dur: 0.25 },
      ],
      "square",
    );
    const xpSound = makeSfx(
      [
        { freq: 880, start: 0, dur: 0.1 },
        { freq: 1320, start: 0.06, dur: 0.12 },
      ],
      "sine",
    );
    const levelUpSound = makeSfx(
      [
        { freq: 523, start: 0, dur: 0.15 },
        { freq: 659, start: 0.12, dur: 0.15 },
        { freq: 784, start: 0.24, dur: 0.25 },
      ],
      "triangle",
    );
    const baseVolumes = new Map<Sfx, number>([
      [jumpSound, 0.18],
      [deathSound, 0.4],
      [xpSound, 0.3],
      [levelUpSound, 0.35],
    ]);

    const volumeKey = "jump_game_volume";
    const lastVolumeKey = "jump_game_last_volume";
    let volume = Number(localStorage.getItem(volumeKey) ?? 1);
    if (isNaN(volume) || volume < 0 || volume > 1) volume = 1;
    let lastVolume = Number(localStorage.getItem(lastVolumeKey) ?? 0.5);
    if (isNaN(lastVolume) || lastVolume <= 0 || lastVolume > 1) lastVolume = 0.5;

    function applyVolume() {
      for (const [snd, base] of baseVolumes) {
        snd.volume = Math.max(0, Math.min(1, base * volume));
        snd.muted = volume === 0;
      }
    }


    function toggleMute() {
      if (volume === 0) {
        volume = lastVolume;
      } else {
        lastVolume = volume;
        localStorage.setItem(lastVolumeKey, String(lastVolume));
        volume = 0;
      }
      localStorage.setItem(volumeKey, String(volume));
      applyVolume();
    }

    let playerY = 0;
    let velocity = 0;
    let x = 0;
    let rotation = 0;
    let rotationTarget = 0;

    let dead = false;
    let jumping = false;
    let airJumpsUsed = 0;
    let levelIndex = 0;
    let won = false;
    let gameComplete = false;

    let challengeOffered = false;
    let challengeMode = false;
    let challengeComplete = false;
    let doubleJumpUnlocked = false;

    let screen: Screen = "menu";
    let returnScreen: "menu" | "paused" = "menu";
    let controlsReturn: "menu" | "paused" = "menu";
    let controlsScroll = 0;
    let draggingControlsBar = false;

    const characters: Character[] = [
      { name: "Blue", color: "cyan" },
      { name: "Red", color: "#ff4d4d" },
      { name: "Orange", color: "#ff9a1f" },
      { name: "Yellow", color: "#ffe135" },
      { name: "Purple", color: "#b166ff" },
      { name: "Pink", color: "#ff6ec7" },
    ];
    const outlines: OutlineChoice[] = ["white", "black", "none"];

    const charKey = "jump_game_character";
    const outlineKey = "jump_game_outline";
    let charIndex = Number(localStorage.getItem(charKey) ?? 0);
    if (isNaN(charIndex) || charIndex < 0 || charIndex >= characters.length) charIndex = 0;
    let outlineChoice = (localStorage.getItem(outlineKey) as OutlineChoice) || "white";
    if (!outlines.includes(outlineChoice)) outlineChoice = "white";

    // Preview index while browsing character select
    let previewCharIndex = charIndex;

    // Volume slider geometry on settings screen
    const volSlider = { x: 150, y: 120, width: 500, height: 10 };
    let draggingVolume = false;

    // Game background choice
    const bgKey = "jump_game_background";
    let bgChoice: "black" | "white" =
      localStorage.getItem(bgKey) === "white" ? "white" : "black";
    const bgBlackBtn = { x: 250, y: 200, width: 145, height: 30 };
    const bgWhiteBtn = { x: 405, y: 200, width: 145, height: 30 };

    // Hotkey config
    const hotkeyKey = "jump_game_hotkeys";
    const defaultHotkeys: Record<HotkeyAction, string> = {
      jump: "Space",
      pause: "Escape",
      mute: "KeyM",
    };
    let hotkeys: Record<HotkeyAction, string> = { ...defaultHotkeys };
    try {
      const saved = JSON.parse(localStorage.getItem(hotkeyKey) || "null");
      if (saved && typeof saved === "object") {
        hotkeys = { ...defaultHotkeys, ...saved };
      }
    } catch {}
    let waitingForHotkey: HotkeyAction | null = null;
    const hotkeyRows: { action: HotkeyAction; label: string; box: { x: number; y: number; width: number; height: number } }[] = [
      { action: "jump", label: "Jump", box: { x: 300, y: 80, width: 200, height: 34 } },
      { action: "pause", label: "Pause", box: { x: 300, y: 130, width: 200, height: 34 } },
      { action: "mute", label: "Mute", box: { x: 300, y: 180, width: 200, height: 34 } },
    ];
    const hotkeySetupBtn = { x: 250, y: 245, width: 300, height: 34 };
    const resetHotkeysBtn = { x: 250, y: 245, width: 300, height: 34 };

    function prettyKey(code: string) {
      if (code === "Space") return "Space";
      if (code === "Escape") return "Esc";
      if (code === "ArrowUp") return "↑ Up";
      if (code === "ArrowDown") return "↓ Down";
      if (code === "ArrowLeft") return "← Left";
      if (code === "ArrowRight") return "→ Right";
      if (code.startsWith("Key")) return code.slice(3);
      if (code.startsWith("Digit")) return code.slice(5);
      return code;
    }
    function isAllowedHotkey(code: string) {
      return (
        code === "ArrowUp" ||
        code === "ArrowDown" ||
        code === "ArrowLeft" ||
        code === "ArrowRight" ||
        code === "Space" ||
        code === "Escape" ||
        /^Key[A-Z]$/.test(code) ||
        /^Digit[0-9]$/.test(code)
      );
    }

    const muteButton = { x: 715, y: 32, width: 25, height: 25 };
    const pauseButton = { x: 680, y: 32, width: 25, height: 25 };
    const challengeBtn = { x: 200, y: 128, width: 400, height: 28 };

    // Main menu buttons (canvas 800x300)
    const menuPlayBtn = { x: 250, y: 62, width: 300, height: 32 };
    const menuSettingsBtn = { x: 250, y: 100, width: 300, height: 32 };
    const menuControlsBtn = { x: 250, y: 138, width: 300, height: 32 };
    const menuAboutBtn = { x: 250, y: 176, width: 300, height: 32 };
    const menuCharBtn = { x: 250, y: 214, width: 300, height: 32 };

    // Pause menu buttons
    const resumeBtn = { x: 250, y: 62, width: 300, height: 32 };
    const pauseMainMenuBtn = { x: 250, y: 100, width: 300, height: 32 };
    const pauseControlsBtn = { x: 250, y: 138, width: 300, height: 32 };
    const pauseCharBtn = { x: 250, y: 176, width: 300, height: 32 };
    const pauseSettingsBtn = { x: 250, y: 214, width: 300, height: 32 };

    // Game controls screen (scrollable list)
    const controlsView = { x: 60, y: 70, width: 680, height: 175 };
    const controlsBar = { x: 745, y: 70, width: 10, height: 175 };

    // Back button for settings / about / char / outline
    const backBtn = { x: 20, y: 250, width: 110, height: 32 };

    // Character select controls
    const charLeftArrow = { x: 200, y: 115, width: 60, height: 60 };
    const charRightArrow = { x: 540, y: 115, width: 60, height: 60 };
    const charSelectBtn = { x: 300, y: 245, width: 200, height: 35 };

    // Outline select — three big swatches
    const outlineBtns = [
      { x: 90, y: 100, width: 160, height: 130 },
      { x: 320, y: 100, width: 160, height: 130 },
      { x: 550, y: 100, width: 160, height: 130 },
    ];

    let jumpCount = 0;
    let currentDeaths = 0;

    const runHighScoreKey = "jump_game_highscore";
    const challengeHighScoreKey = "jump_game_challenge_highscore";
    let runHighScore = Number(localStorage.getItem(runHighScoreKey) || Infinity);
    let challengeHighScore = Number(
      localStorage.getItem(challengeHighScoreKey) || Infinity,
    );

    window.resetBestScores = () => {
      localStorage.removeItem(runHighScoreKey);
      localStorage.removeItem(challengeHighScoreKey);
      runHighScore = Infinity;
      challengeHighScore = Infinity;
      levelIndex = 0;
      currentDeaths = 0;
      jumpCount = 0;
      gameComplete = false;
      dead = false;
      won = false;
      challengeOffered = false;
      challengeMode = false;
      challengeComplete = false;
      doubleJumpUnlocked = false;
      x = 0;
      velocity = 0;
      playerY = 0;
      airJumpsUsed = 0;
      jumping = false;
      screen = "menu";
    };

    const gravity = -0.7;
    const jumpPower = 8;
    const GAP = 20;

    const LAST_NORMAL = 4;
    const LAST_CHALLENGE = 9;

    function pickTargets(count: number, start: number, end: number): number[] {
      if (count === 0) return [];
      return Array.from({ length: count }, (_, i) =>
        start + ((i + 1) / (count + 1)) * (end - start),
      );
    }

    function generateNormalLevel(levelIdx: number, speed: number): Level {
      const TRACK_END = 4500;
      const BUFFER = 300;
      const numDoubles = [0, 1, 2, 3, 4][levelIdx];
      const spikes: Spike[] = [];
      let pos = 400;

      const doubleTargets = pickTargets(
        numDoubles,
        400 + BUFFER,
        TRACK_END - BUFFER,
      );
      let dti = 0;

      while (pos < TRACK_END) {
        pos += 180 + Math.random() * 150;
        spikes.push({ x: pos });

        if (dti < doubleTargets.length && pos >= doubleTargets[dti]) {
          pos += GAP;
          spikes.push({ x: pos });
          dti++;
        }
      }

      const lastX =
        spikes.length > 0 ? spikes[spikes.length - 1].x : TRACK_END;
      return { spikes, end: lastX + 400, speed, isChallenge: false };
    }

    function generateChallengeLevel(
      challengeIdx: number,
      speed: number,
    ): Level {
      const TRACK_END = 9000;
      const BUFFER = 400;

      const numDoubles = [2, 3, 3, 4, 4][challengeIdx];
      const numTriples = [1, 2, 3, 4, 5][challengeIdx];
      const numTalls = [0, 1, 2, 3, 4][challengeIdx];

      const usableStart = 400 + BUFFER;
      const usableEnd = TRACK_END - BUFFER;

      const third = (usableEnd - usableStart) / 3;
      const tallTargets = pickTargets(numTalls, usableStart, usableStart + third);
      const doubleTargets = pickTargets(
        numDoubles,
        usableStart + third,
        usableStart + 2 * third,
      );
      const tripleTargets = pickTargets(
        numTriples,
        usableStart + 2 * third,
        usableEnd,
      );

      const spikes: Spike[] = [];
      let pos = 400;
      let tallI = 0;
      let dblI = 0;
      let triI = 0;

      while (pos < TRACK_END) {
        pos += 180 + Math.random() * 150;

        if (tallI < tallTargets.length && pos >= tallTargets[tallI]) {
          spikes.push({ x: pos, tall: true });
          tallI++;
          continue;
        }

        if (triI < tripleTargets.length && pos >= tripleTargets[triI]) {
          spikes.push({ x: pos });
          pos += GAP;
          spikes.push({ x: pos });
          pos += GAP;
          spikes.push({ x: pos });
          triI++;
          continue;
        }

        if (dblI < doubleTargets.length && pos >= doubleTargets[dblI]) {
          spikes.push({ x: pos });
          pos += GAP;
          spikes.push({ x: pos });
          dblI++;
          continue;
        }

        spikes.push({ x: pos });
      }

      const lastX =
        spikes.length > 0 ? spikes[spikes.length - 1].x : TRACK_END;
      return { spikes, end: lastX + 400, speed, isChallenge: true };
    }

    const levels: Level[] = [
      generateNormalLevel(0, 5),
      generateNormalLevel(1, 6),
      generateNormalLevel(2, 7),
      generateNormalLevel(3, 8),
      generateNormalLevel(4, 9),
      generateChallengeLevel(0, 9),
      generateChallengeLevel(1, 10),
      generateChallengeLevel(2, 10),
      generateChallengeLevel(3, 11),
      generateChallengeLevel(4, 11),
    ];

    function resetLevel() {
      playerY = 0;
      velocity = 0;
      x = 0;
      dead = false;
      jumping = false;
      airJumpsUsed = 0;
      won = false;
      jumpCount = 0;
      rotation = 0;
      rotationTarget = 0;
    }

    function fullReset() {
      levelIndex = 0;
      currentDeaths = 0;
      jumpCount = 0;
      gameComplete = false;
      dead = false;
      won = false;
      challengeOffered = false;
      challengeMode = false;
      challengeComplete = false;
      doubleJumpUnlocked = false;
      x = 0;
      velocity = 0;
      playerY = 0;
      airJumpsUsed = 0;
      jumping = false;
    }

    function goToMainMenu() {
      fullReset();
      screen = "menu";
    }

    function finishLevel() {
      if (levelIndex === LAST_NORMAL) {
        gameComplete = true;
        won = false;

        levelUpSound.currentTime = 0;
        levelUpSound.play().catch(() => {});

        if (currentDeaths < runHighScore) {
          runHighScore = currentDeaths;
          localStorage.setItem(runHighScoreKey, String(runHighScore));
        }

        if (currentDeaths <= 3) challengeOffered = true;
        return;
      }

      if (levelIndex === LAST_CHALLENGE) {
        challengeComplete = true;
        challengeMode = false;
        gameComplete = true;
        won = false;

        levelUpSound.currentTime = 0;
        levelUpSound.play().catch(() => {});

        if (currentDeaths < challengeHighScore) {
          challengeHighScore = currentDeaths;
          localStorage.setItem(challengeHighScoreKey, String(challengeHighScore));
        }
        return;
      }

      levelIndex++;
      resetLevel();
    }

    function jump() {
      if (dead || won || gameComplete || doubleJumpUnlocked) return;

      if (!jumping) {
        velocity = jumpPower;
        jumping = true;
        jumpCount++;
        rotationTarget += 90;
        jumpSound.currentTime = 0;
        jumpSound.play().catch(() => {});
      } else if (airJumpsUsed < 1 && challengeMode) {
        velocity = jumpPower;
        airJumpsUsed++;
        jumpCount++;
        rotationTarget += 90;
        jumpSound.currentTime = 0;
        jumpSound.play().catch(() => {});
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Rebinding hotkey — capture next allowed key
      if (waitingForHotkey && screen === "hotkeys") {
        if (!isAllowedHotkey(e.code)) return;
        e.preventDefault();
        // If key already used by another action, swap them
        for (const a of Object.keys(hotkeys) as HotkeyAction[]) {
          if (a !== waitingForHotkey && hotkeys[a] === e.code) {
            hotkeys[a] = hotkeys[waitingForHotkey];
          }
        }
        hotkeys[waitingForHotkey] = e.code;
        localStorage.setItem(hotkeyKey, JSON.stringify(hotkeys));
        waitingForHotkey = null;
        return;
      }

      if (e.code === "Space" || e.code === "ArrowDown" || e.code === "ArrowUp") {
        e.preventDefault();
      }

      // Pause / resume
      if (e.code === hotkeys.pause) {
        if (screen === "playing") {
          screen = "paused";
          return;
        }
        if (screen === "paused") {
          screen = "playing";
          return;
        }
      }
      // Mute toggle during play
      if (e.code === hotkeys.mute && screen === "playing") {
        toggleMute();
        return;
      }
      // Jump
      if (e.code === hotkeys.jump) {
        if (screen !== "playing") return;
        if (doubleJumpUnlocked) {
          doubleJumpUnlocked = false;
          challengeMode = true;
          gameComplete = false;
          levelIndex = 5;
          currentDeaths = 0;
          resetLevel();
          return;
        }
        jump();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    function hit(cx: number, cy: number, b: { x: number; y: number; width: number; height: number }) {
      return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
    }

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      if (screen === "menu") {
        if (hit(clickX, clickY, menuPlayBtn)) {
          fullReset();
          screen = "playing";
          return;
        }
        if (hit(clickX, clickY, menuSettingsBtn)) {
          returnScreen = "menu";
          screen = "settings";
          return;
        }
        if (hit(clickX, clickY, menuControlsBtn)) {
          controlsReturn = "menu";
          controlsScroll = 0;
          screen = "controls";
          return;
        }
        if (hit(clickX, clickY, menuAboutBtn)) {
          screen = "about";
          return;
        }
        if (hit(clickX, clickY, menuCharBtn)) {
          returnScreen = "menu";
          previewCharIndex = charIndex;
          screen = "characterSelect";
          return;
        }
        return;
      }

      if (screen === "about") {
        if (hit(clickX, clickY, backBtn)) {
          screen = "menu";
        }
        return;
      }

      if (screen === "controls") {
        if (hit(clickX, clickY, backBtn)) {
          screen = controlsReturn;
        }
        return;
      }

      if (screen === "settings") {
        if (hit(clickX, clickY, backBtn)) {
          screen = returnScreen;
          return;
        }
        if (hit(clickX, clickY, hotkeySetupBtn)) {
          waitingForHotkey = null;
          screen = "hotkeys";
          return;
        }
        if (hit(clickX, clickY, bgBlackBtn)) {
          bgChoice = "black";
          localStorage.setItem(bgKey, bgChoice);
          return;
        }
        if (hit(clickX, clickY, bgWhiteBtn)) {
          bgChoice = "white";
          localStorage.setItem(bgKey, bgChoice);
          return;
        }
        return;
      }

      if (screen === "hotkeys") {
        if (hit(clickX, clickY, backBtn)) {
          waitingForHotkey = null;
          screen = "settings";
          return;
        }
        if (hit(clickX, clickY, resetHotkeysBtn)) {
          hotkeys = { ...defaultHotkeys };
          localStorage.setItem(hotkeyKey, JSON.stringify(hotkeys));
          waitingForHotkey = null;
          return;
        }
        for (const row of hotkeyRows) {
          if (hit(clickX, clickY, row.box)) {
            waitingForHotkey = row.action;
            return;
          }
        }
        waitingForHotkey = null;
        return;
      }

      if (screen === "characterSelect") {
        if (hit(clickX, clickY, backBtn)) {
          screen = returnScreen;
          return;
        }
        if (previewCharIndex > 0 && hit(clickX, clickY, charLeftArrow)) {
          previewCharIndex--;
          return;
        }
        if (
          previewCharIndex < characters.length - 1 &&
          hit(clickX, clickY, charRightArrow)
        ) {
          previewCharIndex++;
          return;
        }
        if (hit(clickX, clickY, charSelectBtn)) {
          charIndex = previewCharIndex;
          localStorage.setItem(charKey, String(charIndex));
          screen = "outlineSelect";
          return;
        }
        return;
      }

      if (screen === "outlineSelect") {
        if (hit(clickX, clickY, backBtn)) {
          screen = "characterSelect";
          return;
        }
        for (let i = 0; i < outlines.length; i++) {
          if (hit(clickX, clickY, outlineBtns[i])) {
            outlineChoice = outlines[i];
            localStorage.setItem(outlineKey, outlineChoice);
            screen = returnScreen;
            return;
          }
        }
        return;
      }

      if (screen === "paused") {
        if (hit(clickX, clickY, resumeBtn)) {
          screen = "playing";
          return;
        }
        if (hit(clickX, clickY, pauseMainMenuBtn)) {
          goToMainMenu();
          return;
        }
        if (hit(clickX, clickY, pauseControlsBtn)) {
          controlsReturn = "paused";
          controlsScroll = 0;
          screen = "controls";
          return;
        }
        if (hit(clickX, clickY, pauseCharBtn)) {
          returnScreen = "paused";
          previewCharIndex = charIndex;
          screen = "characterSelect";
          return;
        }
        if (hit(clickX, clickY, pauseSettingsBtn)) {
          returnScreen = "paused";
          screen = "settings";
          return;
        }
        return;
      }

      // screen === "playing"
      if (hit(clickX, clickY, muteButton)) {
        toggleMute();
        return;
      }

      if (hit(clickX, clickY, pauseButton)) {
        screen = "paused";
        return;
      }

      if (dead) {
        resetLevel();
        return;
      }
      if (won) {
        finishLevel();
        return;
      }

      if (doubleJumpUnlocked) {
        doubleJumpUnlocked = false;
        challengeMode = true;
        gameComplete = false;
        levelIndex = 5;
        currentDeaths = 0;
        resetLevel();
        return;
      }

      if (gameComplete && challengeOffered) {
        if (hit(clickX, clickY, challengeBtn)) {
          doubleJumpUnlocked = true;
          gameComplete = false;
          challengeOffered = false;
          return;
        }
        fullReset();
        return;
      }

      if (gameComplete) {
        fullReset();
        return;
      }

      jump();
    };
    canvas.addEventListener("click", handleClick);

    function canvasCoords(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas!.width / rect.width),
        y: (e.clientY - rect.top) * (canvas!.height / rect.height),
      };
    }

    function setVolumeFromX(px: number) {
      const t = Math.max(0, Math.min(1, (px - volSlider.x) / volSlider.width));
      const newVolume = Math.round(t * 100) / 100;
      if (newVolume === 0 && volume > 0) {
        lastVolume = volume;
        localStorage.setItem(lastVolumeKey, String(lastVolume));
      }
      volume = newVolume;
      localStorage.setItem(volumeKey, String(volume));
      applyVolume();
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (screen !== "settings") return;
      const { x: mx, y: my } = canvasCoords(e);
      const knobX = volSlider.x + volume * volSlider.width;
      const knobY = volSlider.y + volSlider.height / 2;
      const onKnob = Math.hypot(mx - knobX, my - knobY) <= 16;
      const onTrack =
        mx >= volSlider.x - 8 &&
        mx <= volSlider.x + volSlider.width + 8 &&
        my >= volSlider.y - 12 &&
        my <= volSlider.y + volSlider.height + 12;
      if (onKnob || onTrack) {
        draggingVolume = true;
        setVolumeFromX(mx);
      }
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingVolume) return;
      const { x: mx } = canvasCoords(e);
      setVolumeFromX(mx);
    };
    const handleMouseUp = () => {
      draggingVolume = false;
    };
    const handleWheel = (e: WheelEvent) => {
      if (screen !== "controls") return;
      e.preventDefault();
      controlsScroll += e.deltaY;
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const setControlsScrollFromY = (my: number) => {
      const content = controlsContentHeight();
      const maxScroll = Math.max(0, content - controlsView.height);
      const ratio = Math.min(1, controlsView.height / content);
      const thumbH = Math.max(24, controlsBar.height * ratio);
      const t = (my - controlsBar.y - thumbH / 2) / Math.max(1, controlsBar.height - thumbH);
      controlsScroll = Math.max(0, Math.min(maxScroll, t * maxScroll));
    };
    const handleControlsDown = (e: MouseEvent) => {
      if (screen !== "controls") return;
      const { x: mx, y: my } = canvasCoords(e);
      if (mx >= controlsBar.x - 8 && mx <= controlsBar.x + controlsBar.width + 8 && my >= controlsBar.y && my <= controlsBar.y + controlsBar.height) {
        draggingControlsBar = true;
        setControlsScrollFromY(my);
      }
    };
    const handleControlsMove = (e: MouseEvent) => {
      if (!draggingControlsBar) return;
      const { y: my } = canvasCoords(e);
      setControlsScrollFromY(my);
    };
    const handleControlsUp = () => {
      draggingControlsBar = false;
    };
    canvas.addEventListener("mousedown", handleControlsDown);
    window.addEventListener("mousemove", handleControlsMove);
    window.addEventListener("mouseup", handleControlsUp);

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    applyVolume();

    let animationFrameId: number;

    function drawButton(
      b: { x: number; y: number; width: number; height: number },
      label: string,
      fontSize = 22,
    ) {
      if (!ctx) return;
      ctx.fillStyle = "#7a7a7a";
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, b.x + b.width / 2, b.y + b.height / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    function drawSquare(
      cx: number,
      cy: number,
      size: number,
      color: string,
      outline: OutlineChoice,
      outlineWidth = 4,
    ) {
      if (!ctx) return;
      ctx.fillStyle = color;
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      if (outline !== "none") {
        ctx.strokeStyle = outline === "white" ? "#ffffff" : "#000000";
        ctx.lineWidth = outlineWidth;
        ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      }
    }

    function drawMenu() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 32px Arial";
      ctx.textAlign = "center";
      ctx.fillText("The Jumping Game", 400, 45);
      ctx.textAlign = "left";
      drawButton(menuPlayBtn, "Play", 18);
      drawButton(menuSettingsBtn, "Settings", 18);
      drawButton(menuControlsBtn, "Game Controls", 18);
      drawButton(menuAboutBtn, "About the Creator", 18);
      drawButton(menuCharBtn, "Character Customization", 18);
    }

    function drawSettings() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 26px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Settings", 400, 45);

      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px Arial";
      ctx.fillText("Sound Volume", 400, 80);

      // Track
      ctx.fillStyle = "#555";
      ctx.fillRect(volSlider.x, volSlider.y, volSlider.width, volSlider.height);
      // Filled portion
      ctx.fillStyle = volume === 0 ? "#888" : "#f5c518";
      ctx.fillRect(volSlider.x, volSlider.y, volume * volSlider.width, volSlider.height);
      // Knob
      const knobX = volSlider.x + volume * volSlider.width;
      const knobY = volSlider.y + volSlider.height / 2;
      ctx.beginPath();
      ctx.arc(knobX, knobY, 12, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icons on either side
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px Arial";
      ctx.textAlign = "center";
      ctx.fillText("🔇", volSlider.x - 30, volSlider.y + 10);
      ctx.fillText("🔊", volSlider.x + volSlider.width + 30, volSlider.y + 10);

      // Percentage label
      ctx.fillStyle = volume === 0 ? "#ff6666" : "#fff";
      ctx.font = "bold 16px Arial";
      ctx.fillText(
        volume === 0 ? "Muted" : `${Math.round(volume * 100)}%`,
        400,
        160,
      );

      // Background choice
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px Arial";
      ctx.fillText("Game Background", 400, 192);

      ctx.textAlign = "left";
      for (const [btn, label, val] of [
        [bgBlackBtn, "Black", "black"],
        [bgWhiteBtn, "White", "white"],
      ] as const) {
        const active = bgChoice === val;
        ctx.fillStyle = active ? "#f5c518" : "#444";
        ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(btn.x, btn.y, btn.width, btn.height);
        ctx.fillStyle = active ? "#000" : "#fff";
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.fillText(label, btn.x + btn.width / 2, btn.y + btn.height / 2 + 6);
        ctx.textAlign = "left";
      }

      drawButton(hotkeySetupBtn, "Hotkey Setup", 18);
      drawButton(backBtn, "Back", 18);
    }

    function drawHotkeys() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Hotkey Setup", 400, 40);

      ctx.font = "14px Arial";
      ctx.fillStyle = "#ccc";
      ctx.fillText(
        waitingForHotkey
          ? `Press a key to set "${waitingForHotkey}" (letters, numbers, arrows, Space, Esc)`
          : "Click an action, then press a key to bind it.",
        400,
        62,
      );

      for (const row of hotkeyRows) {
        // action label
        ctx.fillStyle = "#fff";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "right";
        ctx.fillText(row.label, row.box.x - 20, row.box.y + 23);
        // key box
        const isWaiting = waitingForHotkey === row.action;
        ctx.fillStyle = isWaiting ? "#f5c518" : "#444";
        ctx.fillRect(row.box.x, row.box.y, row.box.width, row.box.height);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(row.box.x, row.box.y, row.box.width, row.box.height);
        ctx.fillStyle = isWaiting ? "#000" : "#fff";
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.fillText(
          isWaiting ? "Press any key..." : prettyKey(hotkeys[row.action]),
          row.box.x + row.box.width / 2,
          row.box.y + 23,
        );
      }
      ctx.textAlign = "left";
      drawButton(resetHotkeysBtn, "Reset to Defaults", 16);
      drawButton(backBtn, "Back", 18);
    }



    function drawAbout() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 26px Arial";
      ctx.textAlign = "center";
      ctx.fillText("About the Creator", 400, 40);
      ctx.font = "bold 16px Arial";
      const lines = [
        "Hi! I'm ibrokethesystem! I am the creator of this",
        "beta version of The Jumping Game!",
        "I love to code games and play Minecraft!",
      ];
      lines.forEach((line, i) => {
        ctx.fillText(line, 400, 90 + i * 28);
      });
      ctx.textAlign = "left";
      drawButton(backBtn, "Back", 18);
    }

    function drawArrow(
      b: { x: number; y: number; width: number; height: number },
      dir: "left" | "right",
    ) {
      if (!ctx) return;
      ctx.fillStyle = "#7a7a7a";
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.fillStyle = "#f5c518";
      ctx.beginPath();
      const cy = b.y + b.height / 2;
      if (dir === "left") {
        ctx.moveTo(b.x + b.width * 0.65, b.y + 12);
        ctx.lineTo(b.x + b.width * 0.35, cy);
        ctx.lineTo(b.x + b.width * 0.65, b.y + b.height - 12);
      } else {
        ctx.moveTo(b.x + b.width * 0.35, b.y + 12);
        ctx.lineTo(b.x + b.width * 0.65, cy);
        ctx.lineTo(b.x + b.width * 0.35, b.y + b.height - 12);
      }
      ctx.closePath();
      ctx.fill();
    }

    function drawCharacterSelect() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Select Your Character", 400, 32);

      const c = characters[previewCharIndex];
      drawSquare(400, 145, 90, c.color, outlineChoice, 5);

      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px Arial";
      ctx.fillText(
        `${c.name} Square  (${previewCharIndex + 1}/${characters.length})`,
        400,
        215,
      );
      ctx.textAlign = "left";

      if (previewCharIndex > 0) drawArrow(charLeftArrow, "left");
      if (previewCharIndex < characters.length - 1)
        drawArrow(charRightArrow, "right");

      drawButton(charSelectBtn, "Select", 18);
      drawButton(backBtn, "Back", 16);
    }

    function drawOutlineSelect() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Select Your Outline", 400, 32);

      const c = characters[charIndex];
      const labels = ["White Outline", "Black Outline", "No Outline"];

      for (let i = 0; i < outlines.length; i++) {
        const b = outlineBtns[i];
        ctx.fillStyle = "#555";
        ctx.fillRect(b.x, b.y, b.width, b.height);
        drawSquare(b.x + b.width / 2, b.y + 55, 70, c.color, outlines[i], 5);
        ctx.fillStyle = "#f5c518";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(labels[i], b.x + b.width / 2, b.y + b.height - 15);
      }
      ctx.textAlign = "left";
      drawButton(backBtn, "Back", 16);
    }

    function controlLines(): { text: string; bold?: boolean }[] {
      return [
        { text: "Movement", bold: true },
        { text: `Jump — ${prettyKey(hotkeys.jump)} or click the game area` },
        { text: "Double jump — press jump again in mid-air (challenge mode)" },
        { text: "Each jump spins your character 90° to the right." },
        { text: "" },
        { text: "Game", bold: true },
        { text: `Pause / Resume — ${prettyKey(hotkeys.pause)} or the ⏸️ button` },
        { text: `Mute / Unmute — ${prettyKey(hotkeys.mute)} or the speaker button` },
        { text: "Restart after death — click anywhere" },
        { text: "Continue after a win — click anywhere" },
        { text: "" },
        { text: "Menus", bold: true },
        { text: "Play — starts at level 1" },
        { text: "Settings — volume slider and hotkey setup" },
        { text: "Character Customization — colour and outline" },
        { text: "Hotkeys can be rebound to letters, numbers, arrow keys, Space or Esc." },
        { text: "Reset to Defaults restores Space / Esc / M." },
        { text: "" },
        { text: "Tips", bold: true },
        { text: "Jump late on tall orange spikes for extra clearance." },
        { text: "Fewer deaths = better score; best runs are saved." },
      ];
    }

    function controlsContentHeight() {
      return controlLines().length * 22 + 10;
    }

    function drawControls() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 26px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Game Controls", 400, 40);
      ctx.textAlign = "left";

      const lines = controlLines();
      const content = controlsContentHeight();
      const maxScroll = Math.max(0, content - controlsView.height);
      if (controlsScroll > maxScroll) controlsScroll = maxScroll;
      if (controlsScroll < 0) controlsScroll = 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(controlsView.x, controlsView.y, controlsView.width, controlsView.height);
      ctx.clip();
      let y = controlsView.y + 18 - controlsScroll;
      for (const line of lines) {
        if (line.bold) {
          ctx.fillStyle = "#f5c518";
          ctx.font = "bold 16px Arial";
        } else {
          ctx.fillStyle = "#e6e6e6";
          ctx.font = "14px Arial";
        }
        ctx.fillText(line.text, controlsView.x + 6, y);
        y += 22;
      }
      ctx.restore();

      // Scrollbar
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(controlsBar.x, controlsBar.y, controlsBar.width, controlsBar.height);
      const ratio = Math.min(1, controlsView.height / content);
      const thumbH = Math.max(24, controlsBar.height * ratio);
      const thumbY =
        controlsBar.y +
        (maxScroll === 0 ? 0 : (controlsScroll / maxScroll) * (controlsBar.height - thumbH));
      ctx.fillStyle = "#f5c518";
      ctx.fillRect(controlsBar.x, thumbY, controlsBar.width, thumbH);

      ctx.fillStyle = "#999";
      ctx.font = "12px Arial";
      ctx.textAlign = "right";
      ctx.fillText("Scroll or drag the bar", 740, 262);
      ctx.textAlign = "left";

      drawButton(backBtn, "Back", 16);
    }

    function drawPauseMenu() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5c518";
      ctx.font = "bold 32px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Game Paused", 400, 55);
      ctx.textAlign = "left";
      drawButton(resumeBtn, "Resume Game", 18);
      drawButton(pauseMainMenuBtn, "Main Menu", 18);
      drawButton(pauseControlsBtn, "Game Controls", 18);
      drawButton(pauseCharBtn, "Character Customization", 18);
      drawButton(pauseSettingsBtn, "Settings", 18);
    }

    function loop() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (screen === "menu") {
        drawMenu();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "settings") {
        drawSettings();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "hotkeys") {
        drawHotkeys();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "controls") {
        drawControls();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "about") {
        drawAbout();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "characterSelect") {
        drawCharacterSelect();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }
      if (screen === "outlineSelect") {
        drawOutlineSelect();
        animationFrameId = requestAnimationFrame(loop);
        return;
      }

      const level = levels[levelIndex];

      if (
        screen === "playing" &&
        !dead &&
        !won &&
        !gameComplete &&
        !doubleJumpUnlocked
      ) {
        x += level.speed;
        velocity += gravity;
        playerY += velocity;

        if (playerY < 0) {
          playerY = 0;
          velocity = 0;
          jumping = false;
          airJumpsUsed = 0;
          rotation = rotationTarget;
        }

        if (jumping) {
          rotation += (rotationTarget - rotation) * 0.18;
        }

        function pointInTriangle(
          px: number,
          py: number,
          ax: number,
          ay: number,
          bx: number,
          by: number,
          cx: number,
          cy: number,
        ) {
          const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
          const a =
            ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
          const b =
            ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
          const c = 1 - a - b;
          return a >= 0 && b >= 0 && c >= 0;
        }

        for (const s of level.spikes) {
          const screenX = s.x - x;
          if (screenX < -50 || screenX > 200) continue;

          const h = s.tall ? 40 : 20;

          // Triangle vertices
          const tx1 = screenX;
          const ty1 = 250;
          const tx2 = screenX + 20;
          const ty2 = 250;
          const tx3 = screenX + 10;
          const ty3 = 250 - h;

          // Player AABB (covers the whole 18x18 square)
          const px = 109;
          const py = 239 - playerY;
          const playerHalf = 9;
          const pLeft = px - playerHalf;
          const pRight = px + playerHalf;
          const pTop = py - playerHalf;
          const pBottom = py + playerHalf;

          // Check several points around the player so the triangle hitbox matches the visuals
          const playerPoints = [
            { x: px, y: pBottom }, // bottom center
            { x: pLeft, y: pBottom }, // bottom left
            { x: pRight, y: pBottom }, // bottom right
            { x: pLeft, y: py }, // left middle
            { x: pRight, y: py }, // right middle
            { x: px, y: pTop }, // top center
            { x: pLeft, y: pTop }, // top left
            { x: pRight, y: pTop }, // top right
          ];

          let hitSpike = false;
          for (const p of playerPoints) {
            if (pointInTriangle(p.x, p.y, tx1, ty1, tx2, ty2, tx3, ty3)) {
              hitSpike = true;
              break;
            }
          }

          // Also check if any triangle vertex is inside the player box
          if (!hitSpike) {
            const trianglePoints = [
              { x: tx1, y: ty1 },
              { x: tx2, y: ty2 },
              { x: tx3, y: ty3 },
            ];
            for (const t of trianglePoints) {
              if (
                t.x >= pLeft &&
                t.x <= pRight &&
                t.y >= pTop &&
                t.y <= pBottom
              ) {
                hitSpike = true;
                break;
              }
            }
          }

          if (hitSpike && !dead) {
            dead = true;
            currentDeaths++;
            deathSound.currentTime = 0;
            deathSound.play().catch(() => {});
          }
        }

        const finalLevelIdx = challengeMode ? LAST_CHALLENGE : LAST_NORMAL;

        if (x >= level.end && playerY === 0 && !jumping && !won) {
          won = true;
          if (levelIndex !== finalLevelIdx) {
            xpSound.currentTime = 0;
            xpSound.play().catch(() => {});
          }
        }
      }

      // Game background + floor (floor contrasts with background)
      ctx.fillStyle = bgChoice === "white" ? "#ffffff" : "#111111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = bgChoice === "white" ? "#111111" : "#ffffff";
      ctx.fillRect(0, 250, 800, 5);
      const hudFg = bgChoice === "white" ? "#111111" : "#ffffff";

      ctx.save();
      ctx.translate(109, 239 - playerY);
      ctx.rotate((rotation * Math.PI) / 180);
      const cc = characters[charIndex];
      ctx.fillStyle = cc.color;
      ctx.fillRect(-9, -9, 18, 18);
      if (outlineChoice !== "none") {
        ctx.strokeStyle = outlineChoice === "white" ? "#ffffff" : "#000000";
        ctx.lineWidth = 2;
        ctx.strokeRect(-9, -9, 18, 18);
      }
      ctx.restore();

      for (const s of level.spikes) {
        const screenX = s.x - x;
        if (screenX < -50 || screenX > 850) continue;
        const h = s.tall ? 40 : 20;
        ctx.fillStyle = s.tall ? "orange" : "red";
        ctx.beginPath();
        ctx.moveTo(screenX, 250);
        ctx.lineTo(screenX + 20, 250);
        ctx.lineTo(screenX + 10, 250 - h);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = bgChoice === "white" ? "#8a6d00" : "yellow";
      ctx.font = "bold 20px Arial";
      const levelLabel = challengeMode
        ? `Challenge ${levelIndex - 4} | Speed ${level.speed}`
        : `Level ${levelIndex + 1} | Speed ${level.speed}`;
      ctx.fillText(levelLabel, 20, 25);
      ctx.fillText(`Jumps: ${jumpCount}`, 250, 25);
      ctx.fillText(`Deaths: ${currentDeaths}`, 250, 45);

      ctx.textAlign = "right";
      const hsLabel = challengeMode
        ? `Challenge Best: ${challengeHighScore === Infinity ? "-" : challengeHighScore}`
        : `Best Run: ${runHighScore === Infinity ? "-" : runHighScore}`;
      ctx.fillText(hsLabel, 670, 25);
      ctx.textAlign = "left";

      ctx.font = "bold 18px Arial";
      ctx.fillText("⏸️", pauseButton.x, pauseButton.y + 18);
      ctx.fillText(volume === 0 ? "🔇" : "🔈", muteButton.x, muteButton.y + 18);

      if (doubleJumpUnlocked) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "gold";
        ctx.font = "bold 28px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Double Jump Unlocked! 😎", 400, 120);
        ctx.fillStyle = "white";
        ctx.font = "bold 18px Arial";
        ctx.fillText("- click to continue -", 400, 165);
        ctx.textAlign = "left";
      }

      if (!gameComplete && won) {
        ctx.fillStyle = hudFg;
        ctx.font = "bold 20px Arial";
        ctx.fillText("🏁 Level Complete - Click next", 250, 120);
      }

      if (dead) {
        ctx.fillStyle = hudFg;
        ctx.font = "bold 20px Arial";
        ctx.fillText("💀 Dead - Click to retry", 280, 120);
      }

      if (gameComplete && challengeComplete) {
        ctx.fillStyle = "gold";
        ctx.font = "bold 22px Arial";
        ctx.fillText("👑 CHALLENGE COMPLETE!", 210, 90);
        ctx.fillStyle = hudFg;
        ctx.font = "bold 18px Arial";
        ctx.fillText(`CHALLENGE SCORE: ${currentDeaths}`, 270, 118);
        ctx.fillText(
          `CHALLENGE BEST: ${challengeHighScore === Infinity ? "-" : challengeHighScore}`,
          260,
          143,
        );
        ctx.fillText("Click to play again", 300, 172);
      } else if (gameComplete && challengeOffered) {
        ctx.fillStyle = hudFg;
        ctx.font = "bold 20px Arial";
        ctx.fillText("🏆 GAME COMPLETE", 270, 78);
        ctx.font = "16px Arial";
        ctx.fillText(
          `Score: ${currentDeaths}  Best: ${runHighScore === Infinity ? "-" : runHighScore}`,
          288,
          100,
        );
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(
          challengeBtn.x,
          challengeBtn.y,
          challengeBtn.width,
          challengeBtn.height,
        );
        ctx.strokeStyle = "gold";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          challengeBtn.x,
          challengeBtn.y,
          challengeBtn.width,
          challengeBtn.height,
        );
        ctx.fillStyle = "gold";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "center";
        ctx.fillText("⚡ CHALLENGE MODE — Click to enter!", 400, 147);
        ctx.textAlign = "left";
        ctx.fillStyle = "#aaa";
        ctx.font = "13px Arial";
        ctx.fillText("(click outside the box to play again)", 270, 175);
      } else if (gameComplete) {
        ctx.fillStyle = hudFg;
        ctx.font = "bold 20px Arial";
        ctx.fillText("🏆 GAME COMPLETE", 270, 100);
        ctx.fillText(`FINAL SCORE: ${currentDeaths}`, 290, 128);
        ctx.fillText(
          `BEST RUN: ${runHighScore === Infinity ? "-" : runHighScore}`,
          295,
          155,
        );
        ctx.fillText("Click to play again", 300, 185);
      }

      if (screen === "paused") {
        drawPauseMenu();
      }

      animationFrameId = requestAnimationFrame(loop);
    }

    loop();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleControlsDown);
      window.removeEventListener("mousemove", handleControlsMove);
      window.removeEventListener("mouseup", handleControlsUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      void audioCtx?.close();

      cancelAnimationFrame(animationFrameId);
      delete window.resetBestScores;
    };
  }, []);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
      <h1 className="text-2xl mb-2">The Jumping Game</h1>
      <button
        onClick={() => window.resetBestScores?.()}
        aria-label="Reset saved best scores and start over"
        style={{
          marginBottom: 10,
          padding: "6px 12px",
          background: "#222",
          color: "yellow",
          border: "1px solid yellow",
        }}
      >
        Reset Game
      </button>
      <canvas
        ref={canvasRef}
        width={800}
        height={300}
        role="application"
        aria-label="Jump Master game screen. Use Space to jump, Escape to pause, and M to mute."
        style={{ background: "#111" }}
      />
      <section className="sr-only">
        <h2 className="text-lg mb-2">How to play Jump Master</h2>
        <p className="mb-4">
          Jump Master is a free browser platformer. You control a square runner that
          sprints across an endless track while red and orange triangular spikes rise
          from the ground. Tap Space or click to jump; each jump spins your character a
          quarter turn in one fluid motion. Clear the challenge gate and double jump
          unlocks, letting you chain a second mid-air hop over taller spike clusters.
        </p>
        <h2 className="text-lg mb-2">Menus and customization</h2>
        <p className="mb-4">
          The main menu offers Play, Character Customization, Settings, and About. In
          Character Customization you can pick between blue, red, orange, yellow,
          purple, and pink runners, then choose a white, black, or no outline. Your
          choice is saved in the browser, so your runner looks the same next visit.
        </p>
        <h2 className="text-lg mb-2">Settings, sound, and hotkeys</h2>
        <p className="mb-4">
          Settings includes a master volume slider — dragging it to 0% mutes the game,
          and the in-game speaker icon always matches the slider. Hotkey Setup lets you
          rebind Jump, Pause, and Mute to any letter, number, Space, or Escape, with a
          Reset to Defaults option if you want the original controls back.
        </p>
        <h2 className="text-lg mb-2">Controls</h2>
        <ul className="list-disc pl-5">
          <li>Space or mouse click — jump (and double jump once unlocked)</li>
          <li>Escape or the pause button — pause and resume a run</li>
          <li>M — toggle mute during gameplay</li>
        </ul>
      </section>
      <a
        href="https://feedback-feed-gaming.lovable.app/invite/fe4d1e42d94e"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open the feedback and bug report form"
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          zIndex: 50,
          padding: "8px 14px",
          background: "#f97316",
          color: "#1c1917",
          fontWeight: 700,
          borderRadius: 8,
          border: "2px solid #7c2d12",
          boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
          textDecoration: "none",
        }}
      >
        feedback/bug report
      </a>
    </main>
  );
}

