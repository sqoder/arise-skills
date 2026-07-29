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
SKILLS=("arise-bug-memo" "arise-commit" "arise-habits" "arise-finish" "arise-verify" "arise-prompt" "arise-router")

# 目标项目目录（默认为当前工作目录）
TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo -e "${CYAN}🚀 arise-skills 安装器${NC}"
echo -e "目标项目: ${TARGET_DIR}"
echo ""

# 检测已安装的 AI 工具
DETECTED=()
LABELS=()
PATHS=()

# 已知工具检测（目录名 → 显示名 → skills路径）
check_tool() {
    if [ -d "$TARGET_DIR/$1" ]; then
        DETECTED+=("$1")
        LABELS+=("$2")
        PATHS+=("$TARGET_DIR/$1/skills")
    fi
}

check_tool ".trae" "TRAE"
check_tool ".claude" "Claude Code"
check_tool ".cursor" "Cursor"
check_tool ".windsurf" "Windsurf"
check_tool ".augment" "Augment"
check_tool ".cline" "Cline"
check_tool ".opencode" "OpenCode"

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

# 展示菜单
echo -e "${CYAN}选择安装目标:${NC}"
if [ ${#DETECTED[@]} -gt 0 ]; then
    for i in "${!DETECTED[@]}"; do
        echo -e "  $((i+1)). ${LABELS[$i]} (${DETECTED[$i]}/skills/)"
    done
fi
echo -e "  $(( ${#DETECTED[@]}+1 )). 通用路径 (.arise/skills/)"
echo -e "  $(( ${#DETECTED[@]}+2 )). 手动输入路径（其他工具）"
echo ""
read -p "输入编号 (默认通用路径): " choice
echo ""

# 处理选择
if [ -z "$choice" ]; then
    # 默认：通用路径
    install_to "$TARGET_DIR/.arise/skills" "通用"
elif [ "$choice" -le ${#DETECTED[@]} ] 2>/dev/null; then
    # 选择了某个检测到的工具
    install_to "${PATHS[$((choice-1))]}" "${LABELS[$((choice-1))]}"
elif [ "$choice" -eq $(( ${#DETECTED[@]}+1 )) ] 2>/dev/null; then
    # 通用路径
    install_to "$TARGET_DIR/.arise/skills" "通用"
elif [ "$choice" -eq $(( ${#DETECTED[@]}+2 )) ] 2>/dev/null; then
    # 手动输入
    read -p "输入 skills 目录路径 (如 .opencode/skills): " custom_path
    if [ -z "$custom_path" ]; then
        echo -e "${YELLOW}未输入路径，使用默认 .arise/skills/${NC}"
        install_to "$TARGET_DIR/.arise/skills" "通用"
    else
        # 支持相对路径和绝对路径
        case "$custom_path" in
            /*) install_to "$custom_path" "自定义" ;;
            *)  install_to "$TARGET_DIR/$custom_path" "自定义" ;;
        esac
    fi
else
    echo -e "${YELLOW}无效选择，使用默认 .arise/skills/${NC}"
    install_to "$TARGET_DIR/.arise/skills" "通用"
fi

echo ""
echo -e "${GREEN}✅ 安装完成！${NC}"
echo ""

# 在目标项目生成 .arise/.gitignore（区分会话级缓存 vs 可共享数据）
ARISE_DIR="$TARGET_DIR/.arise"
if [ ! -d "$ARISE_DIR" ]; then
    mkdir -p "$ARISE_DIR"
fi
GITIGNORE_PATH="$ARISE_DIR/.gitignore"
if [ ! -f "$GITIGNORE_PATH" ]; then
    cat > "$GITIGNORE_PATH" <<'EOF'
# arise-skills 会话级数据（不提交，每个开发者独立）
codegraph-context.json
context.md
knowledge/

# habits/ 和 bug-fix-memory/ 默认可提交（团队共享经验）
# 如想个人使用不共享，取消下方注释：
# habits/
# bug-fix-memory/
EOF
    echo -e "${GREEN}✓${NC} 生成 .arise/.gitignore（会话级数据默认忽略，habits/bug-memo 可共享）"
else
    echo -e "${YELLOW}⚠${NC} .arise/.gitignore 已存在，跳过生成（请手动确认会话级数据已被忽略）"
fi
echo ""

echo -e "使用方式: 在 AI 编码助手中输入 ${CYAN}/arise <技能>${NC}"
echo -e "  /arise             智能路由（推荐入口）"
echo -e "  /arise-prompt      上下文感知提示词工程"
echo -e "  /arise-bug-memo    查历史 / 记录踩坑"
echo -e "  /arise-commit      检查 + 提交"
echo -e "  /arise-habits      加载 / 记录习惯"
echo -e "  /arise-finish      分支收尾"
echo -e "  /arise-verify      完成前验证"
echo ""
echo -e "${CYAN}🧠 代码分析引擎（可选，强烈推荐）:${NC}"
echo ""
echo -e "  ${GREEN}方案 A: 安装 CodeGraph（推荐，完整能力）${NC}"
echo -e "    npm install -g @sdsrs/code-graph"
echo -e "    # 或者 MCP 注册: claude mcp add code-graph-mcp -- npx -y @sdsrs/code-graph"
echo -e "    # 19语言 / 爆炸半径分析 / HTTP追踪 / 死代码检测 / 混合搜索"
echo ""
echo -e "  ${YELLOW}方案 B: 用内置 arise-knowledge（轻量替代）${NC}"
echo -e "    cd $SCRIPT_DIR/arise-knowledge && npm install"
echo -e "    # 5语言 / 基础调用图 / 向量搜索"
echo ""
echo -e "  详见: $SCRIPT_DIR/arise-knowledge/SKILL.md"
