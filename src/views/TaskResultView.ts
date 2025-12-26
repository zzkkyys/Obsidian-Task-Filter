import { ItemView, WorkspaceLeaf, TFile, Menu } from "obsidian";
import type TaskFilterPlugin from "../main";
import { getTaskFiles, filterTaskFilesByTags, TaskFile } from "../utils/tagScanner";

export const TASK_RESULT_VIEW_TYPE = "task-result-view";

type ViewMode = "list" | "kanban" | "project" | "today";
type SortMode = "due" | "priority" | "title" | "created";

// 状态列定义
const STATUS_COLUMNS = [
    { key: "none", label: "未设置", icon: "⬜" },
    { key: "open", label: "Open", icon: "📋" },
    { key: "in-progress", label: "In Progress", icon: "🔄" },
    { key: "done", label: "Done", icon: "✅" },
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

            const columnEl = kanbanEl.createEl("div", {
                cls: "task-kanban-column task-project-column",
            });

            // 列头
            const columnHeaderEl = columnEl.createEl("div", {
                cls: "task-kanban-column-header",
            });
            columnHeaderEl.createEl("span", {
                text: `📁 ${project}`,
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

        // 到期时间
        if (taskFile.due) {
            const daysRemaining = this.getDaysRemaining(taskFile.due);
            const dueEl = metaEl.createEl("span", {
                cls: `task-meta-item task-meta-due ${this.getDueClass(daysRemaining)}`,
            });
            dueEl.createEl("span", { text: "📅 ", cls: "task-meta-icon" });
            dueEl.createEl("span", { text: this.formatDueWithDays(taskFile.due, daysRemaining) });
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
            
            // 更新 frontmatter 中的 status
            const updatedContent = content.replace(
                /^(---\s*\n[\s\S]*?)(status:\s*)([\w-]+)([\s\S]*?---)/m,
                `$1$2${newStatus}$4`
            );
            
            await this.app.vault.modify(file, updatedContent);
            
            // 刷新视图
            await this.refresh();
        } catch (error) {
            console.error("Failed to update task status:", error);
        }
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
}
