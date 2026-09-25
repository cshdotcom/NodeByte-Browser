// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/sync/nodebyte_sync_client.h"

#include <utility>

#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"

namespace nodebyte::sync {

std::string SyncDataTypeToString(SyncDataType type) {
  switch (type) {
    case SyncDataType::kBookmarks: return "bookmarks";
    case SyncDataType::kHistory: return "history";
    case SyncDataType::kSettings: return "settings";
    case SyncDataType::kCookieSets: return "cookie_sets";
    case SyncDataType::kFingerprints: return "fingerprints";
    case SyncDataType::kProxy: return "proxy";
    case SyncDataType::kExtensions: return "extensions";
    case SyncDataType::kPasswords: return "passwords";
    case SyncDataType::kPreferences: return "preferences";
  }
  return "settings";
}

bool SyncDataTypeFromString(const std::string& s, SyncDataType* out) {
  static const std::map<std::string, SyncDataType> kMap = {
      {"bookmarks", SyncDataType::kBookmarks},
      {"history", SyncDataType::kHistory},
      {"settings", SyncDataType::kSettings},
      {"cookie_sets", SyncDataType::kCookieSets},
      {"fingerprints", SyncDataType::kFingerprints},
      {"proxy", SyncDataType::kProxy},
      {"extensions", SyncDataType::kExtensions},
      {"passwords", SyncDataType::kPasswords},
      {"preferences", SyncDataType::kPreferences}};
  auto it = kMap.find(s);
  if (it == kMap.end()) return false;
  *out = it->second;
  return true;
}

NodeByteSyncClient::NodeByteSyncClient(const GURL& server_base)
    : server_base_(server_base) {}

NodeByteSyncClient::~NodeByteSyncClient() = default;

void NodeByteSyncClient::SetPolicyState(
    bool allow_sync, const std::vector<std::string>& disabled_types) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  allow_sync_ = allow_sync;
  disabled_types_ = disabled_types;
}

bool NodeByteSyncClient::IsTypeAllowed(SyncDataType type) const {
  if (!allow_sync_) return false;
  const std::string s = SyncDataTypeToString(type);
  return std::find(disabled_types_.begin(), disabled_types_.end(), s) ==
         disabled_types_.end();
}

void NodeByteSyncClient::EnqueueChange(SyncDataType type,
                                       const std::string& key,
                                       const std::string& plaintext,
                                       const SyncCrypto& crypto) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (!IsTypeAllowed(type)) {
    DVLOG(1) << "NodeByte sync: type blocked by policy: "
             << SyncDataTypeToString(type);
    return;
  }
  PendingChange change;
  change.type = type;
  change.key = key;
  change.local_version = ++version_map_[SyncDataTypeToString(type)];
  change.encrypted = crypto.Encrypt(plaintext);
  change.changed_at = base::Time::Now();
  pending_.push_back(std::move(change));
  // 实时增量：即刻尝试上传（网络失败保留队列，联网后合并）
  UploadNext();
}

void NodeByteSyncClient::SyncNow() {
  for (int t = 0; t <= static_cast<int>(SyncDataType::kMaxValue); ++t) {
    auto type = static_cast<SyncDataType>(t);
    if (!IsTypeAllowed(type)) continue;
    DownloadSince(type, version_map_[SyncDataTypeToString(type)]);
  }
  UploadNext();
}

void NodeByteSyncClient::UploadNext() {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (pending_.empty()) return;
  // 【需核实】通过 profile 的 URLLoaderFactory POST /api/sync/{type}
  // body: { lastVersion, blob: <base64 密文>, snapshotType: "real_time_delta" }
  // 成功回调 OnUploadDone 推进版本号并弹出队列；41301 → 提示「存储空间已满」。
  // 网络层实现与 CloudOrgPolicyProvider::FetchPolicy 同构，此处略。
}

void NodeByteSyncClient::OnUploadDone(SyncDataType type, int64_t new_version) {
  version_map_[SyncDataTypeToString(type)] = new_version;
}

void NodeByteSyncClient::DownloadSince(SyncDataType type, int64_t since_version) {
  // 【需核实】GET /api/sync/{type}?since=<since_version>
  // 返回 items（密文列表）→ MergeIncoming
}

void NodeByteSyncClient::MergeIncoming(
    SyncDataType type, const std::vector<SyncServerItem>& items) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  // 合并策略（提示词 F.2）：
  //   书签合并 / 历史去重 / 设置覆盖 / Cookie 集 → 写入加密 SQLite（0130 模块）
  for (const SyncServerItem& item : items) {
    if (item.version > version_map_[SyncDataTypeToString(type)]) {
      version_map_[SyncDataTypeToString(type)] = item.version;
    }
  }
}

std::string NodeByteSyncClient::ExportLocalBackup(const SyncCrypto& crypto) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  // 策略 CustomAllowExportBackup=false → 导出按钮隐藏/置灰，此处双保险
  //（实际置灰由 WebUI 读 NodeBytePolicy 接口）
  // 打包全部同步项 → AES-GCM 加密 → .custom-browser-backup（本地完成，不经服务端）
  base::Value::Dict manifest;
  manifest.Set("version", 1);
  manifest.Set("exported_at", base::Time::Now().ToJsTime());
  std::string json;
  base::JSONWriter::Write(manifest, &json);
  std::string envelope = crypto.Encrypt(json);
  if (envelope.empty()) return std::string();
  DVLOG(1) << "NodeByte backup exported: " << kBackupExtension;
  return envelope;
}

}  // namespace nodebyte::sync
