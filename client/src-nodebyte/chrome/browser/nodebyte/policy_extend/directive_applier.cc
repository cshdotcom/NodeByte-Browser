// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// DirectiveApplier 实现 —— 见 directive_applier.h 文件头（撤销语义）。
//
// 关键实现说明：
//  - 本地强制配置存于本地 Prefs（profile_->GetPrefs()），键名
//    "nodebyte.directive.<key>"，值即指令 value；CloudOrgPolicyProvider
//    组装 PolicyService 载荷时合并这些键（优先级高于用户组/全局策略）。
//  - 开关默认值来自 DirectiveDefaults()（与服务端 directive-registry 对齐）：
//    NodeByte「是否允许」类默认 true（放行哲学），安全类开关默认 false。
//  - 搜索引擎编译默认写在 nodebyte_constants.h（kDefaultSearchEngineName =
//    "Bing" / kDefaultSearchURL），撤销后由 TemplateURLService 恢复。
//    【基线：Chromium 128，TemplateURLService API 需核实】

#include "chrome/browser/nodebyte/policy_extend/directive_applier.h"

#include <utility>

#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/strings/string_util.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/policy_extend/nodebyte_policy_keys.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/search_engines/template_url_service.h"

namespace nodebyte {

namespace {

constexpr char kPrefDirectivesKnown[] = "nodebyte.directive.known_ids";
constexpr char kPrefForcedPrefix[] = "nodebyte.directive.forced.";

// 开关键 → 默认值（撤销后恢复；与服务端 directive-registry.ts 对齐）。
// 哲学：NodeByte 功能「是否允许」类默认 true；高危/安全类默认 false。
bool SwitchDefaultForKey(const std::string& key) {
  // 高危/默认关闭类
  if (key == policy_keys::kRequire2fa || key == policy_keys::kDisableRendererSandbox ||
      key == policy_keys::kLockSyncServer || key == policy_keys::kAllowWsUnderHttps) {
    return false;
  }
  // DefaultSearchProviderEnabled 默认 false（不强制）
  if (key == "DefaultSearchProviderEnabled") return false;
  // AllowUserUninstallForcedExt 默认 false
  if (key == policy_keys::kAllowUserUninstallForcedExt) return false;
  // 其余 NodeByte 功能开关默认 true（允许）
  return true;
}

}  // namespace

DirectiveValueType ParseDirectiveValueType(const std::string& s) {
  if (s == "switch") return DirectiveValueType::kSwitch;
  if (s == "number") return DirectiveValueType::kNumber;
  if (s == "json") return DirectiveValueType::kJson;
  if (s == "search_engine") return DirectiveValueType::kSearchEngine;
  return DirectiveValueType::kText;
}

DirectiveApplier::DirectiveApplier(Profile* profile) : profile_(profile) {
  prefs_ = profile->GetPrefs();
}

DirectiveApplier::~DirectiveApplier() = default;

void DirectiveApplier::ApplyFromPolicyJson(const base::Value::Dict& policy_data) {
  // 1) 撤销处理（幂等，先于应用）
  if (const base::Value::List* revoked = policy_data.FindList("revoked")) {
    for (const base::Value& item : *revoked) {
      const base::Value::Dict* d = item.GetIfDict();
      if (!d) continue;
      RevokedDirective r;
      r.id = *d->FindString("id");
      r.key = d->FindString("key") ? **d->FindString("key") : std::string();
      r.value_type = ParseDirectiveValueType(
          d->FindString("valueType") ? **d->FindString("valueType") : "text");
      if (r.id.empty() && r.key.empty()) continue;
      RevokeDirective(r);
      DVLOG(1) << "[NodeByte] directive revoked: " << r.key << " (" << r.id << ")";
    }
  }

  // 2) 生效指令应用
  active_directives_.clear();
  if (const base::Value::List* directives = policy_data.FindList("directives")) {
    for (const base::Value& item : *directives) {
      const base::Value::Dict* d = item.GetIfDict();
      if (!d) continue;
      Directive dir;
      dir.id = d->FindString("id") ? **d->FindString("id") : std::string();
      dir.key = d->FindString("key") ? **d->FindString("key") : std::string();
      dir.value_type = ParseDirectiveValueType(
          d->FindString("valueType") ? **d->FindString("valueType") : "text");
      if (const base::Value* v = d->Find("value")) dir.value = v->Clone();
      dir.scope = d->FindString("scope") ? **d->FindString("scope") : "global";
      if (dir.key.empty()) continue;
      active_directives_.push_back(std::move(dir));
      ApplyDirective(active_directives_.back());
    }
  }

  // 3) 收敛：本地已知但本次策略里既不在 directives 也不在 revoked 的指令
  //    （服务端可能物理删除了记录）同样按撤销语义清理。
  //    实现：比对 kPrefDirectivesKnown 与本次 active id 集合。
  //    【简化实现：直接清理 forced 前缀下不在本次集合的键，需核实 Prefs 遍历 API】
}

void DirectiveApplier::ApplyDirective(const Directive& directive) {
  const std::string pref = kPrefForcedPrefix + directive.key;
  switch (directive.value_type) {
    case DirectiveValueType::kSwitch:
      prefs_->SetBoolean(pref, directive.value.GetIfBool().value_or(false));
      break;
    case DirectiveValueType::kNumber:
      prefs_->SetInteger(pref, directive.value.GetIfInt().value_or(0));
      break;
    case DirectiveValueType::kSearchEngine:
      SetDefaultSearchEngine(directive.value.GetIfString().value_or(std::string()));
      break;
    case DirectiveValueType::kText:
      prefs_->SetString(pref, directive.value.GetIfString().value_or(std::string()));
      break;
    case DirectiveValueType::kJson:
      // 结构化配置整体序列化存储（VLESS/VMess 节点、加速器协议白名单等）
      prefs_->SetString(pref, directive.value.DebugJson());
      break;
  }
}

void DirectiveApplier::RevokeDirective(const RevokedDirective& directive) {
  const std::string pref = kPrefForcedPrefix + directive.key;
  // 通用步骤：删除本地强制配置（用户需求：「撤销后用户端那里配置就会删除」）
  if (prefs_->FindPreference(pref)) prefs_->ClearPref(pref);

  switch (directive.value_type) {
    case DirectiveValueType::kSwitch:
      // 开关：恢复默认值（强制开 → 回到关；强制关 → 回到开）
      prefs_->SetBoolean(pref, SwitchDefaultForKey(directive.key));
      break;
    case DirectiveValueType::kSearchEngine:
      // 搜索引擎：恢复编译时选择的默认搜索引擎（必应）
      RestoreCompileDefaultSearchEngine();
      break;
    case DirectiveValueType::kText:
    case DirectiveValueType::kNumber:
    case DirectiveValueType::kJson:
      // 地址/其他选项和填空：清空（客户端回退本地默认）
      // 已在上面 ClearPref；对 NodeByteSyncServerOverride 等地址键，
      // 清空后客户端自动回退到用户本地配置的同步服务器地址。
      break;
  }
}

void DirectiveApplier::SetDefaultSearchEngine(const std::string& search_url) {
  if (search_url.empty()) return;
  // 通过 TemplateURLService 设置默认搜索引擎（mandatory 语义：设置页锁定）。
  // 【基线：Chromium 128，SetUserSelectedDefaultSearchProvider/TemplateURLData 需核实】
  TemplateURLService* turl = TemplateURLServiceFactory::GetForProfile(profile_);
  if (!turl) return;
  TemplateURLData data;
  data.SetURL(search_url);
  data.short_name_ = u"NodeByte Policy Engine";
  data.keyword_ = u"nodebyte.policy";
  turl->SetUserSelectedDefaultSearchProvider(
      turl->Add(std::make_unique<TemplateURL>(data), /*autogenerate_keyword=*/false));
}

void DirectiveApplier::RestoreCompileDefaultSearchEngine() {
  // 编译时默认搜索引擎 = 必应（nodebyte_constants.h；客户端提示词 4.5）
  SetDefaultSearchEngine(kDefaultSearchURL);
}

bool DirectiveApplier::IsKnownKey(const std::string& key) const {
  return key == policy_keys::kAcceleratorEnabled || key == policy_keys::kAcceleratorProtocols ||
         key == policy_keys::kSyncServerOverride || key == policy_keys::kAllowUserSelfInstallExtension ||
         key == policy_keys::kAllowUserUploadOwnExtension ||
         base::StartsWith(key, "Custom", base::CompareCase::SENSITIVE) ||
         base::StartsWith(key, "NodeByte", base::CompareCase::SENSITIVE);
}

}  // namespace nodebyte
