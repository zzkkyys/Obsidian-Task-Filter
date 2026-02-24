import { App, Notice } from "obsidian";
import skillTemplate from "./skill-template.md";

/**
 * 任务生成 Skill —— 从独立的 skill-template.md 读取模板，
 * 动态替换占位符后复制到剪贴板，供 Claude Code / 其他 AI 编程助手使用。
 */

interface ProjectInfo {
    name: string;
    folderPath: string;
    taskCount: number;
}

/**
 * 扫描 vault 中所有 #task 文件，按父文件夹聚合为项目列表
 */
async function scanProjects(app: App): Promise<ProjectInfo[]> {
    const files = app.vault.getMarkdownFiles();
    const projectFolders = new Map<string, { folder: string; count: number }>();

    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) continue;

        // 检查是否是 task 文件
        const tags = fm.tags;
        let isTask = false;
        if (Array.isArray(tags)) {
            isTask = tags.some(
                (t: string) => typeof t === "string" && t.toLowerCase().replace(/^#/, "") === "task"
            );
        }
        if (!isTask) continue;

        // 从路径提取父文件夹
        const pathParts = file.path.split("/");
        if (pathParts.length >= 2) {
            const parentFolder = pathParts.slice(0, -1).join("/");
            const projectName = pathParts[pathParts.length - 2] || "未分类";
            const existing = projectFolders.get(projectName);
            if (existing) {
                existing.count++;
            } else {
                projectFolders.set(projectName, { folder: parentFolder, count: 1 });
            }
        }
    }

    const projects: ProjectInfo[] = [];
    for (const [name, info] of projectFolders.entries()) {
        projects.push({ name, folderPath: info.folder, taskCount: info.count });
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/**
 * 获取 vault 的绝对路径
 */
function getVaultPath(app: App): string {
    const adapter = app.vault.adapter as any;
    if (adapter && typeof adapter.getBasePath === "function") {
        return adapter.getBasePath() as string;
    }
    return "(请手动替换为你的 Obsidian 仓库绝对路径)";
}

/**
 * 用动态数据替换模板中的占位符，生成最终 Skill 内容
 */
export async function generateTaskSkillContent(app: App): Promise<string> {
    const vaultPath = getVaultPath(app);
    const vaultPathUnix = vaultPath.replace(/\\/g, "/");
    const projects = await scanProjects(app);

    const projectListLines =
        projects.length > 0
            ? projects
                .map((p) => `- **${p.name}** | 目录: \`${p.folderPath}\` | 任务数: ${p.taskCount}`)
                .join("\n")
            : "- _(暂无已有项目，可在 `TaskNotes/Projects/<项目名>/` 下创建新项目)_";

    // 替换模板占位符
    let content = skillTemplate;
    content = content.replace(/\{\{VAULT_PATH_UNIX\}\}/g, vaultPathUnix);
    content = content.replace(/\{\{VAULT_PATH\}\}/g, vaultPath);
    content = content.replace(/\{\{PROJECT_LIST\}\}/g, projectListLines);

    return content;
}

/**
 * 复制 Skill 内容到剪贴板并显示通知
 */
export async function copyTaskSkillToClipboard(app: App): Promise<void> {
    try {
        const content = await generateTaskSkillContent(app);
        await navigator.clipboard.writeText(content);

        // 自定义 Notice 样式
        const n = new Notice("", 3000);
        const el = (n as any).noticeEl as HTMLElement | undefined;
        if (el) {
            el.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
            el.style.border = "none";
            el.style.boxShadow = "0 4px 15px rgba(102, 126, 234, 0.4)";
            el.style.borderRadius = "10px";
            el.style.color = "#fff";
            el.style.fontWeight = "600";
            el.style.padding = "12px 20px";

            const parentNotice = el.closest(".notice") as HTMLElement | null;
            if (parentNotice) {
                parentNotice.style.background = "transparent";
                parentNotice.style.border = "none";
                parentNotice.style.boxShadow = "none";
                parentNotice.style.padding = "0";
            }

            while (el.firstChild) el.removeChild(el.firstChild);
            const emojiEl = document.createElement("span");
            emojiEl.textContent = "📋 ";
            emojiEl.style.marginRight = "4px";
            const textEl = document.createElement("span");
            textEl.textContent = "任务生成 Skill 已复制到剪贴板";
            el.append(emojiEl, textEl);
        } else {
            new Notice("📋 任务生成 Skill 已复制到剪贴板");
        }
    } catch (error) {
        console.error("Failed to copy task skill to clipboard:", error);
        new Notice("❌ 复制失败，请重试");
    }
}
