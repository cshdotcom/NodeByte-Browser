/**
 * 事件推送：Next.js 业务写库后，通知 ws-service（独立信令服务）向在线设备下发。
 * 服务间鉴权：INTERNAL_SHARED_SECRET（Bearer）。
 * ws-service 协议见 docs/api-contract.md 附录D。
 */

const WS_BASE = process.env.WS_SERVICE_URL || 'http://localhost:8081';
const SECRET = process.env.INTERNAL_SHARED_SECRET || 'change-me-internal-secret';

export type WsEvent =
  | { type: 'command'; deviceId?: string; userId?: string; data: Record<string, unknown> }
  | { type: 'push_message'; deviceId?: string; userId?: string; data: Record<string, unknown> }
  | { type: 'session_revoked'; userId?: string; data: Record<string, unknown> }
  | { type: 'policy_update'; userId?: string; data: Record<string, unknown> }
  | { type: 'collab'; userId?: string; data: Record<string, unknown> };

export async function emitToWs(event: WsEvent): Promise<void> {
  try {
    await fetch(`${WS_BASE}/internal/emit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    // ws-service 离线不阻塞业务主流程（设备上线后经 REST 兜底拉取）
  }
}
