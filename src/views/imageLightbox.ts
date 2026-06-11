import { App, Modal, setIcon, setTooltip } from "obsidian";

export interface PreviewImage {
    src: string;
    name: string;
}

const SCALE_MIN = 0.5;
const SCALE_MAX = 4;
const SCALE_STEP = 0.2;

/**
 * 时间线图片灯箱：左右切换、滚轮/按钮缩放、拖拽平移、键盘导航。
 */
export class TimelineImagePreviewModal extends Modal {
    private items: PreviewImage[];
    private index: number;
    private scale = 1;
    private offsetX = 0;
    private offsetY = 0;
    private dragPointerId: number | null = null;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragOriginX = 0;
    private dragOriginY = 0;

    private imgEl: HTMLImageElement | null = null;
    private headerTitleEl: HTMLElement | null = null;
    private counterEl: HTMLElement | null = null;
    private prevBtn: HTMLButtonElement | null = null;
    private nextBtn: HTMLButtonElement | null = null;

    constructor(app: App, items: PreviewImage[], startIndex: number) {
        super(app);
        this.items = items;
        this.index = Math.max(0, Math.min(startIndex, items.length - 1));
    }

    onOpen(): void {
        this.modalEl.addClass("tf-image-preview-modal");
        const { contentEl } = this;
        contentEl.empty();

        // 顶部：文件名 + 计数
        const headerEl = contentEl.createEl("div", { cls: "tf-preview-header" });
        this.headerTitleEl = headerEl.createEl("span", { cls: "tf-preview-title" });
        this.counterEl = headerEl.createEl("span", { cls: "tf-preview-counter" });

        // 中部：图片区（拖拽平移 + 滚轮缩放）
        const stageEl = contentEl.createEl("div", { cls: "tf-preview-stage" });
        this.imgEl = stageEl.createEl("img", { cls: "tf-preview-img" });

        stageEl.addEventListener("pointerdown", (e) => {
            if (!(e.target instanceof HTMLImageElement)) return;
            this.dragPointerId = e.pointerId;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragOriginX = this.offsetX;
            this.dragOriginY = this.offsetY;
            stageEl.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        stageEl.addEventListener("pointermove", (e) => {
            if (this.dragPointerId === null || e.pointerId !== this.dragPointerId) return;
            this.offsetX = this.dragOriginX + (e.clientX - this.dragStartX);
            this.offsetY = this.dragOriginY + (e.clientY - this.dragStartY);
            this.applyTransform();
        });
        const endDrag = (e: PointerEvent): void => {
            if (this.dragPointerId === null || e.pointerId !== this.dragPointerId) return;
            if (stageEl.hasPointerCapture(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);
            this.dragPointerId = null;
        };
        stageEl.addEventListener("pointerup", endDrag);
        stageEl.addEventListener("pointercancel", endDrag);
        stageEl.addEventListener("wheel", (e) => {
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
        }, { passive: false });

        // 底部工具栏
        const footerEl = contentEl.createEl("div", { cls: "tf-preview-footer" });
        this.prevBtn = this.iconButton(footerEl, "chevron-left", "上一张", () => this.go(-1));
        this.nextBtn = this.iconButton(footerEl, "chevron-right", "下一张", () => this.go(1));
        this.iconButton(footerEl, "zoom-out", "缩小", () => this.zoom(-SCALE_STEP));
        this.iconButton(footerEl, "zoom-in", "放大", () => this.zoom(SCALE_STEP));
        this.iconButton(footerEl, "rotate-ccw", "重置", () => {
            this.resetViewport();
            this.applyTransform();
        });
        this.iconButton(footerEl, "x", "关闭", () => this.close());

        // 键盘：← → 切换，+/- 缩放（Esc 由 Modal 自带）
        this.scope.register([], "ArrowLeft", () => { this.go(-1); return false; });
        this.scope.register([], "ArrowRight", () => { this.go(1); return false; });
        this.scope.register([], "=", () => { this.zoom(SCALE_STEP); return false; });
        this.scope.register([], "-", () => { this.zoom(-SCALE_STEP); return false; });

        this.renderCurrent();
    }

    onClose(): void {
        this.contentEl.empty();
        this.dragPointerId = null;
    }

    private iconButton(container: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
        const btn = container.createEl("button", {
            cls: "tf-preview-btn",
            attr: { type: "button", "aria-label": label },
        });
        setIcon(btn, icon);
        setTooltip(btn, label);
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    private go(delta: number): void {
        const next = this.index + delta;
        if (next < 0 || next >= this.items.length) return;
        this.index = next;
        this.resetViewport();
        this.renderCurrent();
    }

    private zoom(delta: number): void {
        this.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number((this.scale + delta).toFixed(2))));
        this.applyTransform();
    }

    private resetViewport(): void {
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.dragPointerId = null;
    }

    private applyTransform(): void {
        this.imgEl?.setCssProps({
            transform: `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`,
        });
    }

    private renderCurrent(): void {
        const item = this.items[this.index];
        if (!item || !this.imgEl) return;

        this.imgEl.src = item.src;
        this.imgEl.alt = item.name;
        this.applyTransform();

        this.headerTitleEl?.setText(item.name);
        this.counterEl?.setText(this.items.length > 1 ? `${this.index + 1} / ${this.items.length}` : "");
        if (this.prevBtn) this.prevBtn.disabled = this.index <= 0;
        if (this.nextBtn) this.nextBtn.disabled = this.index >= this.items.length - 1;
    }
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/**
 * 把卡片正文里的图片（含 Obsidian 内部嵌入）抽出来，
 * 统一移动到卡片底部的附件行，从左到右排列成缩略图。
 */
export function moveImagesToBottom(cardEl: HTMLElement): void {
    const movers: HTMLElement[] = [];

    // 内部嵌入：按 src 扩展名判断是否图片（img 可能尚未异步加载出来，移动容器即可）
    for (const embed of Array.from(cardEl.querySelectorAll(".internal-embed"))) {
        const src = (embed.getAttribute("src") || "").split("|")[0]?.trim() || "";
        if (IMAGE_EXT_RE.test(src)) {
            movers.push(embed as HTMLElement);
        }
    }
    // 外链图片：不在内部嵌入里的裸 img
    for (const img of Array.from(cardEl.querySelectorAll("img"))) {
        if (img.closest(".internal-embed")) continue;
        movers.push(img as HTMLElement);
    }

    if (movers.length === 0) return;

    const rowEl = cardEl.createEl("div", { cls: "ob-timeline-attachments" });
    for (const mover of movers) {
        const parent = mover.parentElement;
        rowEl.appendChild(mover);
        // 清理因移走图片而变空的段落
        if (parent && parent !== cardEl && parent !== rowEl
            && parent.children.length === 0 && !(parent.textContent || "").trim()) {
            parent.remove();
        }
    }
}

/**
 * 给时间线容器挂上图片灯箱：点击卡片里的图片打开预览，
 * 同一时间线内的所有图片可左右切换。用捕获阶段拦截，避免触发条目自身的点击行为。
 */
export function registerTimelineImageLightbox(app: App, rootEl: HTMLElement): void {
    rootEl.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLImageElement)) return;
        if (!target.closest(".ob-timeline-card")) return;

        e.preventDefault();
        e.stopPropagation();

        // 点击时再收集，异步加载完成的嵌入图片也能进入列表
        const imgs = Array.from(rootEl.querySelectorAll("img"))
            .filter(img => img.closest(".ob-timeline-card"));
        const items: PreviewImage[] = imgs.map(img => ({
            src: img.currentSrc || img.src,
            name: img.getAttribute("alt") || img.src.split("/").pop() || "图片",
        }));
        const index = imgs.indexOf(target);

        new TimelineImagePreviewModal(app, items, Math.max(0, index)).open();
    }, { capture: true });
}
