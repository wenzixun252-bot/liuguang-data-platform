#!/bin/bash
# Claude Code hook: 修改 backend 文件后自动重启后端容器
# 只在修改了 backend/ 目录下的文件时才触发重启

# 从 stdin 读取 hook 传入的 JSON（包含被修改的文件路径）
INPUT=$(cat)

# 提取文件路径（Edit/Write 工具的 file_path 参数）
FILE_PATH=$(echo "$INPUT" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)

# 只在修改了 backend 文件时才重启
if [[ "$FILE_PATH" != *"backend"* ]]; then
    exit 0
fi

cd "d:/CC/liuguang-data-platform"

# 设置代理绕过
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1

# 后台重启后端容器（不阻塞 Claude Code）
echo "[Hook] 检测到 backend 文件变更: $(basename "$FILE_PATH")"
echo "[Hook] 正在后台重启后端容器..."
docker compose up -d --build backend > /dev/null 2>&1 &

exit 0
