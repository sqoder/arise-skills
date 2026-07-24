#!/bin/bash
# arise-skills 智能安装脚本
# 自动检测当前项目使用的 AI 工具，将 skills 复制到对应路径

set -e

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 获取脚本所在目录（即 skills 源目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS=("arise-bug-memo" "arise-commit" "arise-habits" "arise-finish" "arise-verify")

# 目标项目目录（默认为当前工作目录）
TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo -e "${CYAN}🚀 arise-skills 安装器${NC}"
echo -e "目标项目: ${TARGET_DIR}"
echo ""

# 检测已安装的 AI 工具
DETECTED=()

if [ -d "$TARGET_DIR/.trae" ]; then
    DETECTED+=("trae")
fi

if [ -d "$TARGET_DIR/.claude" ]; then
    DETECTED+=("claude")
fi

# 如果没检测到任何工具，创建 .arise 作为通用目录
if [ ${#DETECTED[@]} -eq 0 ]; then
    echo -e "${YELLOW}未检测到已知 AI 工具目录，使用通用路径 .arise/skills/${NC}"
    DETECTED+=("arise")
fi

# 安装函数
install_to() {
    local dest="$1"
    local label="$2"
    mkdir -p "$dest"
    for skill in "${SKILLS[@]}"; do
        if [ -d "$SCRIPT_DIR/$skill" ]; then
            cp -r "$SCRIPT_DIR/$skill" "$dest/"
        fi
    done
    echo -e "  ${GREEN}✓${NC} $label → $dest"
}

# 按检测结果分发
echo -e "${CYAN}检测到:${NC}"
for tool in "${DETECTED[@]}"; do
    case $tool in
        trae)
            echo -e "  • TRAE (.trae/)"
            install_to "$TARGET_DIR/.trae/skills" "TRAE"
            ;;
        claude)
            echo -e "  • Claude Code (.claude/)"
            install_to "$TARGET_DIR/.claude/skills" "Claude Code"
            ;;
        arise)
            echo -e "  • 通用 (.arise/)"
            install_to "$TARGET_DIR/.arise/skills" "通用"
            ;;
    esac
done

echo ""
echo -e "${GREEN}✅ 安装完成！${NC}"
echo ""
echo -e "使用方式: 在 AI 编码助手中输入 ${CYAN}/arise <技能>${NC}"
echo -e "  /arise-bug-memo    查历史 / 记录踩坑"
echo -e "  /arise-commit      检查 + 提交"
echo -e "  /arise-habits      加载 / 记录习惯"
echo -e "  /arise-finish      分支收尾"
echo -e "  /arise-verify      完成前验证"
