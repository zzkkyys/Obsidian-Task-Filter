import { App, ItemView, WorkspaceLeaf, TFile, Menu, Modal, Setting, Notice, setIcon } from "obsidian";
import { DayTimelineSection } from "./DayTimelineSection";

// 自定义通知，支持emoji和样式
function showTaskNotice(msg: string, emoji: string) {
    const n = new Notice("", 2200);
    const el = (n as any).noticeEl as HTMLElement | undefined;
    if (!el) {
        new Notice(`${emoji} ${msg}`);
        return;
    }

    el.classList.add("my-task-notice");
    // 强制移除 Obsidian 默认背景
    el.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    el.style.border = "none";
    el.style.boxShadow = "0 4px 15px rgba(102, 126, 234, 0.4)";
    el.style.borderRadius = "10px";
    el.style.color = "#fff";
    el.style.fontWeight = "600";
    el.style.padding = "12px 20px";

    // 同时设置外层 .notice 父容器的背景为透明
    const parentNotice = el.closest(".notice") as HTMLElement | null;
    if (parentNotice) {
        parentNotice.style.background = "transparent";
        parentNotice.style.border = "none";
        parentNotice.style.boxShadow = "none";
        parentNotice.style.padding = "0";
    }

    while (el.firstChild) el.removeChild(el.firstChild);
    const emojiEl = document.createElement("span");
    emojiEl.className = "emoji";
    emojiEl.textContent = emoji;
    const textEl = document.createElement("span");
    textEl.textContent = msg;
    el.append(emojiEl, textEl);
}
// 简单金额输入模态框
class MoneyInputModal extends Modal {
    onSubmit: (value: string) => void;
    suggested: string;
    constructor(app: App, suggested: string, onSubmit: (value: string) => void) {
        super(app);
        this.suggested = suggested;
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "请输入报销金额" });
        let value = this.suggested;
        const input = contentEl.createEl("input", { type: "number", value: this.suggested, attr: { step: "0.01", min: "0" } });
        input.addEventListener("input", () => { value = input.value; });
        new Setting(contentEl)
            .addButton(btn => btn.setButtonText("确定").setCta().onClick(() => {
                if (value && !isNaN(Number(value))) {
                    this.close();
                    this.onSubmit(value);
                }
            }))
            .addExtraButton(btn => btn.setIcon("cross").setTooltip("取消").onClick(() => this.close()));
        input.focus();
        input.select();
    }
}

// 简单标签输入模态框
class TagInputModal extends Modal {
    onSubmit: (value: string) => void;
    constructor(app: App, onSubmit: (value: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "自定义输入标签" });
        contentEl.createEl("p", { text: "示例：#food 或 #project/alpha" });

        let value = "";
        const input = contentEl.createEl("input", {
            type: "text",
            attr: { placeholder: "#tag 或 #a/b/c" },
        });
        input.addEventListener("input", () => {
            value = input.value;
        });

        new Setting(contentEl)
            .addButton(btn => btn.setButtonText("确定").setCta().onClick(() => {
                const v = value.trim();
                if (v) {
                    this.close();
                    this.onSubmit(v);
                }
            }))
            .addExtraButton(btn => btn.setIcon("cross").setTooltip("取消").onClick(() => this.close()));

        input.focus();
    }
}

// 简单创建任务模态框
class TaskCreateModal extends Modal {
    onSubmit: (title: string, priority: string, scheduled: string, due: string) => void;
    project: string;

    constructor(app: App, project: string, onSubmit: (title: string, priority: string, scheduled: string, due: string) => void) {
        super(app);
        this.project = project;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: `在「${this.project}」中创建新任务` });

        let title = "";
        let priority = "normal";

        // 标题输入
        new Setting(contentEl)
            .setName("任务标题")
            .addText(text => text
                .setPlaceholder("输入任务名称...")
                .onChange(value => { title = value; }));

        // 优先级选择
        new Setting(contentEl)
            .setName("优先级")
            .addDropdown(drop => drop
                .addOption("high", "🔴 高")
                .addOption("medium", "🟡 中")
                .addOption("low", "🟢 低")
                .addOption("normal", "⚪ 普通")
                .setValue("normal")
                .onChange(value => { priority = value; }));

        // 计划开始时间 (scheduled)
        let scheduled = "";
        new Setting(contentEl)
            .setName("计划开始日期")
            .addText(text => text
                .setPlaceholder("YYYY-MM-DD")
                .onChange(value => { scheduled = value; }));

        // 截止时间 (due)
        let due = "";
        new Setting(contentEl)
            .setName("截止日期")
            .addText(text => text
                .setPlaceholder("YYYY-MM-DD")
                .onChange(value => { due = value; }));

        // 按钮
        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("创建任务")
                .setCta()
                .onClick(() => {
                    if (title.trim()) {
                        this.close();
                        this.onSubmit(title.trim(), priority, scheduled.trim(), due.trim());
                    } else {
                        new Notice("请输入任务标题");
                    }
                }))
            .addExtraButton(btn => btn
                .setIcon("cross")
                .setTooltip("取消")
                .onClick(() => this.close()));
    }
}
import type TaskFilterPlugin from "../main";
import { getTaskFiles, filterTaskFilesByTags, TaskFile } from "../utils/tagScanner";

export const TASK_RESULT_VIEW_TYPE = "task-result-view";

type ViewMode = "list" | "kanban" | "project" | "today" | "focus" | "timeline";
type SortMode = "due" | "priority" | "title" | "created";

type TagTreeNode = {
    label: string;
    fullTag: string | null;
    children: Map<string, TagTreeNode>;
};

// 状态列定义
const STATUS_COLUMNS = [
    { key: "open", label: "Open", icon: "📋" },
    { key: "in-progress", label: "In Progress", icon: "🔄" },
    { key: "done", label: "Done", icon: "✅" },
    { key: "none", label: "未设置", icon: "⬜" },
];

// 优先级权重（用于排序）
const PRIORITY_WEIGHT: Record<string, number> = {
    "high": 0,
    "medium": 1,
    "low": 2,
    "normal": 3,
    "": 4,
};

export class TaskResultView extends ItemView {
    plugin: TaskFilterPlugin;
    private selectedTags: string[] = [];
    private taskFiles: TaskFile[] = [];
    private allTaskTags: string[] = [];
    private viewMode: ViewMode = "list";
    private sortMode: SortMode = "due";
    private hideDone: boolean = true;
    private focusedTasks: Set<string> = new Set();
    private subtaskCache: Map<string, { content: string, line: number, status: string }[]> = new Map();
    private resizeDebounceTimer: number | null = null;
    private resizeListenerRegistered: boolean = false;
    private projectFolderByName: Map<string, string> = new Map();
    private inferredProjectRoot: string | null = null;
    private dayTimelineSection: DayTimelineSection | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: TaskFilterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return TASK_RESULT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "任务列表";
    }

    getIcon(): string {
        return "check-square";
    }

    async onOpen(): Promise<void> {
        if (!this.resizeListenerRegistered) {
            this.registerDomEvent(window, "resize", this.handleWindowResize);
            this.resizeListenerRegistered = true;
        }
        await this.refresh();
    }

    async onClose(): Promise<void> {
        if (this.resizeDebounceTimer !== null) {
            window.clearTimeout(this.resizeDebounceTimer);
            this.resizeDebounceTimer = null;
        }
        this.resizeListenerRegistered = false;
    }

    async setSelectedTags(tags: string[]): Promise<void> {
        this.selectedTags = tags;
        await this.refresh();
    }

    async refresh(): Promise<void> {
        // 获取所有 #task 文件
        const allTaskFiles = await getTaskFiles(this.app);

        // 缓存“所有任务标签”（用于右键菜单二级列表）
        this.allTaskTags = this.collectAllTaskTags(allTaskFiles);

        // 根据选中的标签进行过滤
        let filtered = filterTaskFilesByTags(allTaskFiles, this.selectedTags);

        // 隐藏已完成任务
        if (this.hideDone) {
            filtered = filtered.filter(t => this.normalizeStatus(t.status) !== "done");
        }

        // 今日视图：只显示今天到期的任务
        if (this.viewMode === "today") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            filtered = filtered.filter(t => {
                if (!t.due) return false;
                const due = new Date(t.due);
                due.setHours(0, 0, 0, 0);
                return due.getTime() === today.getTime();
            });
        }

        // 排序
        this.taskFiles = this.sortTasks(filtered);
        this.render();
    }

    private getPinnedProjects(): Set<string> {
        return new Set(
            (this.plugin.settings.pinnedProjects ?? [])
                .map(project => project.trim())
                .filter(project => project.length > 0)
        );
    }

    private async toggleProjectPinned(project: string): Promise<void> {
        try {
            const pinned = this.getPinnedProjects();
            if (pinned.has(project)) {
                pinned.delete(project);
            } else {
                pinned.add(project);
            }
            this.plugin.settings.pinnedProjects = Array.from(pinned).sort((a, b) => a.localeCompare(b, "zh-CN"));
            await this.plugin.saveSettings();
        } catch (error) {
            console.error("Failed to update pinned projects:", error);
            new Notice("保存固定项目失败");
        }
    }

    private saveProjectViewPreference(key: "projectViewMasonry" | "projectViewPinnedOnly", value: boolean): void {
        this.plugin.settings[key] = value;
        this.plugin.saveSettings().catch(error => {
            console.error("Failed to save project view preference:", error);
            new Notice("保存项目视图设置失败");
        });
    }

    private handleWindowResize = (): void => {
        if (this.resizeDebounceTimer !== null) {
            window.clearTimeout(this.resizeDebounceTimer);
        }
        this.resizeDebounceTimer = window.setTimeout(() => {
            this.resizeDebounceTimer = null;
            if (this.viewMode === "project" && this.plugin.settings.projectViewMasonry) {
                this.render();
            }
        }, 120);
    };

    private renderProjectPinButtonIcon(buttonEl: HTMLButtonElement, pinned: boolean): void {
        buttonEl.empty();
        setIcon(buttonEl, "pin");

        const svg = buttonEl.querySelector("svg");
        if (svg) {
            const icon = svg as SVGElement;
            icon.style.width = "13px";
            icon.style.height = "13px";
            icon.style.transform = pinned ? "rotate(-24deg)" : "rotate(-44deg)";
            icon.style.opacity = pinned ? "1" : "0.8";
            return;
        }

        // Fallback: 如果 icon id 不可用，退回 emoji 显示
        buttonEl.setText(pinned ? "📌" : "📍");
        buttonEl.style.fontSize = "12px";
    }

    private styleProjectPinButton(buttonEl: HTMLButtonElement, pinned: boolean): void {
        buttonEl.style.borderRadius = "8px";
        buttonEl.style.width = "24px";
        buttonEl.style.height = "24px";
        buttonEl.style.display = "inline-flex";
        buttonEl.style.alignItems = "center";
        buttonEl.style.justifyContent = "center";
        buttonEl.style.cursor = "pointer";
        buttonEl.style.padding = "0";
        buttonEl.style.transition = "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease";

        const applyVisual = (hover: boolean): void => {
            if (pinned) {
                buttonEl.style.color = "var(--text-on-accent)";
                buttonEl.style.backgroundColor = hover ? "var(--interactive-accent-hover)" : "var(--interactive-accent)";
                buttonEl.style.border = "1px solid var(--interactive-accent)";
                buttonEl.style.boxShadow = "0 1px 4px rgba(0, 0, 0, 0.18)";
            } else {
                buttonEl.style.color = hover ? "var(--text-normal)" : "var(--text-muted)";
                buttonEl.style.backgroundColor = hover ? "var(--background-modifier-hover)" : "var(--background-primary)";
                buttonEl.style.border = "1px solid var(--background-modifier-border)";
                buttonEl.style.boxShadow = "none";
            }
        };

        applyVisual(false);
        buttonEl.addEventListener("mouseenter", () => applyVisual(true));
        buttonEl.addEventListener("mouseleave", () => applyVisual(false));
    }

    private getProjectMasonryMaxColumns(): number {
        const raw = this.plugin.settings.projectViewMasonryMaxColumns;
        if (typeof raw !== "number" || !Number.isFinite(raw)) return 4;
        return Math.min(8, Math.max(1, Math.round(raw)));
    }

    private getProjectMasonryColumnWidthRange(): { min: number; max: number } {
        const minRaw = this.plugin.settings.projectViewMasonryMinColumnWidth;
        const maxRaw = this.plugin.settings.projectViewMasonryMaxColumnWidth;

        const min = (typeof minRaw === "number" && Number.isFinite(minRaw))
            ? Math.min(360, Math.max(160, Math.round(minRaw)))
            : 220;
        let max = (typeof maxRaw === "number" && Number.isFinite(maxRaw))
            ? Math.min(520, Math.max(220, Math.round(maxRaw)))
            : 340;

        if (max < min) max = min;
        return { min, max };
    }

    private getParentFolder(path: string): string {
        const idx = path.lastIndexOf("/");
        if (idx === -1) return "";
        return path.slice(0, idx);
    }

    private joinPath(...parts: string[]): string {
        return parts
            .map(part => part.trim().replace(/^\/+|\/+$/g, ""))
            .filter(part => part.length > 0)
            .join("/");
    }

    private async ensureFolderExists(folderPath: string): Promise<void> {
        const normalized = folderPath.trim().replace(/^\/+|\/+$/g, "");
        if (!normalized) return;

        const segments = normalized.split("/").filter(Boolean);
        let current = "";
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    private rebuildProjectFolderMappings(tasksByProject: Map<string, TaskFile[]>): void {
        this.projectFolderByName.clear();
        const rootCount = new Map<string, number>();

        for (const [project, tasks] of tasksByProject.entries()) {
            if (project === "未分类" || tasks.length === 0) continue;

            const folderCount = new Map<string, number>();
            for (const task of tasks) {
                const parentFolder = this.getParentFolder(task.file.path);
                if (!parentFolder) continue;
                folderCount.set(parentFolder, (folderCount.get(parentFolder) ?? 0) + 1);
            }

            const bestFolder = Array.from(folderCount.entries())
                .sort((a, b) => b[1] - a[1])[0]?.[0];
            if (!bestFolder) continue;

            this.projectFolderByName.set(project, bestFolder);
            const rootFolder = this.getParentFolder(bestFolder);
            if (rootFolder) {
                rootCount.set(rootFolder, (rootCount.get(rootFolder) ?? 0) + 1);
            }
        }

        const inferredRoot = Array.from(rootCount.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        if (inferredRoot) {
            this.inferredProjectRoot = inferredRoot;
            return;
        }

        const unclassifiedTasks = tasksByProject.get("未分类") ?? [];
        const unclassifiedFolder = unclassifiedTasks
            .map(task => this.getParentFolder(task.file.path))
            .find(folder => folder.length > 0);
        this.inferredProjectRoot = unclassifiedFolder ?? this.inferredProjectRoot;
    }

    private resolveProjectFolderPath(project: string, sourceFile?: TFile): string {
        if (project === "未分类") {
            if (this.inferredProjectRoot) return this.inferredProjectRoot;
            if (!sourceFile) return "";
            const sourceParent = this.getParentFolder(sourceFile.path);
            return this.getParentFolder(sourceParent);
        }

        const knownFolder = this.projectFolderByName.get(project);
        if (knownFolder) return knownFolder;

        if (this.inferredProjectRoot) {
            return this.joinPath(this.inferredProjectRoot, project);
        }

        if (sourceFile) {
            const sourceParent = this.getParentFolder(sourceFile.path);
            const sourceRoot = this.getParentFolder(sourceParent);
            if (sourceRoot) return this.joinPath(sourceRoot, project);
        }

        return this.joinPath(project);
    }

    private collectAllTaskTags(taskFiles: TaskFile[]): string[] {
        const tagOriginal = new Map<string, string>();
        for (const tf of taskFiles) {
            for (const tag of tf.tags) {
                const lower = tag.toLowerCase();
                if (lower === "#task") continue;
                if (!tagOriginal.has(lower)) tagOriginal.set(lower, tag);
            }
        }
        return Array.from(tagOriginal.values()).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
    }

    private normalizeTagForCompare(tag: string): string {
        const t = tag.trim();
        const noHash = t.startsWith("#") ? t.slice(1) : t;
        return noHash.toLowerCase();
    }

    private buildTagTree(tags: string[]): TagTreeNode {
        const root: TagTreeNode = { label: "", fullTag: null, children: new Map() };
        for (const originalTag of tags) {
            const raw = originalTag.startsWith("#") ? originalTag.slice(1) : originalTag;
            const parts = raw.split("/").filter((p): p is string => p.length > 0);
            if (parts.length === 0) continue;

            let node = root;
            for (const part of parts) {
                const existing = node.children.get(part);
                const child: TagTreeNode = existing ?? { label: part, fullTag: null, children: new Map() };
                if (!existing) node.children.set(part, child);
                node = child;
            }

            // 叶子节点代表完整 tag
            node.fullTag = originalTag;
        }
        return root;
    }

    private sortTasks(tasks: TaskFile[]): TaskFile[] {
        return [...tasks].sort((a, b) => {
            switch (this.sortMode) {
                case "due":
                    // 无到期日期的放后面
                    if (!a.due && !b.due) return 0;
                    if (!a.due) return 1;
                    if (!b.due) return -1;
                    return new Date(a.due).getTime() - new Date(b.due).getTime();
                case "priority":
                    const pa = PRIORITY_WEIGHT[a.priority.toLowerCase()] ?? 4;
                    const pb = PRIORITY_WEIGHT[b.priority.toLowerCase()] ?? 4;
                    return pa - pb;
                case "title":
                    return a.title.localeCompare(b.title);
                case "created":
                    if (!a.dateCreated && !b.dateCreated) return 0;
                    if (!a.dateCreated) return 1;
                    if (!b.dateCreated) return -1;
                    return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
                default:
                    return 0;
            }
        });
    }

    private render(): void {
        const container = this.contentEl;
        container.empty();

        // 创建主容器
        const mainContainer = container.createEl("div", {
            cls: "task-result-container",
        });

        // 头部信息
        const headerEl = mainContainer.createEl("div", {
            cls: "task-result-header",
        });

        headerEl.createEl("h4", { text: this.viewMode === "timeline" ? "当天时间线" : "任务文件列表" });

        // 视图切换按钮组
        const viewToggleEl = headerEl.createEl("div", {
            cls: "task-view-toggle",
        });

        const listBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "list" ? "is-active" : ""}`,
            attr: { "aria-label": "列表视图" },
        });
        listBtn.innerHTML = "📝";
        listBtn.addEventListener("click", () => {
            this.viewMode = "list";
            this.refresh();
        });

        const kanbanBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "kanban" ? "is-active" : ""}`,
            attr: { "aria-label": "看板视图" },
        });
        kanbanBtn.innerHTML = "📊";
        kanbanBtn.addEventListener("click", () => {
            this.viewMode = "kanban";
            this.refresh();
        });

        const projectBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "project" ? "is-active" : ""}`,
            attr: { "aria-label": "项目视图" },
        });
        projectBtn.innerHTML = "📁";
        projectBtn.addEventListener("click", () => {
            this.viewMode = "project";
            this.refresh();
        });

        const todayBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "today" ? "is-active" : ""}`,
            attr: { "aria-label": "今日任务" },
        });
        todayBtn.innerHTML = "📅";
        todayBtn.addEventListener("click", () => {
            this.viewMode = "today";
            this.refresh();
        });

        const focusBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "focus" ? "is-active" : ""}`,
            attr: { "aria-label": "专注视图" },
        });
        focusBtn.innerHTML = "🔭";
        focusBtn.addEventListener("click", () => {
            this.viewMode = "focus";
            this.refresh();
        });

        const timelineBtn = viewToggleEl.createEl("button", {
            cls: `task-view-btn ${this.viewMode === "timeline" ? "is-active" : ""}`,
            attr: { "aria-label": "当天时间线" },
        });
        timelineBtn.innerHTML = "🕒";
        timelineBtn.addEventListener("click", () => {
            this.viewMode = "timeline";
            this.refresh();
        });

        const refreshBtn = headerEl.createEl("button", {
            cls: "task-result-refresh-btn",
            attr: { "aria-label": "刷新" },
        });
        refreshBtn.innerHTML = "🔄";
        refreshBtn.addEventListener("click", () => this.refresh());

        // 当天时间线视图：不需要任务工具栏，直接渲染
        if (this.viewMode === "timeline") {
            if (!this.dayTimelineSection) {
                this.dayTimelineSection = new DayTimelineSection(this.plugin, this);
            }
            const timelineContainer = mainContainer.createEl("div", {
                cls: "day-timeline-container",
            });
            this.dayTimelineSection.render(timelineContainer);
            return;
        }

        // 工具栏：排序和过滤选项
        const toolbarEl = mainContainer.createEl("div", {
            cls: "task-result-toolbar",
        });

        // 排序下拉
        const sortEl = toolbarEl.createEl("div", { cls: "task-toolbar-item" });
        sortEl.createEl("span", { text: "排序: ", cls: "task-toolbar-label" });
        const sortSelect = sortEl.createEl("select", { cls: "task-toolbar-select" });
        const sortOptions = [
            { value: "due", label: "到期时间" },
            { value: "priority", label: "优先级" },
            { value: "title", label: "标题" },
            { value: "created", label: "创建时间" },
        ];
        for (const opt of sortOptions) {
            const option = sortSelect.createEl("option", { value: opt.value, text: opt.label });
            if (opt.value === this.sortMode) option.selected = true;
        }
        sortSelect.addEventListener("change", () => {
            this.sortMode = sortSelect.value as SortMode;
            this.refresh();
        });

        // 隐藏已完成开关
        const hideEl = toolbarEl.createEl("label", { cls: "task-toolbar-item task-toolbar-checkbox" });
        const hideCheckbox = hideEl.createEl("input", { type: "checkbox" });
        hideCheckbox.checked = this.hideDone;
        hideCheckbox.addEventListener("change", () => {
            this.hideDone = hideCheckbox.checked;
            this.refresh();
        });

        if (this.viewMode === "project") {
            const projectOptionsEl = toolbarEl.createEl("div", {
                cls: "task-toolbar-item task-project-view-options",
            });
            projectOptionsEl.style.marginLeft = "auto";
            projectOptionsEl.style.gap = "12px";

            const masonryLabel = projectOptionsEl.createEl("label", {
                cls: "task-toolbar-mini-checkbox",
            });
            masonryLabel.style.display = "inline-flex";
            masonryLabel.style.alignItems = "center";
            masonryLabel.style.gap = "4px";
            masonryLabel.style.cursor = "pointer";
            const masonryCheckbox = masonryLabel.createEl("input", { type: "checkbox" });
            masonryCheckbox.checked = this.plugin.settings.projectViewMasonry;
            masonryCheckbox.addEventListener("change", () => {
                this.saveProjectViewPreference("projectViewMasonry", masonryCheckbox.checked);
                this.render();
            });
            masonryLabel.createEl("span", { text: "瀑布流" });

            const pinnedOnlyLabel = projectOptionsEl.createEl("label", {
                cls: "task-toolbar-mini-checkbox",
            });
            pinnedOnlyLabel.style.display = "inline-flex";
            pinnedOnlyLabel.style.alignItems = "center";
            pinnedOnlyLabel.style.gap = "4px";
            pinnedOnlyLabel.style.cursor = "pointer";
            const pinnedOnlyCheckbox = pinnedOnlyLabel.createEl("input", { type: "checkbox" });
            pinnedOnlyCheckbox.checked = this.plugin.settings.projectViewPinnedOnly;
            pinnedOnlyCheckbox.addEventListener("change", () => {
                this.saveProjectViewPreference("projectViewPinnedOnly", pinnedOnlyCheckbox.checked);
                this.refresh();
            });
            pinnedOnlyLabel.createEl("span", { text: "仅固定项目" });
        }
        hideEl.createEl("span", { text: "隐藏已完成" });

        // 筛选信息
        const filterInfoEl = mainContainer.createEl("div", {
            cls: "task-result-filter-info",
        });

        if (this.viewMode === "today") {
            const filterP = filterInfoEl.createEl("p");
            filterP.createEl("span", { text: "📅 今日任务", cls: "filter-tag today-tag" });
        } else if (this.selectedTags.length > 0) {
            const filterP = filterInfoEl.createEl("p");
            filterP.createEl("span", { text: "筛选条件: " });
            filterP.createEl("span", { text: "#task", cls: "filter-tag" });
            for (const tag of this.selectedTags) {
                filterP.createEl("span", { text: " + ", cls: "filter-separator" });
                filterP.createEl("span", { text: tag, cls: "filter-tag" });
            }
        } else {
            const filterP = filterInfoEl.createEl("p");
            filterP.createEl("span", { text: "显示所有包含 " });
            filterP.createEl("span", { text: "#task", cls: "filter-tag" });
            filterP.createEl("span", { text: " 的文件" });
        }

        // 统计信息
        const statsEl = mainContainer.createEl("div", {
            cls: "task-result-stats",
        });
        statsEl.createEl("span", {
            text: `找到 ${this.taskFiles.length} 个任务文件`,
        });

        if (this.viewMode === "project") {
            const pinnedCount = this.getPinnedProjects().size;
            if (pinnedCount > 0) {
                const pinnedHint = statsEl.createEl("span", {
                    cls: "task-project-pinned-hint",
                    text: `📌 固定项目 ${pinnedCount} 个`,
                });
                pinnedHint.style.marginLeft = "8px";
                pinnedHint.style.fontSize = "12px";
                pinnedHint.style.color = "var(--text-accent)";
            }
        }

        // 列表/看板视图：显示未完成任务的金额汇总
        if (this.viewMode === "list" || this.viewMode === "kanban") {
            const moneySum = this.taskFiles
                .filter(t => this.normalizeStatus(t.status) !== "done" && typeof t.money === "number" && t.money > 0)
                .reduce((sum, t) => sum + (t.money ?? 0), 0);
            if (moneySum > 0) {
                statsEl.createEl("div", {
                    cls: "task-money-summary",
                    text: `💰待报销合计: ￥${moneySum.toFixed(2)}`,
                });
            }
        }

        // 根据视图模式渲染
        // 根据视图模式渲染
        if (this.viewMode === "kanban") {
            this.renderKanbanView(mainContainer);
        } else if (this.viewMode === "project") {
            this.renderProjectView(mainContainer);
        } else if (this.viewMode === "today") {
            this.renderListView(mainContainer);
        } else if (this.viewMode === "focus") {
            this.renderFocusView(mainContainer);
        } else {
            this.renderListView(mainContainer);
        }
    }

    private renderListView(mainContainer: HTMLElement): void {
        const taskListEl = mainContainer.createEl("div", {
            cls: "task-result-list",
        });

        if (this.taskFiles.length === 0) {
            taskListEl.createEl("p", {
                text: "没有找到匹配的任务文件",
                cls: "task-result-empty",
            });
        } else {
            for (const taskFile of this.taskFiles) {
                this.renderTaskCard(taskListEl, taskFile);
            }
        }
    }

    private renderKanbanView(mainContainer: HTMLElement): void {
        const kanbanEl = mainContainer.createEl("div", {
            cls: "task-kanban",
        });

        // 按状态分组
        const tasksByStatus = new Map<string, TaskFile[]>();
        for (const col of STATUS_COLUMNS) {
            tasksByStatus.set(col.key, []);
        }

        for (const taskFile of this.taskFiles) {
            const status = this.normalizeStatus(taskFile.status);
            const tasks = tasksByStatus.get(status) || tasksByStatus.get("none")!;
            tasks.push(taskFile);
        }

        // 渲染每列
        for (const col of STATUS_COLUMNS) {
            const tasks = tasksByStatus.get(col.key) || [];

            const columnEl = kanbanEl.createEl("div", {
                cls: `task-kanban-column kanban-status-${col.key}`,
            });

            // 列头
            const columnHeaderEl = columnEl.createEl("div", {
                cls: "task-kanban-column-header",
            });
            columnHeaderEl.createEl("span", {
                text: `${col.icon} ${col.label}`,
                cls: "task-kanban-column-title",
            });
            columnHeaderEl.createEl("span", {
                text: `(${tasks.length})`,
                cls: "task-kanban-column-count",
            });

            // 列内容
            const columnContentEl = columnEl.createEl("div", {
                cls: "task-kanban-column-content",
            });

            // 添加拖放功能
            this.setupDropZone(columnContentEl, col.key, "status");

            if (tasks.length === 0) {
                columnContentEl.createEl("p", {
                    text: "暂无任务",
                    cls: "task-kanban-empty",
                });
            } else {
                for (const taskFile of tasks) {
                    this.renderTaskCard(columnContentEl, taskFile, true);
                }
            }
        }
    }

    private renderProjectView(mainContainer: HTMLElement): void {
        const isMasonry = this.plugin.settings.projectViewMasonry;
        const pinnedOnly = this.plugin.settings.projectViewPinnedOnly;
        const pinnedProjects = this.getPinnedProjects();
        const maxColumns = this.getProjectMasonryMaxColumns();
        const columnWidthRange = this.getProjectMasonryColumnWidthRange();

        const kanbanEl = mainContainer.createEl("div", {
            cls: `task-kanban task-project-kanban ${isMasonry ? "is-masonry" : ""}`,
        });
        if (isMasonry) {
            kanbanEl.style.display = "flex";
            kanbanEl.style.flexDirection = "column";
            kanbanEl.style.gap = "16px";
            kanbanEl.style.overflowX = "visible";
            kanbanEl.style.overflowY = "visible";
            kanbanEl.style.maxHeight = "none";
        }

        // 按项目分组
        const tasksByProject = new Map<string, TaskFile[]>();
        tasksByProject.set("未分类", []);  // 默认分类

        for (const taskFile of this.taskFiles) {
            if (taskFile.projects && taskFile.projects.length > 0) {
                // 任务可能属于多个项目，这里放到第一个项目中
                const project = taskFile.projects[0] || "未分类";
                if (!tasksByProject.has(project)) {
                    tasksByProject.set(project, []);
                }
                tasksByProject.get(project)!.push(taskFile);
            } else {
                tasksByProject.get("未分类")!.push(taskFile);
            }
        }

        // 根据当前看板数据推断每个项目对应的实际文件夹路径
        this.rebuildProjectFolderMappings(tasksByProject);

        // 对项目名排序（固定项目优先，未分类放最后）
        const sortedProjects = Array.from(tasksByProject.keys()).sort((a, b) => {
            const aPinned = pinnedProjects.has(a);
            const bPinned = pinnedProjects.has(b);
            if (aPinned !== bPinned) return aPinned ? -1 : 1;
            if (a === "未分类") return 1;
            if (b === "未分类") return -1;
            return a.localeCompare(b, "zh-CN");
        });

        const projectsToRender = pinnedOnly
            ? sortedProjects.filter(project => pinnedProjects.has(project))
            : sortedProjects;

        const visibleProjectsToRender = projectsToRender.filter(project => {
            const tasks = tasksByProject.get(project);
            if (!tasks) return false;
            return !(project === "未分类" && tasks.length === 0);
        });

        const pinnedProjectsToRender = visibleProjectsToRender.filter(project => pinnedProjects.has(project));
        const normalProjectsToRender = visibleProjectsToRender.filter(project => !pinnedProjects.has(project));

        let masonryColumnEls: HTMLElement[] = [];
        let masonryColumnHeights: number[] = [];
        if (isMasonry) {
            const minColumnWidth = columnWidthRange.min;
            const maxColumnWidth = columnWidthRange.max;
            const columnGap = 16;
            // 用实际瀑布流容器宽度计算列数，避免把外层 padding 算进去导致“只显示半列”
            const measuredWidth = Math.floor(kanbanEl.getBoundingClientRect().width) || kanbanEl.clientWidth;
            const availableWidth = Math.max(minColumnWidth, measuredWidth);
            const maxColumnsByMinWidth = Math.max(1, Math.floor((availableWidth + columnGap) / (minColumnWidth + columnGap)));
            const minColumnsByMaxWidth = Math.max(1, Math.ceil((availableWidth + columnGap) / (maxColumnWidth + columnGap)));
            const widthBasedColumnCount = Math.max(minColumnsByMaxWidth, Math.min(maxColumns, maxColumnsByMinWidth));
            const visibleProjectCount = Math.max(1, visibleProjectsToRender.length);
            const columnCount = Math.max(1, Math.min(widthBasedColumnCount, visibleProjectCount));
            const computedWidth = Math.floor((availableWidth - (columnCount - 1) * columnGap) / columnCount);
            const targetColumnWidth = Math.min(maxColumnWidth, Math.max(minColumnWidth, computedWidth));

            const masonryColumnsEl = kanbanEl.createEl("div", { cls: "task-project-masonry-columns" });
            masonryColumnsEl.style.display = "flex";
            masonryColumnsEl.style.alignItems = "flex-start";
            masonryColumnsEl.style.justifyContent = "flex-start";
            masonryColumnsEl.style.gap = `${columnGap}px`;
            masonryColumnsEl.style.width = "100%";

            masonryColumnEls = Array.from({ length: columnCount }, () => {
                const colEl = masonryColumnsEl.createEl("div", { cls: "task-project-masonry-column" });
                colEl.style.display = "flex";
                colEl.style.flexDirection = "column";
                colEl.style.gap = `${columnGap}px`;
                colEl.style.flex = `0 0 ${targetColumnWidth}px`;
                colEl.style.width = `${targetColumnWidth}px`;
                colEl.style.minWidth = `${minColumnWidth}px`;
                colEl.style.maxWidth = `${maxColumnWidth}px`;
                return colEl;
            });
            masonryColumnHeights = new Array(columnCount).fill(0);
        }

        // 渲染每个项目列
        let renderedColumnCount = 0;

        const renderProjectColumn = (project: string, containerEl: HTMLElement, renderMode: "normal" | "masonry"): void => {
            const tasks = tasksByProject.get(project)!;
            // 如果是未分类且没有任务，跳过
            if (project === "未分类" && tasks.length === 0) return;
            renderedColumnCount++;

            const isPinned = pinnedProjects.has(project);

            // 统计未完成任务的 money 总和
            const moneySum = tasks
                .filter(t => this.normalizeStatus(t.status) !== "done" && typeof t.money === "number" && t.money > 0)
                .reduce((sum, t) => sum + (t.money ?? 0), 0);

            const columnEl = containerEl.createEl("div", {
                cls: `task-kanban-column task-project-column ${isPinned ? "is-pinned" : ""}`,
            });
            if (renderMode === "masonry") {
                columnEl.style.display = "flex";
                // 取消 .task-kanban-column 的 flex-basis(280px)，避免在瀑布流列内被当成“固定高度”
                columnEl.style.flex = "0 0 auto";
                columnEl.style.minWidth = "0";
                columnEl.style.width = "100%";
                columnEl.style.height = "auto";
                columnEl.style.maxHeight = "none";
            }
            if (isPinned) {
                columnEl.style.border = "1px solid var(--interactive-accent)";
                columnEl.style.boxShadow = "0 0 0 1px var(--interactive-accent-hover)";
            }

            // 列头
            const columnHeaderEl = columnEl.createEl("div", {
                cls: "task-kanban-column-header",
            });

            const headerLeftEl = columnHeaderEl.createEl("div", {
                cls: "task-kanban-column-header-left",
            });

            headerLeftEl.createEl("span", {
                text: `📁 ${project}`,
                cls: "task-kanban-column-title",
            });

            // 如果有 money 汇总，显示在项目名下一行
            if (moneySum > 0) {
                headerLeftEl.createEl("div", {
                    text: `💰待报销: ￥${moneySum.toFixed(2)}`,
                    cls: "task-project-money-summary",
                });
            }

            // 右侧容器：按钮 + 计数
            const headerRightEl = columnHeaderEl.createEl("div", {
                cls: "task-kanban-column-header-right",
            });

            const pinBtn = headerRightEl.createEl("button", {
                cls: `task-project-pin-btn ${isPinned ? "is-active" : ""}`,
                attr: {
                    type: "button",
                    "aria-label": isPinned ? "取消固定项目" : "固定项目",
                    title: isPinned ? "取消固定项目" : "固定项目",
                },
            });
            this.renderProjectPinButtonIcon(pinBtn, isPinned);
            this.styleProjectPinButton(pinBtn, isPinned);
            pinBtn.addEventListener("click", async (evt) => {
                evt.stopPropagation();
                await this.toggleProjectPinned(project);
                this.render();
            });

            // 新增：创建任务按钮 (使用 clickable-icon 样式更和谐)
            const addBtn = headerRightEl.createEl("div", {
                cls: "clickable-icon task-project-add-btn",
                attr: { "aria-label": "新建任务", "title": "新建任务" },
            });
            setIcon(addBtn, "plus");
            addBtn.addEventListener("click", (evt) => {
                // 打开创建任务模态框
                new TaskCreateModal(this.app, project, async (title, priority, scheduled, due) => {
                    await this.createNewTask(project, title, priority, scheduled, due);
                }).open();
            });

            headerRightEl.createEl("span", {
                text: `(${tasks.length})`,
                cls: "task-kanban-column-count",
            });

            // 列内容
            const columnContentEl = columnEl.createEl("div", {
                cls: "task-kanban-column-content",
            });
            if (renderMode !== "normal") {
                // 取消 task-kanban-column-content 的 flex:1，避免卡片少时被拉伸
                columnContentEl.style.flex = "0 0 auto";
                columnContentEl.style.maxHeight = "none";
                columnContentEl.style.overflowY = "visible";
            }

            // 添加拖放功能
            this.setupDropZone(columnContentEl, project, "project");

            if (tasks.length === 0) {
                columnContentEl.createEl("p", {
                    text: "暂无任务",
                    cls: "task-kanban-empty",
                });
            } else {
                for (const taskFile of tasks) {
                    this.renderTaskCard(columnContentEl, taskFile, true);
                }
            }
        };

        if (isMasonry) {
            const getShortestColumnIndex = (): number => {
                let minHeight = Number.POSITIVE_INFINITY;
                let minIndex = 0;
                for (let i = 0; i < masonryColumnHeights.length; i++) {
                    const h = masonryColumnHeights[i] ?? 0;
                    if (h < minHeight) {
                        minHeight = h;
                        minIndex = i;
                    }
                }
                return minIndex;
            };

            const appendToColumn = (project: string, columnIndex: number): void => {
                const columnEl = masonryColumnEls[columnIndex];
                if (!columnEl) return;
                renderProjectColumn(project, columnEl, "masonry");
                masonryColumnHeights[columnIndex] = columnEl.offsetHeight;
            };

            if (pinnedOnly) {
                // 仅固定项目模式：把当前可见项目全部重新做瀑布流分配，确保切换后发生重排
                for (const project of visibleProjectsToRender) {
                    const targetIndex = getShortestColumnIndex();
                    appendToColumn(project, targetIndex);
                }
            } else {
                // 固定项目优先放置到每列顶部（按列轮询）
                for (let i = 0; i < pinnedProjectsToRender.length; i++) {
                    const project = pinnedProjectsToRender[i];
                    if (!project) continue;
                    const targetIndex = i % masonryColumnEls.length;
                    appendToColumn(project, targetIndex);
                }

                // 非固定项目继续接在同一组列中，追加到当前最短列
                for (const project of normalProjectsToRender) {
                    const targetIndex = getShortestColumnIndex();
                    appendToColumn(project, targetIndex);
                }
            }
        } else {
            for (const project of projectsToRender) {
                renderProjectColumn(project, kanbanEl, "normal");
            }
        }

        // 如果没有任何项目
        if (renderedColumnCount === 0) {
            kanbanEl.createEl("p", {
                text: pinnedOnly ? "暂无固定项目，请先点击项目列右上角📍进行固定" : "没有找到任何项目",
                cls: "task-kanban-empty",
            });
        }
    }

    private normalizeStatus(status: string): string {
        const s = status.toLowerCase().replace(/\s+/g, "-");
        if (s === "done" || s === "completed") return "done";
        if (s === "in-progress" || s === "inprogress" || s === "in progress") return "in-progress";
        if (s === "open") return "open";
        return "none";
    }

    private renderTaskCard(container: HTMLElement, taskFile: TaskFile, compact = false): void {
        const taskEl = container.createEl("div", {
            cls: `task-result-item task-status-${taskFile.status} task-priority-${taskFile.priority} ${compact ? "is-compact" : ""}`,
        });

        if (this.normalizeStatus(taskFile.status) !== "done" && taskFile.completion !== undefined && taskFile.completion > 0) {
            taskEl.style.backgroundImage = `linear-gradient(90deg, rgba(46, 204, 113, 0.2) ${taskFile.completion}%, transparent ${taskFile.completion}%)`;
        }

        // 启用拖拽
        taskEl.draggable = true;
        taskEl.dataset.taskPath = taskFile.file.path;

        taskEl.addEventListener("dragstart", (e) => {
            e.dataTransfer?.setData("text/plain", taskFile.file.path);
            taskEl.classList.add("is-dragging");
        });

        taskEl.addEventListener("dragend", () => {
            taskEl.classList.remove("is-dragging");
        });

        // 右键菜单
        taskEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.showTaskContextMenu(e, taskFile);
        });

        // 专注模式点击 (Ctrl/Cmd + Click)
        taskEl.addEventListener("click", async (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                const path = taskFile.file.path;
                if (this.focusedTasks.has(path)) {
                    this.focusedTasks.delete(path);
                    showTaskNotice("已移出专注视图", "➖");
                } else {
                    this.focusedTasks.add(path);
                    showTaskNotice("已加入专注视图", "🔭");
                    await this.loadSubtasks(taskFile.file);
                }
                this.refresh();
            }
        });

        // 第一行：复选框 + 标题
        const headerEl = taskEl.createEl("div", {
            cls: "task-result-header-row",
        });

        // 复选框
        const checkbox = headerEl.createEl("input", {
            type: "checkbox",
            cls: "task-result-checkbox",
        });
        checkbox.checked = taskFile.status.toLowerCase() === "done" || taskFile.status.toLowerCase() === "completed";
        checkbox.addEventListener("change", async () => {
            await this.toggleTaskStatus(taskFile.file, checkbox.checked);
        });

        // 文件名（可点击打开）
        const linkEl = headerEl.createEl("a", {
            text: taskFile.title,
            cls: `task-result-link ${checkbox.checked ? "is-done" : ""}`,
        });
        linkEl.addEventListener("click", (e) => {
            e.preventDefault();
            this.app.workspace.openLinkText(taskFile.file.path, "", false);
        });

        // 子任务计数
        if (taskFile.subtaskTotal > 0) {
            headerEl.createEl("span", {
                cls: "task-subtask-count",
                text: `${taskFile.subtaskCompleted}/${taskFile.subtaskTotal}`,
            });
        }



        // 第二行：元数据（状态、优先级、到期时间）
        const metaEl = taskEl.createEl("div", {
            cls: "task-result-meta",
        });

        // 在列表视图显示状态，看板视图不需要（因为已经按状态分列）
        if (!compact) {
            const statusEl = metaEl.createEl("span", {
                cls: `task-meta-item task-meta-status status-${this.normalizeStatus(taskFile.status)}`,
            });
            statusEl.createEl("span", { text: "📋 ", cls: "task-meta-icon" });
            statusEl.createEl("span", { text: taskFile.status });
        }

        // 优先级（只显示图标，hover显示文字）
        const priorityEl = metaEl.createEl("span", {
            cls: `task-meta-item task-meta-priority priority-${taskFile.priority}`,
        });
        priorityEl.setAttribute("title", `优先级: ${taskFile.priority}`);
        const priorityIcon = this.getPriorityIcon(taskFile.priority);
        priorityEl.createEl("span", { text: priorityIcon, cls: "task-meta-icon" });

        // 到期时间 / 完成时间
        const isDone = this.normalizeStatus(taskFile.status) === "done";

        // 显示截止日期
        if (taskFile.due) {
            const daysRemaining = isDone ? null : this.getDaysRemaining(taskFile.due);
            const dueEl = metaEl.createEl("span", {
                cls: `task-meta-item task-meta-due ${isDone ? "" : this.getDueClass(daysRemaining)}`,
            });
            dueEl.createEl("span", { text: "📅 ", cls: "task-meta-icon" });
            dueEl.createEl("span", { text: isDone ? taskFile.due : this.formatDueWithDays(taskFile.due, daysRemaining) });
        }

        // 已完成任务显示完成时间
        if (isDone && taskFile.completedDate) {
            const completedEl = metaEl.createEl("span", {
                cls: "task-meta-item task-meta-completed",
            });
            completedEl.createEl("span", { text: "✅ ", cls: "task-meta-icon" });
            completedEl.createEl("span", { text: taskFile.completedDate });
        }


        // 金额标签
        if (typeof taskFile.money === "number" && taskFile.money > 0) {
            const moneyEl = metaEl.createEl("span", {
                cls: "task-meta-item task-meta-money",
                attr: { title: "报销金额" },
            });
            moneyEl.createEl("span", { text: "💰", cls: "task-meta-icon" });
            moneyEl.createEl("span", { text: `￥${taskFile.money.toFixed(2)}` });
        }

        // 项目
        if (taskFile.projects && taskFile.projects.length > 0) {
            const projectEl = metaEl.createEl("span", {
                cls: "task-meta-item task-meta-project",
            });
            projectEl.createEl("span", { text: "📁 ", cls: "task-meta-icon" });
            projectEl.createEl("span", { text: taskFile.projects.join(", ") });
        }

        // 标签（始终显示）
        const tagsEl = taskEl.createEl("div", {
            cls: `task-result-tags ${compact ? "is-compact" : ""}`,
        });
        for (const tag of taskFile.tags) {
            if (tag.toLowerCase() !== "#task") {
                tagsEl.createEl("span", {
                    text: tag,
                    cls: `task-result-tag ${this.selectedTags.includes(tag.toLowerCase()) ? "is-selected" : ""}`,
                });
            }
        }
    }

    private getPriorityIcon(priority: string): string {
        switch (priority.toLowerCase()) {
            case "high": return "🔴";
            case "medium": return "🟡";
            case "low": return "🟢";
            default: return "⚪";
        }
    }

    private formatDate(dateStr: string): string {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            });
        } catch {
            return dateStr;
        }
    }

    private isDueOverdue(dateStr: string): boolean {
        try {
            const due = new Date(dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return due < today;
        } catch {
            return false;
        }
    }

    private getDaysRemaining(dateStr: string): number | null {
        try {
            const due = new Date(dateStr);
            due.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffTime = due.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays;
        } catch {
            return null;
        }
    }

    private getDueClass(daysRemaining: number | null): string {
        if (daysRemaining === null) return "";
        if (daysRemaining < 0) return "is-overdue";
        if (daysRemaining === 0) return "is-today";
        if (daysRemaining <= 3) return "is-soon";
        return "";
    }

    private formatDueWithDays(dateStr: string, daysRemaining: number | null): string {
        const dateFormatted = this.formatDate(dateStr);
        if (daysRemaining === null) return dateFormatted;

        if (daysRemaining < 0) {
            const overdueDays = Math.abs(daysRemaining);
            return `${dateFormatted} (已过期 ${overdueDays} 天)`;
        } else if (daysRemaining === 0) {
            return `${dateFormatted} (今天)`;
        } else if (daysRemaining === 1) {
            return `${dateFormatted} (明天)`;
        } else {
            return `${dateFormatted} (剩 ${daysRemaining} 天)`;
        }
    }

    private async toggleTaskStatus(file: TFile, isDone: boolean): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            const newStatus = isDone ? "done" : "open";
            let updatedContent = content.replace(
                /^(---\s*\n[\s\S]*?)(status:\s*)([\w-]+)([\s\S]*?---)/m,
                `$1$2${newStatus}$4`
            );

            // 处理 completedDate 字段
            const dateStr = isDone ? this.getCurrentTimestamp() : null;
            const completedDateRegex = /^(---\s*\n[\s\S]*?)(completedDate:\s*)([^\n]+)([\s\S]*?---)/m;
            let noticeMsg = "";
            let emoji = "";
            if (isDone && dateStr) {
                if (completedDateRegex.test(updatedContent)) {
                    updatedContent = updatedContent.replace(completedDateRegex, `$1$2${dateStr}$4`);
                    noticeMsg = `已更新 completedDate: ${dateStr}`;
                    emoji = "✏️📅";
                } else {
                    const frontmatterEnd = updatedContent.indexOf("---", 4);
                    if (frontmatterEnd !== -1) {
                        updatedContent = updatedContent.slice(0, frontmatterEnd) + `completedDate: ${dateStr}\n` + updatedContent.slice(frontmatterEnd);
                        noticeMsg = `已设置 completedDate: ${dateStr}`;
                        emoji = "✅📅";
                    }
                }
            } else {
                if (/^completedDate:\s*[^\n]*\n?/m.test(updatedContent)) {
                    updatedContent = updatedContent.replace(/^completedDate:\s*[^\n]*\n?/m, "");
                    noticeMsg = "已移除 completedDate";
                    emoji = "🗑️";
                }
            }

            // 处理 completion 字段：完成时设为 100，取消完成时移除
            const completionRegex = /^(---\s*\n[\s\S]*?)(completion:\s*)([^\n]+)([\s\S]*?---)/m;
            if (isDone) {
                if (completionRegex.test(updatedContent)) {
                    updatedContent = updatedContent.replace(completionRegex, `$1$2100$4`);
                } else {
                    const frontmatterEnd = updatedContent.indexOf("---", 4);
                    if (frontmatterEnd !== -1) {
                        updatedContent = updatedContent.slice(0, frontmatterEnd) + `completion: 100\n` + updatedContent.slice(frontmatterEnd);
                    }
                }
            } else {
                if (/^completion:\s*[^\n]*\n?/m.test(updatedContent)) {
                    updatedContent = updatedContent.replace(/^completion:\s*[^\n]*\n?/m, "");
                }
            }

            await this.app.vault.modify(file, updatedContent);
            if (noticeMsg) showTaskNotice(noticeMsg, emoji);
            await this.refresh();
        } catch (error) {
            console.error("Failed to update task status:", error);
        }
    }

    // 获取当前时间字符串，格式为YYYY-MM-DD HH:mm:ss
    private getCurrentTimestamp(): string {
        const now = new Date();
        const y = now.getFullYear();
        const m = (now.getMonth() + 1).toString().padStart(2, "0");
        const d = now.getDate().toString().padStart(2, "0");
        const h = now.getHours().toString().padStart(2, "0");
        const min = now.getMinutes().toString().padStart(2, "0");
        const s = now.getSeconds().toString().padStart(2, "0");
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    private showTaskContextMenu(event: MouseEvent, taskFile: TaskFile): void {
        const menu = new Menu();

        // 打开文件
        menu.addItem((item) => {
            item.setTitle("打开文件")
                .setIcon("file")
                .onClick(() => {
                    this.app.workspace.openLinkText(taskFile.file.path, "", false);
                });
        });

        // 在新标签页打开
        menu.addItem((item) => {
            item.setTitle("在新标签页打开")
                .setIcon("file-plus")
                .onClick(() => {
                    this.app.workspace.openLinkText(taskFile.file.path, "", true);
                });
        });

        menu.addSeparator();

        // 状态子菜单
        menu.addItem((item) => {
            item.setTitle("设置状态")
                .setIcon("check-circle");

            const statusSubmenu = (item as any).setSubmenu() as Menu;

            const statuses = [
                { key: "open", label: "🔵 待办", icon: "circle" },
                { key: "in-progress", label: "🟡 进行中", icon: "clock" },
                { key: "done", label: "✅ 已完成", icon: "check" },
            ];

            for (const status of statuses) {
                statusSubmenu.addItem((subItem) => {
                    subItem.setTitle(status.label)
                        .setIcon(status.icon)
                        .onClick(async () => {
                            await this.updateTaskField(taskFile.file, "status", status.key);
                        });
                });
            }
        });

        // 优先级子菜单
        menu.addItem((item) => {
            item.setTitle("设置优先级")
                .setIcon("flag");

            const prioritySubmenu = (item as any).setSubmenu() as Menu;

            const priorities = [
                { key: "high", label: "🔴 高", icon: "arrow-up" },
                { key: "medium", label: "🟡 中", icon: "minus" },
                { key: "low", label: "🟢 低", icon: "arrow-down" },
            ];

            for (const priority of priorities) {
                prioritySubmenu.addItem((subItem) => {
                    subItem.setTitle(priority.label)
                        .setIcon(priority.icon)
                        .onClick(async () => {
                            await this.updateTaskField(taskFile.file, "priority", priority.key);
                        });
                });
            }
        });



        // 完成度子菜单
        if (this.normalizeStatus(taskFile.status) !== "done" && this.normalizeStatus(taskFile.status) !== "completed") {
            menu.addItem((item) => {
                item.setTitle("设置完成度")
                    .setIcon("percent");

                const completionSubmenu = (item as any).setSubmenu() as Menu;

                for (let i = 0; i <= 100; i += 10) {
                    completionSubmenu.addItem((subItem) => {
                        subItem.setTitle(`${i}%`)
                            .onClick(async () => {
                                await this.updateTaskField(taskFile.file, "completion", i);
                            });
                    });
                }
            });
        }

        // 设置到期时间（今天/明天/下周/清除）
        menu.addItem((item) => {
            item.setTitle("设置到期时间")
                .setIcon("calendar");

            const dueSubmenu = (item as any).setSubmenu() as Menu;

            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);

            const formatDateStr = (d: Date): string => {
                const parts = d.toISOString().split("T");
                return parts[0] ?? "";
            };

            dueSubmenu.addItem((subItem) => {
                subItem.setTitle("📅 今天")
                    .onClick(async () => {
                        await this.updateTaskField(taskFile.file, "due", formatDateStr(today));
                    });
            });
            dueSubmenu.addItem((subItem) => {
                subItem.setTitle("📅 明天")
                    .onClick(async () => {
                        await this.updateTaskField(taskFile.file, "due", formatDateStr(tomorrow));
                    });
            });
            dueSubmenu.addItem((subItem) => {
                subItem.setTitle("📅 下周")
                    .onClick(async () => {
                        await this.updateTaskField(taskFile.file, "due", formatDateStr(nextWeek));
                    });
            });
            dueSubmenu.addSeparator();
            dueSubmenu.addItem((subItem) => {
                subItem.setTitle("🚫 清除到期时间")
                    .onClick(async () => {
                        await this.removeTaskField(taskFile.file, "due");
                    });
            });
        });

        // 添加金额
        menu.addItem((item) => {
            item.setTitle("添加金额")
                .setIcon("dollar-sign")
                .onClick(() => {
                    const match = taskFile.title.match(/([0-9]+(?:\.[0-9]+)?)/);
                    const suggested = match?.[1] ?? "";
                    new MoneyInputModal(this.app, suggested, async (input) => {
                        if (input && !isNaN(Number(input))) {
                            await this.updateTaskField(taskFile.file, "money", input);
                        }
                    }).open();
                });
        });

        // 添加标签（二级列表：列出所有任务标签）
        menu.addItem((item) => {
            item.setTitle("添加标签")
                .setIcon("tag");

            const tagSubmenu = (item as any).setSubmenu() as Menu;

            // 顶部：自定义输入
            tagSubmenu.addItem((subItem) => {
                subItem.setTitle("自定义输入…")
                    .setIcon("pencil")
                    .onClick(() => {
                        new TagInputModal(this.app, async (input) => {
                            await this.toggleTagInTask(taskFile.file, input);
                        }).open();
                    });
            });
            tagSubmenu.addSeparator();

            if (this.allTaskTags.length === 0) {
                tagSubmenu.addItem((subItem) => {
                    subItem.setTitle("暂无可用标签").setDisabled(true);
                });
                return;
            }

            const currentTagsNorm = new Set(taskFile.tags.map(t => this.normalizeTagForCompare(t)));
            const tree = this.buildTagTree(this.allTaskTags);
            this.renderTagTreeMenu(tagSubmenu, tree, currentTagsNorm, 0, taskFile.file);
        });

        menu.addSeparator();

        // 快速完成/取消完成
        const isDone = taskFile.status.toLowerCase() === "done" || taskFile.status.toLowerCase() === "completed";
        menu.addItem((item) => {
            item.setTitle(isDone ? "标记为未完成" : "标记为已完成")
                .setIcon(isDone ? "circle" : "check")
                .onClick(async () => {
                    await this.toggleTaskStatus(taskFile.file, !isDone);
                });
        });

        menu.showAtMouseEvent(event);
    }

    private renderTagTreeMenu(
        menu: Menu,
        node: TagTreeNode,
        currentTagsNorm: Set<string>,
        depth: number,
        file: TFile
    ): void {
        const children = Array.from(node.children.values()).sort((a, b) =>
            a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
        );

        for (const child of children) {
            const displayTag = `#${this.getNodePath(node, child)}`;
            const isSelected = currentTagsNorm.has(this.normalizeTagForCompare(displayTag))
                || (child.fullTag ? currentTagsNorm.has(this.normalizeTagForCompare(child.fullTag)) : false);

            const hasChildren = child.children.size > 0;

            if (hasChildren) {
                // 有子级：创建更深层子菜单
                menu.addItem((item) => {
                    item.setTitle(isSelected ? `✓ ${displayTag}` : displayTag)
                        .setIcon("tag");
                    const sub = (item as any).setSubmenu() as Menu;

                    // 如果该节点本身就是一个完整 tag（例如同时存在 #a 和 #a/b）
                    if (child.fullTag) {
                        const selfTag = child.fullTag;
                        const selfSelected = currentTagsNorm.has(this.normalizeTagForCompare(selfTag));
                        sub.addItem((subItem) => {
                            subItem.setTitle(selfSelected ? `删除 ${selfTag}` : `添加 ${selfTag}`)
                                .setIcon(selfSelected ? "trash" : "plus")
                                .onClick(async () => {
                                    await this.toggleTagInTask(file, selfTag);
                                });
                        });
                        sub.addSeparator();
                    }

                    this.renderTagTreeMenu(sub, child, currentTagsNorm, depth + 1, file);
                });
            } else {
                // 叶子：点击切换（添加/删除）
                const leafTag = child.fullTag ?? displayTag;
                const leafSelected = currentTagsNorm.has(this.normalizeTagForCompare(leafTag));
                menu.addItem((item) => {
                    item.setTitle(leafSelected ? `✓ ${leafTag}` : leafTag)
                        .setIcon(leafSelected ? "trash" : "plus")
                        .onClick(async () => {
                            await this.toggleTagInTask(file, leafTag);
                        });
                });
            }
        }
    }

    private getNodePath(parent: TagTreeNode, child: TagTreeNode): string {
        // 通过 fullTag 还原路径不可靠；这里按 label 递归拼接
        // 由于渲染时只需要当前层级的 path，使用 parentLabelPath 缓存方式更复杂。
        // 简化：根据 child.fullTag 或子树中任意 fullTag 推断。
        const anyTag = child.fullTag ?? this.findAnyFullTag(child);
        if (anyTag) {
            const raw = anyTag.startsWith("#") ? anyTag.slice(1) : anyTag;
            const parts = raw.split("/");
            const idx = parts.findIndex(p => p === child.label);
            if (idx >= 0) return parts.slice(0, idx + 1).join("/");
        }
        return child.label;
    }

    private findAnyFullTag(node: TagTreeNode): string | null {
        if (node.fullTag) return node.fullTag;
        for (const child of node.children.values()) {
            const found = this.findAnyFullTag(child);
            if (found) return found;
        }
        return null;
    }

    private async toggleTagInTask(file: TFile, tagInput: string): Promise<void> {
        try {
            const cleaned = tagInput.trim();
            if (!cleaned) return;

            const tagName = cleaned.startsWith("#") ? cleaned.slice(1) : cleaned;
            const tagNameLower = tagName.toLowerCase();

            await this.app.fileManager.processFrontMatter(file, (fm) => {
                const raw = (fm as any).tags;
                const tags: string[] = Array.isArray(raw)
                    ? raw.map((t: any) => String(t))
                    : (typeof raw === "string" ? [raw] : []);

                const norm = (t: string) => this.normalizeTagForCompare(t);
                const normalized = tags.map(t => ({ raw: t, norm: norm(t) }));
                const exists = normalized.some(t => t.norm === tagNameLower);

                let next: string[];
                if (exists) {
                    next = normalized.filter(t => t.norm !== tagNameLower).map(t => t.raw);
                } else {
                    // 写入时使用不带 # 的形式（Obsidian frontmatter tags 习惯）
                    next = [...tags, tagName];
                }

                if (next.length === 0) {
                    delete (fm as any).tags;
                } else {
                    (fm as any).tags = next;
                }
            });

            await this.refresh();
        } catch (error) {
            console.error("Failed to toggle tag:", error);
        }
    }


    private async updateTaskField(file: TFile, field: string, value: string | number): Promise<void> {
        try {
            const content = await this.app.vault.read(file);

            // 创建匹配该字段的正则表达式
            const fieldRegex = new RegExp(`^(---\\s*\\n[\\s\\S]*?)(${field}:\\s*)([^\\n]+)([\\s\\S]*?---)`, "m");

            let updatedContent: string;
            if (fieldRegex.test(content)) {
                // 字段存在，更新它
                updatedContent = content.replace(fieldRegex, `$1$2${value}$4`);
            } else {
                // 字段不存在，在 frontmatter 中添加
                const frontmatterEnd = content.indexOf("---", 4);
                if (frontmatterEnd !== -1) {
                    updatedContent = content.slice(0, frontmatterEnd) + `${field}: ${value}\n` + content.slice(frontmatterEnd);
                } else {
                    updatedContent = content;
                }
            }

            await this.app.vault.modify(file, updatedContent);
            await this.refresh();
        } catch (error) {
            console.error(`Failed to update task ${field}:`, error);
        }
    }

    private async removeTaskField(file: TFile, field: string): Promise<void> {
        try {
            const content = await this.app.vault.read(file);

            // 移除该字段行
            const fieldRegex = new RegExp(`^${field}:\\s*[^\\n]*\\n?`, "gm");
            const updatedContent = content.replace(fieldRegex, "");

            await this.app.vault.modify(file, updatedContent);
            await this.refresh();
        } catch (error) {
            console.error(`Failed to remove task ${field}:`, error);
        }
    }

    // 设置拖放区域
    private setupDropZone(el: HTMLElement, targetValue: string, type: "status" | "project"): void {
        el.addEventListener("dragover", (e) => {
            e.preventDefault();
            el.classList.add("drag-over");
        });

        el.addEventListener("dragleave", (e) => {
            // 只有真正离开元素时才移除样式
            if (!el.contains(e.relatedTarget as Node)) {
                el.classList.remove("drag-over");
            }
        });

        el.addEventListener("drop", async (e) => {
            e.preventDefault();
            el.classList.remove("drag-over");

            const taskPath = e.dataTransfer?.getData("text/plain");
            if (!taskPath) return;

            const file = this.app.vault.getAbstractFileByPath(taskPath);
            if (!(file instanceof TFile)) return;

            if (type === "status") {
                await this.updateTaskField(file, "status", targetValue);
                showTaskNotice(`已移动到「${this.getStatusLabel(targetValue)}」`, "📦");
            } else if (type === "project") {
                await this.updateTaskProject(file, targetValue);
                showTaskNotice(`已移动到项目「${targetValue}」`, "📁");
            }
        });
    }

    // 获取状态的显示标签
    private getStatusLabel(status: string): string {
        const col = STATUS_COLUMNS.find(c => c.key === status);
        return col ? col.label : status;
    }

    // 更新任务所属项目（通过移动文件到对应的项目文件夹）
    private async updateTaskProject(file: TFile, targetProject: string): Promise<void> {
        try {
            const currentPath = file.path;
            const targetFolder = this.resolveProjectFolderPath(targetProject, file);
            const newPath = this.joinPath(targetFolder, file.name) || file.name;

            // 如果路径相同，不需要移动
            if (newPath === currentPath) {
                return;
            }

            // 确保目标文件夹存在
            const parentFolder = this.getParentFolder(newPath);
            await this.ensureFolderExists(parentFolder);

            // 移动文件
            await this.app.fileManager.renameFile(file, newPath);
            await this.refresh();
        } catch (error) {
            console.error("Failed to move task to project:", error);
            showTaskNotice("移动文件失败", "❌");
        }
    }

    // 创建新任务
    private async createNewTask(project: string, title: string, priority: string, scheduled: string, due: string): Promise<void> {
        try {
            // 确定文件路径
            const folderPath = this.resolveProjectFolderPath(project);

            // 确保文件夹存在
            await this.ensureFolderExists(folderPath);

            // 文件名处理 (简单处理非法字符)
            const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
            let filePath = this.joinPath(folderPath, `${safeTitle}.md`) || `${safeTitle}.md`;

            // 避免重名
            let counter = 1;
            while (await this.app.vault.adapter.exists(filePath)) {
                filePath = this.joinPath(folderPath, `${safeTitle} ${counter}.md`) || `${safeTitle} ${counter}.md`;
                counter++;
            }

            // 模板内容
            const now = new Date();
            const formatTime = (d: Date) => {
                const pad = (n: number) => n.toString().padStart(2, "0");
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            };

            const scheduledStr = `\nscheduled: ${scheduled || ""}`;
            const dueStr = `\ndue: ${due || ""}`;

            const content = `---
tags:
  - task
status: open
priority: ${priority}${scheduledStr}${dueStr}
dateCreated: ${formatTime(now)}
---
# ${title}

`;

            await this.app.vault.create(filePath, content);
            showTaskNotice(`任务「${title}」已创建`, "✨");

            // 刷新视图并打开文件
            await this.refresh();
            // Optional: open the new file
            // await this.app.workspace.openLinkText(file.path, "", false);
        } catch (error) {
            console.error("Failed to create new task:", error);
            showTaskNotice("创建任务失败", "❌");
        }
    }

    // 加载子任务
    private async loadSubtasks(file: TFile): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");
        const subtasks: { content: string, line: number, status: string }[] = [];

        lines.forEach((line, index) => {
            const match = line.match(/^(\s*)-\s\[([ xX])\]\s(.*)$/);
            if (match) {
                subtasks.push({
                    status: (match[2] || " ").toLowerCase(),
                    content: match[3] || "",
                    line: index
                });
            }
        });

        this.subtaskCache.set(file.path, subtasks);
    }

    // 渲染专注视图
    private renderFocusView(container: HTMLElement): void {
        const focusContainer = container.createEl("div", {
            cls: "task-focus-container",
        });

        focusContainer.createEl("h3", { text: "🔭 任务专注模式", cls: "task-focus-title" });

        const boardContainer = focusContainer.createEl("div", {
            cls: "task-focus-boards",
        });

        for (const path of this.focusedTasks) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;

            const subtasks = this.subtaskCache.get(path) || [];

            const board = boardContainer.createEl("div", {
                cls: "task-focus-board",
            });

            // 看板头部
            const header = board.createEl("div", {
                cls: "task-focus-board-header",
            });

            header.createEl("span", {
                text: file.basename,
                cls: "task-focus-board-name"
            });

            const closeBtn = header.createEl("div", {
                cls: "task-focus-close-btn clickable-icon",
                attr: { "aria-label": "关闭" }
            });
            setIcon(closeBtn, "cross");
            closeBtn.addEventListener("click", () => {
                this.focusedTasks.delete(path);
                this.refresh();
            });

            // 看板内容 (子任务列表)
            const content = board.createEl("div", {
                cls: "task-focus-board-content",
            });

            if (subtasks.length === 0) {
                content.createEl("div", { text: "无子任务", cls: "task-focus-empty" });
            } else {
                const ul = content.createEl("ul", { cls: "task-focus-list" });
                for (const sub of subtasks) {
                    const li = ul.createEl("li", { cls: "task-focus-item" });

                    // 简单的 checkbox 显示 (暂不支持交互修改，因为行号可能变动，需更复杂逻辑)
                    const checkbox = li.createEl("input", { type: "checkbox" });
                    checkbox.checked = sub.status === "x";
                    checkbox.disabled = true; // 只读

                    li.createEl("span", { text: sub.content, cls: sub.status === "x" ? "is-done" : "" });
                }
            }
        }
    }
}
