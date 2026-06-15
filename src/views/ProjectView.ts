import { ItemView, WorkspaceLeaf, Modal, Setting, Notice, TFile, Menu, setIcon } from "obsidian";
import type TaskFilterPlugin from "../main";
import {
    getProjects,
    bucketTasksByStatus,
    normalizeFolder,
    generateProjectId,
    PROJECT_MARKER,
    PROJECT_STATUSES,
    Project,
    ProjectMeta,
} from "../utils/projectScanner";

export const PROJECT_VIEW_TYPE = "task-filter-project-view";

/** 项目内的子板块（对标 Plane 的项目导航） */
type ProjectSection = "overview" | "work-items" | "cycles" | "modules" | "views" | "pages";

const PROJECT_SECTIONS: { key: ProjectSection; label: string; icon: string }[] = [
    { key: "overview", label: "概览", icon: "layout-dashboard" },
    { key: "work-items", label: "工作项", icon: "list-checks" },
    { key: "cycles", label: "周期", icon: "rotate-cw" },
    { key: "modules", label: "模块", icon: "box" },
    { key: "views", label: "视图", icon: "layout-grid" },
    { key: "pages", label: "页面", icon: "file-text" },
];

/** 项目状态对应的色彩（CSS 颜色变量友好的内联值） */
const STATUS_COLOR: Record<string, string> = {
    "规划中": "#94a3b8",
    "进行中": "#3b82f6",
    "已完成": "#22c55e",
    "已归档": "#a78bfa",
};

interface ProjectFormValue {
    name: string;
    icon: string;
    status: string;
    start: string;
    due: string;
    description: string;
}

/** 新建 / 编辑项目的表单模态框 */
class ProjectFormModal extends Modal {
    private value: ProjectFormValue;
    private readonly isEdit: boolean;
    private readonly onSubmit: (value: ProjectFormValue) => void;

    constructor(
        plugin: TaskFilterPlugin,
        initial: Partial<ProjectFormValue>,
        isEdit: boolean,
        onSubmit: (value: ProjectFormValue) => void
    ) {
        super(plugin.app);
        this.isEdit = isEdit;
        this.onSubmit = onSubmit;
        this.value = {
            name: initial.name ?? "",
            icon: initial.icon ?? "📁",
            status: initial.status ?? "进行中",
            start: initial.start ?? "",
            due: initial.due ?? "",
            description: initial.description ?? "",
        };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: this.isEdit ? "编辑项目" : "新建项目" });

        new Setting(contentEl)
            .setName("项目名称")
            .addText((text) =>
                text
                    .setPlaceholder("例如：网站改版")
                    .setValue(this.value.name)
                    .onChange((v) => (this.value.name = v))
            );

        new Setting(contentEl)
            .setName("图标")
            .setDesc("一个 emoji，显示在项目卡片上")
            .addText((text) =>
                text
                    .setPlaceholder("📁")
                    .setValue(this.value.icon)
                    .onChange((v) => (this.value.icon = v))
            );

        new Setting(contentEl)
            .setName("状态")
            .addDropdown((drop) => {
                for (const s of PROJECT_STATUSES) drop.addOption(s, s);
                drop.setValue(this.value.status).onChange((v) => (this.value.status = v));
            });

        new Setting(contentEl)
            .setName("开始日期")
            .addText((text) =>
                text
                    .setPlaceholder("例如 2026-06-14")
                    .setValue(this.value.start)
                    .onChange((v) => (this.value.start = v))
            );

        new Setting(contentEl)
            .setName("截止日期")
            .addText((text) =>
                text
                    .setPlaceholder("例如 2026-06-14")
                    .setValue(this.value.due)
                    .onChange((v) => (this.value.due = v))
            );

        new Setting(contentEl)
            .setName("描述")
            .addTextArea((text) =>
                text
                    .setPlaceholder("一句话说明这个项目")
                    .setValue(this.value.description)
                    .onChange((v) => (this.value.description = v))
            );

        if (this.isEdit) {
            contentEl.createEl("p", {
                cls: "tf-project-form-hint",
                text: "提示：改名只会更新显示名称，项目文件夹不会被重命名。",
            });
        }

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(this.isEdit ? "保存" : "创建")
                    .setCta()
                    .onClick(() => {
                        if (!this.value.name.trim()) {
                            new Notice("请输入项目名称");
                            return;
                        }
                        this.close();
                        this.onSubmit({
                            ...this.value,
                            name: this.value.name.trim(),
                            icon: this.value.icon.trim() || "📁",
                            start: this.value.start.trim(),
                            due: this.value.due.trim(),
                            description: this.value.description.trim(),
                        });
                    })
            )
            .addExtraButton((btn) =>
                btn.setIcon("cross").setTooltip("取消").onClick(() => this.close())
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

interface TaskFormValue {
    title: string;
    priority: string;
    scheduled: string;
    due: string;
}

/** 在项目中创建任务的表单模态框 */
class TaskCreateModal extends Modal {
    private value: TaskFormValue = { title: "", priority: "normal", scheduled: "", due: "" };
    private readonly projectName: string;
    private readonly onSubmit: (value: TaskFormValue) => void;

    constructor(plugin: TaskFilterPlugin, projectName: string, onSubmit: (value: TaskFormValue) => void) {
        super(plugin.app);
        this.projectName = projectName;
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: `在「${this.projectName}」中添加任务` });

        new Setting(contentEl)
            .setName("任务标题")
            .addText((text) =>
                text.setPlaceholder("输入任务名称…").onChange((v) => (this.value.title = v))
            );

        new Setting(contentEl)
            .setName("优先级")
            .addDropdown((drop) =>
                drop
                    .addOption("high", "🔴 高")
                    .addOption("medium", "🟡 中")
                    .addOption("low", "🟢 低")
                    .addOption("normal", "⚪ 普通")
                    .setValue("normal")
                    .onChange((v) => (this.value.priority = v))
            );

        new Setting(contentEl)
            .setName("计划开始日期")
            .addText((text) =>
                text.setPlaceholder("例如 2026-06-14").onChange((v) => (this.value.scheduled = v))
            );

        new Setting(contentEl)
            .setName("截止日期")
            .addText((text) =>
                text.setPlaceholder("例如 2026-06-30").onChange((v) => (this.value.due = v))
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("创建任务")
                    .setCta()
                    .onClick(() => {
                        if (!this.value.title.trim()) {
                            new Notice("请输入任务标题");
                            return;
                        }
                        this.close();
                        this.onSubmit({
                            title: this.value.title.trim(),
                            priority: this.value.priority,
                            scheduled: this.value.scheduled.trim(),
                            due: this.value.due.trim(),
                        });
                    })
            )
            .addExtraButton((btn) =>
                btn.setIcon("cross").setTooltip("取消").onClick(() => this.close())
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class ProjectView extends ItemView {
    plugin: TaskFilterPlugin;
    private projects: Project[] = [];
    private selectedFolderPath: string | null = null;
    private selectedSection: ProjectSection = "overview";
    private expanded: Set<string> = new Set();
    private listEl: HTMLElement | null = null;
    private detailEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: TaskFilterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return PROJECT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "项目";
    }

    getIcon(): string {
        return "folder-kanban";
    }

    async onOpen(): Promise<void> {
        this.buildLayout();
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    private buildLayout(): void {
        const root = this.contentEl;
        root.empty();
        root.classList.add("tf-project-root");

        // 顶部工具栏
        const toolbar = root.createEl("div", { cls: "tf-project-toolbar" });
        const titleEl = toolbar.createEl("div", { cls: "tf-project-title", text: "项目" });
        titleEl.prepend(this.makeIcon("folder-kanban"));

        const actions = toolbar.createEl("div", { cls: "tf-project-toolbar-actions" });
        const newBtn = actions.createEl("button", { cls: "tf-project-btn tf-project-btn-cta", text: "新建项目" });
        newBtn.prepend(this.makeIcon("plus"));
        newBtn.addEventListener("click", () => this.openCreateModal());

        const refreshBtn = actions.createEl("button", { cls: "tf-project-btn", attr: { "aria-label": "刷新" } });
        refreshBtn.appendChild(this.makeIcon("refresh-cw"));
        refreshBtn.addEventListener("click", () => void this.refresh());

        // 主体：左列表 + 右详情
        const body = root.createEl("div", { cls: "tf-project-body" });
        this.listEl = body.createEl("div", { cls: "tf-project-list" });
        this.detailEl = body.createEl("div", { cls: "tf-project-detail" });
    }

    private makeIcon(name: string): HTMLElement {
        const span = document.createElement("span");
        span.className = "tf-project-icon";
        setIcon(span, name);
        return span;
    }

    /** 重新扫描项目并重绘 */
    async refresh(): Promise<void> {
        this.projects = await getProjects(this.plugin.app, this.plugin.settings.projectRootFolder);

        // 维持选中项；失效则选第一个
        if (this.selectedFolderPath && !this.projects.some((p) => p.folderPath === this.selectedFolderPath)) {
            this.selectedFolderPath = null;
        }
        if (!this.selectedFolderPath && this.projects.length > 0) {
            this.selectedFolderPath = this.projects[0]?.folderPath ?? null;
        }
        if (this.selectedFolderPath) {
            this.expanded.add(this.selectedFolderPath);
        }

        this.renderList();
        this.renderDetail();
    }

    /** 选中某个项目的某个板块 */
    private selectSection(folderPath: string, section: ProjectSection): void {
        this.selectedFolderPath = folderPath;
        this.selectedSection = section;
        this.expanded.add(folderPath);
        this.renderList();
        this.renderDetail();
    }

    private renderList(): void {
        const listEl = this.listEl;
        if (!listEl) return;
        listEl.empty();

        if (this.projects.length === 0) {
            const empty = listEl.createEl("div", { cls: "tf-project-empty" });
            empty.createEl("div", { cls: "tf-project-empty-emoji", text: "🗂️" });
            empty.createEl("div", { cls: "tf-project-empty-title", text: "还没有项目" });
            empty.createEl("div", {
                cls: "tf-project-empty-desc",
                text: "点击「新建项目」创建第一个项目，它会成为一个带 _index.md 的文件夹。",
            });
            const btn = empty.createEl("button", { cls: "tf-project-btn tf-project-btn-cta", text: "新建项目" });
            btn.addEventListener("click", () => this.openCreateModal());
            return;
        }

        for (const project of this.projects) {
            const isSelected = project.folderPath === this.selectedFolderPath;
            const isExpanded = this.expanded.has(project.folderPath);

            const card = listEl.createEl("div", { cls: "tf-project-card" });
            if (isSelected) card.classList.add("is-active");

            // 项目头部：折叠箭头 + 图标 + 名称 + 状态
            const head = card.createEl("div", { cls: "tf-project-card-head" });
            const chevron = head.createEl("span", { cls: "tf-project-chevron" });
            setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
            head.createEl("span", { cls: "tf-project-card-icon", text: project.meta.icon });
            head.createEl("span", { cls: "tf-project-card-name", text: project.meta.name });
            this.appendStatusChip(head, project.meta.status);
            head.addEventListener("click", () => {
                if (this.expanded.has(project.folderPath)) {
                    this.expanded.delete(project.folderPath);
                } else {
                    this.expanded.add(project.folderPath);
                }
                this.selectedFolderPath = project.folderPath;
                this.renderList();
                this.renderDetail();
            });

            // 进度条
            const pct = project.taskTotal > 0 ? Math.round((project.taskDone / project.taskTotal) * 100) : 0;
            const bar = card.createEl("div", { cls: "tf-project-progress" });
            const fill = bar.createEl("div", { cls: "tf-project-progress-fill" });
            fill.style.width = `${pct}%`;
            fill.style.backgroundColor = STATUS_COLOR[project.meta.status] ?? "#3b82f6";

            card.createEl("div", {
                cls: "tf-project-card-meta",
                text: project.taskTotal > 0 ? `${project.taskDone}/${project.taskTotal} 个任务 · ${pct}%` : "暂无任务",
            });

            // 展开后的子板块导航
            if (isExpanded) {
                const nav = card.createEl("div", { cls: "tf-project-nav" });
                for (const section of PROJECT_SECTIONS) {
                    const row = nav.createEl("div", { cls: "tf-project-nav-item" });
                    if (isSelected && this.selectedSection === section.key) {
                        row.classList.add("is-active");
                    }
                    const icon = row.createEl("span", { cls: "tf-project-nav-icon" });
                    setIcon(icon, section.icon);
                    row.createEl("span", { cls: "tf-project-nav-label", text: section.label });
                    if (section.key === "work-items" && project.taskTotal > 0) {
                        row.createEl("span", { cls: "tf-project-nav-count", text: String(project.taskTotal) });
                    }
                    row.addEventListener("click", (evt) => {
                        evt.stopPropagation();
                        this.selectSection(project.folderPath, section.key);
                    });
                }
            }
        }
    }

    private renderDetail(): void {
        const detailEl = this.detailEl;
        if (!detailEl) return;
        detailEl.empty();

        const project = this.projects.find((p) => p.folderPath === this.selectedFolderPath);
        if (!project) {
            const placeholder = detailEl.createEl("div", { cls: "tf-project-detail-empty" });
            placeholder.setText("选择左侧的项目查看概览");
            return;
        }

        // 头部（所有板块共用）
        const header = detailEl.createEl("div", { cls: "tf-project-detail-header" });
        header.createEl("span", { cls: "tf-project-detail-icon", text: project.meta.icon });
        const headText = header.createEl("div", { cls: "tf-project-detail-headtext" });
        const nameRow = headText.createEl("div", { cls: "tf-project-detail-nameRow" });
        nameRow.createEl("span", { cls: "tf-project-detail-name", text: project.meta.name });
        if (project.meta.id) {
            nameRow.createEl("span", { cls: "tf-project-id-chip", text: `#${project.meta.id}` });
        }
        const sub = headText.createEl("div", { cls: "tf-project-detail-sub" });
        this.appendStatusChip(sub, project.meta.status);
        const dateText = this.formatDateRange(project.meta);
        if (dateText) sub.createEl("span", { cls: "tf-project-detail-dates", text: dateText });

        // 操作按钮
        const ops = header.createEl("div", { cls: "tf-project-detail-ops" });
        const addTaskBtn = ops.createEl("button", { cls: "tf-project-btn tf-project-btn-cta", text: "添加任务" });
        addTaskBtn.prepend(this.makeIcon("plus"));
        addTaskBtn.addEventListener("click", () => this.openCreateTaskModal(project));
        const editBtn = ops.createEl("button", { cls: "tf-project-btn", text: "编辑" });
        editBtn.addEventListener("click", () => this.openEditModal(project));
        const openBtn = ops.createEl("button", { cls: "tf-project-btn", text: "打开笔记" });
        openBtn.addEventListener("click", () => this.openFile(project.indexFile));
        const moreBtn = ops.createEl("button", { cls: "tf-project-btn", attr: { "aria-label": "更多" } });
        moreBtn.appendChild(this.makeIcon("more-horizontal"));
        moreBtn.addEventListener("click", (evt) => this.openMoreMenu(evt, project));

        // 当前板块标题
        const sectionDef = PROJECT_SECTIONS.find((s) => s.key === this.selectedSection);
        const sectionTitle = detailEl.createEl("div", { cls: "tf-project-section-title" });
        if (sectionDef) {
            const ico = sectionTitle.createEl("span", { cls: "tf-project-icon" });
            setIcon(ico, sectionDef.icon);
            sectionTitle.createEl("span", { text: sectionDef.label });
        }

        const body = detailEl.createEl("div", { cls: "tf-project-section-body" });
        switch (this.selectedSection) {
            case "overview":
                this.renderOverviewSection(body, project);
                break;
            case "work-items":
                this.renderWorkItemsSection(body, project);
                break;
            case "cycles":
                this.renderComingSoon(body, "周期", "把任务按时间盒（迭代）分组，配合燃尽图推进。");
                break;
            case "modules":
                this.renderComingSoon(body, "模块", "按功能把任务分组，跨周期组织一块块大功能。");
                break;
            case "views":
                this.renderComingSoon(body, "视图", "保存一组筛选 + 布局（列表 / 看板 / 日历），随时切换。");
                break;
            case "pages":
                this.renderComingSoon(body, "页面", "项目内的文档与笔记，写需求、会议纪要、设计草稿。");
                break;
        }
    }

    private renderOverviewSection(body: HTMLElement, project: Project): void {
        if (project.meta.description) {
            body.createEl("div", { cls: "tf-project-detail-desc", text: project.meta.description });
        }

        const buckets = bucketTasksByStatus(project.tasks);
        const pct = project.taskTotal > 0 ? Math.round((project.taskDone / project.taskTotal) * 100) : 0;

        const overview = body.createEl("div", { cls: "tf-project-overview" });
        this.appendStatCard(overview, "总任务", String(project.taskTotal));
        this.appendStatCard(overview, "待开始", String(buckets.open.length));
        this.appendStatCard(overview, "进行中", String(buckets.inProgress.length));
        this.appendStatCard(overview, "已完成", String(buckets.done.length));

        const progWrap = body.createEl("div", { cls: "tf-project-detail-progress" });
        progWrap.createEl("div", { cls: "tf-project-detail-progress-label", text: `整体进度 ${pct}%` });
        const bar = progWrap.createEl("div", { cls: "tf-project-progress tf-project-progress-lg" });
        const fill = bar.createEl("div", { cls: "tf-project-progress-fill" });
        fill.style.width = `${pct}%`;
        fill.style.backgroundColor = STATUS_COLOR[project.meta.status] ?? "#3b82f6";
    }

    private renderWorkItemsSection(body: HTMLElement, project: Project): void {
        const toolbar = body.createEl("div", { cls: "tf-project-workitems-toolbar" });
        const addBtn = toolbar.createEl("button", { cls: "tf-project-btn tf-project-btn-cta", text: "添加任务" });
        addBtn.prepend(this.makeIcon("plus"));
        addBtn.addEventListener("click", () => this.openCreateTaskModal(project));

        if (project.tasks.length === 0) {
            body.createEl("div", {
                cls: "tf-project-detail-empty",
                text: "这个项目文件夹下还没有带 #task 的笔记，点上面「添加任务」创建一个",
            });
            return;
        }
        for (const task of project.tasks) {
            const row = body.createEl("div", { cls: "tf-project-task-row" });
            const dot = row.createEl("span", { cls: "tf-project-task-dot" });
            dot.style.backgroundColor = STATUS_COLOR[task.status === "done" ? "已完成" : "进行中"] ?? "#94a3b8";
            row.createEl("span", { cls: "tf-project-task-name", text: task.title });
            if (task.due) row.createEl("span", { cls: "tf-project-task-due", text: task.due });
            row.addEventListener("click", () => this.openFile(task.file));
        }
    }

    private renderComingSoon(body: HTMLElement, label: string, desc: string): void {
        const wrap = body.createEl("div", { cls: "tf-project-coming-soon" });
        wrap.createEl("div", { cls: "tf-project-coming-soon-badge", text: "即将推出" });
        wrap.createEl("div", { cls: "tf-project-coming-soon-title", text: label });
        wrap.createEl("div", { cls: "tf-project-coming-soon-desc", text: desc });
    }

    private appendStatCard(parent: HTMLElement, label: string, value: string): void {
        const card = parent.createEl("div", { cls: "tf-project-stat" });
        card.createEl("div", { cls: "tf-project-stat-value", text: value });
        card.createEl("div", { cls: "tf-project-stat-label", text: label });
    }

    private appendStatusChip(parent: HTMLElement, status: string): void {
        const chip = parent.createEl("span", { cls: "tf-project-status-chip", text: status });
        const color = STATUS_COLOR[status] ?? "#94a3b8";
        chip.style.color = color;
        chip.style.borderColor = color;
    }

    private formatDateRange(meta: ProjectMeta): string {
        if (meta.start && meta.due) return `${meta.start} → ${meta.due}`;
        if (meta.due) return `截止 ${meta.due}`;
        if (meta.start) return `始于 ${meta.start}`;
        return "";
    }

    private openMoreMenu(evt: MouseEvent, project: Project): void {
        const menu = new Menu();
        if (project.meta.status !== "已归档") {
            menu.addItem((item) =>
                item
                    .setTitle("归档项目")
                    .setIcon("archive")
                    .onClick(() => void this.setProjectStatus(project, "已归档"))
            );
        } else {
            menu.addItem((item) =>
                item
                    .setTitle("取消归档（设为进行中）")
                    .setIcon("archive-restore")
                    .onClick(() => void this.setProjectStatus(project, "进行中"))
            );
        }
        menu.addItem((item) =>
            item
                .setTitle("在文件管理器中定位 _index")
                .setIcon("folder")
                .onClick(() => this.openFile(project.indexFile))
        );
        menu.showAtMouseEvent(evt);
    }

    private openFile(file: TFile): void {
        void this.plugin.app.workspace.getLeaf("tab").openFile(file);
    }

    // ---- 数据写入 ----

    private openCreateModal(): void {
        new ProjectFormModal(this.plugin, {}, false, (value) => void this.createProject(value)).open();
    }

    private openCreateTaskModal(project: Project): void {
        new TaskCreateModal(this.plugin, project.meta.name, (value) => void this.createTask(project, value)).open();
    }

    /** 在项目文件夹下创建一篇 #task 笔记 */
    private async createTask(project: Project, value: TaskFormValue): Promise<void> {
        const { app } = this.plugin;
        try {
            const safeTitle = value.title.replace(/[\\/:*?"<>|]/g, "_") || "未命名任务";
            let filePath = `${project.folderPath}/${safeTitle}.md`;
            let counter = 1;
            while (app.vault.getAbstractFileByPath(filePath)) {
                filePath = `${project.folderPath}/${safeTitle} ${counter}.md`;
                counter++;
            }

            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            const dateCreated = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

            const content = `---
tags:
  - task
status: open
priority: ${value.priority}
scheduled: ${value.scheduled}
due: ${value.due}
dateCreated: ${dateCreated}
---
# ${value.title}

`;
            await app.vault.create(filePath, content);
            new Notice(`任务「${value.title}」已创建`);

            // 切到工作项板块并刷新
            this.selectSection(project.folderPath, "work-items");
            await this.refresh();
        } catch (error) {
            console.error("创建任务失败:", error);
            new Notice("创建任务失败，详见控制台");
        }
    }

    private openEditModal(project: Project): void {
        new ProjectFormModal(
            this.plugin,
            {
                name: project.meta.name,
                icon: project.meta.icon,
                status: project.meta.status,
                start: project.meta.start ?? "",
                due: project.meta.due ?? "",
                description: project.meta.description,
            },
            true,
            (value) => void this.updateProject(project, value)
        ).open();
    }

    private async createProject(value: ProjectFormValue): Promise<void> {
        const { app, settings } = this.plugin;
        const root = normalizeFolder(settings.projectRootFolder);
        const folderName = this.sanitizeFolderName(value.name);
        const folderPath = root ? `${root}/${folderName}` : folderName;

        try {
            if (app.vault.getAbstractFileByPath(folderPath)) {
                new Notice(`文件夹「${folderPath}」已存在，请换个名字`);
                return;
            }
            if (root && !app.vault.getAbstractFileByPath(root)) {
                await app.vault.createFolder(root);
            }
            await app.vault.createFolder(folderPath);

            const indexPath = `${folderPath}/_index.md`;
            const projectId = generateProjectId();
            await app.vault.create(indexPath, this.buildIndexContent(value, projectId));

            new Notice(`已创建项目「${value.name}」（#${projectId}）`);
            this.selectedFolderPath = folderPath;
            await this.refresh();
        } catch (error) {
            console.error("创建项目失败:", error);
            new Notice("创建项目失败，详见控制台");
        }
    }

    private async updateProject(project: Project, value: ProjectFormValue): Promise<void> {
        try {
            await this.plugin.app.fileManager.processFrontMatter(project.indexFile, (fm: Record<string, unknown>) => {
                fm[PROJECT_MARKER] = true;
                if (typeof fm.id !== "string" || !fm.id.trim()) fm.id = generateProjectId();
                fm.name = value.name;
                fm.icon = value.icon;
                fm.status = value.status;
                if (value.start) fm.start = value.start; else delete fm.start;
                if (value.due) fm.due = value.due; else delete fm.due;
                if (value.description) fm.description = value.description; else delete fm.description;
            });
            new Notice("已保存项目设置");
            await this.refresh();
        } catch (error) {
            console.error("更新项目失败:", error);
            new Notice("更新项目失败，详见控制台");
        }
    }

    private async setProjectStatus(project: Project, status: string): Promise<void> {
        try {
            await this.plugin.app.fileManager.processFrontMatter(project.indexFile, (fm: Record<string, unknown>) => {
                fm[PROJECT_MARKER] = true;
                fm.status = status;
            });
            new Notice(`项目状态已设为「${status}」`);
            await this.refresh();
        } catch (error) {
            console.error("更新项目状态失败:", error);
            new Notice("更新项目状态失败，详见控制台");
        }
    }

    /** 把名称转成安全的文件夹名 */
    private sanitizeFolderName(name: string): string {
        return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名项目";
    }

    /** 生成 _index.md 内容 */
    private buildIndexContent(value: ProjectFormValue, id: string): string {
        const lines: string[] = ["---", `${PROJECT_MARKER}: true`];
        lines.push(`id: ${this.yamlStr(id)}`);
        lines.push(`name: ${this.yamlStr(value.name)}`);
        lines.push(`icon: ${this.yamlStr(value.icon)}`);
        lines.push(`status: ${this.yamlStr(value.status)}`);
        if (value.start) lines.push(`start: ${value.start}`);
        if (value.due) lines.push(`due: ${value.due}`);
        if (value.description) lines.push(`description: ${this.yamlStr(value.description)}`);
        lines.push("---", "", `# ${value.name}`, "");
        if (value.description) lines.push(value.description, "");
        return lines.join("\n");
    }

    private yamlStr(s: string): string {
        return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
}
