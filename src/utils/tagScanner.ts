import { App, TFile } from "obsidian";

export interface TagInfo {
    tag: string;
    count: number;
}

export interface TaskFile {
    file: TFile;
    tags: string[];
    title: string;
    // TaskNotes 元数据
    status: string;
    priority: string;
    due: string | null;
    dateCreated: string | null;
    dateModified: string | null;
    completedDate: string | null;
    projects: string[];
    money?: number; // 报销金额
}

/**
 * 扫描 vault 中所有文件的标签
 */
export async function getAllTags(app: App): Promise<TagInfo[]> {
    const tagCounts = new Map<string, number>();
    const tagOriginalCase = new Map<string, string>();  // 保存原始大小写
    const files = app.vault.getMarkdownFiles();

    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.tags) {
            for (const tagItem of cache.tags) {
                const tagLower = tagItem.tag.toLowerCase();
                tagCounts.set(tagLower, (tagCounts.get(tagLower) || 0) + 1);
                // 保留第一次遇到的原始大小写
                if (!tagOriginalCase.has(tagLower)) {
                    tagOriginalCase.set(tagLower, tagItem.tag);
                }
            }
        }
        // 也检查 frontmatter 中的标签
        if (cache?.frontmatter?.tags) {
            const fmTags = cache.frontmatter.tags;
            const tagsArray = Array.isArray(fmTags) ? fmTags : [fmTags];
            for (const tag of tagsArray) {
                const originalTag = tag.startsWith("#") ? tag : `#${tag}`;
                const tagLower = originalTag.toLowerCase();
                tagCounts.set(tagLower, (tagCounts.get(tagLower) || 0) + 1);
                if (!tagOriginalCase.has(tagLower)) {
                    tagOriginalCase.set(tagLower, originalTag);
                }
            }
        }
    }

    return Array.from(tagCounts.entries())
        .map(([tagLower, count]) => ({ 
            tag: tagOriginalCase.get(tagLower) || tagLower,  // 使用原始大小写
            count 
        }))
        .sort((a, b) => b.count - a.count);
}

/**
 * 获取所有包含 #task 标签的文件
 */
export async function getTaskFiles(app: App): Promise<TaskFile[]> {
    const taskFiles: TaskFile[] = [];
    const files = app.vault.getMarkdownFiles();

    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const fileTags: string[] = [];
        let hasTaskTag = false;

        // 检查内联标签
        if (cache?.tags) {
            for (const tagItem of cache.tags) {
                fileTags.push(tagItem.tag);  // 保留原始大小写
                if (tagItem.tag.toLowerCase() === "#task") {
                    hasTaskTag = true;
                }
            }
        }

        // 检查 frontmatter 标签
        if (cache?.frontmatter?.tags) {
            const fmTags = cache.frontmatter.tags;
            const tagsArray = Array.isArray(fmTags) ? fmTags : [fmTags];
            for (const tag of tagsArray) {
                const originalTag = tag.startsWith("#") ? tag : `#${tag}`;
                fileTags.push(originalTag);  // 保留原始大小写
                if (originalTag.toLowerCase() === "#task") {
                    hasTaskTag = true;
                }
            }
        }

        if (hasTaskTag) {
            const fm = cache?.frontmatter || {};
            let projects = fm.projects ? (Array.isArray(fm.projects) ? fm.projects : [fm.projects]) : [];
            projects = projects.filter((p: string) => p && p.length > 0);
            
            // 如果 frontmatter 中没有 projects，尝试从文件路径提取
            // 路径格式: xxxx/Projects/项目名/yyy.md -> projects = 项目名
            if (projects.length === 0) {
                const pathParts = file.path.split("/");
                const projectsIndex = pathParts.findIndex(part => part.toLowerCase() === "projects");
                if (projectsIndex !== -1 && projectsIndex < pathParts.length - 1) {
                    const projectName = pathParts[projectsIndex + 1];
                    if (projectName && projectName.length > 0 && !projectName.endsWith(".md")) {
                        projects = [projectName];
                    }
                }
            }
            
            taskFiles.push({
                file,
                tags: [...new Set(fileTags)], // 去重
                title: file.basename,
                status: fm.status || "open",
                priority: fm.priority || "normal",
                due: fm.due || null,
                dateCreated: fm.dateCreated || null,
                dateModified: fm.dateModified || null,
                completedDate: fm.completedDate || null,
                projects,
                money: typeof fm.money === "number" ? fm.money : (fm.money ? Number(fm.money) : undefined),
            });
        }
    }

    return taskFiles;
}

/**
 * 根据选中的标签过滤任务文件
 */
export function filterTaskFilesByTags(taskFiles: TaskFile[], selectedTags: string[]): TaskFile[] {
    if (selectedTags.length === 0) {
        return taskFiles;
    }

    // 将选中的标签统一转换为小写
    const normalizedSelectedTags = selectedTags.map(tag => tag.toLowerCase());

    return taskFiles.filter((taskFile) => {
        // 文件必须包含所有选中的标签
        const fileTags = taskFile.tags.map(t => t.toLowerCase());
        return normalizedSelectedTags.every((selectedTag) =>
            fileTags.includes(selectedTag)
        );
    });
}
