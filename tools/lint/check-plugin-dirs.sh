#!/usr/bin/env bash
# 验证 plugins/<X>/ 下不存在 engine/ runtime/ lib/ 目录(总纲 § 4.1 / § 5.8 规定)
# 失败时退出非 0,可接 npm run lint 或 CI

set -euo pipefail

# 历史 baseline 白名单——本阶段起草时已存在的违规,等波次 3/4 各插件
# 迁移时清。详见 task-card § J5.5。新增违规不允许进入此白名单——必须
# 走独立 PR 评审。
ALLOWLIST=(
  "src/plugins/note/lib"
  "src/plugins/browser-capability/runtime"
)

is_allowlisted() {
  local dir="$1"
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    if [[ "$dir" == "$entry" ]]; then
      return 0
    fi
  done
  return 1
}

ALL_HITS=$(find src/plugins -mindepth 2 -maxdepth 2 -type d \( -name 'engine' -o -name 'runtime' -o -name 'lib' \) 2>/dev/null || true)

VIOLATIONS=""
while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  if ! is_allowlisted "$dir"; then
    VIOLATIONS+="$dir"$'\n'
  fi
done <<< "$ALL_HITS"

if [[ -n "$VIOLATIONS" ]]; then
  echo "❌ 发现违规目录(总纲 § 4.1 规定):"
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "  plugins/<X>/ 下禁建 engine/runtime/lib/——"
  echo "  外部依赖必须封装到 src/capabilities/<x>/ 内"
  echo "  详见 docs/refactor/00-总纲.md § 5.8"
  exit 1
fi

echo "✓ 插件目录结构合规(${#ALLOWLIST[@]} 条历史 baseline 白名单已豁免,详见脚本注释)"
