#!/usr/bin/env node
/**
 * NodeByte v1.4.5 协作会议 + 远程指令 自检（零依赖，静态 + 行为级）
 * 覆盖：
 *   1. 附录 E.1 远程指令白名单 8 种 —— 服务端 /api/admin/devices/command 与
 *      客户端 nodebyte_constants.h 双侧对齐
 *   2. payload 校验规则（open_url/switch_proxy/switch_fingerprint）
 *   3. 附录 E.2 信令通道 15 消息 —— ws-service 消息处理覆盖
 *   4. ws-service rtc_relay / collab_join / collab_leave / input_event 角色校验
 *   5. REST 协作路由存在性（sessions / [id] / participants）
 *   6. 客户端 collab_controller / mojom / drop WebUI 关键接线
 *   7. admin 设备面板接线（DevicesPanel / t('devicesRemote')）
 *   8. 策略键一致性（AllowDropCollaboration / allow_collab_invite）
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function section(name) { console.log(`\n== ${name} ==`); }

// ---------------------------------------------------------------- 1. 命令白名单双侧对齐
section('1. 远程指令白名单（附录 E.1，8 种，双侧对齐）');
const E1_CMDS = ['open_url', 'close_tab', 'clear_cache', 'logout', 'lock_browser', 'switch_fingerprint', 'switch_proxy', 'enable_snapshot'];
const serverCmd = read('server/src/app/api/admin/devices/command/route.ts');
const clientConst = read('client/src-nodebyte/chrome/browser/nodebyte/nodebyte_constants.h');
for (const c of E1_CMDS) {
  ok(serverCmd.includes(`'${c}'`), `服务端白名单含 ${c}`);
  ok(clientConst.includes(`kRemoteCmd${c.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')}`), `客户端常量含 kRemoteCmd${c}`);
}
ok(serverCmd.includes('COMMANDS.has(cmd)'), '服务端执行前校验白名单');
ok(clientConst.includes('kCollabStatusReportSeconds'), '客户端含状态上报间隔常量');
ok(clientConst.includes('kCollabWsReconnectMaxMs'), '客户端含 WS 重连退避常量');

// ---------------------------------------------------------------- 2. payload 校验
section('2. payload 校验规则');
ok(/open_url[^\0]*?\/\^https\?:\\\/\\\//.test(serverCmd.replace(/\s/g, '')) || serverCmd.includes('http(s) url'), 'open_url 校验 http(s) url');
ok(serverCmd.includes("'direct', 'fixed_servers', 'system'"), 'switch_proxy 校验 mode 枚举');
ok(serverCmd.includes('fixed_servers 模式需要 server'), 'fixed_servers 强制 server');
ok(serverCmd.includes('templateId'), 'switch_fingerprint 强制 templateId');

// ---------------------------------------------------------------- 3. ws-service 信令通道
section('3. ws-service 信令消息覆盖（附录 D/E）');
const wss = read('server/ws-service/index.mjs');
const WS_MSGS = ['hello', 'device_status', 'collab_create', 'collab_join', 'collab_leave',
  'request_audio_publish', 'request_video_publish', 'input_event', 'rtc_relay'];
for (const m of WS_MSGS) {
  if (m === 'hello') ok(/type === 'hello'/.test(wss), 'ws-service 处理 hello（建连鉴权 if 分支）');
  else ok(wss.includes(`case '${m}'`), `ws-service 处理 ${m}`);
}
const WS_DOWN = ['command', 'push_message', 'session_revoked', 'policy_update', 'auth_failed', 'hello_ok'];
for (const m of WS_DOWN) ok(wss.includes(`'${m}'`), `ws-service 下发 ${m}`);
ok(wss.includes("kind: 'participant_joined'"), 'collab_join → owner 通知');
ok(wss.includes("kind: 'participant_update'"), '参与者列表广播');
ok(wss.includes("kind: 'rtc'"), 'rtc_relay 中继事件');
ok(wss.includes("kind: 'media_request'"), '媒体申请转发 owner');
ok(wss.includes("kind: 'input_event'"), '输入事件转发 owner');
ok(wss.includes("kind: 'collab_ended'") || wss.includes('collab_ended'), '会话结束事件（REST 落库 + emit）');

// ---------------------------------------------------------------- 4. rtc_relay 会内校验
section('4. rtc_relay 会内成员校验（服务端权威）');
ok(/rtc_relay[\s\S]*?target not in session/.test(wss), '目标不在会内 → 拒绝中继');
ok(/rtc_relay[\s\S]*?you are not in this session/.test(wss), '发送者不在会内 → 拒绝中继');
ok(/input_event[\s\S]*?requires controller role/.test(wss), 'input_event 仅 controller 角色');

// ---------------------------------------------------------------- 5. REST 协作路由
section('5. 协作 REST 路由（邀请/审批/管控/销毁）');
ok(existsSync(join(ROOT, 'server/src/app/api/collab/sessions/route.ts')), '/api/collab/sessions 存在');
ok(existsSync(join(ROOT, 'server/src/app/api/collab/sessions/[id]/route.ts')), '/api/collab/sessions/[id] 存在');
ok(existsSync(join(ROOT, 'server/src/app/api/collab/sessions/[id]/participants/route.ts')), '/api/collab/sessions/[id]/participants 存在');
const mod = read('server/src/app/api/collab/sessions/[id]/route.ts');
for (const a of ['mute', 'unmute', 'disable_camera', 'revoke_control', 'grant_control', 'kick', 'mute_all', 'camera_all', 'end']) {
  ok(mod.includes(`'${a}'`), `管控动作 ${a}`);
}
const parts = read('server/src/app/api/collab/sessions/[id]/participants/route.ts');
ok(parts.includes('approve'), '参与者 PATCH 支持审批');
ok(parts.includes("request === 'audio' ? 'audio' : 'video'") || parts.includes("request: 'audio' | 'video'"), '审批支持 audio/video 双通道');
ok(parts.includes('collab_invite'), '邀请后 push_message collab_invite 通知');
ok(mod.includes("kind: 'collab_ended'"), '销毁/结束广播 collab_ended');

// ---------------------------------------------------------------- 6. 客户端接线
section('6. 客户端（mojom / collab_controller / drop WebUI）');
const mojom = read('client/src-nodebyte/chrome/browser/nodebyte/mojo/nodebyte.mojom');
for (const m of ['CreateSession', 'JoinByToken', 'GetSessions', 'GetParticipants', 'EndSession',
  'RequestAudioPublish', 'RequestVideoPublish', 'Moderate', 'GetWsAuth', 'ExecuteRemoteCommand',
  'GetDeviceStatus', 'ShowControlPanel', 'HideControlPanel']) {
  ok(mojom.includes(m), `mojom NodeByteCollab.${m}`);
}
ok(mojom.includes('kWsPathSignal') || mojom.includes('ApiBase()'), 'GetWsAuth 注释标注可塑性推导');
ok(existsSync(join(ROOT, 'client/src-nodebyte/chrome/browser/nodebyte/collab/collab_controller.h')), 'collab_controller.h 存在');
ok(existsSync(join(ROOT, 'client/src-nodebyte/chrome/browser/nodebyte/collab/collab_controller.cc')), 'collab_controller.cc 存在');
const cc = read('client/src-nodebyte/chrome/browser/nodebyte/collab/collab_controller.cc');
ok(cc.includes('IsAllowedCommand'), '客户端执行前白名单校验');
ok(cc.includes('SchemeIsHTTPOrHTTPS'), 'open_url 二次校验 scheme');
ok(cc.includes('JSONReader'), 'payload 经 base::JSONReader 解析');
ok(cc.includes('kApiPathCollabSessions') || read('client/src-nodebyte/chrome/browser/nodebyte/nodebyte_constants.h').includes('kApiPathCollabSessions'), '协作 REST 基路径常量');
ok(cc.includes('【需核实】'), '真实注入点按惯例标注（不虚标）');

const dropApp = read('client/webui/drop/app.js');
for (const fn of ['connectSignal', 'reportStatus', 'onSignal', 'onRemoteCommand', 'onCollabEvent',
  'loadSessions', 'openSessionDetail', 'renderParticipants', 'renderApprovals',
  'publishApprovedTracks', 'ensurePc', 'onRtcSignal', 'teardownRtc']) {
  ok(dropApp.includes(fn), `drop WebUI ${fn}`);
}
ok(dropApp.includes("wsRetryMs = Math.min(wsRetryMs * 2, 30000)"), 'WS 指数退避 30s 封顶');
ok(dropApp.includes("send('hello', { deviceId: r.deviceId, jwt: r.jwt })"), 'hello 建连鉴权（附录 D）');
ok(dropApp.includes("send('device_status', status)"), 'device_status 定时上报');
ok(dropApp.includes("collabAllowed"), 'AllowDropCollaboration=false 拒绝建连');
ok(/allowAudio[\s\S]*?allowVideo[\s\S]*?未放行不上轨道|allowed[\s\S]*?未放行/.test(dropApp) || dropApp.includes('未放行不上轨道'), '媒体权限放行前不上轨道（附录 E.2 要点）');
ok(dropApp.includes("send('rtc_relay'"), 'WebRTC SDP/ICE 经 rtc_relay');
ok(dropApp.includes('executeRemoteCommand'), 'S→C command → Mojo 白名单执行');
const dropHtml = read('client/webui/drop/index.html');
ok(dropHtml.includes('collabOwned') && dropHtml.includes('collabJoined'), '会话双列表（我发起/我参与）');
ok(dropHtml.includes('approvalBox') && dropHtml.includes('participantList'), '审批弹层 + 参与者列表');

// ---------------------------------------------------------------- 7. admin 面板接线
section('7. 管理后台「设备与远程指令」面板');
const admin = read('server/src/app/admin/page.tsx');
ok(admin.includes('DevicesPanel'), 'DevicesPanel 组件');
ok(admin.includes("tab === 'devices'"), 'devices tab 挂载');
ok(admin.includes("['devices', t('devicesRemote')]"), 'nav 导航项');
ok(admin.includes('/api/admin/devices'), '设备列表数据源');
ok(admin.includes('/api/admin/devices/command'), '指令下发调用');
const i18n = read('server/src/i18n/index.tsx');
ok(i18n.includes("devicesRemote: '设备与远程指令'"), 'i18n zh devicesRemote');
ok(i18n.includes("devicesRemote: 'Devices & Remote'"), 'i18n en devicesRemote');
ok((i18n.match(/devicesRemote:/g) || []).length === 2, 'devicesRemote 无重复键');
ok(existsSync(join(ROOT, 'server/src/app/api/admin/devices/route.ts')), '/api/admin/devices 路由存在');
ok(serverCmd.includes('device_remote_command'), '远程指令全量审计');

// ---------------------------------------------------------------- 8. 策略键（AllowDropCollaboration / allow_collab_invite）
section('8. 策略键（AllowDropCollaboration / allow_collab_invite）');
const policy = read('server/src/lib/policy-defaults.ts');
ok(policy.includes('AllowDropCollaboration'), '服务端 AllowDropCollaboration 键');
const collabRoute = read('server/src/app/api/collab/sessions/route.ts');
ok(collabRoute.includes("requireFeature(u, 'allow_collab_invite')"), '创建会话校验 allow_collab_invite（功能键通道）');
ok(read('server/src/lib/auth.ts').includes('requireFeature'), 'requireFeature 功能开关执行链');
ok(admin.includes("allow_collab_invite") || read('server/src/lib/auth.ts').includes('feature_key'), '组功能黑白名单覆盖协作邀请');
const registry = read('server/src/lib/directive-registry.ts');
ok(registry.includes('AllowDropCollaboration'), '指令注册表覆盖协作开关（可撤销）');
const genPatches = read('client/scripts/gen_patches.sh');
ok(genPatches.includes('0250-nodebyte-collab'), 'gen_patches 0250 组');
ok(genPatches.includes('chrome/browser/nodebyte/collab'), '0250 组含 collab 目录');
ok(existsSync(join(ROOT, 'client/patches/0250-nodebyte-collab.patch')), '0250 补丁文件存在');

// ---------------------------------------------------------------- 汇总
console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
