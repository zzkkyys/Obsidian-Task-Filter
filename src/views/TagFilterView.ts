import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf } from "obsidian";
import type TaskFilterPlugin from "../main";
import { getAllTags, TagInfo } from "../utils/tagScanner";
import { MentionInfo, openMentionSearch, openPersonNote, renameMention } from "../utils/mentionScanner";
import { TaskResultView, TASK_RESULT_VIEW_TYPE } from "./TaskResultView";

export const TAG_FILTER_VIEW_TYPE = "tag-filter-view";

// 标签树节点
interface TagTreeNode {
    name: string;           // 节点名称（不含 #）
    fullTag: string;        // 完整标签（含 #）
    count: number;          // 该标签的计数
    children: Map<string, TagTreeNode>;  // 子节点
    isLeaf: boolean;        // 是否叶子节点
}

// 提及树节点（多级人名，如 hit/zhangsan）
interface MentionTreeNode {
    name: string;           // 当前级名称
    fullName: string;       // 完整人名（不含 @）
    count: number;          // 该人名的出现次数
    children: Map<string, MentionTreeNode>;
}

export class TagFilterView extends ItemView {
    plugin: TaskFilterPlugin;
    private selectedTags: Set<string> = new Set();
    private tags: TagInfo[] = [];
    private expandedGroups: Set<string> = new Set();  // 展开的父标签集合
    private mentions: MentionInfo[] = [];
    private expandedMentionGroups: Set<string> = new Set();  // 展开的提及分组
    private mentionSectionCollapsed = false;

    constructor(leaf: WorkspaceLeaf, plugin: TaskFilterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return TAG_FILTER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "标签过滤器";
    }

    getIcon(): string {
        return "tags";
    }

    async onOpen(): Promise<void> {
        await this.refresh();
    }

    async onClose(): Promise<void> {
        // 清理点击监听器
        document.removeEventListener("click", this.handleOutsideClick);
    }

    async refresh(): Promise<void> {
        const allTags = await getAllTags(this.app);
        // 过滤掉隐藏的标签
        const hiddenTags = this.plugin.settings.hiddenTags.map(t => t.toLowerCase());
        this.tags = allTags.filter(tagInfo => !hiddenTags.includes(tagInfo.tag.toLowerCase()));
        this.mentions = await this.plugin.mentionIndex.getAllMentions();
        this.render();
    }

    // 构建标签树
    private buildTagTree(): TagTreeNode {
        const root: TagTreeNode = {
            name: "",
            fullTag: "",
            count: 0,
            children: new Map(),
            isLeaf: false,
        };

        for (const tagInfo of this.tags) {
            const tag = tagInfo.tag;
            // 去掉 # 前缀
            const tagWithoutHash = tag.startsWith("#") ? tag.slice(1) : tag;
            const parts = tagWithoutHash.split("/");
            
            let currentNode = root;
            let currentPath = "#";
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!part) continue;
                
                currentPath = i === 0 ? `#${part}` : `${currentPath}/${part}`;
                
                if (!currentNode.children.has(part)) {
                    currentNode.children.set(part, {
                        name: part,
                        fullTag: currentPath,
                        count: 0,
                        children: new Map(),
                        isLeaf: true,
                    });
                }
                
                const nextNode = currentNode.children.get(part);
                if (!nextNode) continue;
                currentNode = nextNode;
                
                // 如果是最后一个部分，设置计数
                if (i === parts.length - 1) {
                    currentNode.count = tagInfo.count;
                } else {
                    currentNode.isLeaf = false;
                }
            }
        }

        return root;
    }

    private render(): void {
        const container = this.contentEl;
        container.empty();

        // 创建主容器
        const mainContainer = container.createEl("div", {
            cls: "tag-filter-container",
        });

        // 点击容器任意位置，如果任务面板未打开则打开它
        mainContainer.addEventListener("click", async (e) => {
            // 检查任务结果面板是否已打开
            const existingLeaf = this.app.workspace.getLeavesOfType(TASK_RESULT_VIEW_TYPE)[0];
            if (!existingLeaf) {
                // 打开任务面板
                await this.openTaskResultView();
            }
        });

        // 标题和刷新按钮
        const headerEl = mainContainer.createEl("div", {
            cls: "tag-filter-header",
        });

        headerEl.createEl("h4", { text: "选择标签" });

        // 按钮组容器
        const headerBtns = headerEl.createEl("div", {
            cls: "tag-filter-header-btns",
        });

        // 清除选择按钮（图标）
        const clearBtn = headerBtns.createEl("button", {
            cls: "tag-filter-icon-btn",
            attr: { "aria-label": "清除选择" },
        });
        clearBtn.innerHTML = "✕";
        clearBtn.addEventListener("click", () => this.clearSelection());

        // 刷新按钮（图标）
        const refreshBtn = headerBtns.createEl("button", {
            cls: "tag-filter-icon-btn",
            attr: { "aria-label": "刷新标签" },
        });
        refreshBtn.innerHTML = "🔄";
        refreshBtn.addEventListener("click", () => this.refresh());

        // 标签列表
        const tagListEl = mainContainer.createEl("div", {
            cls: "tag-filter-list",
        });

        if (this.tags.length === 0) {
            tagListEl.createEl("p", {
                text: "未找到任何标签",
                cls: "tag-filter-empty",
            });
        } else {
            const tree = this.buildTagTree();
            this.renderTagTree(tagListEl, tree, 0);
        }

        // 提及区块（列出库中所有 @人名）
        this.renderMentionSection(mainContainer);
    }

    // 构建提及树（按 / 分级）
    private buildMentionTree(): MentionTreeNode {
        const root: MentionTreeNode = {
            name: "",
            fullName: "",
            count: 0,
            children: new Map(),
        };

        for (const mention of this.mentions) {
            const parts = mention.name.split("/");
            let currentNode = root;
            let currentPath = "";

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!part) continue;

                currentPath = i === 0 ? part : `${currentPath}/${part}`;

                if (!currentNode.children.has(part)) {
                    currentNode.children.set(part, {
                        name: part,
                        fullName: currentPath,
                        count: 0,
                        children: new Map(),
                    });
                }

                const nextNode = currentNode.children.get(part);
                if (!nextNode) continue;
                currentNode = nextNode;

                if (i === parts.length - 1) {
                    currentNode.count = mention.count;
                }
            }
        }

        return root;
    }

    private renderMentionSection(mainContainer: HTMLElement): void {
        const sectionEl = mainContainer.createEl("div", {
            cls: "mention-section",
        });

        // 区块标题（可折叠）
        const headerEl = sectionEl.createEl("div", {
            cls: "mention-section-header",
        });
        const toggleEl = headerEl.createEl("span", {
            cls: "tag-filter-toggle",
        });
        toggleEl.setText(this.mentionSectionCollapsed ? "▶" : "▼");
        headerEl.createEl("h4", { text: "提及" });
        if (this.mentions.length > 0) {
            headerEl.createEl("span", {
                text: `(${this.mentions.length})`,
                cls: "tag-filter-tag-count",
            });
        }
        headerEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.mentionSectionCollapsed = !this.mentionSectionCollapsed;
            this.render();
        });

        if (this.mentionSectionCollapsed) return;

        const listEl = sectionEl.createEl("div", {
            cls: "mention-list",
        });

        if (this.mentions.length === 0) {
            listEl.createEl("p", {
                text: "未找到任何提及（在笔记中用 @人名 来添加）",
                cls: "tag-filter-empty",
            });
            return;
        }

        const tree = this.buildMentionTree();
        this.renderMentionTree(listEl, tree, 0);
    }

    private renderMentionTree(container: HTMLElement, node: MentionTreeNode, depth: number): void {
        const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        for (const child of sortedChildren) {
            const hasChildren = child.children.size > 0;
            const isExpanded = this.expandedMentionGroups.has(child.fullName);

            const itemEl = container.createEl("div", {
                cls: `tag-filter-item mention-item depth-${depth} ${hasChildren ? "has-children" : ""}`,
            });

            if (hasChildren) {
                const toggleEl = itemEl.createEl("span", {
                    cls: `tag-filter-toggle ${isExpanded ? "" : "is-collapsed"}`,
                });
                toggleEl.setText(isExpanded ? "▼" : "▶");
            }

            const displayName = depth === 0 ? `@${child.name}` : child.name;
            itemEl.createEl("span", {
                text: displayName,
                cls: "tag-filter-tag-name mention-name",
            });

            if (child.count > 0) {
                itemEl.createEl("span", {
                    text: `(${child.count})`,
                    cls: "tag-filter-tag-count",
                });
            }

            itemEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (hasChildren) {
                    // 父节点：展开/折叠
                    if (isExpanded) {
                        this.expandedMentionGroups.delete(child.fullName);
                    } else {
                        this.expandedMentionGroups.add(child.fullName);
                    }
                    this.render();
                } else if ((e.metaKey || e.ctrlKey) && this.plugin.settings.mentionNotesFolder) {
                    // Cmd/Ctrl+点击：打开人物笔记
                    void openPersonNote(this.app, this.plugin.settings.mentionNotesFolder, child.fullName);
                } else {
                    // 叶子节点：打开全局搜索
                    this.searchMention(child.fullName);
                }
            });

            // 右键菜单：重命名/人物笔记
            if (!hasChildren) {
                itemEl.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showMentionMenu(e, child.fullName);
                });
            }

            if (hasChildren && isExpanded) {
                const childrenEl = container.createEl("div", {
                    cls: "mention-children",
                });
                this.renderMentionTree(childrenEl, child, depth + 1);
            }
        }
    }

    // 用全局搜索定位某个人名的所有提及
    private searchMention(name: string): void {
        openMentionSearch(this.app, name);
    }

    // 提及右键菜单
    private showMentionMenu(e: MouseEvent, name: string): void {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle("搜索所有提及")
            .setIcon("search")
            .onClick(() => this.searchMention(name)));

        if (this.plugin.settings.mentionNotesFolder) {
            menu.addItem(item => item
                .setTitle("打开人物笔记")
                .setIcon("file-text")
                .onClick(() => {
                    void openPersonNote(this.app, this.plugin.settings.mentionNotesFolder, name);
                }));
        }

        menu.addItem(item => item
            .setTitle("重命名 / 合并…")
            .setIcon("pencil")
            .onClick(() => {
                new RenameMentionModal(this.app, name, async (newName) => {
                    const changed = await renameMention(this.app, name, newName);
                    new Notice(`已把 @${name} 改为 @${newName}（${changed} 个文件）`);
                    this.plugin.mentionIndex.markDirty();
                    await this.refresh();
                }).open();
            }));

        menu.showAtMouseEvent(e);
    }

    private renderTagTree(container: HTMLElement, node: TagTreeNode, depth: number): void {
        // 按名称排序
        const sortedChildren = Array.from(node.children.values()).sort((a, b) => 
            a.name.localeCompare(b.name)
        );

        for (const child of sortedChildren) {
            const hasChildren = child.children.size > 0;
            const isExpanded = this.expandedGroups.has(child.fullTag);

            if (hasChildren) {
                // 有子标签的父标签：创建一个包含父标签和子标签的容器
                const groupEl = container.createEl("div", {
                    cls: `tag-filter-group ${isExpanded ? "is-expanded" : ""}`,
                });

                // 父标签
                const tagEl = groupEl.createEl("div", {
                    cls: `tag-filter-item has-children ${this.selectedTags.has(child.fullTag) ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""} depth-${depth}`,
                });

                // 展开图标
                const toggleEl = tagEl.createEl("span", {
                    cls: `tag-filter-toggle ${isExpanded ? "" : "is-collapsed"}`,
                });
                toggleEl.innerHTML = isExpanded ? "▼" : "▶";

                // 显示名称
                const displayName = depth === 0 ? `#${child.name}` : child.name;
                tagEl.createEl("span", {
                    text: displayName,
                    cls: "tag-filter-tag-name",
                });

                // 计数
                if (child.count > 0) {
                    tagEl.createEl("span", {
                        text: `(${child.count})`,
                        cls: "tag-filter-tag-count",
                    });
                }

                // 点击父标签：展开/折叠子标签
                tagEl.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.toggleGroup(child.fullTag);
                });

                // 子标签容器（始终创建，通过CSS控制显示/隐藏）
                if (isExpanded) {
                    const childrenEl = groupEl.createEl("div", {
                        cls: "tag-filter-children",
                    });
                    // 扁平化渲染所有子标签
                    this.renderChildTagsFlat(childrenEl, child);
                }
            } else {
                // 叶子标签：直接创建
                const tagEl = container.createEl("div", {
                    cls: `tag-filter-item ${this.selectedTags.has(child.fullTag) ? "is-selected" : ""} depth-${depth}`,
                });

                // 显示名称
                const displayName = depth === 0 ? `#${child.name}` : child.name;
                tagEl.createEl("span", {
                    text: displayName,
                    cls: "tag-filter-tag-name",
                });

                // 计数
                if (child.count > 0) {
                    tagEl.createEl("span", {
                        text: `(${child.count})`,
                        cls: "tag-filter-tag-count",
                    });
                }

                // 点击叶子标签：触发筛选
                tagEl.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.toggleTag(child.fullTag, !this.selectedTags.has(child.fullTag));
                });
            }
        }
    }

    private toggleGroup(fullTag: string): void {
        if (this.expandedGroups.has(fullTag)) {
            this.expandedGroups.delete(fullTag);
            document.removeEventListener("click", this.handleOutsideClick);
        } else {
            // 关闭其他展开的组
            this.expandedGroups.clear();
            this.expandedGroups.add(fullTag);
            // 添加点击外部关闭的监听
            setTimeout(() => {
                document.addEventListener("click", this.handleOutsideClick);
            }, 0);
        }
        this.render();
    }

    private handleOutsideClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        // 如果点击的不是标签组内的元素，关闭所有展开的组
        if (!target.closest(".tag-filter-group")) {
            this.expandedGroups.clear();
            document.removeEventListener("click", this.handleOutsideClick);
            this.render();
        }
    };

    private renderChildTagsFlat(container: HTMLElement, node: TagTreeNode): void {
        const sortedChildren = Array.from(node.children.values()).sort((a, b) => 
            a.name.localeCompare(b.name)
        );

        for (const child of sortedChildren) {
            const tagEl = container.createEl("div", {
                cls: `tag-filter-item child-item ${this.selectedTags.has(child.fullTag) ? "is-selected" : ""}`,
            });

            tagEl.createEl("span", {
                text: child.name,
                cls: "tag-filter-tag-name",
            });

            if (child.count > 0) {
                tagEl.createEl("span", {
                    text: `(${child.count})`,
                    cls: "tag-filter-tag-count",
                });
            }

            tagEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleTag(child.fullTag, !this.selectedTags.has(child.fullTag));
            });

            // 如果有子标签，递归渲染
            if (child.children.size > 0) {
                this.renderChildTagsFlat(container, child);
            }
        }
    }

    private async toggleTag(tag: string, selected: boolean): Promise<void> {
        if (selected) {
            this.selectedTags.add(tag);
        } else {
            this.selectedTags.delete(tag);
        }
        this.render();
        // 立即触发过滤
        await this.openTaskResultView();
    }

    private async clearSelection(): Promise<void> {
        this.selectedTags.clear();
        this.render();
        // 清除后也刷新任务列表
        await this.openTaskResultView();
    }

    private async openTaskResultView(): Promise<void> {
        const selectedTagsArray = Array.from(this.selectedTags);

        // 打开或激活结果视图
        let leaf = this.app.workspace.getLeavesOfType(TASK_RESULT_VIEW_TYPE)[0];
        if (!leaf) {
            leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({
                type: TASK_RESULT_VIEW_TYPE,
                active: true,
            });
        }

        this.app.workspace.revealLeaf(leaf);

        // 等待视图完全初始化后再设置标签
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 直接从 leaf 获取视图并设置标签
        const view = leaf.view as TaskResultView;
        if (view && typeof view.setSelectedTags === "function") {
            await view.setSelectedTags(selectedTagsArray);
        }
    }
}

/** 重命名/合并提及的输入弹窗 */
class RenameMentionModal extends Modal {
    private oldName: string;
    private onSubmit: (newName: string) => Promise<void>;

    constructor(app: App, oldName: string, onSubmit: (newName: string) => Promise<void>) {
        super(app);
        this.oldName = oldName;
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: `重命名 @${this.oldName}` });
        contentEl.createEl("p", {
            text: "将在整个库中替换该人名；如果新名字已存在，则相当于合并。",
            cls: "setting-item-description",
        });

        const input = contentEl.createEl("input", {
            type: "text",
            cls: "rename-mention-input",
            attr: { placeholder: "新人名，如 hit/zhangsan" },
        });
        input.value = this.oldName;
        input.focus();
        input.select();

        const submit = async (): Promise<void> => {
            const newName = input.value.trim().replace(/^@/, "");
            if (!newName) {
                new Notice("请输入新人名");
                return;
            }
            if (!/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(newName)) {
                new Notice("人名只能包含中文、字母、数字、_、-，多级用 / 分隔");
                return;
            }
            if (newName === this.oldName) {
                this.close();
                return;
            }
            this.close();
            await this.onSubmit(newName);
        };

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void submit();
            }
        });

        const btnRow = contentEl.createEl("div", { cls: "rename-mention-btns" });
        const cancelBtn = btnRow.createEl("button", { text: "取消" });
        cancelBtn.addEventListener("click", () => this.close());
        const okBtn = btnRow.createEl("button", { text: "重命名", cls: "mod-cta" });
        okBtn.addEventListener("click", () => void submit());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
