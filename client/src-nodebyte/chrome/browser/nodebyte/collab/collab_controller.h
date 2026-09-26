// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 协作会议 + 远程指令控制器（客户端提示词 5.9 / 附录 E.1-E.2，v1.4.5 端到端补齐）：
//   - REST 会话管理代理（创建/加入/列表/参与者/管控/销毁 → /api/collab/sessions*）
//   - WS 信令建连材料（GetWsAuth：ws_url 按 ApiBase() 动态推导 + JWT + deviceId）
//   - 远程指令执行（附录 E.1 S→C command 8 种白名单动作）
//   - 设备状态采集（device_status 上报）
// 业务逻辑（WS 连接生命周期、WebRTC P2P、媒体权限 UI 状态机）全部在 Drop WebUI
// JS 侧（低侵入铁律 附录 F.1：C++ 只暴露原子能力，网页 UI 经 Mojo.bindInterface 调用）。

#ifndef CHROME_BROWSER_NODEBYTE_COLLAB_COLLAB_CONTROLLER_H_
#define CHROME_BROWSER_NODEBYTE_COLLAB_COLLAB_CONTROLLER_H_

#include <string>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/nodebyte/mojo/nodebyte.mojom.h"
#include "mojo/public/cpp/bindings/receiver_set.h"

class Profile;

namespace nodebyte {

class CollabController : public mojom::NodeByteCollab {
 public:
  explicit CollabController(Profile* profile);
  ~CollabController() override;

  // 绑定到 WebUI（nodebyte://drop 页面加载时；同一控制器服务多接收端）
  void BindReceiver(mojo::PendingReceiver<mojom::NodeByteCollab> receiver);

  // ---- mojom::NodeByteCollab（WebUI → 浏览器进程）----
  void CreateSession(int32_t expire_hours, bool allow_multi, int32_t max_participants,
                     CreateSessionCallback callback) override;
  void JoinByToken(const std::string& token, JoinByTokenCallback callback) override;
  void GetSessions(GetSessionsCallback callback) override;
  void GetParticipants(const std::string& session_id,
                       GetParticipantsCallback callback) override;
  void EndSession(const std::string& session_id, EndSessionCallback callback) override;
  void RequestAudioPublish(const std::string& session_id) override;
  void RequestVideoPublish(const std::string& session_id) override;
  void Moderate(const std::string& session_id, const std::string& action,
                const std::string& participant_id, ModerateCallback callback) override;
  void GetWsAuth(GetWsAuthCallback callback) override;
  void ExecuteRemoteCommand(const std::string& cmd, const std::string& payload_json,
                            ExecuteRemoteCommandCallback callback) override;
  void GetDeviceStatus(GetDeviceStatusCallback callback) override;
  void ShowControlPanel(const std::string& session_id,
                        ShowControlPanelCallback callback) override;
  void HideControlPanel() override;

  // 服务端 WebSocket collab 事件到达（ws 信令 → 侧边栏实时刷新；
  // 由推送通道统一入口转发：kind = participant_joined / participant_update /
  // media_request / media_permission / control_grant / collab_ended / rtc / input_event）
  void OnCollabEvent(const std::string& event_json);
  // 远程指令到达（S→C command；统一推送入口转发后本地执行）
  void OnRemoteCommand(const std::string& cmd_json);

 private:
  // 远程指令 8 种动作的执行体（白名单外一律拒绝并返回 error json）
  bool RunCommand(const std::string& cmd, const std::string& payload_json,
                  std::string* result_json);
  // 命令白名单校验（附录 E.1 8 种；大小写敏感）
  static bool IsAllowedCommand(const std::string& cmd);

  raw_ptr<Profile> profile_;
  mojo::ReceiverSet<mojom::NodeByteCollab> receivers_;
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_COLLAB_COLLAB_CONTROLLER_H_
