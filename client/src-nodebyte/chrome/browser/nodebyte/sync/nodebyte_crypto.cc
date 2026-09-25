// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/sync/nodebyte_crypto.h"

#include <cstdint>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/logging.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "crypto/hkdf.h"
#include "crypto/random.h"
#include "third_party/boringssl/src/include/aead.h"

namespace nodebyte::sync {

namespace {

constexpr size_t kKeyBytes = 32;
constexpr size_t kIvBytes = 12;
constexpr size_t kTagBytes = 16;
constexpr char kEnvelopeVersion[] = "v1";

}  // namespace

// static
absl::optional<SyncCrypto> SyncCrypto::DeriveFromPassphrase(
    base::StringPiece passphrase,
    base::span<const uint8_t> salt) {
  if (passphrase.empty() || salt.empty()) return absl::nullopt;
  // HKDF-SHA256（chromium/src/crypto/hkdf.h；【需核实】参数与 bssl/EVP_PKEY 派生路径）
  std::vector<uint8_t> key =
      crypto::HkdfSha256(reinterpret_cast<const uint8_t*>(passphrase.data()),
                         passphrase.size(), salt.data(), salt.size(),
                         /*info=*/reinterpret_cast<const uint8_t*>("nodebyte-sync"),
                         /*info_len=*/14, kKeyBytes);
  return SyncCrypto(std::move(key));
}

// static
std::string SyncCrypto::GenerateRecoveryKey() {
  // 32 字节随机 → 8 组 4 字符 Base32 风格（用户可手抄恢复）
  std::vector<uint8_t> raw(32);
  crypto::RandBytes(raw);
  return base::Base64Encode(raw);
}

SyncCrypto::SyncCrypto(std::vector<uint8_t> key) : key_(std::move(key)) {}

std::string SyncCrypto::Encrypt(base::StringPiece plaintext) const {
  return EncryptBlob(base::make_span(
      reinterpret_cast<const uint8_t*>(plaintext.data()), plaintext.size()));
}

std::string SyncCrypto::EncryptBlob(base::span<const uint8_t> data) const {
  std::vector<uint8_t> iv(kIvBytes);
  crypto::RandBytes(iv);

  // EVP_aead_aes_256_gcm（boringssl；【需核实】直接用 crypto/ 封装的 Encrypt是完全等价替代）
  const EVP_AEAD* aead = EVP_aead_aes_256_gcm();
  EVP_AEAD_CTX ctx;
  EVP_AEAD_CTX_init(&ctx, aead, key_.data(), key_.size(), kTagBytes, nullptr);

  std::vector<uint8_t> out(data.size() + kTagBytes);
  size_t out_len = 0;
  if (!EVP_AEAD_CTX_seal(&ctx, out.data(), &out_len, out.size(), iv.data(),
                         iv.size(), data.data(), data.size(), nullptr, 0)) {
    EVP_AEAD_CTX_cleanup(&ctx);
    LOG(ERROR) << "NodeByte sync: seal failed";
    return std::string();
  }
  EVP_AEAD_CTX_cleanup(&ctx);

  // v1.<iv b64>.<ciphertext+tag b64>
  return base::StrCat({kEnvelopeVersion, ".",
                       base::Base64Encode(iv), ".",
                       base::Base64Encode(out)});
}

absl::optional<std::string> SyncCrypto::Decrypt(
    base::StringPiece envelope) const {
  auto blob = DecryptBlob(envelope);
  if (!blob) return absl::nullopt;
  return std::string(blob->begin(), blob->end());
}

absl::optional<std::vector<uint8_t>> SyncCrypto::DecryptBlob(
    base::StringPiece envelope) const {
  std::vector<std::string> parts = base::SplitString(
      envelope, ".", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY);
  if (parts.size() != 3 || parts[0] != kEnvelopeVersion) return absl::nullopt;

  std::string iv, body;
  if (!base::Base64Decode(parts[1], &iv) || !base::Base64Decode(parts[2], &body))
    return absl::nullopt;
  if (iv.size() != kIvBytes || body.size() < kTagBytes) return absl::nullopt;

  const EVP_AEAD* aead = EVP_aead_aes_256_gcm();
  EVP_AEAD_CTX ctx;
  if (!EVP_AEAD_CTX_init(&ctx, aead, key_.data(), key_.size(), kTagBytes, nullptr))
    return absl::nullopt;

  std::vector<uint8_t> out(body.size() - kTagBytes);
  size_t out_len = 0;
  const bool ok = EVP_AEAD_CTX_open(
      &ctx, out.data(), &out_len, out.size(),
      reinterpret_cast<const uint8_t*>(iv.data()), iv.size(),
      reinterpret_cast<const uint8_t*>(body.data()), body.size(), nullptr, 0);
  EVP_AEAD_CTX_cleanup(&ctx);
  if (!ok) return absl::nullopt;
  out.resize(out_len);
  return out;
}

}  // namespace nodebyte::sync
