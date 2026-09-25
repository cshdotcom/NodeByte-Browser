// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 同步加密原语（客户端提示词 5.2.2 / F.2 —— 极其关键的安全边界）：
//   登录后客户端本地派生 AES-256-GCM 主密钥，密钥永不上传服务器；
//   所有敏感数据（密码、Cookie、crx、历史）在客户端加密后再上传，服务端只存密文；
//   新设备恢复：下载密文 → 用户输入验证恢复密钥 → 本地解密。
//   明文 Cookie 绝不入库。

#ifndef CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_CRYPTO_H_
#define CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_CRYPTO_H_

#include <string>

#include "base/containers/span.h"
#include "base/strings/string_piece_forward.h"
#include "third_party/abseil-cpp/absl/types/optional.h"
#include "third_party/boringssl/src/include/aes.h"

namespace nodebyte::sync {

class SyncCrypto {
 public:
  // 从登录口令 + 本地盐派生主密钥（HKDF-SHA256；密钥仅存内存/OS 钥匙串，永不落盘明文、永不上传）
  static absl::optional<SyncCrypto> DeriveFromPassphrase(
      base::StringPiece passphrase, base::span<const uint8_t> salt);

  // 序列化恢复密钥（用户可抄写，用于新设备恢复；提示词 5.2.2）
  static std::string GenerateRecoveryKey();

  // 加密 → base64(v1.iv.ciphertext.tag)
  std::string Encrypt(base::StringPiece plaintext) const;
  // 解密（失败返回 nullopt：密钥不匹配/数据被篡改）
  absl::optional<std::string> Decrypt(base::StringPiece envelope) const;

  // 大 blob（crx/备份包）流式版本：调用方分片
  std::string EncryptBlob(base::span<const uint8_t> data) const;
  absl::optional<std::vector<uint8_t>> DecryptBlob(
      base::StringPiece envelope) const;

 private:
  explicit SyncCrypto(std::vector<uint8_t> key);
  std::vector<uint8_t> key_;  // 32 字节 AES-256
};

}  // namespace nodebyte::sync

#endif  // CHROME_BROWSER_NODEBYTE_SYNC_NODEBYTE_CRYPTO_H_
