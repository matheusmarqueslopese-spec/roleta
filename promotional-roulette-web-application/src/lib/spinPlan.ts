/**
 * Linha do tempo única do giro. A roleta (disco) e o avatar 3D leem o MESMO
 * plano, então o gesto de puxar, o giro, a frenagem e a reação ficam
 * sincronizados ao progresso real do disco.
 *
 * Física adotada:
 * - Puxada: a mão esquerda agarra a borda do DISCO e o acelera sem deslizar
 *   (o ângulo da mão acompanha exatamente o ângulo do disco).
 * - Depois de soltar, o disco desacelera sozinho: v(s) = v1 · (1 − s)^p.
 * - Frenagem: as mãos pressionam a borda do disco (atrito); o disco desliza
 *   sob as mãos, que não ficam presas a ele.
 */

export type SpinOutcome = "prize" | "retry";

export type SpinPlan = {
  startMs: number;
  fromAngle: number; // graus (CSS rotate, horário positivo)
  totalDelta: number; // graus a percorrer (> 0)
  prepS: number; // preparação antes de agarrar o disco
  pullS: number; // duração da puxada (mão em contato com o disco)
  spinS: number; // duração total do movimento do disco
  handTravelDeg: number; // arco percorrido pela mão durante a puxada
  v1: number; // velocidade de pico (graus/s) no instante em que a mão solta
  p: number; // expoente de desaceleração
  outcome: SpinOutcome;
};

export const PLAN_DEFAULTS = {
  prepS: 0.9,
  pullS: 0.45,
  spinS: 10,
  handTravelDeg: 45,
};

export type SpinStage =
  | "prep"
  | "pull"
  | "release"
  | "hold"
  | "brake"
  | "result"
  | "reaction"
  | "return"
  | "done";

export function createSpinPlan(params: {
  fromAngle: number;
  targetCenterDeg: number; // centro do setor sorteado (horário a partir do topo)
  outcome: SpinOutcome;
  startMs: number;
}): SpinPlan {
  const { prepS, pullS, spinS, handTravelDeg } = PLAN_DEFAULTS;
  const currentMod = ((params.fromAngle % 360) + 360) % 360;
  const desiredMod = ((-params.targetCenterDeg % 360) + 360) % 360;
  let delta = desiredMod - currentMod;
  if (delta <= 0) delta += 360;
  // 2 voltas + o necessário: mantém p entre ~1.3 e ~2.5 (parada suave, sem tranco)
  const totalDelta = delta + 720;
  const v1 = (2 * handTravelDeg) / pullS;
  const decelS = spinS - pullS;
  const p = Math.max(1, (v1 * decelS) / (totalDelta - handTravelDeg) - 1);
  return {
    startMs: params.startMs,
    fromAngle: params.fromAngle,
    totalDelta,
    prepS,
    pullS,
    spinS,
    handTravelDeg,
    v1,
    p,
    outcome: params.outcome,
  };
}

/** Ângulo (graus) e velocidade (graus/s) do disco no tempo t (s desde o início do plano). */
export function wheelAt(plan: SpinPlan, t: number): { angle: number; velocity: number } {
  const tp = t - plan.prepS;
  if (tp <= 0) return { angle: plan.fromAngle, velocity: 0 };
  if (tp < plan.pullS) {
    const a = plan.v1 / plan.pullS;
    return { angle: plan.fromAngle + 0.5 * a * tp * tp, velocity: a * tp };
  }
  const decelS = plan.spinS - plan.pullS;
  const s = Math.min(1, (tp - plan.pullS) / decelS);
  const travelDecel = plan.totalDelta - plan.handTravelDeg;
  // integral de v1·(1−s)^p normalizada para fechar exatamente em totalDelta
  const progress = 1 - Math.pow(1 - s, plan.p + 1);
  return {
    angle: plan.fromAngle + plan.handTravelDeg + travelDecel * progress,
    velocity: s >= 1 ? 0 : plan.v1 * Math.pow(1 - s, plan.p),
  };
}

export function stageTimes(plan: SpinPlan) {
  const grab = plan.prepS;
  const release = grab + plan.pullS;
  const stop = grab + plan.spinS;
  return {
    grab,
    release,
    holdStart: release + 0.65,
    brakeStart: stop - 3.2,
    stop,
    reaction: stop + 0.7,
    modal: stop + 2.4,
    returnStart: stop + 2.7,
    done: stop + 3.7,
  };
}

export function stageAt(plan: SpinPlan, t: number): SpinStage {
  const s = stageTimes(plan);
  if (t < s.grab) return "prep";
  if (t < s.release) return "pull";
  if (t < s.holdStart) return "release";
  if (t < s.brakeStart) return "hold";
  if (t < s.stop) return "brake";
  if (t < s.reaction) return "result";
  if (t < s.returnStart) return "reaction";
  if (t < s.done) return "return";
  return "done";
}
