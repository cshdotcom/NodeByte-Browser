import { authAdmin } from '@/lib/auth';
import { ok, err, CODE, readJson } from '@/lib/status';
import { q, q1 } from '@/lib/db';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';
import { DIRECTIVE_REGISTRY, DIRECTIVE_VALUE_TYPES, type DirectiveValueType } from '@/lib/directive-registry';

export const dynamic = 'force-dynamic';

/**
 * 策略指令（服务端下发的指令，可撤销）——
 *
 * POST { action: 'create', scope, scopeId?, key, valueType, value, note? }
 *   下发指令：scope=global|group|user；valueType 决定客户端撤销语义。
 * POST { action: 'revoke', directiveId, note? }
 *   撤销指令：服务端标记 is_active=false，随 /api/client/policy 返回 revoked 列表；
 *   客户端收到后**删除本地强制配置**：
 *     - switch        → 恢复默认值（指令强制开则回到关、强制关则回到开）
 *     - text/address  → 清空（回退客户端本地默认）
 *     - search_engine → 恢复编译时默认搜索引擎（必应）
 *   并经 WebSocket 下发 policy_update 触发客户端立即处理。
 * GET  ?status=active|revoked|all
 *   指令列表（含创建人、撤销信息）。
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const status = new URL(req.url).searchParams.get('status') ?? 'all';
  const cond = status === 'active' ? 'is_active = true' : status === 'revoked' ? 'is_active = false' : 'true';
  const r = await q(
    `SELECT d.*, COALESCE(a.username, 'system') AS created_by_name
       FROM policy_directive d LEFT JOIN users a ON a.user_id = d.created_by
      WHERE ${cond} ORDER BY d.created_at DESC LIMIT 500`,
    []
  );
  return ok({ directives: r.rows });
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{
    action?: string; scope?: string; scopeId?: string | null; key?: string;
    valueType?: string; value?: unknown; note?: string; directiveId?: string; confirmHighRisk?: boolean;
  }>(req);
  if (!body) return err(CODE.BAD_REQUEST, '请求体必须是 JSON');
  const ip = clientIp(req);

  if (body.action === 'create') {
    const scope = body.scope ?? 'global';
    if (!['global', 'group', 'user'].includes(scope)) return err(CODE.BAD_REQUEST, 'scope 必须是 global/group/user');
    if (scope !== 'global' && !body.scopeId) return err(CODE.BAD_REQUEST, 'group/user 作用域必须提供 scopeId');
    const key = (body.key ?? '').trim();
    if (!key) return err(CODE.BAD_REQUEST, 'key 不能为空');

    const valueType = (body.valueType ?? 'switch') as DirectiveValueType;
    if (!DIRECTIVE_VALUE_TYPES.includes(valueType)) {
      return err(CODE.BAD_REQUEST, `valueType 必须是 ${DIRECTIVE_VALUE_TYPES.join(' / ')}`);
    }
    // 值校验与归一化（按注册表声明的类型）
    let normalized: unknown = body.value;
    const meta = DIRECTIVE_REGISTRY[key];
    if (valueType === 'switch') {
      normalized = body.value === true || body.value === 'true' || body.value === 1;
      if (meta?.highRisk && normalized === true) {
        return err(CODE.BAD_REQUEST, `${key} 为高危开关，开启需二次确认（请在请求中带 confirmHighRisk: true）`);
      }
    } else if (valueType === 'number') {
      const n = Number(body.value);
      if (!Number.isFinite(n)) return err(CODE.BAD_REQUEST, 'number 指令的值必须是数字');
      normalized = n;
    } else if (valueType === 'json') {
      if (typeof body.value === 'string') {
        try { normalized = JSON.parse(body.value); } catch { return err(CODE.BAD_REQUEST, 'json 指令的值必须是合法 JSON'); }
      }
    } else if (valueType === 'search_engine') {
      normalized = String(body.value ?? '').trim();
    }

    // 高危开关二次确认
    if (meta?.highRisk && body.confirmHighRisk !== true && valueType === 'switch' && normalized === true) {
      return err(CODE.BAD_REQUEST, '高危操作需要 confirmHighRisk=true（前端二次确认后携带）');
    }

    const scopeId = scope === 'global' ? null : body.scopeId!;
    if (scopeId) {
      const exists = await q1(
        scope === 'group' ? `SELECT 1 FROM user_group WHERE group_id=$1` : `SELECT 1 FROM users WHERE user_id=$1`,
        [scopeId]
      );
      if (!exists) return err(CODE.NOT_FOUND, '目标用户组或用户不存在');
    }

    const r = await q1<{ directive_id: string }>(
      `INSERT INTO policy_directive (scope, scope_id, key, value_type, value_json, note, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING directive_id`,
      [scope, scopeId, key, valueType, JSON.stringify(normalized ?? null), body.note ?? '', admin.userId]
    );

    await adminAudit({
      adminUserId: admin.userId, targetUserId: scope === 'user' ? scopeId : null,
      operateType: 'create_policy_directive',
      detail: { directiveId: r?.directive_id, scope, scopeId, key, valueType, value: normalized },
      ip
    }).catch(() => undefined);
    await emitToWs({ type: 'policy_update', data: { reason: 'directive_created', key } });
    return ok({ directiveId: r?.directive_id }, '指令已下发，在线设备将立即收到更新');
  }

  if (body.action === 'revoke') {
    if (!body.directiveId) return err(CODE.BAD_REQUEST, '缺少 directiveId');
    const cur = await q1<{ directive_id: string; key: string; value_type: string; value_json: unknown; is_active: boolean }>(
      `SELECT directive_id, key, value_type, value_json, is_active FROM policy_directive WHERE directive_id=$1`,
      [body.directiveId]
    );
    if (!cur) return err(CODE.NOT_FOUND, '指令不存在');
    if (!cur.is_active) return err(CODE.BAD_REQUEST, '该指令已撤销');

    await q(`UPDATE policy_directive SET is_active=false, revoked_at=now(), revoke_note=$2 WHERE directive_id=$1`,
      [body.directiveId, body.note ?? '']);

    const semantic =
      cur.value_type === 'switch'
        ? '客户端将删除该开关的强制配置并恢复默认值（强制开→回到关；强制关→回到开）'
        : cur.value_type === 'search_engine'
          ? '客户端搜索引擎将恢复为编译时选择的默认搜索引擎（必应）'
          : '客户端将清空该地址/文本/数值/JSON 配置并回退本地默认';

    await adminAudit({
      adminUserId: admin.userId, operateType: 'revoke_policy_directive',
      detail: { directiveId: body.directiveId, key: cur.key, valueType: cur.value_type, revokeNote: body.note ?? '' },
      ip
    }).catch(() => undefined);
    await emitToWs({ type: 'policy_update', data: { reason: 'directive_revoked', directiveId: body.directiveId, key: cur.key } });

    return ok({ directiveId: body.directiveId, key: cur.key, semantics: semantic }, `指令已撤销：${semantic}`);
  }

  return err(CODE.BAD_REQUEST, 'action 必须是 create / revoke');
}
