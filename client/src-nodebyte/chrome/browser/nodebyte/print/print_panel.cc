// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/print/print_panel.h"

#include "components/prefs/pref_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"

namespace nodebyte {

bool PrintPanelEnabled(Profile* profile) {
  const std::string kKey =
      std::string("nodebyte.directive.forced.") +
      std::string(kPolicyNodeBytePrintPanelEnabled);
  if (!profile || !profile->GetPrefs() ||
      !profile->GetPrefs()->HasPrefPath(kKey)) {
    return true;  // 编译默认：面板为主（提示词 5.11.2 定制打印弹窗语义）
  }
  return profile->GetPrefs()->GetBoolean(kKey);
}

}  // namespace nodebyte
