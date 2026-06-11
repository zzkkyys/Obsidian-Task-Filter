import { App, Component, MarkdownRenderer, Notice, Scope, TFile, moment, normalizePath, setIcon, setTooltip } from "obsidian";
import type TaskFilterPlugin from "../main";
import { MentionIndex } from "../utils/mentionScanner";
import { MemoEntry, extractMemos } from "../utils/memoScanner";
import { attachMentionAutocomplete } from "../suggest/inputMentionSuggest";

// 当天模式条目头：HH:mm[:ss] - HH:mm[:ss] |
const DAY_HEAD_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-~—–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\|/;

interface DayEntry {
    startSeconds: number;
    endSeconds: number;
    label: string;
    title: string;
    descLines: string[];
    lineInBlock: number; // 条目首行在代码块内的行号
    lineSpan: number;    // 条目占的总行数（首行 + 后续描述行）
    headerRaw: string;   // 条目首行原文（回写文件时用于校验定位）
    hasSeconds: boolean;
}

interface TimelineBlock {
    fenceStart: number; // 开头 ``` 行号（文件内，0 基）
    fenceEnd: number;   // 结尾 ``` 行号
    blockLines: string[];
}

interface DailyNotesConfig {
    folder: string;
    format: string;
    template: string;
}

// 编辑卡片的草稿（存在状态里，视图被外部刷新重建时不丢失）
interface EntryDraft {
    start: string;
    end: string;
    title: string;
    desc: string;
}

/**
 * 「当天时间线」子视图：读取选定日期的每日笔记里的 ob-timeline（当天模式）块，
 * 渲染成时间线，并提供快捷表单往块里追加时间段条目。
 */
export class DayTimelineSection {
    private app: App;
    private plugin: TaskFilterPlugin;
    private component: Component;
    private mentionIndex: MentionIndex;
    private date: string; // YYYY-MM-DD
    // 编辑卡片打开时压入的按键作用域（让 Mod+Enter 优先于全局快捷键）
    private activeKeyScope: Scope | null = null;
    private containerEl: HTMLElement | null = null;
    // 当前展开的内嵌编辑器：新增模式，或正在编辑的条目（按首行原文识别）；draft 保存未提交的输入
    private editorState:
        | { mode: "add"; draft: EntryDraft }
        | { mode: "edit"; headerRaw: string; draft: EntryDraft }
        | null = null;

    constructor(plugin: TaskFilterPlugin, component: Component) {
        this.app = plugin.app;
        this.plugin = plugin;
        this.component = component;
        this.mentionIndex = plugin.mentionIndex;
        this.date = moment().format("YYYY-MM-DD");

        // 看“今天”时每分钟刷新一次“正在进行”高亮；有编辑卡片展开时跳过，避免打扰输入
        this.component.registerInterval(window.setInterval(() => {
            if (!this.containerEl || !this.containerEl.isConnected) return;
            if (this.editorState) return;
            if (this.date !== moment().format("YYYY-MM-DD")) return;
            this.rerender();
        }, 60 * 1000));
    }

    render(container: HTMLElement): void {
        this.containerEl = container;
        void this.renderContent();
    }

    private rerender(): void {
        if (this.containerEl) {
            this.containerEl.empty();
            void this.renderContent();
        }
    }

    private setKeyScope(scope: Scope | null): void {
        if (this.activeKeyScope) {
            this.app.keymap.popScope(this.activeKeyScope);
            this.activeKeyScope = null;
        }
        if (scope) {
            this.app.keymap.pushScope(scope);
            this.activeKeyScope = scope;
        }
    }

    private async renderContent(): Promise<void> {
        const container = this.containerEl;
        if (!container) return;

        // 每次重渲染先弹出旧作用域；如果编辑卡片仍然存在，下面会重新压入
        this.setKeyScope(null);

        const file = this.findDailyNote();
        this.renderDateNav(container, file);

        let block: TimelineBlock | null = null;
        let entries: DayEntry[] = [];
        let memos: MemoEntry[] = [];

        if (file) {
            const content = await this.app.vault.cachedRead(file);
            const contentLines = content.split("\n");
            block = this.findTimelineBlock(contentLines);
            if (block) {
                entries = this.parseDayEntries(block.blockLines);
            }
            if (this.plugin.settings.dayTimelineShowMemos) {
                memos = extractMemos(contentLines);
            }
        }

        this.renderAddTrigger(container);

        // 时间段条目与 memos 合并，统一按时间升序
        const renderItems: Array<{ sortKey: number; entry?: DayEntry; memo?: MemoEntry }> = [
            ...entries.map(e => ({ sortKey: e.startSeconds, entry: e })),
            ...memos.map(m => ({ sortKey: m.timeSeconds, memo: m })),
        ];
        renderItems.sort((a, b) => a.sortKey - b.sortKey);

        const timelineEl = container.createEl("div", { cls: "ob-timeline ob-timeline-day day-timeline-body" });

        if (renderItems.length === 0) {
            timelineEl.createEl("p", {
                text: "这一天还没有时间段记录",
                cls: "ob-timeline-empty",
            });
            return;
        }

        const isToday = this.date === moment().format("YYYY-MM-DD");
        const now = new Date();
        const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

        for (const item of renderItems) {
            if (item.memo) {
                if (file) {
                    await this.renderMemoItem(timelineEl, item.memo, file);
                }
                continue;
            }
            const entry = item.entry;
            if (!entry) continue;
            // 正在编辑的条目：原地替换为编辑卡片
            if (this.editorState?.mode === "edit"
                && this.editorState.headerRaw === entry.headerRaw
                && file && block) {
                this.renderEntryEditor(timelineEl, this.buildEditOptions(file, block, entry));
                continue;
            }

            // 跨午夜条目：now 或 now+24h 落在区间内都算正在进行
            const isNow = isToday
                && ((nowSeconds >= entry.startSeconds && nowSeconds < entry.endSeconds)
                    || (nowSeconds + 24 * 3600 >= entry.startSeconds && nowSeconds + 24 * 3600 < entry.endSeconds));
            const itemEl = timelineEl.createEl("div", {
                cls: `ob-timeline-item ${isNow ? "is-now" : ""}`,
            });

            // 点击条目：原地展开编辑卡片
            itemEl.setAttribute("title", "点击编辑此条目");
            itemEl.addEventListener("click", () => {
                if (file && block) {
                    const [startStr, endStr] = entry.label.replace(" ⁺¹", "").split(" - ");
                    this.editorState = {
                        mode: "edit",
                        headerRaw: entry.headerRaw,
                        draft: {
                            start: startStr || "",
                            end: endStr || "",
                            title: entry.title,
                            desc: entry.descLines.join("\n").trim(),
                        },
                    };
                    this.rerender();
                }
            });

            const timeEl = itemEl.createEl("div", { cls: "ob-timeline-time" });
            timeEl.createEl("span", { text: entry.label, cls: "ob-timeline-time-label" });
            timeEl.createEl("span", {
                text: this.formatDuration(entry.endSeconds - entry.startSeconds),
                cls: "ob-timeline-duration",
            });

            const axisEl = itemEl.createEl("div", { cls: "ob-timeline-axis" });
            axisEl.createEl("div", { cls: "ob-timeline-dot" });
            axisEl.createEl("div", { cls: "ob-timeline-line" });

            const cardEl = itemEl.createEl("div", { cls: "ob-timeline-card" });
            cardEl.createEl("div", { text: entry.title, cls: "ob-timeline-title" });
            const description = entry.descLines.join("\n").trim();
            if (description) {
                const descEl = cardEl.createEl("div", { cls: "ob-timeline-desc" });
                await MarkdownRenderer.render(this.app, description, descEl, file?.path ?? "", this.component);
            }
        }
    }

    // 渲染单条 memo（来自 Journal Memos 的 ```memos 块），点击跳转到笔记对应位置
    private async renderMemoItem(container: HTMLElement, memo: MemoEntry, file: TFile): Promise<void> {
        const itemEl = container.createEl("div", { cls: "ob-timeline-item is-memo" });
        itemEl.setAttribute("title", "点击在笔记中定位此 memo");
        itemEl.addEventListener("click", () => {
            void this.openNoteAtLine(file, memo.line + 1);
        });

        const timeEl = itemEl.createEl("div", { cls: "ob-timeline-time" });
        timeEl.createEl("span", { text: memo.label, cls: "ob-timeline-time-label" });
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- 小写 memo 为徽标样式
        timeEl.createEl("span", { text: "memo", cls: "ob-timeline-memo-badge" });

        const axisEl = itemEl.createEl("div", { cls: "ob-timeline-axis" });
        axisEl.createEl("div", { cls: "ob-timeline-dot" });
        axisEl.createEl("div", { cls: "ob-timeline-line" });

        const cardEl = itemEl.createEl("div", { cls: "ob-timeline-card" });
        if (memo.text) {
            const contentEl = cardEl.createEl("div", { cls: "ob-timeline-memo-content" });
            await MarkdownRenderer.render(this.app, memo.text, contentEl, file.path, this.component);
        } else {
            cardEl.createEl("div", { text: "（空 memo）", cls: "ob-timeline-desc" });
        }
    }

    // 日期导航：◀ 今天 ▶ + 日期选择
    private renderDateNav(container: HTMLElement, file: TFile | null): void {
        const navEl = container.createEl("div", { cls: "day-timeline-nav" });

        const prevBtn = navEl.createEl("button", {
            text: "◀",
            cls: "day-timeline-nav-btn",
            attr: { "aria-label": "前一天" },
        });
        prevBtn.addEventListener("click", () => {
            this.editorState = null;
            this.date = moment(this.date).subtract(1, "day").format("YYYY-MM-DD");
            this.rerender();
        });

        const dateInput = navEl.createEl("input", {
            type: "date",
            cls: "day-timeline-date-input",
        });
        dateInput.value = this.date;
        dateInput.addEventListener("change", () => {
            if (dateInput.value) {
                this.editorState = null;
                this.date = dateInput.value;
                this.rerender();
            }
        });

        const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
        navEl.createEl("span", {
            text: `周${weekdayNames[moment(this.date).day()] || ""}`,
            cls: "day-timeline-weekday",
        });

        const nextBtn = navEl.createEl("button", {
            text: "▶",
            cls: "day-timeline-nav-btn",
            attr: { "aria-label": "后一天" },
        });
        nextBtn.addEventListener("click", () => {
            this.editorState = null;
            this.date = moment(this.date).add(1, "day").format("YYYY-MM-DD");
            this.rerender();
        });

        const todayBtn = navEl.createEl("button", {
            text: "今天",
            cls: "day-timeline-nav-btn day-timeline-today-btn",
        });
        todayBtn.addEventListener("click", () => {
            this.editorState = null;
            this.date = moment().format("YYYY-MM-DD");
            this.rerender();
        });

        // memos 显示开关
        const showMemos = this.plugin.settings.dayTimelineShowMemos;
        const memosBtn = navEl.createEl("button", {
            text: "💬",
            cls: `day-timeline-nav-btn day-timeline-memos-btn ${showMemos ? "is-active" : ""}`,
            attr: { "aria-label": showMemos ? "隐藏 memos" : "显示 memos" },
        });
        setTooltip(memosBtn, showMemos ? "隐藏 memos" : "在时间线中显示 memos");
        memosBtn.addEventListener("click", () => {
            void (async () => {
                this.plugin.settings.dayTimelineShowMemos = !this.plugin.settings.dayTimelineShowMemos;
                await this.plugin.saveSettings();
                this.rerender();
            })();
        });

        // 右侧：每日笔记状态胶囊
        const chipEl = navEl.createEl(file ? "a" : "span", {
            cls: `day-timeline-note-chip ${file ? "is-exists" : "is-missing"}`,
        });
        chipEl.createEl("span", { cls: "day-timeline-note-dot" });
        chipEl.createEl("span", {
            text: file ? file.basename : "无每日笔记",
            cls: "day-timeline-note-chip-text",
        });
        if (file) {
            setTooltip(chipEl, "打开每日笔记");
            chipEl.addEventListener("click", (e) => {
                e.preventDefault();
                void this.app.workspace.openLinkText(file.path, "", false);
            });
        } else {
            setTooltip(chipEl, "添加条目时会自动创建");
        }
    }

    // 快捷添加：memos 风格的输入卡片，点击原地展开为编辑卡片
    private renderAddTrigger(container: HTMLElement): void {
        const state = this.editorState;
        if (state?.mode === "add") {
            this.renderEntryEditor(container, {
                saveLabel: "添加",
                start: state.draft.start,
                end: state.draft.end,
                title: state.draft.title,
                desc: state.draft.desc,
                hasSeconds: false,
                onChange: (draft) => { state.draft = draft; },
                onSave: async (start, end, title, desc) => {
                    await this.appendEntryLines(this.buildEntryLines(start, end, title, desc));
                    this.editorState = null;
                    this.rerender();
                },
                onCancel: () => {
                    this.editorState = null;
                    this.rerender();
                },
            });
            return;
        }

        const cardEl = container.createEl("div", { cls: "day-timeline-add-card" });
        const iconEl = cardEl.createEl("span", { cls: "day-timeline-add-icon" });
        setIcon(iconEl, "plus");
        cardEl.createEl("span", {
            text: "记录一段时间…",
            cls: "day-timeline-add-placeholder",
        });

        cardEl.addEventListener("click", () => {
            const now = moment();
            this.editorState = {
                mode: "add",
                draft: {
                    start: now.format("HH:mm"),
                    end: now.add(1, "hour").format("HH:mm"),
                    title: "",
                    desc: "",
                },
            };
            this.rerender();
        });
    }

    // 往每日笔记的 ob-timeline 块末尾追加条目（笔记/代码块不存在则创建）
    private async appendEntryLines(entryLines: string[]): Promise<void> {
        let file = this.findDailyNote();

        if (!file) {
            file = await this.createDailyNote();
            if (!file) return;
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split("\n");
            const block = this.findTimelineBlock(lines);
            if (block) {
                lines.splice(block.fenceEnd, 0, ...entryLines);
                return lines.join("\n");
            }
            // 没有块：在文末追加二级标题 + 时间线块
            const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
            return `${content}${suffix}\n## 时间线\n\n\`\`\`ob-timeline\nmode: day\n${entryLines.join("\n")}\n\`\`\`\n`;
        });

        new Notice(`已添加：${entryLines[0] || ""}`);
    }

    // ===== 每日笔记定位 =====

    private getDailyNotesConfig(): DailyNotesConfig {
        interface InternalPluginsApp {
            internalPlugins?: {
                getPluginById?: (id: string) => {
                    instance?: { options?: { folder?: string; format?: string; template?: string } };
                } | null;
            };
        }
        const appWithInternals = this.app as unknown as InternalPluginsApp;
        const options = appWithInternals.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
        return {
            folder: (options?.folder || "").trim(),
            format: (options?.format || "").trim() || "YYYY-MM-DD",
            template: (options?.template || "").trim(),
        };
    }

    private dailyNotePath(): string {
        const { folder, format } = this.getDailyNotesConfig();
        const name = moment(this.date).format(format);
        return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
    }

    private findDailyNote(): TFile | null {
        const path = this.dailyNotePath();
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return file;

        // 兜底：按文件名匹配（用户可能改过每日笔记目录）
        const { format } = this.getDailyNotesConfig();
        const basename = moment(this.date).format(format).split("/").pop() || this.date;
        const match = this.app.vault.getMarkdownFiles().find(f => f.basename === basename);
        return match ?? null;
    }

    private async createDailyNote(): Promise<TFile | null> {
        const path = this.dailyNotePath();
        // 逐级创建父目录
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (!dir || this.app.vault.getAbstractFileByPath(dir)) continue;
            try {
                await this.app.vault.createFolder(dir);
            } catch {
                // 并发创建等情况忽略
            }
        }
        try {
            const basename = parts[parts.length - 1]?.replace(/\.md$/, "") || this.date;
            const content = await this.renderDailyTemplate(basename);
            const file = await this.app.vault.create(path, content);
            // 模板里有 Templater 语法时，调用 Templater 执行它
            if (content.includes("<%")) {
                await this.processWithTemplater(file);
            }
            new Notice(`已创建每日笔记：${path}`);
            return file;
        } catch (e) {
            new Notice(`创建每日笔记失败：${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }

    /**
     * 用 Templater 插件处理新建笔记中的 <% %> 模板语法。
     * 如果用户开启了 Templater 的“新建文件时自动触发”，则交给它自己处理，避免重复执行。
     */
    private async processWithTemplater(file: TFile): Promise<void> {
        interface TemplaterApp {
            plugins?: {
                plugins?: Record<string, {
                    settings?: { trigger_on_file_creation?: boolean };
                    templater?: { overwrite_file_commands?: (file: TFile) => Promise<void> };
                } | undefined>;
            };
        }
        const templaterPlugin = (this.app as unknown as TemplaterApp).plugins?.plugins?.["templater-obsidian"];
        const overwrite = templaterPlugin?.templater?.overwrite_file_commands;
        if (!overwrite) {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Templater 是插件专有名词
            new Notice("模板包含 Templater 语法，但未检测到 Templater 插件，已按原文写入");
            return;
        }
        if (templaterPlugin.settings?.trigger_on_file_creation) {
            // Templater 会在文件创建事件里自己处理
            return;
        }
        try {
            await overwrite.call(templaterPlugin.templater, file);
        } catch (e) {
            new Notice(`Templater 模板处理失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** 读取“每日笔记”插件配置的模板并替换常用占位符；没有模板则返回空串 */
    private async renderDailyTemplate(noteTitle: string): Promise<string> {
        const { template } = this.getDailyNotesConfig();
        if (!template) return "";

        let templateFile = this.app.vault.getAbstractFileByPath(normalizePath(`${template}.md`));
        if (!templateFile) {
            templateFile = this.app.vault.getAbstractFileByPath(normalizePath(template));
        }
        if (!(templateFile instanceof TFile)) return "";

        let content: string;
        try {
            content = await this.app.vault.cachedRead(templateFile);
        } catch {
            return "";
        }

        const noteMoment = moment(this.date);
        const now = moment();
        return content
            .replace(/{{\s*title\s*}}/gi, noteTitle)
            .replace(/{{\s*date(?::([^}]+))?\s*}}/gi, (_m, fmt: string | undefined) =>
                noteMoment.format((fmt || "YYYY-MM-DD").trim()))
            .replace(/{{\s*time(?::([^}]+))?\s*}}/gi, (_m, fmt: string | undefined) =>
                now.format((fmt || "HH:mm").trim()));
    }

    private async openNoteAtLine(file: TFile, line: number): Promise<void> {
        await this.app.workspace.openLinkText(file.path, "", false, {
            eState: { line },
        });
    }

    // ===== 条目编辑 =====

    private buildEditOptions(file: TFile, block: TimelineBlock, entry: DayEntry): DayEntryEditorOptions {
        const state = this.editorState;
        const [startStr, endStr] = entry.label.replace(" ⁺¹", "").split(" - ");
        const draft: EntryDraft = state?.mode === "edit" ? state.draft : {
            start: startStr || "",
            end: endStr || "",
            title: entry.title,
            desc: entry.descLines.join("\n").trim(),
        };
        return {
            saveLabel: "保存",
            start: draft.start,
            end: draft.end,
            title: draft.title,
            desc: draft.desc,
            hasSeconds: entry.hasSeconds,
            onChange: (d) => {
                if (state?.mode === "edit") state.draft = d;
            },
            onSave: async (start, end, title, desc) => {
                const newLines = this.buildEntryLines(start, end, title, desc);
                await this.replaceEntryLines(file, entry, newLines);
                this.editorState = null;
                this.rerender();
            },
            onDelete: async () => {
                await this.replaceEntryLines(file, entry, []);
                this.editorState = null;
                this.rerender();
            },
            onOpenNote: () => {
                this.editorState = null;
                void this.openNoteAtLine(file, block.fenceStart + 1 + entry.lineInBlock);
            },
            onCancel: () => {
                this.editorState = null;
                this.rerender();
            },
        };
    }

    /** 生成条目的源码行：单行描述放在行内，多行描述放在首行下方 */
    private buildEntryLines(start: string, end: string, title: string, desc: string): string[] {
        const header = `${start} - ${end} | ${title}`;
        if (!desc) return [header];
        if (!desc.includes("\n")) return [`${header} | ${desc}`];
        return [header, ...desc.split("\n")];
    }

    /** 用新内容替换条目在文件中占的行（newLines 为空数组即删除条目） */
    private async replaceEntryLines(file: TFile, entry: DayEntry, newLines: string[]): Promise<void> {
        let failReason: string | null = null;

        await this.app.vault.process(file, (content) => {
            const lines = content.split("\n");
            const block = this.findTimelineBlock(lines);
            if (!block) {
                failReason = "笔记中找不到 ob-timeline 块";
                return content;
            }

            // 优先按记录的行号定位，文件被改过时按原文搜索兜底
            let idx = entry.lineInBlock;
            if ((block.blockLines[idx] || "").trim() !== entry.headerRaw) {
                idx = block.blockLines.findIndex(l => l.trim() === entry.headerRaw);
            }
            if (idx === -1) {
                failReason = "条目已被修改，请刷新后重试";
                return content;
            }

            const startLine = block.fenceStart + 1 + idx;
            const span = Math.min(entry.lineSpan, block.fenceEnd - startLine);
            lines.splice(startLine, span, ...newLines);
            return lines.join("\n");
        });

        if (failReason) {
            new Notice(failReason);
        } else {
            new Notice(newLines.length === 0 ? "已删除条目" : "已保存修改");
        }
    }

    // ===== ob-timeline 块解析 =====

    /** 找文件中第一个当天模式的 ob-timeline 块（没有当天模式块则退回第一个块） */
    private findTimelineBlock(lines: string[]): TimelineBlock | null {
        let firstBlock: TimelineBlock | null = null;

        for (let i = 0; i < lines.length; i++) {
            if (!/^```+\s*ob-timeline\s*$/.test((lines[i] || "").trim())) continue;

            let end = -1;
            for (let j = i + 1; j < lines.length; j++) {
                if (/^```+\s*$/.test((lines[j] || "").trim())) {
                    end = j;
                    break;
                }
            }
            if (end === -1) break;

            const blockLines = lines.slice(i + 1, end);
            const block: TimelineBlock = { fenceStart: i, fenceEnd: end, blockLines };

            const isDayMode = blockLines.some(l => /^mode\s*:\s*day$/i.test(l.trim()))
                || blockLines.some(l => DAY_HEAD_RE.test(l.trim()));
            if (isDayMode) return block;

            if (!firstBlock) firstBlock = block;
            i = end;
        }

        return firstBlock;
    }

    private parseDayEntries(blockLines: string[]): DayEntry[] {
        const entries: DayEntry[] = [];
        let current: DayEntry | null = null;

        for (let i = 0; i < blockLines.length; i++) {
            const rawLine = blockLines[i] || "";
            const line = rawLine.trim();

            if (/^mode\s*:\s*(date|day)$/i.test(line) && !current) continue;
            if (line.startsWith("//")) continue;

            const match = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-~—–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\|(.*)$/);
            if (match) {
                const startSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
                let endSeconds = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6] || 0);
                const hasSeconds = match[3] !== undefined || match[6] !== undefined;
                // 结束早于开始：视为跨午夜（如 23:00 - 01:00）
                const crossesMidnight = endSeconds <= startSeconds;
                if (crossesMidnight) endSeconds += 24 * 3600;
                const rest = (match[7] || "").split("|").map(p => p.trim());
                const title = rest[0] || "";
                if (title) {
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const fmt = (total: number) => {
                        const inDay = total % (24 * 3600);
                        const h = Math.floor(inDay / 3600);
                        const m = Math.floor((inDay % 3600) / 60);
                        const s = inDay % 60;
                        return hasSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
                    };
                    current = {
                        startSeconds,
                        endSeconds,
                        label: `${fmt(startSeconds)} - ${fmt(endSeconds)}${crossesMidnight ? " ⁺¹" : ""}`,
                        title,
                        descLines: rest.length > 1 ? [rest.slice(1).join(" | ")] : [],
                        lineInBlock: i,
                        lineSpan: 1,
                        headerRaw: line,
                        hasSeconds,
                    };
                    entries.push(current);
                    continue;
                }
            }

            if (current) {
                current.descLines.push(rawLine);
                current.lineSpan++;
            }
        }

        for (const entry of entries) {
            while (entry.descLines.length > 0 && !(entry.descLines[entry.descLines.length - 1] || "").trim()) {
                entry.descLines.pop();
            }
        }

        return entries;
    }

    private formatDuration(seconds: number): string {
        if (seconds <= 0) return "";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const segs: string[] = [];
        if (h > 0) segs.push(`${h}h`);
        if (m > 0) segs.push(`${m}m`);
        if (s > 0 && h === 0) segs.push(`${s}s`);
        return segs.join("") || "";
    }

    // ===== 内嵌编辑卡片（memos 风格） =====

    private renderEntryEditor(container: HTMLElement, options: DayEntryEditorOptions): void {
        const cardEl = container.createEl("div", { cls: "day-timeline-editor" });

        let start = options.start;
        let end = options.end;
        let desc = options.desc;

        const timeStep = options.hasSeconds ? "1" : "60";

        // ── 顶部：时间段 + 实时时长 ──
        const headerEl = cardEl.createEl("div", { cls: "dtm-header" });
        const timeGroup = headerEl.createEl("div", { cls: "dtm-time-group" });

        const startInput = timeGroup.createEl("input", {
            type: "time",
            cls: "dtm-time-input",
            attr: { step: timeStep, "aria-label": "开始时间" },
        });
        startInput.value = start;

        timeGroup.createEl("span", { text: "→", cls: "dtm-time-arrow" });

        const endInput = timeGroup.createEl("input", {
            type: "time",
            cls: "dtm-time-input",
            attr: { step: timeStep, "aria-label": "结束时间" },
        });
        endInput.value = end;

        const durationEl = headerEl.createEl("span", { cls: "dtm-duration" });
        const updateDuration = (): void => {
            const toSeconds = (v: string): number => {
                const segs = v.split(":").map(Number);
                return (segs[0] || 0) * 3600 + (segs[1] || 0) * 60 + (segs[2] || 0);
            };
            let diff = toSeconds(endInput.value) - toSeconds(startInput.value);
            // 结束早于开始视为跨午夜
            const crossesMidnight = diff < 0;
            if (crossesMidnight) diff += 24 * 3600;
            if (!startInput.value || !endInput.value || diff <= 0) {
                durationEl.setText("");
                return;
            }
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const text = h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
            durationEl.setText(crossesMidnight ? `${text} ⁺¹` : text);
        };
        updateDuration();

        // 任何输入变化都同步到草稿，防止视图被外部刷新时丢内容
        const emitChange = (): void => {
            options.onChange?.({
                start,
                end,
                title: titleInputValue(),
                desc,
            });
        };
        let titleInputValue = (): string => "";

        startInput.addEventListener("input", () => { start = startInput.value; updateDuration(); emitChange(); });
        endInput.addEventListener("input", () => { end = endInput.value; updateDuration(); emitChange(); });

        // ── 中部：标题 + 描述（memos 式无边框输入区）──
        const bodyEl = cardEl.createEl("div", { cls: "dtm-body" });

        const titleInput = bodyEl.createEl("input", {
            type: "text",
            cls: "dtm-title-input",
            attr: { placeholder: "做了什么", "aria-label": "标题" },
        });
        titleInput.value = options.title;
        titleInputValue = () => titleInput.value;
        titleInput.addEventListener("input", () => emitChange());
        attachMentionAutocomplete(cardEl, titleInput, this.mentionIndex);

        const descArea = bodyEl.createEl("textarea", {
            cls: "dtm-desc-area",
            attr: { placeholder: "补充描述，支持 Markdown…", rows: "3" },
        });
        descArea.value = desc;

        // 自动撑高
        const autoResize = (): void => {
            descArea.setCssProps({ height: "auto" });
            descArea.setCssProps({ height: `${Math.min(descArea.scrollHeight, 320)}px` });
        };
        descArea.addEventListener("input", () => { desc = descArea.value; autoResize(); emitChange(); });
        window.requestAnimationFrame(autoResize);
        attachMentionAutocomplete(cardEl, descArea, this.mentionIndex);

        // ── 底部工具栏：左侧图标操作，右侧取消/保存 ──
        const footerEl = cardEl.createEl("div", { cls: "dtm-footer" });
        const actionsEl = footerEl.createEl("div", { cls: "dtm-actions" });

        const onDelete = options.onDelete;
        if (onDelete) {
            const deleteBtn = actionsEl.createEl("button", { cls: "dtm-icon-btn dtm-delete-btn" });
            setIcon(deleteBtn, "trash-2");
            setTooltip(deleteBtn, "删除此条目");
            deleteBtn.addEventListener("click", () => void onDelete());
        }

        const onOpenNote = options.onOpenNote;
        if (onOpenNote) {
            const openNoteBtn = actionsEl.createEl("button", { cls: "dtm-icon-btn" });
            setIcon(openNoteBtn, "file-text");
            setTooltip(openNoteBtn, "在笔记中打开");
            openNoteBtn.addEventListener("click", () => onOpenNote());
        }

        const save = async (): Promise<void> => {
            const trimmedTitle = titleInput.value.trim();
            if (!start || !end) {
                new Notice("请填写开始和结束时间");
                return;
            }
            if (!trimmedTitle) {
                new Notice("请填写标题");
                return;
            }
            if (end === start) {
                new Notice("开始和结束时间不能相同（结束早于开始会视为跨午夜）");
                return;
            }
            await options.onSave(start, end, trimmedTitle, desc.trim());
        };

        const buttonsEl = footerEl.createEl("div", { cls: "dtm-buttons" });
        const cancelBtn = buttonsEl.createEl("button", { text: "取消", cls: "dtm-cancel-btn" });
        cancelBtn.addEventListener("click", () => options.onCancel());

        const saveBtn = buttonsEl.createEl("button", { text: options.saveLabel, cls: "dtm-save-btn" });
        saveBtn.addEventListener("click", () => void save());

        // Cmd/Ctrl+Enter 随处保存；回车快捷保存（描述多行区除外）；Esc 取消
        cardEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
            } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                void save();
            } else if (e.key === "Escape") {
                e.preventDefault();
                options.onCancel();
            }
        });

        // Mod+Enter 注册到 Obsidian 按键作用域栈顶，避免被全局快捷键抢先拦截
        const scope = new Scope(this.app.scope);
        scope.register(["Mod"], "Enter", (evt) => {
            if (!cardEl.isConnected) {
                // 卡片已被销毁（如外部重渲染），清理作用域并放行
                this.setKeyScope(null);
                return true;
            }
            evt.preventDefault();
            void save();
            return false;
        });
        this.setKeyScope(scope);

        titleInput.focus();
    }
}

interface DayEntryEditorOptions {
    saveLabel: string;
    start: string;
    end: string;
    title: string;
    desc: string;
    hasSeconds: boolean;
    onChange?: (draft: EntryDraft) => void;
    onSave: (start: string, end: string, title: string, desc: string) => Promise<void>;
    onDelete?: () => Promise<void>;
    onOpenNote?: () => void;
    onCancel: () => void;
}
