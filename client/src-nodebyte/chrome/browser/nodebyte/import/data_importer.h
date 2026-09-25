// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// DataImporter —— CSV / 其他浏览器数据导入（客户端侧，docs/data-import.md）。
//
// 双通道体系：
//   A) 本机直接导入（本模块）：
//      CSV（密码/书签/历史）解析后写入本机加密存储：
//        密码   → PasswordStore（本机 OS 加密 + KeyProvider，密钥永不上传）
//        书签   → BookmarkModel（保持文件夹层级 folder 支持 "/" 分层）
//        历史   → HistoryService（去重：同 URL 同日合并 visit_count）
//   B) 账号待下发导入区（服务端批量导入，管理端/个人中心）：
//      GET /api/sync/imported 拉取 → 转成本机端到端加密数据 → POST ack
//      删除服务端副本（服务端密码仅静态加密暂存，零明文驻留收敛）。
//
// 从其他浏览器导入（提示词 5.13）：复用 Chromium 原生 importer（Chrome /
// Edge / Firefox / Brave / Opera / Vivaldi / 360 / QQ 列表由 ImportList
// 配置），Windows 全量支持；Android 沙盒限制不支持外部浏览器一键导入，
// 但支持 CSV 导入与账号下发通道（平台差异表）。
//
// 策略：
//   NodeByteImportPasswordsAllowed=false → 隐藏密码导入入口（本机 + 下发均拒收）
//   NodeByteImportHistoryAllowed=false   → 同上（历史）
//   NodeByteImportBookmarksAllowed=false → 同上（书签）
//
// 【基线：Chromium 128，PasswordStore/BookmarkModel/HistoryService API 需核实】

#ifndef CHROME_BROWSER_NODEBYTE_IMPORT_DATA_IMPORTER_H_
#define CHROME_BROWSER_NODEBYTE_IMPORT_DATA_IMPORTER_H_

#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"

class Profile;

namespace nodebyte {

enum class ImportDataType { kPasswords, kBookmarks, kHistory };

struct ImportedPasswordRow {
  std::string origin;      // 来源站点名
  std::string url;
  std::string username;
  std::string password;    // 仅内存驻留，写 PasswordStore 后立即清零
};

struct ImportedBookmarkRow {
  std::string title;
  std::string url;
  std::string folder;      // 支持 "/" 分层（书签文件夹分类）
  int64_t date_added = 0;  // WebKit epoch（微秒），0 = now
};

struct ImportedHistoryRow {
  std::string url;
  std::string title;
  int64_t visited_at = 0;  // WebKit epoch（微秒）
  int visit_count = 1;
};

struct ImportSummary {
  ImportDataType type = ImportDataType::kPasswords;
  int total_rows = 0;
  int imported = 0;
  int skipped = 0;
  int duplicates_merged = 0;
  std::string error;
};

using ImportProgressCallback = base::RepeatingCallback<void(const ImportSummary&)>;
using ImportDoneCallback = base::OnceCallback<void(const ImportSummary&)>;

class DataImporter {
 public:
  explicit DataImporter(Profile* profile);
  ~DataImporter();

  DataImporter(const DataImporter&) = delete;
  DataImporter& operator=(const DataImporter&) = delete;

  // ---- 通道 A：本机 CSV 导入（RFC-4180；列名自动识别，见 server/src/lib/csv.ts 同源规则）----
  ImportSummary ImportPasswordsCsv(const std::string& csv_text);
  ImportSummary ImportBookmarksCsv(const std::string& csv_text);
  ImportSummary ImportHistoryCsv(const std::string& csv_text);

  // ---- 通道 B：账号待下发导入区（服务端批量导入 → 本机）----
  // GET /api/sync/imported → 分类型转成本机数据；策略禁用类型跳过并计数 skipped；
  // 完成后 POST { action:'ack', batchIds:[...] } 删除服务端副本。
  void PullFromServerImportQueue(ImportProgressCallback on_progress,
                                 ImportDoneCallback on_done);

  // 从其他浏览器导入（Windows；复用原生 importer UI 与逻辑）
  static bool IsBrowserImportSupported();  // Android 返回 false（沙盒限制）

 private:
  ImportSummary WritePasswords(std::vector<ImportedPasswordRow> rows);
  ImportSummary WriteBookmarks(std::vector<ImportedBookmarkRow> rows);
  ImportSummary WriteHistory(std::vector<ImportedHistoryRow> rows);
  bool PolicyAllows(ImportDataType type) const;

  raw_ptr<Profile> profile_ = nullptr;
  base::WeakPtrFactory<DataImporter> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_IMPORT_DATA_IMPORTER_H_
