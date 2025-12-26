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

        // 添加侧边栏图标
        this.addRibbonIcon("tags", "打开标签过滤器", () => {
            this.activateTagFilterView();
        });

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
