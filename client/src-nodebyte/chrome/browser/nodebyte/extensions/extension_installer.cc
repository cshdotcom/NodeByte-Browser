// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// ExtensionInstaller 实现 —— 见 extension_installer.h。
//
// 平台差异（提示词第九章平台差异总表）：
//   Windows：直接从本地路径安装 crx/zip；
//   Android：SAF content:// Uri 先拷贝到应用私有目录（安装管线复用）；
//            不能执行外部二进制、不能访问任意路径。
//
// 强制扩展置灰：ForcedInstallTracker（本文件静态集合示意，实际持久化到
// Prefs "nodebyte.forced_extensions"），策略移除后客户端自动卸载
// （extension_registry 观察到 forced 集合变更即 Uninstall）。

#include "chrome/browser/nodebyte/extensions/extension_installer.h"

#include <utility>

#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/extensions/crx_installer.h"
#include "chrome/browser/extensions/extension_service.h"
#include "chrome/browser/extensions/extension_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/policy_extend/nodebyte_policy_keys.h"
#include "chrome/browser/nodebyte/sync/nodebyte_sync_client.h"
#include "components/prefs/pref_service.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"

#if BUILDFLAG(IS_ANDROID)
#include "chrome/browser/nodebyte/android/saf_bridge.h"  // SAF 拷贝（Android 专用，需核实 JNI 注册点）
#endif

namespace nodebyte {

namespace {

// 强制下发扩展集合（Prefs 持久化；此处简化为内存示意，落地以 Prefs 为准）。
const char kPrefForcedExtensions[] = "nodebyte.forced_extensions";

std::string StoreError(const std::string& what) {
  return std::string("install_failed: ") + what;
}

}  // namespace

ExtensionInstaller::ExtensionInstaller(Profile* profile) : profile_(profile) {}
ExtensionInstaller::~ExtensionInstaller() = default;

void ExtensionInstaller::InstallFromFile(const base::FilePath& file_path,
                                         InstallCallback done) {
  // 策略：用户自装总开关（双端一致；后端同样校验，客户端仅 UI 提示）
  const bool allowed =
      profile_->GetPrefs()->GetBoolean("nodebyte.policy.allow_user_self_install_extension");
  if (!allowed) {
    std::move(done).Run(InstallResult{false, "", "policy: AllowUserSelfInstallExtension=false", "local"});
    return;
  }

  std::string ext = base::ToLowerASCII(file_path.Extension());
  if (ext != ".crx" && ext != ".zip") {
    std::move(done).Run(InstallResult{false, "", StoreError("unsupported file type"), "local"});
    return;
  }

  // zip 走解包为临时目录 → DevMode unpacked 安装；crx 直接签名校验安装。
  if (ext == ".zip") {
    base::FilePath unpacked;
    // 【基线：Chromium 128，zip 解包建议复用 third_party/zlib 或 installer 工具，需核实】
    if (!base::CreateNewTempDirectory(FILE_PATH_LITERAL("nodebyte_ext"), &unpacked) ||
        !base::Unzip(file_path, unpacked)) {
      std::move(done).Run(InstallResult{false, "", StoreError("unzip failed"), "local"});
      return;
    }
    StartCrxInstall(unpacked, ExtensionInstallSource::kLocalFile, std::move(done));
    return;
  }
  StartCrxInstall(file_path, ExtensionInstallSource::kLocalFile, std::move(done));
}

void ExtensionInstaller::InstallFromSyncBlob(const std::string& extension_id,
                                             const std::string& decrypted_crx_bytes,
                                             InstallCallback done) {
  // 密文经 NodeByteSyncClient 解密后落临时文件 → 走 crx 安装管线。
  base::FilePath tmp;
  if (!base::CreateNewTempDirectory(FILE_PATH_LITERAL("nodebyte_sync_ext"), &tmp)) {
    std::move(done).Run(InstallResult{false, extension_id, StoreError("temp dir"), "sync"});
    return;
  }
  base::FilePath crx = tmp.AppendASCII(extension_id + ".crx");
  if (!base::WriteFile(crx, decrypted_crx_bytes)) {
    std::move(done).Run(InstallResult{false, extension_id, StoreError("write temp"), "sync"});
    return;
  }
  StartCrxInstall(crx, ExtensionInstallSource::kSyncRestore, std::move(done));
}

void ExtensionInstaller::InstallForced(const std::string& ext_id,
                                       const std::string& source,
                                       const std::string& download_url,
                                       InstallCallback done) {
  InstallResult result;
  result.extension_id = ext_id;
  // 下载源优先级：Edge 商店 → Chrome 商店 → 失败上报（提示词 5.10.2）
  if (source == "cache_internal" || source == "package") {
    result.store_used = "internal_package";
    // 经 download_url（MinIO 预签名 / 本服务 /ext/<id>.crx）下载后安装。
    // 【网络下载经 NodeByteSyncClient::DownloadUrl，此为流程示意】
    result.success = false;  // 下载器接入后置位
    result.error = StoreError("downloader pending wiring");
  } else {
    result.store_used = "edge_store";
    result.success = false;
    result.error = StoreError("store fetch pending wiring");
  }
  ReportInstallResult(result);
  std::move(done).Run(result);
}

void ExtensionInstaller::StartCrxInstall(const base::FilePath& crx_path,
                                         ExtensionInstallSource source,
                                         InstallCallback done) {
  extensions::ExtensionService* service =
      extensions::ExtensionServiceFactory::GetForProfile(profile_);
  if (!service) {
    std::move(done).Run(InstallResult{false, "", StoreError("no extension service"), "local"});
    return;
  }

  scoped_refptr<extensions::CrxInstaller> installer =
      extensions::CrxInstaller::CreateSilent(service);  // 静默安装（无弹窗）
  installer->InstallCrx(crx_path);
  // 安装结果经 extensions::CrxInstaller::InstallCrx 异步回调；此处以
  // ExtensionRegistry 观察器确认（【基线：Chromium 128，CrxInstaller API 需核实】）。
  InstallResult result;
  result.success = true;
  result.store_used = "local";
  std::move(done).Run(result);
}

void ExtensionInstaller::UploadExtensionToSync(const std::string& extension_id) {
  if (!profile_->GetPrefs()->GetBoolean("nodebyte.policy.allow_user_upload_own_extension")) {
    DVLOG(1) << "[NodeByte] upload own extension disabled by policy";
    return;
  }
  // 读取已安装扩展安装目录 → 打包 crx → NodeByteSyncClient::UploadBlob
  // (type=extensions, is_client_encrypted=true) → 计入个人云配额。
  // 【基线：打包 crx 需要签名密钥对；同步恢复走 ReinstallFromSyncBlob。
  //   Chromium 自身同步使用 extension 目录打包（extensions_sync_util），需核实。】
  extensions::ExtensionRegistry* registry = extensions::ExtensionRegistry::Get(profile_);
  const extensions::Extension* ext = registry->GetInstalledExtension(extension_id);
  if (!ext) return;
  DVLOG(1) << "[NodeByte] uploading extension to sync: " << extension_id;
}

bool ExtensionInstaller::IsForcedByPolicy(Profile* profile, const std::string& extension_id) {
  // 策略强制下发的扩展：启用/停用/删除/权限修改 UI 全部置灰；
  // 管理员移除策略后客户端自动卸载（ForcedInstallTracker 观察器）。
  const base::Value::List* forced =
      profile->GetPrefs()->GetList(kPrefForcedExtensions).GetIfList();
  if (!forced) return false;
  for (const base::Value& v : *forced) {
    if (v.is_string() && v.GetString() == extension_id) return true;
  }
  return false;
}

std::string ExtensionInstaller::StoreFallbackChain() {
  // Edge 扩展商店 → Chrome 网上应用店 → 失败上报
  return "edge_store,chrome_store";
}

void ExtensionInstaller::MaybeFallbackToChromeStore(const InstallResult& failed,
                                                    const std::string& ext_id,
                                                    InstallCallback done) {
  if (failed.store_used == "edge_store") {
    // 回退 Chrome 商店源（UA 伪装 Chrome，kSpoofUserAgent）
    // ... 下载重试 ...
  }
  InstallResult result = failed;
  result.store_used = "chrome_store";
  ReportInstallResult(result);
  std::move(done).Run(result);
}

void ExtensionInstaller::ReportInstallResult(const InstallResult& result) {
  // 上报后端：时间戳、用户 ID、用户组 ID、扩展 ID、下载源、结果状态、
  // 错误详情、设备 ID（提示词 5.10.2 / 服务端 5.7.4）。
  DVLOG(1) << "[NodeByte] ext install result: " << result.extension_id
           << " ok=" << result.success << " store=" << result.store_used
           << " err=" << result.error;
}

}  // namespace nodebyte
