// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// DirectiveApplier —— 策略指令（可撤销）的客户端执行器。
//
// 服务端 /api/client/policy 返回：
//   directives: [{ id, key, valueType, value, scope }]   生效中的指令（最高优先级）
//   revoked:    [{ id, key, valueType, revokedAt }]      近 30 天撤销的指令
//
// 应用语义：directives 按 valueType 写入本地强制配置（本地 Prefs 的
// kNodeByteDirectiveForced 前缀下），等价于 mandatory 策略。
//
// 撤销语义（用户需求，服务端 docs/policy-dictionary.md 同步维护）：
//   收到 revoked 后，**删除该指令的本地强制配置**，随后：
//     - valueType == switch        → 恢复该开关的默认值
//         （指令此前强制为开 → 回到关；强制为关 → 回到开；
//           即回到「从未下发过这条指令」的状态）
//     - valueType == text/number/json（地址或填空类）→ 清空，
//         客户端回退到本地/编译默认（例如 NodeByteSyncServerOverride 清空后
//         重新使用用户自己配置的同步服务器地址）
//     - valueType == search_engine → 恢复**编译时选择的默认搜索引擎**
//         （NodeByte 编译默认 = 必应 Bing，nodebyte_constants.h kDefaultSearchURL）
//
// 指令撤销经 WebSocket policy_update 或定时重拉策略触发；处理幂等
// （重复撤销同一 directive_id 无副作用）。

#ifndef CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_DIRECTIVE_APPLIER_H_
#define CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_DIRECTIVE_APPLIER_H_

#include <string>
#include <vector>

#include "base/memory/weak_ptr.h"
#include "base/values.h"

class PrefService;
class Profile;

namespace nodebyte {

enum class DirectiveValueType {
  kSwitch = 0,     // 开关：撤销 → 恢复默认值
  kText,           // 地址/文本：撤销 → 清空
  kNumber,         // 数值：撤销 → 清空
  kJson,           // 结构化配置：撤销 → 清空
  kSearchEngine,   // 搜索引擎：撤销 → 回编译时默认（必应）
};

struct Directive {
  std::string id;             // directive_id（uuid）
  std::string key;            // 策略键
  DirectiveValueType value_type = DirectiveValueType::kText;
  base::Value value;          // switch=Bool / number=Int / 其余=String 或 Dict
  std::string scope;          // global | group | user
};

struct RevokedDirective {
  std::string id;
  std::string key;
  DirectiveValueType value_type = DirectiveValueType::kText;
  std::string revoked_at;     // ISO-8601
};

class DirectiveApplier {
 public:
  explicit DirectiveApplier(Profile* profile);
  ~DirectiveApplier();

  DirectiveApplier(const DirectiveApplier&) = delete;
  DirectiveApplier& operator=(const DirectiveApplier&) = delete;

  // 解析 /api/client/policy 响应中的 directives / revoked 数组并执行。
  // 1) 对 revoked：DeleteLocalForcedConfig()（幂等）；
  // 2) 对 directives：ApplyDirective() 写入本地强制配置；
  // 3) 已知指令集合持久化到本地 Prefs（用于识别"指令消失但未进入 revoked"的情况，
  //    同样按撤销语义清理，保证指令被服务端物理删除后客户端也能收敛）。
  void ApplyFromPolicyJson(const base::Value::Dict& policy_data);

 private:
  void ApplyDirective(const Directive& directive);
  // 撤销语义的核心：按 valueType 删除/回退本地配置（见文件头注释）。
  void RevokeDirective(const RevokedDirective& directive);
  void SetDefaultSearchEngine(const std::string& search_url);   // search_engine 应用
  void RestoreCompileDefaultSearchEngine();                     // 撤销 → 必应（编译默认）
  bool IsKnownKey(const std::string& key) const;

  raw_ptr<Profile> profile_ = nullptr;
  raw_ptr<PrefService> prefs_ = nullptr;  // 本地强制配置存储（kNodeByteDirective* 前缀）
  std::vector<Directive> active_directives_;

  base::WeakPtrFactory<DirectiveApplier> weak_factory_{this};
};

// valueType 字符串 → 枚举（"switch"/"text"/"number"/"json"/"search_engine"）
DirectiveValueType ParseDirectiveValueType(const std::string& s);

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_DIRECTIVE_APPLIER_H_
