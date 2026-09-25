// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// Drop 侧边栏容器协调器（客户端提示词 5.4 / F.4）：
//   自定义常驻侧边栏（不依赖谷歌原生 SidePanel 业务逻辑）：
//   Windows：常驻侧边栏；Android：移入底部呼出菜单。
//   容器内嵌 WebContents 加载 nodebyte://drop（Vue 页面），Mojo 双向通信。
//   能力：消息、文件选择/上传、网页截图、标签页推送、Cookie 会话集切换、协作入口。

#ifndef CHROME_BROWSER_NODEBYTE_DROP_DROP_SIDE_PANEL_COORDINATOR_H_
#define CHROME_BROWSER_NODEBYTE_DROP_DROP_SIDE_PANEL_COORDINATOR_H_

#include <memory>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/nodebyte/mojo/nodebyte.mojom.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "mojo/public/cpp/bindings/remote_set.h"
#include "ui/views/view.h"

namespace views {
class WebView;
}  // namespace views

namespace nodebyte {

class DropSidePanelCoordinator : public mojom::NodeByteDrop,
                                 public content::WebContentsObserver {
 public:
  // 创建侧边栏视图（挂接浏览器窗口布局；Windows 常驻 / Android 底部菜单）
  static std::unique_ptr<DropSidePanelCoordinator> Create(
      Profile* profile, const gfx::Size& preferred_size);

  DropSidePanelCoordinator(const DropSidePanelCoordinator&) = delete;
  DropSidePanelCoordinator& operator=(const DropSidePanelCoordinator&) = delete;
  ~DropSidePanelCoordinator() override;

  // 挂到父视图（BrowserView 的非活动区域；【需核实】views 布局挂点）
  views::View* GetView();

  // mojom::NodeByteDrop（WebUI → 浏览器进程）
  void GetMessages(int32_t limit, GetMessagesCallback callback) override;
  void PickAndUploadFiles(PickAndUploadFilesCallback callback) override;
  void CaptureTabScreenshot(CaptureTabScreenshotCallback callback) override;
  void CaptureDesktopScreenshot(CaptureDesktopScreenshotCallback callback) override;
  void PushTab(const std::string& url, const std::string& title,
               const std::vector<std::string>& target_emails,
               const std::vector<std::string>& target_device_ids,
               PushTabCallback callback) override;
  void ShareSessionContext(const std::string& password,
                           const std::string& display_name,
                           const std::string& note_tag,
                           const std::string& target_emails,
                           ShareSessionContextCallback callback) override;
  void AcceptSharedSession(const std::string& shared_session_id) override;
  void RejectSharedSession(const std::string& shared_session_id) override;
  void UseSharedSession(const std::string& shared_session_id) override;

  // 服务端推送到达（WebSocket push_message）→ 侧边栏实时刷新
  void OnServerPush(const std::string& payload_json);

 private:
  explicit DropSidePanelCoordinator(Profile* profile);

  // 策略置灰：disable_drop_file=true（用户组）→ 发送文件/截图按钮置灰
  bool IsFileUploadAllowed() const;

  raw_ptr<Profile> profile_;
  std::unique_ptr<content::WebContents> contents_;
  views::WebView* web_view_ = nullptr;  // 挂在原生视图树

  mojo::ReceiverSet<mojom::NodeByteDrop> receivers_;
  mojo::RemoteSet<mojom::NodeByteDropClient> clients_;

  base::WeakPtrFactory<DropSidePanelCoordinator> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_DROP_DROP_SIDE_PANEL_COORDINATOR_H_
