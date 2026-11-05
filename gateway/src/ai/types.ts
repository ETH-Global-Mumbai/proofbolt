export type AiDecision = "OPEN" | "HOLD" | "ALERT";

export type AiStatus = "OK" | "0G_UNREACHABLE" | "INVALID_OUTPUT";

export interface AiResult {
  status: AiStatus;
  /** Null unless a real model answered. Never filled in by a fallback. */
  decision: AiDecision | null;
  requestId: string | null;
  provider: string | null;
  totalCost: string | null;
  teeVerified: boolean | null;
  detail: string | null;
}

export interface DecisionRequest {
  challenge: string;
  imageDataUrl: string;
}

export interface Decider {
  decide(request: DecisionRequest): Promise<AiResult>;
}

export function failedResult(status: AiStatus, detail: string): AiResult {
  return { status, decision: null, requestId: null, provider: null, totalCost: null, teeVerified: null, detail };
}
