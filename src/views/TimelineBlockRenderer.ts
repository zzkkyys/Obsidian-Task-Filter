import { App, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, moment } from "obsidian";
import type { EditorView } from "@codemirror/view";

interface TimelineEntry {
    label: string;       // 左侧展示的日期或时间段
    sortKey: string;     // 排序用
    title: string;
    descLines: string[]; // 描述（支持多行、空行）
    lineIndex: number;   // 条目首行在代码块 source 中的行号（用于双击定位）
    headerText: string;  // 条目首行原文（getSectionInfo 失效时按文本兜底定位）
    startSeconds?: number; // 当天模式：开始时间（秒数）
    endSeconds?: number;   // 当天模式：结束时间（秒数）
}

type TimelineMode = "date" | "day";

// 日期模式条目头：YYYY[-MM[-DD]][ HH:mm[:ss]] |
const DATE_HEAD_RE = /^(\d{4})(-\d{1,2}(-\d{1,2})?)?(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*\|/;
// 当天模式条目头：HH:mm[:ss] - HH:mm[:ss] |
const DAY_HEAD_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-~—–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\|/;

/**
 * ob-timeline 代码块渲染器，支持两种形式：
 *
 * 1. 日期模式（默认）：每项以年份日期开头，可带可选的时间（精确到秒）
 *    2024-06-01 | 项目启动 | 完成立项与分工
 *    2024-08-15 14:30 | 中期检查
 *    2025-01-10 09:00:30 | 结题
 *
 * 2. 当天模式（mode: day，或自动识别 HH:mm 开头），适合放在每日笔记里：
 *    09:00 - 10:30 | 晨会 | 讨论本周进度
 *    14:00:30 - 16:00 | 写代码
 *
 * 条目下方未以日期/时间开头的行（包括空行）都视为该条目的多行描述，
 * 描述按 Markdown 渲染。双击任意条目可跳到源码对应行编辑。
 */
export class TimelineBlockRenderer extends MarkdownRenderChild {
    app: App;
    source: string;
    ctx: MarkdownPostProcessorContext;

    constructor(app: App, containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext) {
        super(containerEl);
        this.app = app;
        this.source = source;
        this.ctx = ctx;
    }

    private currentMode: TimelineMode = "date";

    onload(): void {
        void this.render();
        // 当天模式 + 今天的笔记：每分钟重渲染，让“正在进行”高亮跟着时间走
        this.registerInterval(window.setInterval(() => {
            if (this.currentMode === "day" && this.isTodayNote()) {
                void this.render();
            }
        }, 60 * 1000));
    }

    private async render(): Promise<void> {
        const el = this.containerEl;
        el.empty();

        const lines = this.source.split("\n");
        let mode: TimelineMode | null = null;
        let sortDesc = false;

        // 先确定模式：显式 mode: 行优先，否则看首个条目头是否为时间段
        let firstHeadIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = (lines[i] || "").trim();
            if (!line || line.startsWith("//")) continue;
            const modeMatch = line.match(/^mode\s*:\s*(date|day)$/i);
            if (modeMatch && modeMatch[1]) {
                if (mode === null) mode = modeMatch[1].toLowerCase() as TimelineMode;
                continue;
            }
            const sortMatch = line.match(/^sort\s*:\s*(asc|desc)$/i);
            if (sortMatch && sortMatch[1]) {
                sortDesc = sortMatch[1].toLowerCase() === "desc";
                continue;
            }
            if (firstHeadIndex === -1 && (DATE_HEAD_RE.test(line) || DAY_HEAD_RE.test(line))) {
                firstHeadIndex = i;
                if (mode === null) {
                    mode = DAY_HEAD_RE.test(line) ? "day" : "date";
                }
            }
        }
        if (mode === null) mode = "date";
        this.currentMode = mode;

        const headRe = mode === "day" ? DAY_HEAD_RE : DATE_HEAD_RE;
        const entries: TimelineEntry[] = [];
        const errors: string[] = [];
        let current: TimelineEntry | null = null;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i] || "";
            const line = rawLine.trim();

            if (/^(mode\s*:\s*(date|day)|sort\s*:\s*(asc|desc))$/i.test(line) && !current) continue;
            if (line.startsWith("//")) continue;

            if (headRe.test(line)) {
                const entry = mode === "day"
                    ? this.parseDayEntry(line, i)
                    : this.parseDateEntry(line, i);
                if (entry) {
                    entries.push(entry);
                    current = entry;
                    continue;
                }
            }

            if (current) {
                // 条目内的后续行（含空行）都归入描述
                current.descLines.push(rawLine);
            } else if (line) {
                errors.push(line);
            }
        }

        // 去掉每个条目描述末尾多余的空行
        for (const entry of entries) {
            while (entry.descLines.length > 0 && !(entry.descLines[entry.descLines.length - 1] || "").trim()) {
                entry.descLines.pop();
            }
        }

        entries.sort((a, b) => sortDesc
            ? b.sortKey.localeCompare(a.sortKey)
            : a.sortKey.localeCompare(b.sortKey));

        const container = el.createEl("div", { cls: `ob-timeline ob-timeline-${mode}` });

        if (entries.length === 0 && errors.length === 0) {
            container.createEl("p", {
                text: mode === "day"
                    ? "暂无条目。格式：09:00 - 10:30 | 标题 | 描述"
                    : "暂无条目。格式：2024-06-01 | 标题 | 描述",
                cls: "ob-timeline-empty",
            });
            return;
        }

        // 当天模式：如果是今天的笔记，高亮正在进行的条目
        const nowSeconds = this.isTodayNote() ? this.currentSeconds() : null;

        for (const entry of entries) {
            // 跨午夜条目：now 或 now+24h 落在区间内都算正在进行
            const isNow = mode === "day"
                && nowSeconds !== null
                && entry.startSeconds !== undefined
                && entry.endSeconds !== undefined
                && ((nowSeconds >= entry.startSeconds && nowSeconds < entry.endSeconds)
                    || (nowSeconds + 24 * 3600 >= entry.startSeconds && nowSeconds + 24 * 3600 < entry.endSeconds));

            const itemEl = container.createEl("div", {
                cls: `ob-timeline-item ${isNow ? "is-now" : ""}`,
            });

            // 双击进入该条目的编辑模式
            itemEl.setAttribute("title", "双击编辑此条目");
            // 阻止 CodeMirror 把双击处理成“选中整个代码块 widget”
            itemEl.addEventListener("mousedown", (e) => {
                if (e.detail >= 2) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
            itemEl.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.editEntry(entry, itemEl);
            });
            // 移动端：长按进入编辑
            let longPressTimer: number | null = null;
            itemEl.addEventListener("touchstart", () => {
                longPressTimer = window.setTimeout(() => {
                    longPressTimer = null;
                    void this.editEntry(entry, itemEl);
                }, 550);
            }, { passive: true });
            const cancelLongPress = (): void => {
                if (longPressTimer !== null) {
                    window.clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };
            itemEl.addEventListener("touchend", cancelLongPress);
            itemEl.addEventListener("touchmove", cancelLongPress, { passive: true });
            itemEl.addEventListener("touchcancel", cancelLongPress);

            // 左侧：日期 / 时间段
            const timeEl = itemEl.createEl("div", { cls: "ob-timeline-time" });
            timeEl.createEl("span", { text: entry.label, cls: "ob-timeline-time-label" });
            if (mode === "day" && entry.startSeconds !== undefined && entry.endSeconds !== undefined) {
                timeEl.createEl("span", {
                    text: this.formatDuration(entry.endSeconds - entry.startSeconds),
                    cls: "ob-timeline-duration",
                });
            }

            // 中间：轴线与圆点
            const axisEl = itemEl.createEl("div", { cls: "ob-timeline-axis" });
            axisEl.createEl("div", { cls: "ob-timeline-dot" });
            axisEl.createEl("div", { cls: "ob-timeline-line" });

            // 右侧：内容卡片
            const cardEl = itemEl.createEl("div", { cls: "ob-timeline-card" });
            cardEl.createEl("div", { text: entry.title, cls: "ob-timeline-title" });
            const description = entry.descLines.join("\n").trim();
            if (description) {
                const descEl = cardEl.createEl("div", { cls: "ob-timeline-desc" });
                await MarkdownRenderer.render(this.app, description, descEl, this.ctx.sourcePath, this);
            }
        }

        for (const errorLine of errors) {
            container.createEl("p", {
                text: `无法解析：${errorLine}`,
                cls: "ob-timeline-error",
            });
        }
    }

    // 日期模式：YYYY[-MM[-DD]][ HH:mm[:ss]] | 标题 | 行内描述
    private parseDateEntry(line: string, lineIndex: number): TimelineEntry | null {
        const parts = line.split("|").map(p => p.trim());
        const dateStr = parts[0] || "";
        const match = dateStr.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return null;
        if (parts.length < 2 || !parts[1]) return null;

        const pad = (s: string | undefined, fallback: string) => (s || fallback).padStart(2, "0");
        const sortKey = `${match[1]}-${pad(match[2], "00")}-${pad(match[3], "00")} `
            + `${pad(match[4], "00")}:${pad(match[5], "00")}:${pad(match[6], "00")}`;

        return {
            label: dateStr,
            sortKey,
            title: parts[1],
            descLines: parts.length > 2 ? [parts.slice(2).join(" | ")] : [],
            lineIndex,
            headerText: line,
        };
    }

    // 当天模式：HH:mm[:ss] - HH:mm[:ss] | 标题 | 行内描述
    private parseDayEntry(line: string, lineIndex: number): TimelineEntry | null {
        const parts = line.split("|").map(p => p.trim());
        const timeStr = parts[0] || "";
        const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-~—–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        if (parts.length < 2 || !parts[1]) return null;

        const startSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
        let endSeconds = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6] || 0);
        const hasSeconds = match[3] !== undefined || match[6] !== undefined;

        // 结束早于开始：视为跨午夜（如 23:00 - 01:00）
        const crossesMidnight = endSeconds <= startSeconds;
        if (crossesMidnight) endSeconds += 24 * 3600;

        const fmt = (total: number) => {
            const pad = (n: number) => String(n).padStart(2, "0");
            const inDay = total % (24 * 3600);
            const h = Math.floor(inDay / 3600);
            const m = Math.floor((inDay % 3600) / 60);
            const s = inDay % 60;
            return hasSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
        };

        return {
            label: `${fmt(startSeconds)} - ${fmt(endSeconds)}${crossesMidnight ? " ⁺¹" : ""}`,
            sortKey: String(startSeconds).padStart(6, "0"),
            title: parts[1],
            descLines: parts.length > 2 ? [parts.slice(2).join(" | ")] : [],
            lineIndex,
            headerText: line,
            startSeconds,
            endSeconds,
        };
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

    // 双击条目：定位到源码中该条目所在行并进入编辑
    private async editEntry(entry: TimelineEntry, itemEl: HTMLElement): Promise<void> {
        // 找到渲染此代码块的 markdown 视图，优先当前激活的视图
        let targetView: MarkdownView | null = null;
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file?.path === this.ctx.sourcePath) {
            targetView = activeView;
        } else {
            for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
                const view = leaf.view;
                if (view instanceof MarkdownView && view.file?.path === this.ctx.sourcePath) {
                    targetView = view;
                    break;
                }
            }
        }
        if (!targetView) return;
        const view = targetView;

        // 三层定位：getSectionInfo → CodeMirror posAtDOM → 按条目原文搜索
        let targetLine: number | null = null;

        const sectionInfo = this.ctx.getSectionInfo(this.containerEl);
        if (sectionInfo) {
            // lineStart 是代码块开头 ``` 那一行，条目行 = lineStart + 1 + 块内行号
            targetLine = sectionInfo.lineStart + 1 + entry.lineIndex;
        }

        if (targetLine === null) {
            const cm = (view.editor as unknown as { cm?: EditorView }).cm;
            if (cm) {
                try {
                    const pos = cm.posAtDOM(itemEl);
                    const blockStartLine = cm.state.doc.lineAt(pos).number - 1; // 转 0 基行号
                    targetLine = blockStartLine + 1 + entry.lineIndex;
                } catch {
                    // widget 不在该编辑器中，继续兜底
                }
            }
        }

        if (targetLine === null) {
            const docLines = view.editor.getValue().split("\n");
            const idx = docLines.findIndex(l => l.trim() === entry.headerText);
            if (idx >= 0) targetLine = idx;
        }

        if (targetLine === null) return;
        const lineToSelect = targetLine;

        // 阅读模式下先切换到编辑模式
        let switchedMode = false;
        if (view.getMode() === "preview") {
            const leaf = view.leaf;
            const state = leaf.getViewState();
            (state.state as Record<string, unknown>).mode = "source";
            await leaf.setViewState(state);
            switchedMode = true;
        }

        // 延迟到 CodeMirror 处理完双击的默认选区之后再定位，
        // 否则光标会被它的“选中整个 widget”覆盖
        window.setTimeout(() => {
            const editor = view.editor;
            const lineText = editor.getLine(lineToSelect) ?? "";
            // 校验目标行内容，不一致（文档刚被改过）则按原文重新搜索
            let line = lineToSelect;
            if (lineText.trim() !== entry.headerText) {
                const idx = editor.getValue().split("\n").findIndex(l => l.trim() === entry.headerText);
                if (idx >= 0) line = idx;
            }
            const finalText = editor.getLine(line) ?? "";
            // 选中整行，清楚地标出进入的是哪个时间段
            editor.setSelection({ line, ch: 0 }, { line, ch: finalText.length });
            editor.scrollIntoView(
                { from: { line, ch: 0 }, to: { line, ch: finalText.length } },
                true
            );
            editor.focus();
        }, switchedMode ? 120 : 30);
    }

    // 笔记是否是今天的每日笔记：优先按“每日笔记”插件的命名格式判断，兜底匹配 YYYY-MM-DD
    private isTodayNote(): boolean {
        const basename = (this.ctx.sourcePath.split("/").pop() || "").replace(/\.md$/, "");

        interface InternalPluginsApp {
            internalPlugins?: {
                getPluginById?: (id: string) => {
                    instance?: { options?: { format?: string } };
                } | null;
            };
        }
        const appWithInternals = this.app as unknown as InternalPluginsApp;
        const format = appWithInternals.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options?.format?.trim();
        if (format) {
            const todayName = moment().format(format).split("/").pop() || "";
            if (todayName && basename === todayName) return true;
        }

        return this.ctx.sourcePath.includes(moment().format("YYYY-MM-DD"));
    }

    private currentSeconds(): number {
        const now = new Date();
        return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    }
}
