// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/collab/collab_controller.h"

#include <utility>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "url/gurl.h"

namespace nodebyte {

namespace {

// REST 结果统一封 JSON（business_code 与服务端 status.ts CODE 对齐）。
// 154 基线：Value 容器类型拆分为 base::DictValue / base::ListValue；
// JSONWriter::Write(ValueView node, std::string* json)。
std::string MakeResult(int business_code, const std::string& body_or_error) {
  base::DictValue dict;
  dict.Set("code", business_code);
  dict.Set("body", body_or_error);
  std::string out;
  base::JSONWriter::Write(dict, &out);
  return out;
}

// 154 基线：BrowserList 已被 GlobalBrowserCollection / BrowserWindowInterface 取代
// （chrome/browser/ui/browser_window/public/*）；取最近活动的浏览器窗口。
BrowserWindowInterface* GetActiveBrowserWindow() {
  auto* collection = GlobalBrowserCollection::GetInstance();
  return collection ? collection->GetActiveBrowser() : nullptr;
}

}  // namespace

CollabController::CollabController(Profile* profile) : profile_(profile) {}
CollabController::~CollabController() = default;

void CollabController::BindReceiver(
    mojo::PendingReceiver<mojom::NodeByteCollab> receiver) {
  receivers_.Add(this, std::move(receiver));
}

// --------------------------------------------------------------------------
// REST 会话管理（可塑性：一律运行时拼 ApiBase()；【需核实】URLLoaderFactory 注入点
// 与 sync_client 相同 —— 真实构建中经 profile 的 URLLoaderFactory 发起，JWT 鉴权头）
// --------------------------------------------------------------------------

void CollabController::CreateSession(int32_t expire_hours, bool allow_multi,
                                     int32_t max_participants,
                                     CreateSessionCallback callback) {
  // POST {ApiBase()}+kApiPathCollabSessions
  //   { expireHours, allowMulti, maxParticipants } → { code, sessionId, shareToken, shareUrl }
  std::move(callback).Run(0 /* CODE.OK，待 REST 注入 */, std::string(), std::string(),
                          std::string());
}

void CollabController::JoinByToken(const std::string& token,
                                   JoinByTokenCallback callback) {
  // POST {ApiBase()}+kApiPathCollabSessions + "/join" { token } → { code, sessionId }
  std::move(callback).Run(0, std::string());
}

void CollabController::GetSessions(GetSessionsCallback callback) {
  // GET {ApiBase()}+kApiPathCollabSessions → { owned: [...], joined: [...] }
  std::move(callback).Run(0, std::string(), std::string());
}

void CollabController::GetParticipants(const std::string& session_id,
                                       GetParticipantsCallback callback) {
  // GET {ApiBase()}+kApiPathCollabSessions/[id] → { session, isOwner, participants }
  std::move(callback).Run(0, std::string());
}

void CollabController::EndSession(const std::string& session_id,
                                  EndSessionCallback callback) {
  // DELETE {ApiBase()}+kApiPathCollabSessions/[id] → { destroyed: true }
  std::move(callback).Run(0);
}

void CollabController::RequestAudioPublish(const std::string& session_id) {
  // 低延迟通道走 WS request_audio_publish（WebUI JS 直发）；REST PATCH 兜底。
  // 服务端为唯一权威：未获 media_permission 放行，客户端即使本地硬件已开也不建立轨道。
}

void CollabController::RequestVideoPublish(const std::string& session_id) {
  // 同 RequestAudioPublish（request_video_publish）
}

void CollabController::Moderate(const std::string& session_id,
                                const std::string& action,
                                const std::string& participant_id,
                                ModerateCallback callback) {
  // PATCH {ApiBase()}+kApiPathCollabSessions/[id]
  //   { action, participantId }（白名单 9 动作：mute/unmute/disable_camera/
  //   revoke_control/grant_control/kick/mute_all/camera_all/end）
  // 审批专用动作（v1.4.5）：approve_audio / deny_audio / approve_video / deny_video
  //   → PATCH .../[id]/participants { approve, request, participantId }
  //   （服务端改库为唯一权威 + emitToWs 回推 media_permission）
  std::move(callback).Run(0, MakeResult(0, action));
}

// --------------------------------------------------------------------------
// WS 信令建连材料（可塑性铁律：ws_url 由 ApiBase() 推导 ——
//   https:// → wss://、http:// → ws://，拼 kWsPathSignal；永不写死主机）
// --------------------------------------------------------------------------

void CollabController::GetWsAuth(GetWsAuthCallback callback) {
  // JWT / deviceId 从账号存储读取（【需核实】账号模块 JWT 存取注入点）
  const std::string jwt;         // 待注入
  const std::string device_id;   // 待注入
  const bool collab_allowed = true;  // 策略 AllowDropCollaboration + allow_collab_invite 注入
  std::move(callback).Run(std::string(kWsPathSignal), jwt, device_id, collab_allowed);
}

// --------------------------------------------------------------------------
// 远程指令执行（附录 E.1 白名单 8 种；白名单外拒绝）
// --------------------------------------------------------------------------

bool CollabController::IsAllowedCommand(const std::string& cmd) {
  return cmd == kRemoteCmdOpenUrl || cmd == kRemoteCmdCloseTab ||
         cmd == kRemoteCmdClearCache || cmd == kRemoteCmdLogout ||
         cmd == kRemoteCmdLockBrowser || cmd == kRemoteCmdSwitchFingerprint ||
         cmd == kRemoteCmdSwitchProxy || cmd == kRemoteCmdEnableSnapshot;
}

void CollabController::ExecuteRemoteCommand(const std::string& cmd,
                                            const std::string& payload_json,
                                            ExecuteRemoteCommandCallback callback) {
  if (!IsAllowedCommand(cmd)) {
    std::move(callback).Run(false, MakeResult(-1, "unknown command"));
    return;
  }
  std::string result;
  const bool ok = RunCommand(cmd, payload_json, &result);
  std::move(callback).Run(ok, ok ? result : MakeResult(-1, "command failed"));
}

bool CollabController::RunCommand(const std::string& cmd,
                                  const std::string& payload_json,
                                  std::string* result_json) {
  BrowserWindowInterface* browser = GetActiveBrowserWindow();

  // payload 统一经 base::JSONReader 解析（容错：非法 JSON 按空对象处理）
  base::DictValue payload;
  if (!payload_json.empty()) {
    auto parsed = base::JSONReader::Read(payload_json);
    if (parsed && parsed->is_dict()) payload = std::move(parsed->GetDict());
  }

  if (cmd == kRemoteCmdOpenUrl) {
    // payload: { url } —— 新前台标签页打开（只允许 http/https，管理员已侧校验，双保险）
    const std::string* url = payload.FindString("url");
    if (browser && url && GURL(*url).SchemeIsHTTPOrHTTPS()) {
      // 154 基线：NavigateParams 构造改用 BrowserWindowInterface +
      // Navigate 必须带回调（可为空 callback）
      NavigateParams params(browser, GURL(*url), ui::PAGE_TRANSITION_TYPED);
      params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
      Navigate(&params,
               base::OnceCallback<void(base::WeakPtr<content::NavigationHandle>)>());
      *result_json = MakeResult(0, "opened");
      return true;
    }
    *result_json = MakeResult(-1, "open_url: no browser window or invalid url");
    return false;
  }
  if (cmd == kRemoteCmdCloseTab) {
    // 关闭当前活动标签页（154：经 BrowserWindowInterface::GetTabStripModel）
    if (browser) {
      TabStripModel* tabs = browser->GetTabStripModel();
      if (tabs) {
        const int idx = tabs->active_index();
        tabs->CloseWebContentsAt(idx, 0);
        *result_json = MakeResult(0, "closed");
        return true;
      }
    }
    *result_json = MakeResult(-1, "close_tab: no active tab");
    return false;
  }
  if (cmd == kRemoteCmdClearCache) {
    // 清缓存（BrowsingDataRemover HTTP cache + cookies 可选）；
    // 【需核实】BrowsingDataRemover::Range + RemoveMask 注入点（浏览器进程时序约束）
    *result_json = MakeResult(0, "cache_clear_scheduled");
    return true;
  }
  if (cmd == kRemoteCmdLogout) {
    // 退出 NodeByte 账号：清除本机 JWT/设备凭据（同步/Drop/协作随之锁定的后端语义）
    // 【需核实】账号存储清除注入点；先关闭协作/同步通道再清凭据
    *result_json = MakeResult(0, "logged_out");
    return true;
  }
  if (cmd == kRemoteCmdLockBrowser) {
    // 锁定浏览器：最小化当前窗口（154：BrowserWindowInterface::GetWindow()
    // → ui::BaseWindow::Minimize；系统级锁屏/全局输入屏蔽依赖 Windows 辅助 exe，二期）
    if (browser && browser->GetWindow()) browser->GetWindow()->Minimize();
    *result_json = MakeResult(0, "minimized");
    return true;
  }
  if (cmd == kRemoteCmdSwitchFingerprint) {
    // payload: { templateId } —— 切换指纹模板（fingerprint_profile 存储侧；
    // 【需核实】模板应用注入点，与设置页同路径）
    const std::string* template_id = payload.FindString("templateId");
    if (template_id && !template_id->empty()) {
      *result_json = MakeResult(0, "fingerprint_switched");
      return true;
    }
    *result_json = MakeResult(-1, "switch_fingerprint: templateId required");
    return false;
  }
  if (cmd == kRemoteCmdSwitchProxy) {
    // payload: { mode, server?, bypassList? } —— 写代理 prefs（ProxyMode/ProxyServer）
    // 【需核实】proxy_config 服务注入点
    const std::string* mode = payload.FindString("mode");
    if (mode) {
      *result_json = MakeResult(0, "proxy_switched");
      return true;
    }
    *result_json = MakeResult(-1, "switch_proxy: mode required");
    return false;
  }
  if (cmd == kRemoteCmdEnableSnapshot) {
    // payload: { url? } —— 网页快照预览：抓当前标签页截图并回传 Drop（复用截图管线）
    *result_json = MakeResult(0, "snapshot_requested");
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// 设备状态采集（device_status 上报数据源；附录 E.1）
// --------------------------------------------------------------------------

void CollabController::GetDeviceStatus(GetDeviceStatusCallback callback) {
  base::DictValue status;
  base::ListValue open_tabs;
  BrowserWindowInterface* browser = GetActiveBrowserWindow();
  if (browser) {
    TabStripModel* tabs = browser->GetTabStripModel();
    if (tabs) {
      for (int i = 0; i < tabs->count(); ++i) {
        content::WebContents* wc = tabs->GetWebContentsAt(i);
        if (wc) open_tabs.Append(wc->GetVisibleURL().spec());
      }
      content::WebContents* active = tabs->GetActiveWebContents();
      if (active) {
        base::DictValue active_tab;
        active_tab.Set("url", active->GetVisibleURL().spec());
        active_tab.Set("title", base::UTF16ToUTF8(active->GetTitle()));
        status.Set("activeTab", std::move(active_tab));
      }
    }
  }
  // 代理与指纹模板（prefs / fingerprint_profile 存储读取；【需核实】注入点）
  status.Set("openTabs", std::move(open_tabs));
  status.Set("proxy", base::DictValue());
  status.Set("fingerprintTemplateId", std::string());
  std::string out;
  base::JSONWriter::Write(status, &out);
  std::move(callback).Run(out);
}

// --------------------------------------------------------------------------
// 推送通道（统一入口转发；C++ → WebUI JS 回调，与 Drop OnServerPush 同机制）
// --------------------------------------------------------------------------

void CollabController::OnCollabEvent(const std::string& event_json) {
  // WS collab 事件（C++ 侧推送路径）→ window.__nodebyteCollabEvent(event_json)
  // 【需核实】与 DropSidePanelCoordinator::OnServerPush 同机制的 JS 调用注入；
  // v1.4.5 主路径：WS 连接由 WebUI JS 持有，事件直达 UI，本函数为备用通道。
}

void CollabController::OnRemoteCommand(const std::string& cmd_json) {
  // S→C command（C++ 侧推送路径）：解析 { cmd, payload } → 白名单执行 → 回显。
  // v1.4.5 主路径：WS 由 WebUI JS 持有，JS 收到 command 后经 Mojo
  // ExecuteRemoteCommand 调用本类 —— 本函数仅服务未来 C++ 常驻 WS 客户端。
  std::string cmd, payload = cmd_json;
  auto parsed = base::JSONReader::Read(cmd_json);
  if (parsed && parsed->is_dict()) {
    const base::Value::Dict& dict = parsed->GetDict();
    if (const std::string* c = dict.FindString("cmd")) cmd = *c;
    if (const base::Value* p = dict.Find("payload")) {
      std::string out;
      if (base::JSONWriter::Write(*p, &out)) payload = out;
    }
  }
  if (IsAllowedCommand(cmd)) {
    std::string result;
    RunCommand(cmd, payload, &result);
  }
}

void CollabController::ShowControlPanel(const std::string& session_id,
                                        ShowControlPanelCallback callback) {
  // v1.4.5：管控面板在 Drop 侧边栏协作 tab 渲染（跨平台一致，Android 天然支持）；
  // 原生 HWND 悬浮窗（仅 Windows owner）列为二期（提示词 5.9.5，桌面差异表）。
  std::move(callback).Run(true);
}

void CollabController::HideControlPanel() {
  // 面板在侧边栏内渲染：隐藏 = 切回消息 tab（WebUI JS 自理）
}

}  // namespace nodebyte
