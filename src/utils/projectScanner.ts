import { App, TFile } from "obsidian";
import { getTaskFiles, TaskFile } from "./tagScanner";

/** _index.md frontmatter 里标记“这是一个项目”的字段 */
export const PROJECT_MARKER = "task-filter-project";
/** 项目文件夹内的索引笔记文件名（不含扩展名） */
export const PROJECT_INDEX_BASENAME = "_index";

/** 项目状态选项（按生命周期顺序） */
export const PROJECT_STATUSES = ["规划中", "进行中", "已完成", "已归档"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectMeta {
    id: string | null;
    name: string;
    icon: string;
    status: string;
    start: string | null;
    due: string | null;
    description: string;
}

/** 生成一个简短的随机项目 ID，如 K3M7QX2A */
export function generateProjectId(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混字符 I O 0 1
    let id = "";
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (const b of bytes) id += alphabet[b % alphabet.length];
    return id;
}

export interface Project {
    /** 项目文件夹路径，如 Projects/网站改版 */
    folderPath: string;
    /** 项目索引笔记 _index.md */
    indexFile: TFile;
    meta: ProjectMeta;
    /** 项目下 #task 文件总数 */
    taskTotal: number;
    /** 其中已完成的数量 */
    taskDone: number;
    tasks: TaskFile[];
}

/** 去掉首尾斜杠 */
export function normalizeFolder(folder: string): string {
    return folder.trim().replace(/^\/+|\/+$/g, "");
}

/** frontmatter 里日期可能是字符串或被 YAML 解析成 Date，统一转成 YYYY-MM-DD 文本 */
function toDateText(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return null;
}

function readMeta(fm: Record<string, unknown>, folderName: string): ProjectMeta {
    const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : folderName;
    const icon = typeof fm.icon === "string" && fm.icon.trim() ? fm.icon.trim() : "📁";
    const status = typeof fm.status === "string" && fm.status.trim() ? fm.status.trim() : "进行中";
    return {
        id: typeof fm.id === "string" && fm.id.trim() ? fm.id.trim() : null,
        name,
        icon,
        status,
        start: toDateText(fm.start),
        due: toDateText(fm.due),
        description: typeof fm.description === "string" ? fm.description : "",
    };
}

/** 判断一个任务文件是否算“已完成” */
export function isTaskDone(task: TaskFile): boolean {
    const s = (task.status || "").toLowerCase();
    if (s === "done" || s === "completed" || s === "x") return true;
    if (task.status === "已完成") return true;
    if (task.completion === 100) return true;
    return !!task.completedDate;
}

/**
 * 扫描 vault，返回所有被标记为项目的文件夹（_index.md 带 task-filter-project: true）。
 * rootFolder 为空时扫描全库；非空时只取该目录下的项目。
 */
export async function getProjects(app: App, rootFolder: string): Promise<Project[]> {
    const root = normalizeFolder(rootFolder);
    const rootPrefix = root ? `${root}/` : "";

    const indexFiles = app.vault.getMarkdownFiles().filter((file) => {
        if (file.basename !== PROJECT_INDEX_BASENAME) return false;
        if (rootPrefix && !file.path.startsWith(rootPrefix)) return false;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        return fm?.[PROJECT_MARKER] === true;
    });

    if (indexFiles.length === 0) return [];

    const allTasks = await getTaskFiles(app);

    const projects: Project[] = indexFiles.map((indexFile) => {
        const folderPath = indexFile.parent?.path ?? "";
        const folderName = indexFile.parent?.name ?? folderPath;
        const fm = (app.metadataCache.getFileCache(indexFile)?.frontmatter ?? {}) as Record<string, unknown>;
        const meta = readMeta(fm, folderName);

        const tasks = allTasks.filter((t) => t.file.path.startsWith(`${folderPath}/`));
        const taskDone = tasks.filter(isTaskDone).length;

        return {
            folderPath,
            indexFile,
            meta,
            tasks,
            taskTotal: tasks.length,
            taskDone,
        };
    });

    // 已归档排在最后，其余按名称排序
    return projects.sort((a, b) => {
        const aArchived = a.meta.status === "已归档" ? 1 : 0;
        const bArchived = b.meta.status === "已归档" ? 1 : 0;
        if (aArchived !== bArchived) return aArchived - bArchived;
        return a.meta.name.localeCompare(b.meta.name, "zh-CN");
    });
}

/** 任务按状态分桶（用于概览统计） */
export function bucketTasksByStatus(tasks: TaskFile[]): {
    open: TaskFile[];
    inProgress: TaskFile[];
    done: TaskFile[];
} {
    const open: TaskFile[] = [];
    const inProgress: TaskFile[] = [];
    const done: TaskFile[] = [];
    for (const t of tasks) {
        if (isTaskDone(t)) {
            done.push(t);
            continue;
        }
        const s = (t.status || "").toLowerCase();
        if (s === "in-progress" || s === "doing" || t.status === "进行中") {
            inProgress.push(t);
        } else {
            open.push(t);
        }
    }
    return { open, inProgress, done };
}
