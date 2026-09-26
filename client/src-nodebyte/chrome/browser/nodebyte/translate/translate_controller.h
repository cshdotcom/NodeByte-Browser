// Copyright 2026 NodeByte Browser Project. All rights reserved.
// 翻译控制器（用户需求：开源免费翻译 API）
//
// 设计：浏览器侧轻量代理，把整页翻译/选中文本翻译请求通过 NodeByteSync
// 通道转发到服务端 /api/translate（多供应商聚合，无需付费 API Key）。
// 客户端不直接调用 LibreTranslate/Lingva 等公共实例，原因：
//   1) 避免在客户端暴露服务端密钥/自托管端点；
//   2) 服务端可缓存 + 限速 + 审计；
//   3) 策略 NodeByteTranslateEnabled 由服务端统一管控。

#ifndef CHROME_BROWSER_NODEBYTE_TRANSLATE_TRANSLATE_CONTROLLER_H_
#define CHROME_BROWSER_NODEBYTE_TRANSLATE_TRANSLATE_CONTROLLER_H_

#include <memory>
#include <string>
#include <vector>

#include "base/callback_forward.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "url/gurl.h"

namespace content {
class WebContents;
}

namespace nodebyte {

// 单次翻译请求（与服务端 TranslateRequest 对齐）
struct TranslateRequest {
  std::string text;          // 待翻译文本
  std::string source_lang;   // "auto" 或具体语言代码
  std::string target_lang;   // 目标语言代码
  std::string format = "text"; // "text" | "html"
};

// 翻译结果（与服务端 TranslateResult 对齐）
struct TranslateResult {
  std::string translated_text;
  std::string detected_source;
  std::string provider;       // libretranslate | lingva | mymemory | deeplx
  std::string endpoint;       // 命中的实例（脱敏，不含 apiKey）
  bool cached = false;
};

// 翻译控制器：负责整页翻译与选区翻译的生命周期管理。
//
// 整页翻译流程（用户点击工具栏「翻译此页」按钮时触发）：
//   1) TranslatePage() 收集当前 WebContents 主帧可见文本节点；
//   2) 按 5000 字符（NodeByteTranslateMaxChars 策略可调）分批；
//   3) 通过 NodeByteSyncClient 通道发送 POST /api/translate；
//   4) 收到结果后调用 JS 注入函数 nodebyte.replaceTextNodes()，
//      原地替换文本节点，保留 DOM 结构与样式；
//   5) 工具栏显示「已翻译 ✓ / 还原」按钮，点击 RestorePage() 还原。
class TranslateController : public base::SupportsWeakPtr<TranslateController> {
 public:
  explicit TranslateController(content::WebContents* web_contents);
  ~TranslateController();

  TranslateController(const TranslateController&) = delete;
  TranslateController& operator=(const TranslateController&) = delete;

  // 整页翻译：异步分批调用服务端 API；on_done 返回成功/失败与已翻译节点数。
  void TranslatePage(const std::string& target_lang,
                     base::OnceCallback<void(bool ok, size_t node_count)> on_done);

  // 选区翻译：把选中文本发送到服务端，返回译文（用于右键菜单）。
  void TranslateSelection(const std::string& text,
                          const std::string& target_lang,
                          base::OnceCallback<void(bool ok, const std::string& translated)> on_done);

  // 还原当前页：恢复原文 DOM 节点（保留在内存中的快照）。
  void RestorePage();

  bool IsPageTranslated() const { return is_translated_; }

  // 策略检查：NodeByteTranslateEnabled / NodeByteTranslateMaxChars
  static bool IsTranslateAllowed();
  static size_t MaxCharsPerRequest();

 private:
  // 内部：发送单批请求到服务端
  void DispatchBatch(const TranslateRequest& req,
                     base::OnceCallback<void(bool ok, TranslateResult result)> on_done);

  // 内部：调用 JS 注入脚本替换/还原文本节点
  void InjectReplaceScript(const std::vector<std::pair<std::string, std::string>>& replacements);
  void InjectRestoreScript();

  raw_ptr<content::WebContents> web_contents_;
  bool is_translated_ = false;

  // 原文快照（用于还原；仅保存被替换的节点 textContent）
  std::vector<std::pair<std::string, std::string>> original_snapshots_;

  base::WeakPtrFactory<TranslateController> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_TRANSLATE_TRANSLATE_CONTROLLER_H_
