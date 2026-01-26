import { App, ItemView, WorkspaceLeaf, TFile, Menu, Modal, Setting, Notice, setIcon } from "obsidian";

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

type ViewMode = "list" | "kanban" | "project" | "today";
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
    private hideDone: boolean = false;

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
        await this.refresh();
    }

    async onClose(): Promise<void> {
        // 清理工作
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

        headerEl.createEl("h4", { text: "任务文件列表" });

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

        const refreshBtn = headerEl.createEl("button", {
            cls: "task-result-refresh-btn",
            attr: { "aria-label": "刷新" },
        });
        refreshBtn.innerHTML = "🔄";
        refreshBtn.addEventListener("click", () => this.refresh());

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
        if (this.viewMode === "kanban") {
            this.renderKanbanView(mainContainer);
        } else if (this.viewMode === "project") {
            this.renderProjectView(mainContainer);
        } else if (this.viewMode === "today") {
            this.renderListView(mainContainer);
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
        const kanbanEl = mainContainer.createEl("div", {
            cls: "task-kanban task-project-kanban",
        });

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

        // 对项目名排序（未分类放最后）
        const sortedProjects = Array.from(tasksByProject.keys()).sort((a, b) => {
            if (a === "未分类") return 1;
            if (b === "未分类") return -1;
            return a.localeCompare(b);
        });

        // 渲染每个项目列
        for (const project of sortedProjects) {
            const tasks = tasksByProject.get(project)!;
            // 如果是未分类且没有任务，跳过
            if (project === "未分类" && tasks.length === 0) continue;

            // 统计未完成任务的 money 总和
            const moneySum = tasks
                .filter(t => this.normalizeStatus(t.status) !== "done" && typeof t.money === "number" && t.money > 0)
                .reduce((sum, t) => sum + (t.money ?? 0), 0);

            const columnEl = kanbanEl.createEl("div", {
                cls: "task-kanban-column task-project-column",
            });

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
        }

        // 如果没有任何项目
        if (sortedProjects.length === 0 || (sortedProjects.length === 1 && sortedProjects[0] === "未分类" && tasksByProject.get("未分类")!.length === 0)) {
            kanbanEl.createEl("p", {
                text: "没有找到任何项目",
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

    private async updateTaskField(file: TFile, field: string, value: string): Promise<void> {
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
            const rootPath = this.plugin.settings.projectPath || "Projects";

            // 简单的路径替换逻辑
            // 如果已经在项目目录下，替换项目名
            // 如果不在，移动到项目目录

            let newPath: string;

            if (targetProject === "未分类") {
                // 移动到根项目目录
                newPath = `${rootPath}/${file.name}`;
            } else {
                newPath = `${rootPath}/${targetProject}/${file.name}`;
            }

            // 确保目标文件夹存在

            // 如果路径相同，不需要移动
            if (newPath === currentPath) {
                return;
            }

            // 确保目标文件夹存在
            const targetFolder = newPath.substring(0, newPath.lastIndexOf("/"));
            const existingFolder = this.app.vault.getAbstractFileByPath(targetFolder);
            if (!existingFolder) {
                await this.app.vault.createFolder(targetFolder);
            }

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
            const rootPath = this.plugin.settings.projectPath || "Projects";
            let folderPath = rootPath; // 默认根目录
            if (project !== "未分类") {
                folderPath = `${rootPath}/${project}`;
            }

            // 确保文件夹存在
            if (!await this.app.vault.adapter.exists(folderPath)) {
                await this.app.vault.createFolder(folderPath);
            }

            // 文件名处理 (简单处理非法字符)
            const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
            let filePath = `${folderPath}/${safeTitle}.md`;

            // 避免重名
            let counter = 1;
            while (await this.app.vault.adapter.exists(filePath)) {
                filePath = `${folderPath}/${safeTitle} ${counter}.md`;
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

            const file = await this.app.vault.create(filePath, content);
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
}
