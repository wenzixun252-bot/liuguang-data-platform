"""Claude Code hook: parse Edit/Write event and append human-readable changelog."""
import sys, json, datetime, os, re

logfile = sys.argv[1] if len(sys.argv) > 1 else "CHANGELOG-claude.md"

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = d.get("tool_name", "")
inp = d.get("tool_input", {})
fp = inp.get("file_path", "")
if not fp:
    sys.exit(0)

# Normalize path
fp = fp.replace("\\", "/")
for prefix in ["d:/CC/liuguang-data-platform/", "D:/CC/liuguang-data-platform/"]:
    if fp.startswith(prefix):
        fp = fp[len(prefix):]
        break

# ── Determine module area ──
MODULE_MAP = [
    (r"^frontend/src/pages/",       "前端页面"),
    (r"^frontend/src/components/",  "前端组件"),
    (r"^frontend/src/lib/",         "前端工具库"),
    (r"^frontend/src/",             "前端"),
    (r"^backend/app/api/",          "后端接口"),
    (r"^backend/app/models/",       "数据模型"),
    (r"^backend/app/schemas/",      "数据结构定义"),
    (r"^backend/app/services/",     "后端服务"),
    (r"^backend/app/worker/",       "后台任务"),
    (r"^backend/app/",              "后端"),
    (r"^backend/alembic/",          "数据库迁移"),
    (r"^\.claude/",                 "开发工具配置"),
    (r"docker|\.env|requirements",  "项目配置"),
]

module = "其他"
for pattern, name in MODULE_MAP:
    if re.search(pattern, fp):
        module = name
        break

# Extract simple filename
filename = fp.rsplit("/", 1)[-1] if "/" in fp else fp
basename = filename.rsplit(".", 1)[0] if "." in filename else filename

# ── Analyze change content ──
desc_parts = []

if tool == "Write":
    content = inp.get("content", "")
    lines = content.count("\n") + 1
    # Extract function/class/component names
    funcs = re.findall(r"(?:def|class|async def)\s+(\w+)", content)
    components = re.findall(r"(?:export\s+(?:default\s+)?function|const)\s+(\w+)", content)
    names = funcs or components
    if names:
        desc_parts.append(f"新建文件 `{basename}`，包含 {', '.join(names[:5])}")
    else:
        desc_parts.append(f"新建文件 `{basename}` ({lines}行)")

elif tool == "Edit":
    old = inp.get("old_string", "")
    new = inp.get("new_string", "")

    old_lines = set(old.strip().splitlines())
    new_lines = set(new.strip().splitlines())
    added = new_lines - old_lines
    removed = old_lines - new_lines

    # Detect new functions/components
    new_funcs = re.findall(r"(?:def|async def|function|const)\s+(\w+)", "\n".join(added))
    old_funcs = re.findall(r"(?:def|async def|function|const)\s+(\w+)", "\n".join(removed))
    added_funcs = [f for f in new_funcs if f not in old_funcs]
    removed_funcs = [f for f in old_funcs if f not in new_funcs]

    # Detect new routes/endpoints
    new_routes = [l for l in added if re.search(r"@(app|router)\.(get|post|put|delete|patch)", l.strip())]
    # Detect new imports
    new_imports = [l for l in added if re.match(r"\s*(import |from |require\()", l.strip())]
    # Detect UI changes
    new_jsx = [l for l in added if re.search(r"<[A-Z]\w+", l)]

    if added_funcs:
        desc_parts.append(f"新增 {', '.join(added_funcs[:4])}")
    if removed_funcs:
        desc_parts.append(f"移除 {', '.join(removed_funcs[:4])}")
    if new_routes:
        desc_parts.append("新增API端点")
    if new_imports and not added_funcs:
        desc_parts.append("添加依赖引用")
    if new_jsx and not added_funcs:
        desc_parts.append("调整UI组件")

    if not desc_parts:
        add_count = len(added)
        rem_count = len(removed)
        if rem_count == 0 and add_count > 0:
            desc_parts.append(f"新增 {add_count} 行代码")
        elif add_count == 0 and rem_count > 0:
            desc_parts.append(f"删除 {rem_count} 行代码")
        elif add_count > 0 and rem_count > 0:
            desc_parts.append(f"修改逻辑 (+{add_count}/-{rem_count}行)")
        else:
            desc_parts.append("微调代码")

# ── Format and write ──
ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
desc = "；".join(desc_parts) if desc_parts else "更新文件"

if not os.path.exists(logfile):
    with open(logfile, "w", encoding="utf-8") as f:
        f.write("# Claude Code 变更日志\n\n自动记录每次文件修改。\n\n")

with open(logfile, "a", encoding="utf-8") as f:
    f.write(f"- **{ts}** [{module}] `{fp}` — {desc}\n")
