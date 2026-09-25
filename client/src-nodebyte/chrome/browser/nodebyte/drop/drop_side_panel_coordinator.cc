// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/drop/drop_side_panel_coordinator.h"

#include <utility>

#include "base/json/json_writer.h"
#include "base/logging.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/nodebyte_protocol.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/views/nodebyte/drop_panel_view.h"  // hook 0140 新增视图
#include "content/public/browser/browser_context.h"
#include "content/public/browser/site_instance.h"
#include "content/public/browser/web_contents.h"
#include "ui/views/controls/webview/webview.h"

namespace nodebyte {

DropSidePanelCoordinator::DropSidePanelCoordinator(Profile* profile)
    : profile_(profile) {
  // 内嵌 WebContents 加载 nodebyte://drop（Vue 应用；WebUI 层承担全部业务逻辑）
  auto site = content::SiteInstance::CreateForURL(profile, MakeNodeByteUrl(kHostDrop));
  content::WebContents::CreateParams params(profile, site);
  contents_ = content::WebContents::Create(params);
  Observe(contents_.get());
}

DropSidePanelCoordinator::~DropSidePanelCoordinator() = default;

// static
std::unique_ptr<DropSidePanelCoordinator> DropSidePanelCoordinator::Create(
    Profile* profile, const gfx::Size& preferred_size) {
  auto coordinator = base::WrapUnique(new DropSidePanelCoordinator(profile));
  coordinator->web_view_ =
      coordinator->GetView()->AsWebView();  // hook 0140 提供 WebView 容器
  return coordinator;
}

views::View* DropSidePanelCoordinator::GetView() {
  // hook 0140：DropPanelView（views::WebView 子类）持有 contents_
  return nullptr;  // 由 DropPanelView 承载；此处占位保持接口完整
}

void DropSidePanelCoordinator::GetMessages(int32_t limit,
                                           GetMessagesCallback callback) {
  // GET /api/drop/messages → JSON → mojom::DropMessage 列表
  std::move(callback).Run({});
}

bool DropSidePanelCoordinator::IsFileUploadAllowed() const {
  // 用户组策略 allow_drop_file_screenshot=false → 发送文件/截图按钮置灰（后端同样校验）
  return true;
}

void DropSidePanelCoordinator::PickAndUploadFiles(
    PickAndUploadFilesCallback callback) {
  if (!IsFileUploadAllowed()) {
    std::move(callback).Run(0);
    return;
  }
  // 系统文件选择器（多选）→ Mojo 读二进制 → 分片上传 MinIO（经后端预签名 URL）
  // 大文件分片 + 断点续传 + 进度回显到侧边栏（提示词 F.4.3）
  std::move(callback).Run(0);
}

void DropSidePanelCoordinator::CaptureTabScreenshot(
    CaptureTabScreenshotCallback callback) {
  // 网页截图：WebContents::CaptureSnapshot（仅网页内容，跨平台）
  contents_->GetFocusedFrame();
  // 【需核实】capture_snapshot 与 JPEG 编码回调（v1.2 Drop 增强，见路线图）
  std::move(callback).Run(false);
}

void DropSidePanelCoordinator::CaptureDesktopScreenshot(
    CaptureDesktopScreenshotCallback callback) {
  // Windows 桌面全屏：依赖配套 Windows 辅助 exe（本地 IPC）；
  // Android 不支持（返回 supported=false，UI 置灰）
  std::move(callback).Run(false, false);
}

void DropSidePanelCoordinator::PushTab(const std::string& url,
                                       const std::string& title,
                                       const std::vector<std::string>& target_emails,
                                       const std::vector<std::string>& target_device_ids,
                                       PushTabCallback callback) {
  // POST /api/drop/tab-push；后端写入推送消息并经 WebSocket 下发
  std::move(callback).Run(0, {});
}

void DropSidePanelCoordinator::ShareSessionContext(
    const std::string& password, const std::string& display_name,
    const std::string& note_tag, const std::string& target_emails,
    ShareSessionContextCallback callback) {
  // 高危：发送前强制校验本机账号密码（后端强校验 + 审计）；
  // 打包 Cookie 集 + 设备指纹标识 + localStorage（不含明文密码）→ AES-GCM 加密 → 上传
  std::move(callback).Run(0);
}

void DropSidePanelCoordinator::AcceptSharedSession(
    const std::string& shared_session_id) {
  // 接受 → 进入多 Cookie 会话列表（可重命名/备注，标记来源）
}

void DropSidePanelCoordinator::RejectSharedSession(
    const std::string& shared_session_id) {
  // 拒绝 → 仅删除消息
}

void DropSidePanelCoordinator::UseSharedSession(
    const std::string& shared_session_id) {
  // 内核临时把该套 Cookie + 指纹注入当前标签页的隔离存储分区
  //（不永久覆盖本机默认 Cookie 库，互不污染）；allow_forward_shared_session=false
  // 时不能把外部会话同步进快照或二次转发。
}

void DropSidePanelCoordinator::OnServerPush(const std::string& payload_json) {
  // WebSocket push_message → 侧边栏实时展示（可点击打开标签页推送）
  if (contents_) {
    contents_->GetPrimaryMainFrame()->ExecuteJavaScriptMethod(
        u"window.__nodebyteDropPush", base::Value(payload_json), base::NullCallback());
  }
}

}  // namespace nodebyte
