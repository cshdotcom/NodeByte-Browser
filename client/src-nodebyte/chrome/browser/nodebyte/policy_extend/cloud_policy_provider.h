// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// CloudOrgPolicyProvider（客户端提示词 5.3.1 / 附录F）：
//   从后端 GET /api/client/policy 拉取 JSON 策略，注入原生 PolicyService，优先级最高。
//   复用 Chromium 原生企业策略框架：mandatory 下发后设置页原生置灰（内置行为），
//   recommended 提供默认值，sensitiveFields 交由 WebUI 层隐藏明文。
//
// 架构说明：继承 policy::PolicyLoader / 或作为 policy::ConfigurationPolicyProvider
// 的自定义实现（【基线：Chromium 128，需核实】Provider 接口签名）。
// 挂接到 ProfilePolicyConnector 的优先级序列在 hook 补丁 0200 中注册。

#ifndef CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_CLOUD_POLICY_PROVIDER_H_
#define CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_CLOUD_POLICY_PROVIDER_H_

#include <memory>
#include <string>

#include "base/functional/callback_forward.h"
#include "base/memory/scoped_refptr.h"
#include "base/values.h"
#include "components/policy/core/common/configuration_policy_provider.h"
#include "components/policy/policy_export.h"
#include "net/traffic_annotation/network_traffic_annotation.h"

class GURL;

namespace network {
class SharedURLLoaderFactory;
}  // namespace network

namespace nodebyte {

// 策略载荷（对应服务端 /api/client/policy 响应 data）
struct CloudPolicyPayload {
  std::string policy_version;
  base::Value::Dict mandatory;      // 注入 POLICY_LEVEL_MANDATORY
  base::Value::Dict recommended;    // 注入 POLICY_LEVEL_RECOMMENDED
  std::vector<std::string> sensitive_fields;  // WebUI 据此隐藏明文（UI 层）
  bool Parse(const base::Value::Dict& json);
};

class CloudOrgPolicyProvider : public policy::ConfigurationPolicyProvider {
 public:
  CloudOrgPolicyProvider(
      policy::PolicyBundle&& initial_bundle,
      policy::PolicyDomain domain,
      scoped_refptr<network::SharedURLLoaderFactory> url_loader_factory);
  ~CloudOrgPolicyProvider() override;

  // policy::ConfigurationPolicyProvider:
  void Init(policy::SchemaRegistry* registry) override;
  void RefreshPolicies(base::OnceClosure refresh_callback) override;
  void Shutdown() override;

  // WebUI 查询敏感字段（nodebyte://settings 用）
  std::vector<std::string> sensitive_fields() const;

 private:
  // 请求 GET {sync_server}/api/client/policy?deviceId=xxx（JWT 由 Account 模块注入）
  void FetchPolicy(base::OnceClosure refresh_callback);
  void OnFetched(base::OnceClosure refresh_callback,
                 std::unique_ptr<std::string> body);

  scoped_refptr<network::SharedURLLoaderFactory> url_loader_factory_;
  CloudPolicyPayload payload_;
  base::WeakPtrFactory<CloudOrgPolicyProvider> weak_factory_{this};
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_CLOUD_POLICY_PROVIDER_H_
