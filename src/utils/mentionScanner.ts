import { App, Notice, TFile, normalizePath } from "obsidian";

export interface MentionInfo {
    name: string;   // 人名（不含 @，可以是多级，如 hit/zhangsan）
    count: number;  // 出现次数
}

/**
 * 提及匹配规则：
 * - 以 @ 开头，前面不能紧跟字母/数字（避免匹配邮箱 foo@bar.com）
 * - 名称支持中文、字母、数字、下划线、连字符
 * - 支持用 / 分隔的多级名称，如 @hit/zhangsan
 */
export const MENTION_REGEX = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

/** 调起 Obsidian 全局搜索，定位某个人名的所有提及 */
export function openMentionSearch(app: App, name: string): void {
    interface GlobalSearchApp {
        internalPlugins?: {
            getPluginById?: (id: string) => {
                instance?: { openGlobalSearch?: (query: string) => void };
            } | null;
        };
    }
    const appWithInternals = app as unknown as GlobalSearchApp;
    const instance = appWithInternals.internalPlugins?.getPluginById?.("global-search")?.instance;
    instance?.openGlobalSearch?.(`"@${name}"`);
}

/** 打开（必要时创建）某个人名对应的人物笔记，如 People/hit/zhangsan.md */
export async function openPersonNote(app: App, folder: string, name: string): Promise<void> {
    const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!cleanFolder) return;

    const path = normalizePath(`${cleanFolder}/${name}.md`);
    let file = app.vault.getAbstractFileByPath(path);

    if (!file) {
        // 逐级创建父目录
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (!dir || app.vault.getAbstractFileByPath(dir)) continue;
            try {
                await app.vault.createFolder(dir);
            } catch {
                // 已存在等情况忽略
            }
        }
        try {
            file = await app.vault.create(path, `# ${name}\n\n`);
            new Notice(`已创建人物笔记：${path}`);
        } catch (e) {
            new Notice(`创建人物笔记失败：${e instanceof Error ? e.message : String(e)}`);
            return;
        }
    }

    if (file instanceof TFile) {
        await app.workspace.openLinkText(file.path, "", false);
    }
}

/** 转义正则元字符 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 全库重命名提及：把 @oldName 改为 @newName（newName 已存在时即为合并）。
 * 返回修改的文件数。
 */
export async function renameMention(app: App, oldName: string, newName: string): Promise<number> {
    // 边界：前面不能是名称字符，后面不能继续接名称字符或下级路径
    const re = new RegExp(
        `(?<![\\p{L}\\p{N}_])@${escapeRegExp(oldName)}(?![\\p{L}\\p{N}_/-])`,
        "gu"
    );

    let changedFiles = 0;
    for (const file of app.vault.getMarkdownFiles()) {
        let content: string;
        try {
            content = await app.vault.cachedRead(file);
        } catch {
            continue;
        }
        re.lastIndex = 0;
        if (!re.test(content)) continue;

        await app.vault.process(file, (data) => data.replace(re, `@${newName}`));
        changedFiles++;
    }
    return changedFiles;
}

/**
 * 提及索引：按文件维护 @人名 计数，文件变动时只重扫该文件。
 */
export class MentionIndex {
    private app: App;
    // 文件路径 -> （小写人名 -> 计数）
    private fileIndex: Map<string, Map<string, number>> = new Map();
    // 小写人名 -> 原始大小写（取第一次遇到的写法）
    private originalCase: Map<string, string> = new Map();
    private aggregated: MentionInfo[] = [];
    private aggregateDirty = true;
    private fullScanDone = false;
    private fullScanPromise: Promise<void> | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /** 兼容旧调用：让聚合结果失效（不会触发全库重扫） */
    markDirty(): void {
        this.aggregateDirty = true;
    }

    /** 文件修改/新建：重扫单个文件 */
    async onFileChanged(file: TFile): Promise<void> {
        if (file.extension !== "md") return;
        await this.indexFile(file);
        this.aggregateDirty = true;
    }

    /** 文件删除 */
    onFileDeleted(path: string): void {
        if (this.fileIndex.delete(path)) {
            this.aggregateDirty = true;
        }
    }

    /** 文件重命名 */
    onFileRenamed(oldPath: string, newPath: string): void {
        const entry = this.fileIndex.get(oldPath);
        if (entry) {
            this.fileIndex.delete(oldPath);
            this.fileIndex.set(newPath, entry);
        }
    }

    /** 获取所有提及（按出现次数降序），首次调用做一次全库扫描，之后增量维护 */
    async getAllMentions(): Promise<MentionInfo[]> {
        if (!this.fullScanDone) {
            if (!this.fullScanPromise) {
                this.fullScanPromise = this.fullScan().finally(() => {
                    this.fullScanPromise = null;
                });
            }
            await this.fullScanPromise;
        }
        return this.aggregate();
    }

    /** 同步返回当前缓存（可能为旧数据），用于补全时即时响应 */
    getCachedMentions(): MentionInfo[] {
        if (!this.fullScanDone) {
            // 后台触发首次扫描，不阻塞调用方
            void this.getAllMentions();
            return this.aggregated;
        }
        return this.aggregate();
    }

    private async fullScan(): Promise<void> {
        for (const file of this.app.vault.getMarkdownFiles()) {
            await this.indexFile(file);
        }
        this.fullScanDone = true;
        this.aggregateDirty = true;
    }

    private async indexFile(file: TFile): Promise<void> {
        let content: string;
        try {
            content = await this.app.vault.cachedRead(file);
        } catch {
            this.fileIndex.delete(file.path);
            return;
        }

        // 去掉代码块，避免把代码里的 @ 当成提及；
        // 但保留本插件的 ob-timeline 块，时间线条目里的 @人名 也要计入
        const stripped = content.replace(
            /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]*`/g,
            (block) => /^```\s*ob-timeline\b/.test(block) ? block : ""
        );
        const counts = new Map<string, number>();
        for (const match of stripped.matchAll(MENTION_REGEX)) {
            const name = match[1];
            if (!name) continue;
            const lower = name.toLowerCase();
            counts.set(lower, (counts.get(lower) || 0) + 1);
            if (!this.originalCase.has(lower)) {
                this.originalCase.set(lower, name);
            }
        }

        if (counts.size > 0) {
            this.fileIndex.set(file.path, counts);
        } else {
            this.fileIndex.delete(file.path);
        }
    }

    private aggregate(): MentionInfo[] {
        if (!this.aggregateDirty) return this.aggregated;

        const totals = new Map<string, number>();
        for (const counts of this.fileIndex.values()) {
            for (const [lower, count] of counts) {
                totals.set(lower, (totals.get(lower) || 0) + count);
            }
        }

        this.aggregated = Array.from(totals.entries())
            .map(([lower, count]) => ({
                name: this.originalCase.get(lower) || lower,
                count,
            }))
            .sort((a, b) => b.count - a.count);
        this.aggregateDirty = false;
        return this.aggregated;
    }
}
