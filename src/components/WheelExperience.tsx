"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { PublicSector } from "@/lib/wheel";
import { createSpinPlan, stageAt, stageTimes, wheelAt, type SpinPlan, type SpinStage } from "@/lib/spinPlan";

const Avatar3D = dynamic(() => import("./Avatar3D"), { ssr: false });

type WheelData = {
  available: boolean;
  configured: boolean;
  mode: "live" | "configuration";
  sectors: PublicSector[];
};

type SpinResult = {
  id?: string;
  requestId?: string;
  sectorId: string;
  sectorName: string;
  sectorDescription?: string;
  sectorPosition: number;
  createdAt?: string;
  valid: boolean;
  demo?: boolean;
  error?: boolean;
};

function polarClock(radius: number, degClockwiseFromTop: number): [number, number] {
  const rad = (degClockwiseFromTop * Math.PI) / 180;
  return [250 + radius * Math.sin(rad), 250 - radius * Math.cos(rad)];
}

function describeSlice(startDeg: number, endDeg: number): string {
  const [x1, y1] = polarClock(206, startDeg);
  const [x2, y2] = polarClock(206, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M250 250 L${x1.toFixed(2)} ${y1.toFixed(2)} A206 206 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function wrapSectorLabel(name: string): string[] {
  const words = String(name).trim().toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= 10 || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function isLightColor(hex: string): boolean {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 165;
}

function classifySectorStyle(hex: string, index: number): "navy" | "blue" | "silver" | "custom" {
  const lower = hex.toLowerCase();
  if (isLightColor(lower)) return "silver";
  if (
    lower === "#0a2a63" ||
    lower === "#08245b" ||
    lower === "#082254" ||
    lower === "#071b48" ||
    lower === "#09285d"
  ) {
    return "navy";
  }
  if (
    lower === "#0f63e8" ||
    lower === "#087cec" ||
    lower === "#1479f2" ||
    lower === "#079eef" ||
    lower === "#0b7bdc"
  ) {
    return "blue";
  }
  const fallback: ("navy" | "blue" | "silver")[] = ["navy", "blue", "silver", "blue"];
  return hex ? "custom" : fallback[index % fallback.length];
}

function getSectorIconType(name: string): "gift" | "star" | "retry" {
  const n = name.toUpperCase();
  if (n.includes("TENTE") || n.includes("NOVO") || n.includes("GIRE")) return "retry";
  if (n.includes("BÔNUS") || n.includes("BONUS")) return "star";
  return "gift";
}

function SectorVectorIcon({
  type,
  stroke,
}: {
  type: "gift" | "star" | "retry";
  stroke: string;
}) {
  if (type === "star") {
    return (
      <path
        d="M0 -13 L3.6 -4.5 L12.8 -3.5 L5.9 2.7 L7.9 11.8 L0 7.1 L-7.9 11.8 L-5.9 2.7 L-12.8 -3.5 L-3.6 -4.5 Z"
        fill="none"
        stroke={stroke}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    );
  }
  if (type === "retry") {
    return (
      <g fill="none" stroke={stroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 9 -6 A 11 11 0 1 0 10 5" />
        <polyline points="4,-10 10,-6 5,-1" />
      </g>
    );
  }
  // Gift box icon matching reference image
  return (
    <g fill="none" stroke={stroke} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="-11" y="-4" width="22" height="6" rx="1.5" />
      <path d="M-9.5 2 H9.5 V12.5 A1.5 1.5 0 0 1 8 14 H-8 A1.5 1.5 0 0 1 -9.5 12.5 Z" />
      <line x1="0" y1="-4" x2="0" y2="14" />
      <path d="M0 -4 C-5.5 -4 -8 -7.5 -5.5 -10 C-3 -12.5 0 -7.5 0 -4 Z" />
      <path d="M0 -4 C5.5 -4 8 -7.5 5.5 -10 C3 -12.5 0 -7.5 0 -4 Z" />
    </g>
  );
}

// Synthesized Web Audio sound effects (no external audio files required)
class WheelAudioEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playPrep() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.5);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.58);
  }

  playPush() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(135, now + 0.22);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.52);
    gain.gain.setValueAtTime(0.001, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.32);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + 0.22);
    osc.stop(now + 0.58);
  }

  playBrake() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.65);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.72);
  }

  playTick(speedFactor = 1) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    const baseFreq = 680 + Math.min(420, speedFactor * 280);
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.032);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playCelebration(isRetry = false) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isRetry ? [392, 349.23, 329.63] : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isRetry ? "sine" : "triangle";
      const start = now + i * 0.09;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.48);
    });
  }
}

export default function WheelExperience({ initialData }: { initialData: WheelData }) {
  const sectors = initialData.sectors;
  const initialAngle = sectors.length > 0 ? -(360 / sectors.length) / 2 : -22.5;

  const [spinStage, setSpinStage] = useState<SpinStage | "idle">("idle");
  const rotationRef = useRef(initialAngle);
  const planRef = useRef<SpinPlan | null>(null);
  const wheelRotRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<SVGSVGElement | null>(null);
  const driverRafRef = useRef(0);
  const spinning = spinStage !== "idle" && spinStage !== "result" && spinStage !== "reaction" && spinStage !== "return" && spinStage !== "done";
  const [result, setResult] = useState<SpinResult | null>(null);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  const lockRef = useRef(false);
  const demoCursorRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const audioRef = useRef<WheelAudioEngine | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    audioRef.current = new WheelAudioEngine();
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
      if (driverRafRef.current) cancelAnimationFrame(driverRafRef.current);
    };
  }, []);

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      if (audioRef.current) audioRef.current.muted = next;
      return next;
    });
  };

  const launchConfetti = useCallback(() => {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const palette = ["#2f7bff", "#00d4ff", "#ffffff", "#bcd8ff", "#ffd166"];
    const particles = Array.from({ length: 130 }, () => ({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 160,
      y: canvas.height * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      size: 6 + Math.random() * 6,
      color: palette[Math.floor(Math.random() * palette.length)],
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.25,
      alpha: 1,
    }));

    let frame = 0;
    const render = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.34;
        p.vx *= 0.99;
        p.rot += p.vRot;
        if (frame > 75) p.alpha = Math.max(0, p.alpha - 0.022);
        if (p.alpha > 0 && p.y < canvas.height + 40) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
      }
      if (alive && frame < 150) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    requestAnimationFrame(render);
  }, []);

  const clearScheduledTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  const slices = useMemo(() => {
    if (!sectors.length) return [];
    const span = 360 / sectors.length;
    return sectors.map((sector, index) => {
      const start = index * span;
      const end = (index + 1) * span;
      const center = start + span / 2;
      const styleKind = classifySectorStyle(sector.color, index);
      return {
        sector,
        index,
        start,
        end,
        center,
        span,
        styleKind,
        isSilver: styleKind === "silver",
        iconType: getSectorIconType(sector.name),
      };
    });
  }, [sectors]);

  function stopDriver() {
    if (driverRafRef.current) cancelAnimationFrame(driverRafRef.current);
    driverRafRef.current = 0;
  }

  async function handleSpin() {
    if (lockRef.current || planRef.current || result || !slices.length) return;
    lockRef.current = true;
    clearScheduledTimers();

    try {
      // 1. O resultado é escolhido no servidor ANTES de qualquer animação
      const isLive = initialData.mode === "live";
      const response = await fetch(isLive ? "/api/spin" : "/api/demo-spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLive ? { requestId: crypto.randomUUID() } : { cursor: demoCursorRef.current++ }
        ),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível iniciar o giro.");
      }

      const targetSlice = slices.find((s) => s.sector.id === data.sectorId);
      if (!targetSlice) {
        throw new Error("O setor sorteado não está ativo na roleta.");
      }

      const outcome = getSectorIconType(data.sectorName) === "retry" ? "retry" : "prize";
      const plan = createSpinPlan({
        fromAngle: rotationRef.current,
        targetCenterDeg: targetSlice.center,
        outcome,
        startMs: performance.now(),
      });
      planRef.current = plan;
      const times = stageTimes(plan);
      const span = 360 / slices.length;
      let lastTick = Math.floor(plan.fromAngle / span);
      let lastStage: SpinStage | null = null;
      let modalShown = false;
      const spinResult: SpinResult = {
        id: data.id,
        requestId: data.requestId,
        sectorId: data.sectorId,
        sectorName: data.sectorName,
        sectorDescription: data.sectorDescription,
        sectorPosition: data.sectorPosition,
        createdAt: data.createdAt,
        valid: Boolean(data.valid),
        demo: Boolean(data.demo),
      };

      // 2. Driver em tempo real: disco, ponteiro, sons e etapas leem o MESMO plano do avatar
      const tick = () => {
        const t = (performance.now() - plan.startMs) / 1000;
        const { angle, velocity } = wheelAt(plan, t);
        rotationRef.current = angle;
        if (wheelRotRef.current) wheelRotRef.current.style.transform = `rotate(${angle}deg)`;

        const tickIdx = Math.floor(angle / span);
        if (tickIdx !== lastTick) {
          lastTick = tickIdx;
          audioRef.current?.playTick(Math.min(1, velocity / 220));
          const el = pointerRef.current;
          if (el) {
            el.classList.remove("wheel-pointer-tap");
            void el.getBoundingClientRect();
            el.classList.add("wheel-pointer-tap");
          }
        }

        const stage = stageAt(plan, t);
        if (stage !== lastStage) {
          lastStage = stage;
          setSpinStage(stage);
          if (stage === "prep") audioRef.current?.playPrep();
          if (stage === "pull") audioRef.current?.playPush();
          if (stage === "brake") audioRef.current?.playBrake();
          if (stage === "reaction") {
            audioRef.current?.playCelebration(outcome === "retry");
            if (outcome === "prize") launchConfetti();
          }
        }

        if (!modalShown && t >= times.modal) {
          modalShown = true;
          setResult(spinResult);
        }

        if (stage === "done") {
          planRef.current = null;
          rotationRef.current = ((angle % 360) + 360) % 360;
          if (wheelRotRef.current) {
            wheelRotRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
          }
          setSpinStage("idle");
          lockRef.current = false;
          driverRafRef.current = 0;
          return;
        }
        driverRafRef.current = requestAnimationFrame(tick);
      };
      stopDriver();
      driverRafRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      planRef.current = null;
      setSpinStage("idle");
      lockRef.current = false;
      setResult({
        sectorId: "error",
        sectorName: cause instanceof Error ? cause.message : "Erro ao processar giro.",
        sectorPosition: -1,
        valid: false,
        error: true,
      });
    }
  }

  function closeResultModal() {
    setResult(null);
    setCopied(false);
  }

  function copyReceipt() {
    if (!result) return;
    const text = `FATOR REDUÇÃO - Resultado: ${result.sectorName}${
      result.id ? ` | Protocolo: ${result.id.slice(0, 8).toUpperCase()}` : " (Demonstração)"
    }`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  const isBusy = spinStage !== "idle" || Boolean(result);

  return (
    <div className="fr-page">
      <div className="fr-scene" aria-hidden="true" />
      <canvas
        ref={confettiCanvasRef}
        className="pointer-events-none fixed inset-0 z-[90]"
        aria-hidden="true"
      />

      {/* Top-left floating utility bar */}
      <div className="fr-top-controls">
        <Link
          href="/admin"
          className="fr-gear"
          aria-label="Acessar painel administrativo"
          title="Painel Administrativo"
        >
          <Settings className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={toggleMute}
          className="fr-gear"
          aria-label={muted ? "Ativar som" : "Silenciar som"}
          title={muted ? "Ativar efeitos sonoros" : "Silenciar efeitos sonoros"}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <div
          className={`fr-status-pill ${
            initialData.mode === "live" ? "is-live" : "is-config"
          }`}
        >
          <span className="fr-status-dot" />
          <span>
            {initialData.mode === "live"
              ? "SORTEIO OFICIAL ATIVO"
              : "MODO DEMONSTRAÇÃO"}
          </span>
        </div>
      </div>

      {/* Top-right official FATOR REDUÇÃO metallic brand lockup */}
      <aside className="fr-brand" aria-label="Identidade visual Fator Redução">
        <div className="fr-brand-icon-wrap">
          <img
            src="/assets/fator-icone-transparente.png"
            alt="Ícone Oficial Fator Redução"
            className="fr-brand-icon"
          />
        </div>
        <div className="fr-brand-wordmark">
          <span className="fr-brand-fator">FATOR</span>
          <span className="fr-brand-reducao">REDUÇÃO</span>
          <span className="fr-brand-divider" />
          <span className="fr-brand-tagline">ESTRATÉGIA. CLAREZA. RESULTADO.</span>
        </div>
      </aside>

      {/* Main stage: 3D Avatar + Wheel + Spin Controls */}
      <main className="fr-main-stage">
        <div className="wheel-rig">
          <Avatar3D planRef={planRef} />
          <div className="fr-floor" aria-hidden="true" />
          <div className="fr-base" aria-hidden="true" />

          <div className="wheel-stage">
            <div className="wheel-glow" aria-hidden="true" />

            {/* Rotating wheel disc (ONLY the disc and its sectors rotate) */}
            <div
              className="wheel-rotation"
              ref={wheelRotRef}
              style={{ transform: `rotate(${initialAngle}deg)` }}
            >
              <svg
                viewBox="0 0 500 500"
                className="wheel-svg"
                role="img"
                aria-label="Setores da roleta promocional Fator Redução"
              >
                <defs>
                  <linearGradient id="segNavy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#123a82" />
                    <stop offset="0.55" stopColor="#0a2a63" />
                    <stop offset="1" stopColor="#051942" />
                  </linearGradient>
                  <linearGradient id="segBlue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#328eff" />
                    <stop offset="0.55" stopColor="#0f63e8" />
                    <stop offset="1" stopColor="#0744b0" />
                  </linearGradient>
                  <linearGradient id="segSilver" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f8fbff" />
                    <stop offset="0.5" stopColor="#dfe7f1" />
                    <stop offset="1" stopColor="#b8c7dc" />
                  </linearGradient>
                  <linearGradient id="divG" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#f0f5fc" />
                    <stop offset="0.5" stopColor="#8ba0bd" />
                    <stop offset="1" stopColor="#e2eaf5" />
                  </linearGradient>
                  <radialGradient id="depthG" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0.6" stopColor="#030a19" stopOpacity="0" />
                    <stop offset="1" stopColor="#020816" stopOpacity="0.58" />
                  </radialGradient>
                </defs>

                <circle cx="250" cy="250" r="206" fill="#071129" />

                {/* Sector wedges */}
                {slices.map((s) => {
                  const fillUrl =
                    s.styleKind === "navy"
                      ? "url(#segNavy)"
                      : s.styleKind === "blue"
                      ? "url(#segBlue)"
                      : s.styleKind === "silver"
                      ? "url(#segSilver)"
                      : s.sector.color;
                  return (
                    <path
                      key={s.sector.id}
                      d={describeSlice(s.start, Math.min(s.end, s.start + 359.99))}
                      fill={fillUrl}
                    />
                  );
                })}

                {/* Metallic spoke dividers */}
                {slices.length > 1 &&
                  slices.map((s) => {
                    const [x, y] = polarClock(206, s.start);
                    return (
                      <g key={`div-${s.sector.id}`}>
                        <line
                          x1="250"
                          y1="250"
                          x2={x.toFixed(2)}
                          y2={y.toFixed(2)}
                          stroke="#040c1e"
                          strokeWidth="5"
                        />
                        <line
                          x1="250"
                          y1="250"
                          x2={x.toFixed(2)}
                          y2={y.toFixed(2)}
                          stroke="url(#divG)"
                          strokeWidth="2.5"
                          opacity="0.92"
                        />
                      </g>
                    );
                  })}

                {/* Sector icons and radial legible labels */}
                {slices.map((s) => {
                  const [cx, cy] = polarClock(136, s.center);
                  const lines = wrapSectorLabel(s.sector.name);
                  const maxChars = lines.reduce((m, l) => Math.max(m, l.length), 0);
                  const chord = 268 * Math.sin((s.span * Math.PI) / 360);
                  const fontSize = Math.min(14.5, Math.max(8.5, (chord * 1.18) / Math.max(maxChars, 6)));
                  const lineHeight = fontSize * 1.2;
                  const iconScale = Math.max(0.65, Math.min(1, s.span / 45));
                  const textColor = s.isSilver ? "#08347c" : "#ffffff";
                  const iconColor = s.isSilver ? "#0a3986" : "#e8f6ff";
                  const blockHeight = 24 * iconScale + 8 + lines.length * lineHeight;
                  const startY = -blockHeight / 2;

                  return (
                    <g
                      key={`label-${s.sector.id}`}
                      transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${s.center})`}
                    >
                      <g
                        transform={`translate(0 ${(startY + 11 * iconScale).toFixed(2)}) scale(${iconScale.toFixed(2)})`}
                      >
                        <SectorVectorIcon type={s.iconType} stroke={iconColor} />
                      </g>
                      {lines.map((line, lineIdx) => (
                        <text
                          key={lineIdx}
                          x="0"
                          y={(
                            startY +
                            24 * iconScale +
                            9 +
                            (lineIdx + 0.5) * lineHeight
                          ).toFixed(2)}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={fontSize}
                          fontWeight="800"
                          fill={textColor}
                          style={
                            s.isSilver
                              ? { letterSpacing: "0.03em" }
                              : {
                                  letterSpacing: "0.03em",
                                  paintOrder: "stroke",
                                  stroke: "rgba(3, 12, 30, 0.65)",
                                  strokeWidth: fontSize > 11 ? 2.2 : 1.4,
                                }
                          }
                        >
                          {line}
                        </text>
                      ))}
                    </g>
                  );
                })}

                <circle cx="250" cy="250" r="206" fill="url(#depthG)" />
              </svg>
            </div>

            {/* Fixed outer chrome rim with 16 cyan LED lights */}
            <svg
              viewBox="0 0 500 500"
              className="wheel-rim"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="chromeRim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f8fbff" />
                  <stop offset="0.26" stopColor="#8fa3bf" />
                  <stop offset="0.5" stopColor="#eaf1fb" />
                  <stop offset="0.75" stopColor="#586d8c" />
                  <stop offset="1" stopColor="#d2dcea" />
                </linearGradient>
                <linearGradient id="chromeInnerLip" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e2eaf5" />
                  <stop offset="1" stopColor="#384963" />
                </linearGradient>
              </defs>
              <circle
                cx="250"
                cy="250"
                r="246"
                fill="none"
                stroke="#040a1b"
                strokeWidth="8"
              />
              <circle
                cx="250"
                cy="250"
                r="224"
                fill="none"
                stroke="url(#chromeRim)"
                strokeWidth="38"
              />
              <path
                d="M98 84 A224 224 0 0 1 402 84"
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M428 356 A224 224 0 0 1 272 468"
                fill="none"
                stroke="rgba(8,20,42,0.5)"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M28 356 A224 224 0 0 1 72 118"
                fill="none"
                stroke="rgba(255,255,255,0.24)"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle
                cx="250"
                cy="250"
                r="203"
                fill="none"
                stroke="url(#chromeInnerLip)"
                strokeWidth="7"
              />
              <circle
                cx="250"
                cy="250"
                r="199"
                fill="none"
                stroke="rgba(2,8,20,0.68)"
                strokeWidth="3"
              />

              {Array.from({ length: 16 }).map((_, idx) => {
                const [lx, ly] = polarClock(224, idx * 22.5);
                return (
                  <g key={idx}>
                    <circle
                      className="wheel-light-glow"
                      cx={lx}
                      cy={ly}
                      r="9.5"
                      fill="#29cbff"
                      style={{
                        animationDelay: `${idx * 0.1}s`,
                        animationDuration: spinning ? "0.45s" : "1.8s",
                      }}
                    />
                    <circle
                      className="wheel-light"
                      cx={lx}
                      cy={ly}
                      r="4.3"
                      fill="#edffff"
                      style={{
                        animationDelay: `${idx * 0.1}s`,
                        animationDuration: spinning ? "0.45s" : "1.8s",
                      }}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="wheel-sheen" aria-hidden="true" />

            {/* Fixed central medallion with official transparent PNG icon */}
            <div
              className={
                spinStage === "reaction" ? "wheel-hub wheel-hub-pulse" : "wheel-hub"
              }
            >
              <span className="wheel-hub-ring" aria-hidden="true" />
              <img
                src="/assets/fator-icone-transparente.png"
                alt="Ícone oficial Fator Redução"
                className="wheel-hub-logo"
              />
            </div>

            {/* Fixed top metallic & cyan pointer */}
            <svg
              ref={pointerRef}
              className="wheel-pointer"
              viewBox="0 0 70 88"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="ptrCyan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#a9e6ff" />
                  <stop offset="0.52" stopColor="#1ca2ff" />
                  <stop offset="1" stopColor="#0848c8" />
                </linearGradient>
                <linearGradient id="ptrSilver" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#f4f8ff" />
                  <stop offset="0.5" stopColor="#8fa3bf" />
                  <stop offset="1" stopColor="#e8f0fa" />
                </linearGradient>
              </defs>
              <rect
                x="19"
                y="2"
                width="32"
                height="16"
                rx="5"
                fill="url(#ptrSilver)"
                stroke="#091b3e"
                strokeWidth="1.6"
              />
              <path
                d="M35 83 L9 18 L61 18 Z"
                fill="url(#ptrCyan)"
                stroke="url(#ptrSilver)"
                strokeWidth="3.6"
                strokeLinejoin="round"
              />
              <path
                d="M35 77 L17 24 L35 24 Z"
                fill="rgba(255,255,255,0.28)"
              />
            </svg>
          </div>
        </div>

        {/* Main Spin Action Button and Mode Feedback */}
        <div className="fr-action-dock">
          <button
            type="button"
            onClick={handleSpin}
            disabled={isBusy || !slices.length}
            className={`spin-btn ${
              spinning ? "is-spinning" : result ? "is-done" : ""
            }`}
          >
            <span className="spin-btn-inner">
              {spinStage === "prep" || spinStage === "pull" ? (
                <>
                  <Sparkles className="h-5 w-5 animate-spin" />
                  <span>PUXANDO A ROLETA…</span>
                </>
              ) : spinStage === "release" || spinStage === "hold" ? (
                <>
                  <Sparkles className="h-5 w-5 animate-spin" />
                  <span>GIRANDO…</span>
                </>
              ) : spinStage === "brake" ? (
                <>
                  <Sparkles className="h-5 w-5 animate-spin" />
                  <span>FREANDO A ROLETA…</span>
                </>
              ) : spinStage !== "idle" || result ? (
                <>
                  <RotateCcw className="h-5 w-5" />
                  <span>CONCLUÍDO — GIRAR DE NOVO</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  <span>GIRAR ROLETA</span>
                </>
              )}
            </span>
          </button>

          {initialData.mode === "live" ? (
            <p className="fr-caption is-live">
              <ShieldCheck className="h-3.5 w-3.5 text-[#38e9a3]" />
              <span>Sorteio auditado no servidor • Resultado sincronizado</span>
            </p>
          ) : (
            <p className="fr-caption is-demo">
              <span>
                Modo de demonstração ativo — configure pesos e publique em{" "}
                <Link href="/admin" className="underline hover:text-white">
                  /admin
                </Link>{" "}
                para validar prêmios.
              </span>
            </p>
          )}
        </div>
      </main>

      {/* Celebratory Result Modal */}
      {result && (
        <div
          className="fr-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fr-modal-title"
          onClick={closeResultModal}
        >
          <div
            className="fr-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeResultModal}
              className="fr-modal-close"
              aria-label="Fechar resultado"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="fr-modal-glow" aria-hidden="true" />

            <div className="fr-modal-badge-icon">
              {result.error ? (
                <X className="h-9 w-9 text-red-300" />
              ) : getSectorIconType(result.sectorName) === "retry" ? (
                <RotateCcw className="h-9 w-9 text-[#9ee8ff]" />
              ) : (
                <Trophy className="h-9 w-9 text-[#ffe699]" />
              )}
            </div>

            <span className="fr-modal-kicker">
              {result.error
                ? "AVISO DO SISTEMA"
                : result.valid
                ? "SORTEIO OFICIAL FATOR REDUÇÃO"
                : "MODO DEMONSTRAÇÃO • SEM VALIDADE DE PRÊMIO"}
            </span>

            <h2 id="fr-modal-title" className="fr-modal-heading">
              {result.error
                ? "OPS!"
                : getSectorIconType(result.sectorName) === "retry"
                ? "QUASE LÁ!"
                : "PARABÉNS!"}
            </h2>

            <div className="fr-modal-prize-box">
              <span className="fr-modal-prize-label">SETOR INDICADO PELO PONTEIRO</span>
              <strong className="fr-modal-prize-name">{result.sectorName}</strong>
              {result.sectorDescription && (
                <p className="fr-modal-prize-desc">{result.sectorDescription}</p>
              )}
            </div>

            {!result.error && (
              <div className="fr-modal-meta">
                {result.valid && result.id ? (
                  <div className="fr-receipt-row">
                    <span>
                      Protocolo: <b>#{result.id.slice(0, 8).toUpperCase()}</b>
                    </span>
                    <button
                      type="button"
                      onClick={copyReceipt}
                      className="fr-copy-btn"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-300" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copiar comprovante</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <p className="fr-demo-warning">
                    Este giro foi executado em modo de configuração/demonstração e
                    não gera direito a resgate.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={closeResultModal}
              className="fr-modal-cta"
            >
              GIRAR NOVAMENTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
