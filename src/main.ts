import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { TagFilterView, TAG_FILTER_VIEW_TYPE } from "./views/TagFilterView";
import { TaskResultView, TASK_RESULT_VIEW_TYPE } from "./views/TaskResultView";

export default class TaskFilterPlugin extends Plugin {
    settings: MyPluginSettings;
    private taskResultView: TaskResultView | null = null;

    async onload() {
        await this.loadSettings();

        // 注册标签过滤视图
        this.registerView(TAG_FILTER_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
            return new TagFilterView(leaf, this);
        });

        // 注册任务结果视图
        this.registerView(TASK_RESULT_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
            this.taskResultView = new TaskResultView(leaf, this);
            return this.taskResultView;
        });

        // 添加功能区（ribbon）图标
        const ribbonIconEl = this.addRibbonIcon("tags", "打开标签过滤器", () => {
            this.activateTagFilterView();
        });
        ribbonIconEl.addClass("task-filter-ribbon-icon");

        // Obsidian 内置 icon 是单色的；这里注入自定义彩色 SVG 作为真正的“彩色图标”
        ribbonIconEl.empty();
        ribbonIconEl.innerHTML = `
            <svg class="task-filter-ribbon-icon-svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <!-- tag -->
                <path d="M20.59 13.41 12 4.83V4H4v8h.83l8.58 8.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82Z" fill="#22c55e"/>
                <path d="M7.5 7.5h.01" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>
                <!-- coin -->
                <circle cx="17.5" cy="17.5" r="4.25" fill="#f59e0b" stroke="#0f172a" stroke-width="1.25"/>
                <path d="M16.2 17.5h2.6" stroke="#0f172a" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M17.5 16.2v2.6" stroke="#0f172a" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `;

        // 添加命令：打开标签过滤器
        this.addCommand({
            id: "open-tag-filter",
            name: "打开标签过滤器",
            callback: () => {
                this.activateTagFilterView();
            },
        });

        // 添加命令：打开任务列表
        this.addCommand({
            id: "open-task-list",
            name: "打开任务列表",
            callback: () => {
                this.activateTaskResultView();
            },
        });

        // 添加命令：打开插件视图（同时打开标签过滤 + 任务列表）
        this.addCommand({
            id: "open-task-filter-workspace",
            name: "打开任务筛选面板（标签过滤 + 任务列表）",
            callback: async () => {
                await this.activateTagFilterView();
                await this.activateTaskResultView();
            },
        });

        // 添加设置选项卡
        this.addSettingTab(new SampleSettingTab(this.app, this));

        // 监听元数据缓存更新，以便自动刷新标签
        this.registerEvent(
            this.app.metadataCache.on("resolved", () => {
                this.refreshViews();
            })
        );
    }

    onunload() {
        // 关闭所有相关视图
        this.app.workspace.detachLeavesOfType(TAG_FILTER_VIEW_TYPE);
        this.app.workspace.detachLeavesOfType(TASK_RESULT_VIEW_TYPE);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 激活标签过滤视图
     */
    async activateTagFilterView(): Promise<void> {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(TAG_FILTER_VIEW_TYPE)[0];

        if (!leaf) {
            // 在左侧边栏创建视图
            const leftLeaf = workspace.getLeftLeaf(false);
            if (leftLeaf) {
                await leftLeaf.setViewState({
                    type: TAG_FILTER_VIEW_TYPE,
                    active: true,
                });
                leaf = leftLeaf;
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * 激活任务结果视图
     */
    async activateTaskResultView(): Promise<void> {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(TASK_RESULT_VIEW_TYPE)[0];

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({
                type: TASK_RESULT_VIEW_TYPE,
                active: true,
            });
        }

        workspace.revealLeaf(leaf);
    }

    /**
     * 设置选中的标签并刷新任务结果视图
     */
    setSelectedTags(tags: string[]): void {
        if (this.taskResultView) {
            this.taskResultView.setSelectedTags(tags);
        } else {
            // 如果视图还没有创建，先创建它
            this.activateTaskResultView().then(() => {
                // 等待一下让视图初始化
                setTimeout(() => {
                    if (this.taskResultView) {
                        this.taskResultView.setSelectedTags(tags);
                    }
                }, 100);
            });
        }
    }

    /**
     * 刷新所有视图
     */
    private refreshViews(): void {
        // 刷新标签过滤视图
        const tagLeaves = this.app.workspace.getLeavesOfType(TAG_FILTER_VIEW_TYPE);
        for (const leaf of tagLeaves) {
            const view = leaf.view as TagFilterView;
            if (view && typeof view.refresh === "function") {
                view.refresh();
            }
        }

        // 刷新任务结果视图
        if (this.taskResultView) {
            this.taskResultView.refresh();
        }
    }
}
