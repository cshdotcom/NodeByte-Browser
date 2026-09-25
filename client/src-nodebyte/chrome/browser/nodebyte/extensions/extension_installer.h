// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// ExtensionInstaller —— 手动安装扩展（crx/zip），Windows 与 Android 均支持。
//
// 三种来源（客户端提示词 5.10）：
//   1) 用户手动安装：本地导入（本模块）或商店安装；安装后「上传到同步空间」
//      把 crx 原始包加密上传（EXTENSION_BLOB 类型，计入个人云配额），
//      跨设备恢复时静默重装；
//   2) 管理员上传包强制下发（ForceInstallExtensionPackages）；
//   3) 管理员仅填扩展 ID 下发（ForceInstallExtensionIds，cache_internal /
//      external_store），下载源优先级：Edge 商店 → Chrome 商店 → 失败上报。
//
// Windows：设置页/扩展管理页选择 crx/zip（.crx 优先，zip 走 unpacked 转换）。
// Android：设置 → 扩展 → 「安装本地扩展」，经系统文件选择器（SAF，
//   Storage Access Framework）取得 content:// Uri 后复制到应用私有目录，
//   再走同一安装管线；受沙盒限制无法访问任意路径，SAF 是唯一入口。
//
// 策略：
//   AllowUserSelfInstallExtension=false → 入口隐藏（双端）；
//   AllowUserUploadOwnExtension=false → 「上传到同步空间」置灰；
//   策略强制下发的扩展启用/停用/删除/权限修改全部置灰（UI 层判断
//   ForcedInstallTracker 是否包含该扩展 ID），策略移除后自动卸载。
//
// 【基线：Chromium 128，ExtensionService / CrxInstaller API 需核实】

#ifndef CHROME_BROWSER_NODEBYTE_EXTENSIONS_EXTENSION_INSTALLER_H_
#define CHROME_BROWSER_NODEBYTE_EXTENSIONS_EXTENSION_INSTALLER_H_

#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"

class Profile;

namespace nodebyte {

enum class ExtensionInstallSource {
  kLocalFile,        // 用户本地 crx/zip（Windows + Android 手动安装）
  kSyncRestore,      // 同步恢复（EXTENSION_BLOB 下载后静默重装）
  kForcedPackage,    // 管理员上传包强制下发（mode 2）
  kForcedId,         // 仅扩展 ID 下发（mode 3：cache_internal / external_store）
};

struct InstallResult {
  bool success = false;
  std::string extension_id;
  std::string error;       // 失败详情（上报后端 extension_install_result）
  std::string store_used;  // edge_store / chrome_store / internal_package / local
};

using InstallCallback = base::OnceCallback<void(const InstallResult&)>;

class ExtensionInstaller {
 public:
  explicit ExtensionInstaller(Profile* profile);
  ~ExtensionInstaller();

  ExtensionInstaller(const ExtensionInstaller&) = delete;
  ExtensionInstaller& operator=(const ExtensionInstaller&) = delete;

  // 入口 1：本地文件安装（crx/zip）。Android 先经 SafBridge 拷贝到私有目录。
  void InstallFromFile(const base::FilePath& file_path, InstallCallback done);

  // 入口 2：同步恢复 —— 从 MinIO 下载的 crx 字节流静默安装
  // （先经 NodeByteSyncClient 解密；恢复后同步启用/禁用状态）。
  void InstallFromSyncBlob(const std::string& extension_id,
                           const std::string& decrypted_crx_bytes,
                           InstallCallback done);

  // 入口 3：管理员强制下发（策略拉取后触发；失败上报后端）。
  void InstallForced(const std::string& ext_id,
                     const std::string& source,          // cache_internal | external_store | package
                     const std::string& download_url,
                     InstallCallback done);

  // 把已安装扩展的 crx 原始包上传到个人同步空间（EXTENSION_BLOB）。
  // 读取路径：extensions::ExtensionRegistry 拿到安装目录 → 打包（CRX 格式）
  // → NodeByteSyncClient::UploadBlob(type=extensions)。
  void UploadExtensionToSync(const std::string& extension_id);

  // 策略强制下发的扩展：管理页 UI 置灰判断（启用/停用/删除/权限）。
  static bool IsForcedByPolicy(Profile* profile, const std::string& extension_id);

  // 商店下载源优先级：Edge 扩展商店 → Chrome 网上应用店 → 失败。
  // 商店访问时 UA 伪装对应原版浏览器（kSpoofBrowserVendor/kSpoofUserAgent）。
  static std::string StoreFallbackChain();

 private:
  void StartCrxInstall(const base::FilePath& crx_path,
                       ExtensionInstallSource source,
                       InstallCallback done);
  void MaybeFallbackToChromeStore(const InstallResult& failed,
                                  const std::string& ext_id,
                                  InstallCallback done);
  void ReportInstallResult(const InstallResult& result);

  raw_ptr<Profile> profile_ = nullptr;
  base::WeakPtrFactory<ExtensionInstaller> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_EXTENSIONS_EXTENSION_INSTALLER_H_
