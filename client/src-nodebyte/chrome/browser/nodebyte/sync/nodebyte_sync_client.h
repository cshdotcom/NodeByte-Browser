// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 自定义同步客户端（客户端提示词 5.2 / F.2）：
//   - 移除 Google Sync，替换为自建同步（bsync.nodebyte.cn）
//   - 同步类型：bookmarks / history / settings / cookie_sets / fingerprints / proxy /
//               extensions / passwords / preferences（全为客户端加密后密文）
//   - 增量实时同步（real_time_delta）+ 手动快照（manual_backup → .custom-browser-backup）
//   - 策略执行：CustomAllowSync=false → 入口置灰；CustomSyncDisabledTypes 按类型禁止
//
// 架构：本地变更日志（type,key,version）→ 定时/触发批量加密上传；
//       下载合并按类型分策略（书签合并/历史去重/设置覆盖/Cookie集写入加密SQLite）。

#ifndef CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_SYNC_CLIENT_H_
#define CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_SYNC_CLIENT_H_

#include <map>
#include <string>

#include "base/memory/weak_ptr.h"
#include "base/sequence_checker.h"
#include "base/time/time.h"
#include "chrome/browser/nodebyte/sync/nodebyte_crypto.h"
#include "components/keyed_service/core/keyed_service.h"
#include "url/gurl.h"

namespace nodebyte::sync {

enum class SyncDataType {
  kBookmarks,
  kHistory,
  kSettings,
  kCookieSets,
  kFingerprints,
  kProxy,
  kExtensions,
  kPasswords,
  kPreferences,
  kMaxValue = kPreferences
};

std::string SyncDataTypeToString(SyncDataType type);
bool SyncDataTypeFromString(const std::string& s, SyncDataType* out);

// 本地变更日志条目（离线可操作，联网后合并上传）
struct PendingChange {
  SyncDataType type;
  std::string key;          // 数据项主键
  int64_t local_version;    // 单调递增
  std::string encrypted;    // 已加密密文（v1.iv.ct.tag）
  base::Time changed_at;
};

struct SyncServerItem {
  int64_t version;
  std::string encrypted_blob;
  int64_t created_at;
};

class NodeByteSyncClient : public KeyedService {
 public:
  explicit NodeByteSyncClient(const GURL& server_base);
  ~NodeByteSyncClient() override;

  // 策略注入：CustomAllowSync / CustomSyncDisabledTypes（由 Policy 模块在变更时调用）
  void SetPolicyState(bool allow_sync,
                      const std::vector<std::string>& disabled_types);
  bool IsTypeAllowed(SyncDataType type) const;

  // 记录本地变更（业务模块调用；本函数只做日志与排队，不直接发网络）
  void EnqueueChange(SyncDataType type, const std::string& key,
                     const std::string& plaintext,
                     const SyncCrypto& crypto);

  // 触发一轮同步：上传本地增量 → 下载对端增量并合并
  void SyncNow();

  // 手动快照导出：全部同步项 → 加密归档（.custom-browser-backup，本地完成不经服务端）
  // 返回空字符串表示被策略禁止（CustomAllowExportBackup=false）
  std::string ExportLocalBackup(const SyncCrypto& crypto);

 private:
  void UploadNext();
  void OnUploadDone(SyncDataType type, int64_t new_version);
  void DownloadSince(SyncDataType type, int64_t since_version);
  void MergeIncoming(SyncDataType type, const std::vector<SyncServerItem>& items);

  GURL server_base_;
  bool allow_sync_ = true;
  std::vector<std::string> disabled_types_;

  // 各类型本地版本号（单调递增，解决冲突）
  std::map<std::string, int64_t> version_map_;
  std::vector<PendingChange> pending_;

  SEQUENCE_CHECKER(sequence_checker_);
  base::WeakPtrFactory<NodeByteSyncClient> weak_factory_{this};
};

}  // namespace nodebyte::sync

#endif  // CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_SYNC_CLIENT_H_
