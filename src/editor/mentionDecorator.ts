import {
    Decoration,
    DecorationSet,
    EditorView,
    PluginValue,
    ViewPlugin,
    ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { editorLivePreviewField } from "obsidian";
import { MENTION_REGEX } from "../utils/mentionScanner";

const mentionMark = Decoration.mark({ class: "mention-chip" });

// 这些语法节点内不渲染气泡（代码块、行内代码、链接地址、frontmatter 等）
const EXCLUDED_NODE_RE = /code|codeblock|hmd-frontmatter|formatting|url|hashtag/i;

/**
 * 实时预览（Live Preview）下把正文中的 @人名 渲染成气泡。
 * 用 mark 装饰而非 widget 替换，文本仍可正常编辑。
 */
class MentionDecoratorPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged ||
            update.state.field(editorLivePreviewField) !== update.startState.field(editorLivePreviewField)) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    private buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // 仅在实时预览模式下渲染，源码模式保持纯文本
        if (!view.state.field(editorLivePreviewField)) {
            return builder.finish();
        }

        const tree = syntaxTree(view.state);

        for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            for (const match of text.matchAll(MENTION_REGEX)) {
                if (match.index === undefined) continue;
                const start = from + match.index;
                const end = start + match[0].length;

                // 跳过代码等语法节点内的匹配
                const nodeName = tree.resolveInner(start, 1).type.name;
                if (EXCLUDED_NODE_RE.test(nodeName)) continue;

                builder.add(start, end, mentionMark);
            }
        }

        return builder.finish();
    }
}

export const mentionDecorator = ViewPlugin.fromClass(MentionDecoratorPlugin, {
    decorations: (plugin) => plugin.decorations,
});
