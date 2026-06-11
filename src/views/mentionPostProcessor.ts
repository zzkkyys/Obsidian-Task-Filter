import { App } from "obsidian";
import { MENTION_REGEX, openMentionSearch, openPersonNote } from "../utils/mentionScanner";
import type TaskFilterPlugin from "../main";

// 这些标签内不渲染气泡
const EXCLUDED_TAGS = new Set(["CODE", "PRE", "A", "BUTTON", "TEXTAREA", "INPUT"]);

/**
 * 阅读视图：把渲染后正文里的 @人名 替换成气泡。
 * 点击全局搜索该人名；配置了人物笔记目录后，Cmd/Ctrl+点击打开人物笔记。
 */
export function processMentionsInElement(plugin: TaskFilterPlugin, el: HTMLElement): void {
    const app: App = plugin.app;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest(".mention-chip")) return NodeFilter.FILTER_REJECT;
            for (let cur: HTMLElement | null = parent; cur && cur !== el; cur = cur.parentElement) {
                if (EXCLUDED_TAGS.has(cur.tagName)) return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    // 先收集再替换，避免遍历时修改 DOM
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
    }

    for (const textNode of textNodes) {
        const text = textNode.nodeValue;
        if (!text || !text.includes("@")) continue;

        const matches = Array.from(text.matchAll(MENTION_REGEX));
        if (matches.length === 0) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of matches) {
            if (match.index === undefined) continue;
            const name = match[1];
            if (!name) continue;

            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            const chip = document.createElement("span");
            chip.classList.add("mention-chip", "mention-chip-clickable");
            chip.createEl("span", { text: "@", cls: "mention-chip-at" });
            chip.createEl("span", { text: name, cls: "mention-chip-name" });
            chip.setAttribute("aria-label", `搜索 @${name} 的所有提及`);
            chip.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if ((e.metaKey || e.ctrlKey) && plugin.settings.mentionNotesFolder) {
                    void openPersonNote(app, plugin.settings.mentionNotesFolder, name);
                } else {
                    openMentionSearch(app, name);
                }
            });
            fragment.appendChild(chip);

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        textNode.replaceWith(fragment);
    }
}
