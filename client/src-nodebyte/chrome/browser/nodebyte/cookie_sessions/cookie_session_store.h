// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 多 Cookie 会话集存储（客户端提示词 5.5 / F.3 —— 🔴 核心自研隔离层）：
//   同一网站保存多套 Cookie 会话集（CookieProfile）：id / 备注 / 域名匹配 / cookie 列表 / localStorage
//   本地：加密 SQLite；云端：sync type=cookie_sets（加密）
//   使用：拦截网络请求，在 ResourceRequest 层注入对应 Cookie，响应 Set-Cookie 回写选中集；
//        HttpOnly Cookie 必须在内核 C++ 层读写（JS/扩展拿不到）。
//   安全：不直接改浏览器全局 Cookie 数据库；隔离存储分区注入，互不污染。

#ifndef CHROME_BROWSER_NODEBYTE_COOKIE_SESSIONS_COOKIE_SESSION_STORE_H_
#define CHROME_BROWSER_NODEBYTE_COOKIE_SESSIONS_COOKIE_SESSION_STORE_H_

#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/values.h"
#include "net/cookies/canonical_cookie.h"
#include "url/gurl.h"

namespace nodebyte {

// 一套会话集（CookieProfile）
struct CookieSessionSet {
  std::string id;             // uuid
  std::string display_name;   // 用户备注
  std::string domain_rule;    // 域名匹配规则，如 "example.com" / "*.example.com"
  std::vector<net::CanonicalCookie> cookies;  // 含 HttpOnly（内核层持有）
  std::string local_storage;  // JSON 快照（可选）
  bool effective = true;      // 外部分享被撤销后置灰不可选、移入历史归档
  std::string source_label;   // 来源标记："来自分享者昵称"
  base::Time last_used_at;
};

class CookieSessionStore {
 public:
  explicit CookieSessionStore(const base::FilePath& profile_path);
  ~CookieSessionStore();

  // 打开/初始化加密 SQLite（密钥来自 SyncCrypto 派生，不落盘明文）
  bool Open(const std::string& derived_key_hex);

  // 查询当前域名可用的会话集（Drop 侧边栏弹出选择框，显示备注）
  std::vector<CookieSessionSet> QueryByDomain(const GURL& url) const;

  // 新建 / 编辑备注 / 导出 / 删除
  std::string CreateSet(const std::string& display_name,
                        const std::string& domain_rule);
  bool UpdateNotes(const std::string& set_id, const std::string& display_name);
  bool DeleteSet(const std::string& set_id);
  std::string ExportSetJson(const std::string& set_id) const;

  // ---- 内核注入与回写（网络层钩子调用，见 hook 0220 / NetworkDelegate 委托）----
  // 请求前：把选中集合的 cookie（按 domain/path/secure 匹配）合并进请求头
  // 返回注入后的 Cookie 头值；未选择集合返回空
  std::string InjectCookiesForRequest(const GURL& url,
                                      const std::string& tab_state_set_id);
  // 响应后：Set-Cookie 回写到选中会话集（含 HttpOnly；JS/扩展不可见）
  void WriteBackSetCookie(const GURL& url,
                          const std::string& tab_state_set_id,
                          const std::vector<net::CanonicalCookie>& cookies);

  // 外部分享会话：写入 user_shared_session_store 对应隔离分区；
  // 不覆盖本机默认 Cookie 库；撤销事件 → 置灰（effective=false）
  void ImportSharedSession(const std::string& set_id,
                           const std::string& sender_label,
                           const std::string& encrypted_blob,
                           const sync::SyncCrypto& crypto);
  void MarkRevoked(const std::string& set_id);

  // 当前标签页绑定的会话集（tab → set_id 状态由 Drop 侧边栏设置）
  void BindTab(const content::WebContents* contents, const std::string& set_id);
  std::string BoundSetId(const content::WebContents* contents) const;

  // 整体序列化（参与同步：加密后上传 type=cookie_sets）
  base::Value::Dict SerializeForSync() const;
  void RestoreFromSync(const base::Value::Dict& encrypted_envelope,
                       const sync::SyncCrypto& crypto);

 private:
  base::FilePath db_path_;   // <profile>/nodebyte/cookie_sets.db（加密 SQLite）
  bool opened_ = false;
  // tab → 会话集（内存态；隔离存储分区句柄在此映射）
  std::map<const content::WebContents*, std::string> tab_bindings_;
  base::WeakPtrFactory<CookieSessionStore> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_COOKIE_SESSIONS_COOKIE_SESSION_STORE_H_
