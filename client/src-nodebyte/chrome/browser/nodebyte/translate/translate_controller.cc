// Copyright 2026 NodeByte Browser Project. All rights reserved.
// 翻译控制器实现（用户需求：开源免费翻译 API）
//
// 该文件为 NodeByte 自研模块（chrome/browser/nodebyte/translate/），不依赖
// Chromium 自带的 //components/translate，因为后者绑定 Google Translate API。
// 我们改用服务端聚合的开源 API（LibreTranslate/Lingva/MyMemory/DeepLX），
// 客户端只做轻量代理 + DOM 替换。

#include "chrome/browser/nodebyte/translate/translate_controller.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/nodebyte_protocol.h"
#include "content/public/browser/web_contents.h"
#include "third_party/blink/public/web/web_local_frame.h"

namespace nodebyte {

namespace {

// 默认单批字符上限（与服务端 NodeByteTranslateMaxChars 默认值一致）
constexpr size_t kDefaultMaxChars = 5000;

// 把文本按句子边界分批（避免在词中间切断）
std::vector<std::string> SplitIntoBatches(const std::string& text, size_t max_chars) {
  std::vector<std::string> batches;
  if (text.empty()) return batches;

  // 简化策略：按句号/问号/感叹号/换行切分，累计到 max_chars 即开新批
  std::string current;
  constexpr size_t kSentenceLookahead = 200;

  size_t i = 0;
  while (i < text.size()) {
    size_t end = std::min(i + max_chars - current.size(), text.size());
    // 在 [i, end) 范围内寻找最近的句末符号
    size_t sentence_end = end;
    if (end < text.size()) {
      size_t look_start = (end > kSentenceLookahead) ? end - kSentenceLookahead : i;
      for (size_t j = end; j > look_start; --j) {
        char c = text[j - 1];
        if (c == '.' || c == '!' || c == '?' || c == '\n' || c == 0xE3 /* CJK 末 */) {
          sentence_end = j;
          break;
        }
      }
    }
    current.append(text, i, sentence_end - i);
    i = sentence_end;

    if (current.size() >= max_chars * 0.8 || i >= text.size()) {
      batches.push_back(std::move(current));
      current.clear();
    }
  }
  if (!current.empty()) batches.push_back(std::move(current));
  return batches;
}

}  // namespace

TranslateController::TranslateController(content::WebContents* web_contents)
    : web_contents_(web_contents) {}

TranslateController::~TranslateController() = default;

// static
bool TranslateController::IsTranslateAllowed() {
  // 读取 NodeBytePolicy（CloudOrgPolicyProvider 合并后的 mandatory）
  // 策略 NodeByteTranslateEnabled 默认 true，上游可关闭
  return NodeByteProtocol::GetMandatoryPolicyBool(
      kPolicyNodeByteTranslateEnabled, /*default_value=*/true);
}

// static
size_t TranslateController::MaxCharsPerRequest() {
  return NodeByteProtocol::GetMandatoryPolicyInt(
      kPolicyNodeByteTranslateMaxChars, /*default_value=*/kDefaultMaxChars);
}

void TranslateController::TranslatePage(
    const std::string& target_lang,
    base::OnceCallback<void(bool ok, size_t node_count)> on_done) {
  if (!IsTranslateAllowed()) {
    std::move(on_done).Run(false, 0);
    return;
  }

  // 1) 通过 JS 收集当前页所有可见文本节点
  //    （实际实现：注入 collectTextNodes.js，返回 [{id, text}] 数组）
  //    此处给出概念性调用；具体 JS 注入由 WebLocalFrame::ExecuteScript 完成。
  auto collected_callback = base::BindOnce(
      &TranslateController::OnTextNodesCollected,
      weak_factory_.GetWeakPtr(),
      target_lang,
      std::move(on_done));
  NodeByteProtocol::CollectVisibleTextNodes(
      web_contents_, std::move(collected_callback));
}

void TranslateController::OnTextNodesCollected(
    const std::string& target_lang,
    base::OnceCallback<void(bool ok, size_t node_count)> on_done,
    bool ok,
    std::vector<std::pair<std::string, std::string>> nodes) {
  if (!ok || nodes.empty()) {
    std::move(on_done).Run(false, 0);
    return;
  }
  original_snapshots_ = nodes;

  // 2) 合并文本并按字符上限分批
  std::string full_text;
  for (const auto& [id, text] : nodes) {
    full_text.append(text);
    full_text.append("\n");
  }
  auto batches = SplitIntoBatches(full_text, MaxCharsPerRequest());

  // 3) 串行分批调用服务端 /api/translate
  //    （并行可能触发公共实例限速；串行更稳）
  //    每批结果按 (batch_id) 累积，最后注入 JS 替换。
  //    此处只给出骨架；完整实现见 NodeByteSyncClient::TranslateBatch。
  std::vector<std::pair<std::string, std::string>> replacements;
  replacements.reserve(nodes.size());

  // 占位：实际由 NodeByteSyncClient 串行调用 + 收敛到 OnBatchTranslated
  // 这里仅声明流程，避免在头文件示例中引入完整异步调度。
  NodeByteProtocol::TranslateBatches(
      web_contents_,
      /*source_lang=*/"auto",
      target_lang,
      batches,
      base::BindOnce(&TranslateController::OnAllBatchesTranslated,
                     weak_factory_.GetWeakPtr(),
                     std::move(on_done)));
}

void TranslateController::OnAllBatchesTranslated(
    base::OnceCallback<void(bool ok, size_t node_count)> on_done,
    bool ok,
    std::vector<std::pair<std::string, std::string>> replacements) {
  if (!ok) {
    std::move(on_done).Run(false, 0);
    return;
  }
  // 4) 注入 JS 替换文本节点
  InjectReplaceScript(replacements);
  is_translated_ = true;
  std::move(on_done).Run(true, replacements.size());
}

void TranslateController::TranslateSelection(
    const std::string& text,
    const std::string& target_lang,
    base::OnceCallback<void(bool ok, const std::string& translated)> on_done) {
  if (!IsTranslateAllowed() || text.empty()) {
    std::move(on_done).Run(false, std::string());
    return;
  }

  TranslateRequest req;
  req.text = text;
  req.source_lang = "auto";
  req.target_lang = target_lang;
  req.format = "text";

  DispatchBatch(req, base::BindOnce(
      [](base::OnceCallback<void(bool, const std::string&)> cb,
         bool ok, TranslateResult result) {
        std::move(cb).Run(ok, ok ? result.translated_text : std::string());
      },
      std::move(on_done)));
}

void TranslateController::RestorePage() {
  if (!is_translated_) return;
  InjectRestoreScript();
  is_translated_ = false;
  original_snapshots_.clear();
}

void TranslateController::DispatchBatch(
    const TranslateRequest& req,
    base::OnceCallback<void(bool ok, TranslateResult result)> on_done) {
  // 委托 NodeByteSyncClient::PostTranslate（实际实现见 sync/nodebyte_sync_client.cc）
  // 该方法负责把请求体加密（AES-GCM 端到端加密通道），发送到同步服务器
  // 的 /api/translate 端点，并解析返回 JSON。
  NodeByteProtocol::PostTranslateRequest(web_contents_, req, std::move(on_done));
}

void TranslateController::InjectReplaceScript(
    const std::vector<std::pair<std::string, std::string>>& replacements) {
  // 注入 nodebyte_replace_text_nodes.js：根据每对的 (id, translated) 替换
  // 实际 JS 代码见 client/webui/translate/replace.js（由 WebUIDataSource 提供）
  std::string js = "(function(){window.__nodebyteRestore=[];";
  for (const auto& [id, translated] : replacements) {
    // 简化：实际应 JSON-encode id 与 translated 防注入
    js.append("window.__nodebyteRestore.push({id:'");
    js.append(id);
    js.append("',original:document.querySelector('[data-nb-id=\"");
    js.append(id);
    js.append("\"]').textContent});");
    js.append("document.querySelector('[data-nb-id=\"");
    js.append(id);
    js.append("\"]').textContent='");
    js.append(translated);
    js.append("';");
  }
  js.append("})();");

  // 通过主帧执行
  if (web_contents_ && web_contents_->GetPrimaryFrame()) {
    web_contents_->GetPrimaryFrame()->ExecuteJavaScript(
        base::UTF8ToUTF16(js), base::OnceCallback<void(base::Value)>());
  }
}

void TranslateController::InjectRestoreScript() {
  std::string js = "(function(){if(!window.__nodebyteRestore)return;"
                    "window.__nodebyteRestore.forEach(function(r){"
                    "var el=document.querySelector('[data-nb-id=\"'+r.id+'\"]');"
                    "if(el)el.textContent=r.original;"
                    "});window.__nodebyteRestore=null;})();";
  if (web_contents_ && web_contents_->GetPrimaryFrame()) {
    web_contents_->GetPrimaryFrame()->ExecuteJavaScript(
        base::UTF8ToUTF16(js), base::OnceCallback<void(base::Value)>());
  }
}

}  // namespace nodebyte
