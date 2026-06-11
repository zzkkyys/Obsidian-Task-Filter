import {
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    TFile,
} from "obsidian";
import type TaskFilterPlugin from "../main";
import { MentionInfo } from "../utils/mentionScanner";

interface MentionSuggestion {
    name: string;
    count: number;
    isNew: boolean; // 是否为新建人名（库中尚不存在）
}

/**
 * 输入 @ 时实时提示库中已有的人名（支持多级，如 hit/zhangsan）
 */
export class MentionSuggest extends EditorSuggest<MentionSuggestion> {
    private plugin: TaskFilterPlugin;

    constructor(plugin: TaskFilterPlugin) {
        super(plugin.app);
        this.plugin = plugin;
        this.setInstructions([
            { command: "↑↓", purpose: "选择人名" },
            { command: "↵", purpose: "插入提及" },
            { command: "esc", purpose: "关闭" },
        ]);
    }

    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        _file: TFile | null
    ): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line).slice(0, cursor.ch);
        // 从光标向前找最近的 @，其后只允许人名字符
        const match = line.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_/-]*)$/u);
        if (!match) return null;

        const query = match[1] ?? "";
        const startCh = cursor.ch - query.length - 1; // 包含 @ 本身
        return {
            start: { line: cursor.line, ch: startCh },
            end: cursor,
            query,
        };
    }

    getSuggestions(context: EditorSuggestContext): MentionSuggestion[] {
        const query = context.query.toLowerCase();
        const all: MentionInfo[] = this.plugin.mentionIndex.getCachedMentions();

        const matched = all
            .filter((m) => m.name.toLowerCase().includes(query))
            .map((m) => ({ name: m.name, count: m.count, isNew: false }));

        // 输入了内容且没有完全相同的人名时，提供“新建”选项
        if (
            context.query.length > 0 &&
            !all.some((m) => m.name.toLowerCase() === query)
        ) {
            matched.push({ name: context.query, count: 0, isNew: true });
        }

        return matched;
    }

    renderSuggestion(suggestion: MentionSuggestion, el: HTMLElement): void {
        el.addClass("mention-suggest-item");

        const nameEl = el.createEl("span", { cls: "mention-suggest-name" });
        nameEl.createEl("span", { text: "@", cls: "mention-suggest-at" });

        // 多级人名分段展示，如 hit / zhangsan
        const parts = suggestion.name.split("/");
        parts.forEach((part, i) => {
            if (i > 0) {
                nameEl.createEl("span", { text: "/", cls: "mention-suggest-sep" });
            }
            nameEl.createEl("span", { text: part });
        });

        if (suggestion.isNew) {
            el.createEl("span", { text: "新建", cls: "mention-suggest-new" });
        } else {
            el.createEl("span", {
                text: `${suggestion.count}`,
                cls: "mention-suggest-count",
            });
        }
    }

    selectSuggestion(suggestion: MentionSuggestion, _evt: MouseEvent | KeyboardEvent): void {
        const context = this.context;
        if (!context) return;

        context.editor.replaceRange(
            `@${suggestion.name} `,
            context.start,
            context.end
        );
        const newCh = context.start.ch + suggestion.name.length + 2;
        context.editor.setCursor({ line: context.start.line, ch: newCh });

        // 新人名插入后让索引尽快刷新
        this.plugin.mentionIndex.markDirty();
        this.close();
    }
}
