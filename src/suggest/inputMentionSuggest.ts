import { MentionIndex, MentionInfo } from "../utils/mentionScanner";

/**
 * 给普通 HTML 输入框/文本域挂上 @人名 补全下拉
 * （EditorSuggest 只在 CodeMirror 编辑器里生效，时间线编辑卡片用的是原生 input）。
 *
 * containerEl 需要 position: relative，下拉框以它为定位参照，
 * 随容器一起销毁，不会泄漏到 document.body。
 */
export function attachMentionAutocomplete(
    containerEl: HTMLElement,
    inputEl: HTMLInputElement | HTMLTextAreaElement,
    mentionIndex: MentionIndex,
): void {
    let dropdown: HTMLElement | null = null;
    let items: MentionInfo[] = [];
    let selectedIndex = 0;
    let queryStart = -1;

    const hide = (): void => {
        dropdown?.remove();
        dropdown = null;
        items = [];
        queryStart = -1;
    };

    const select = (name: string): void => {
        const caret = inputEl.selectionStart ?? 0;
        if (queryStart < 0 || queryStart > caret) {
            hide();
            return;
        }
        const value = inputEl.value;
        inputEl.value = `${value.slice(0, queryStart)}@${name} ${value.slice(caret)}`;
        const newPos = queryStart + name.length + 2;
        inputEl.setSelectionRange(newPos, newPos);
        hide();
        // 触发 input 事件，让草稿同步等既有监听正常工作
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.focus();
    };

    // 用镜像元素测量光标在输入框内的像素位置（相对输入框内容区左上角）
    const getCaretCoords = (): { left: number; top: number; lineHeight: number } => {
        const caret = inputEl.selectionStart ?? 0;
        const isTextarea = inputEl instanceof HTMLTextAreaElement;
        const computed = window.getComputedStyle(inputEl);

        const mirror = document.body.createEl("div");
        const copyProps = [
            "font-family", "font-size", "font-weight", "font-style",
            "letter-spacing", "text-transform", "word-spacing", "text-indent",
            "padding-top", "padding-right", "padding-bottom", "padding-left",
            "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
            "box-sizing", "line-height",
        ];
        const mirrorStyles: Record<string, string> = {
            position: "absolute",
            visibility: "hidden",
            top: "-9999px",
            left: "0",
            "white-space": isTextarea ? "pre-wrap" : "pre",
        };
        for (const prop of copyProps) {
            mirrorStyles[prop] = computed.getPropertyValue(prop);
        }
        if (isTextarea) {
            mirrorStyles["word-wrap"] = "break-word";
            mirrorStyles["width"] = `${inputEl.clientWidth}px`;
        }
        mirror.setCssProps(mirrorStyles);

        mirror.textContent = inputEl.value.slice(0, caret);
        const marker = mirror.createEl("span", { text: "​" });
        const left = marker.offsetLeft - inputEl.scrollLeft;
        const top = marker.offsetTop - inputEl.scrollTop;
        mirror.remove();

        const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 20;
        return { left, top, lineHeight };
    };

    const renderDropdown = (): void => {
        if (!dropdown) {
            dropdown = containerEl.createEl("div", { cls: "mention-input-suggest" });
        }
        dropdown.empty();

        // 定位到光标正下方（offsetParent 即 containerEl），并防止超出容器右缘
        const coords = getCaretCoords();
        const dropdownWidth = 220;
        const rawLeft = inputEl.offsetLeft + coords.left;
        const maxLeft = Math.max(0, containerEl.clientWidth - dropdownWidth - 8);
        dropdown.setCssProps({
            top: `${inputEl.offsetTop + coords.top + coords.lineHeight + 4}px`,
            left: `${Math.max(0, Math.min(rawLeft, maxLeft))}px`,
        });

        items.forEach((item, i) => {
            const row = dropdown!.createEl("div", {
                cls: `mention-input-suggest-item ${i === selectedIndex ? "is-selected" : ""}`,
            });
            const nameEl = row.createEl("span", { cls: "mention-suggest-name" });
            nameEl.createEl("span", { text: "@", cls: "mention-suggest-at" });
            nameEl.createEl("span", { text: item.name });
            row.createEl("span", { text: `${item.count}`, cls: "mention-suggest-count" });

            // mousedown 而非 click：避免输入框先失焦关掉下拉
            row.addEventListener("mousedown", (e) => {
                e.preventDefault();
                select(item.name);
            });
            row.addEventListener("mouseenter", () => {
                selectedIndex = i;
                renderDropdown();
            });
        });
    };

    const update = (): void => {
        const caret = inputEl.selectionStart ?? 0;
        const before = inputEl.value.slice(0, caret);
        const match = before.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_/-]*)$/u);
        if (!match) {
            hide();
            return;
        }
        const query = (match[1] ?? "").toLowerCase();
        queryStart = caret - (match[1]?.length ?? 0) - 1;
        items = mentionIndex.getCachedMentions()
            .filter(m => m.name.toLowerCase().includes(query))
            .slice(0, 8);
        if (items.length === 0) {
            hide();
            return;
        }
        selectedIndex = 0;
        renderDropdown();
    };

    inputEl.addEventListener("input", update);
    inputEl.addEventListener("click", update);
    inputEl.addEventListener("blur", () => {
        window.setTimeout(hide, 150);
    });

    const onKeydown = (e: KeyboardEvent): void => {
        if (!dropdown || items.length === 0) return;
        // Cmd/Ctrl+Enter 是“保存”快捷键：收起下拉并放行给上层处理
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            hide();
            return;
        }
        if (e.key === "ArrowDown") {
            selectedIndex = (selectedIndex + 1) % items.length;
            renderDropdown();
        } else if (e.key === "ArrowUp") {
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            renderDropdown();
        } else if (e.key === "Enter" || e.key === "Tab") {
            const item = items[selectedIndex];
            if (item) select(item.name);
        } else if (e.key === "Escape") {
            hide();
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    };
    inputEl.addEventListener("keydown", onKeydown as EventListener);
}
