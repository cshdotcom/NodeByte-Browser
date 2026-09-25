// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/policy_extend/cloud_policy_provider.h"

#include <utility>

#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "components/policy/core/common/policy_bundle.h"
#include "components/policy/core/common/policy_map.h"
#include "components/policy/core/common/policy_types.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/load_flags.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/url_loader_factory.mojom.h"

namespace nodebyte {

namespace {

constexpr net::NetworkTrafficAnnotationTag kPolicyTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("nodebyte_cloud_policy", R"(
      semantics {
        sender: "NodeByte Browser"
        description: "Fetches organization policy from the NodeByte sync server."
        trigger: "Browser startup, periodic refresh, or policy_update signal."
        data: "Device id and bearer JWT. No user browsing data."
        destination: OTHER
        destination_other: "The organization-provided NodeByte sync server."
      }
      policy {
        cookies_allowed: NO
        setting: "Controlled by NodeByte organization policy."
      })");

constexpr int kMaxPolicyResponseBytes = 4 * 1024 * 1024;  // 4 MiB

bool MergeLevel(const base::Value::Dict& root,
                const char* key,
                policy::PolicyMap& out) {
  const base::Value::Dict* level = root.FindDict(key);
  if (!level) return true;
  for (const auto [name, value] : *level) {
    out.Set(name, policy::POLICY_LEVEL_MANDATORY, policy::POLICY_SCOPE_MACHINE,
            policy::POLICY_SOURCE_CLOUD, value.Clone(), nullptr);
    // 注：recommended 级别在调用侧以 POLICY_LEVEL_RECOMMENDED 设置。
  }
  return true;
}

}  // namespace

bool CloudPolicyPayload::Parse(const base::Value::Dict& json) {
  const std::string* version = json.FindString("policyVersion");
  policy_version = version ? *version : std::string();

  const base::Value::Dict* m = json.FindDict("mandatory");
  const base::Value::Dict* r = json.FindDict("recommended");
  mandatory = m ? m->Clone() : base::Value::Dict();
  recommended = r ? r->Clone() : base::Value::Dict();

  sensitive_fields.clear();
  if (const base::Value::List* fields = json.FindList("sensitiveFields")) {
    for (const base::Value& v : *fields) {
      if (v.is_string()) sensitive_fields.push_back(v.GetString());
    }
  }
  return true;
}

CloudOrgPolicyProvider::CloudOrgPolicyProvider(
    policy::PolicyBundle&& initial_bundle,
    policy::PolicyDomain domain,
    scoped_refptr<network::SharedURLLoaderFactory> url_loader_factory)
    : policy::ConfigurationPolicyProvider(
          /*metadata=*/{domain,
                        policy::POLICY_SCOPE_MACHINE,
                        policy::POLICY_SOURCE_CLOUD}),
      url_loader_factory_(std::move(url_loader_factory)) {
  // 初始 bundle 由挂接点预填（见 hook 0200），此处持有。
  bundle_ = std::move(initial_bundle);
}

CloudOrgPolicyProvider::~CloudOrgPolicyProvider() = default;

void CloudOrgPolicyProvider::Init(policy::SchemaRegistry* registry) {
  policy::ConfigurationPolicyProvider::Init(registry);
  RefreshPolicies(base::OnceClosure());
}

void CloudOrgPolicyProvider::RefreshPolicies(base::OnceClosure refresh_callback) {
  FetchPolicy(std::move(refresh_callback));
}

void CloudOrgPolicyProvider::Shutdown() {
  url_loader_factory_ = nullptr;
  policy::ConfigurationPolicyProvider::Shutdown();
}

std::vector<std::string> CloudOrgPolicyProvider::sensitive_fields() const {
  return payload_.sensitive_fields;
}

void CloudOrgPolicyProvider::FetchPolicy(base::OnceClosure refresh_callback) {
  if (!url_loader_factory_) {
    if (refresh_callback) std::move(refresh_callback).Run();
    return;
  }

  auto request = std::make_unique<network::ResourceRequest>();
  // 同步服务器地址来自本地偏好（策略 CustomLockSyncServer=true 时锁定不可改）。
  request->url = GURL("https://" + std::string(kDefaultSyncServer) + "/api/client/policy");
  request->load_flags = net::LOAD_BYPASS_CACHE | net::LOAD_DISABLE_CACHE;
  request->headers.SetHeader("Authorization", "Bearer " + pending_jwt_);
  // deviceId 由 Account 模块持久化生成。
  request->url = request->url.Resolve("?deviceId=" + pending_device_id_);

  auto loader = network::SimpleURLLoader::Create(std::move(request),
                                                 kPolicyTrafficAnnotation);
  loader->DownloadToString(
      url_loader_factory_.get(),
      base::BindOnce(&CloudOrgPolicyProvider::OnFetched,
                     weak_factory_.GetWeakPtr(), std::move(refresh_callback)),
      kMaxPolicyResponseBytes);
  loader_ = std::move(loader);
}

void CloudOrgPolicyProvider::OnFetched(base::OnceClosure refresh_callback,
                                       std::unique_ptr<std::string> body) {
  if (body) {
    auto parsed = base::JSONReader::ReadAndReturnValueWithError(*body);
    if (parsed.has_value() && parsed->is_dict()) {
      // 统一信封 { code, message, data }；业务码 40301 → 触发 2FA 绑定引导
      const base::Value::Dict& envelope = parsed->GetDict();
      if (const base::Value::Dict* data = envelope.FindDict("data")) {
        payload_.Parse(*data);
        ApplyPayload();
      }
    } else {
      LOG(WARNING) << "NodeByte policy fetch: invalid JSON";
    }
  }
  if (refresh_callback) std::move(refresh_callback).Run();
}

void CloudOrgPolicyProvider::ApplyPayload() {
  policy::PolicyBundle bundle;
  policy::PolicyMap& map =
      bundle.Get(PolicyNamespace(domain(), std::string()));
  policy::PolicyMap recommended_map;
  // mandatory
  for (const auto [name, value] : payload_.mandatory) {
    map.Set(name, policy::POLICY_LEVEL_MANDATORY, policy::POLICY_SCOPE_MACHINE,
            policy::POLICY_SOURCE_CLOUD, value.Clone(), nullptr);
  }
  // recommended（用户可改，设置页不置灰）
  for (const auto [name, value] : payload_.recommended) {
    recommended_map.Set(name, policy::POLICY_LEVEL_RECOMMENDED,
                        policy::POLICY_SCOPE_MACHINE,
                        policy::POLICY_SOURCE_CLOUD, value.Clone(), nullptr);
  }
  map.MergeFrom(recommended_map);
  bundle_ = std::move(bundle);
  NotifyPolicyUpdate();
}

}  // namespace nodebyte
