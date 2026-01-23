import { MarkdownPostProcessorContext, App, TFile, MarkdownRenderChild } from "obsidian";
import { getTaskFiles, TaskFile } from "../utils/tagScanner";

export class TaskBlockRenderer extends MarkdownRenderChild {
    app: App;
    source: string;
    ctx: MarkdownPostProcessorContext;

    constructor(app: App, containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext) {
        super(containerEl);
        this.app = app;
        this.source = source;
        this.ctx = ctx;
    }

    async onload() {
        await this.render();
    }

    async render() {
        const el = this.containerEl;
        const source = this.source;
        // Parse YAML-like content
        // Parse YAML-like content
        const lines = source.split("\n");
        let dateStr = "";
        let startDateStr = "";
        let endDateStr = "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("date:")) {
                dateStr = (trimmed.split(":")[1] || "").trim();
            } else if (trimmed.startsWith("startDate:")) {
                startDateStr = (trimmed.split(":")[1] || "").trim();
            } else if (trimmed.startsWith("endDate:")) {
                endDateStr = (trimmed.split(":")[1] || "").trim();
            }
        }

        let start = "";
        let end = "";
        let displayTitle = "";
        let isRangeMode = false;

        if (startDateStr || endDateStr) {
            isRangeMode = true;
            start = startDateStr;
            end = endDateStr;

            if (start && end) displayTitle = `${start} to ${end}`;
            else if (start) displayTitle = `Since ${start}`;
            else if (end) displayTitle = `Until ${end}`;
        } else {
            if (!dateStr) {
                const today = new Date();
                dateStr = today.toISOString().split("T")[0] || "";
            }
            start = dateStr;
            end = dateStr;
            displayTitle = dateStr;
        }

        const container = el.createEl("div", { cls: "ob-task-block" });

        // Show loading state
        container.createEl("p", { text: "Loading tasks...", cls: "ob-task-loading" });

        try {
            // Get all tasks
            const allTasks = await getTaskFiles(this.app);

            // Filter tasks
            // Filter tasks
            const createdTasks = allTasks
                .filter(t => this.isDateInRange(t.dateCreated, start, end))
                .sort((a, b) => {
                    const da = new Date(a.dateCreated || "");
                    const db = new Date(b.dateCreated || "");
                    return da.getTime() - db.getTime();
                });

            const completedTasks = allTasks
                .filter(t => {
                    const status = t.status.toLowerCase();
                    const isDone = status === "done" || status === "completed";
                    return isDone && this.isDateInRange(t.completedDate, start, end);
                })
                .sort((a, b) => {
                    const da = new Date(a.completedDate || "");
                    const db = new Date(b.completedDate || "");
                    return da.getTime() - db.getTime();
                });

            // Clear loading
            container.empty();

            // Render Header
            container.createEl("h4", {
                text: `Task Summary: ${displayTitle}`,
                cls: "ob-task-header"
            });

            // Render Created Tasks
            this.renderSection(container, "📅 Created Tasks", createdTasks, "created", isRangeMode);

            // Render Completed Tasks
            this.renderSection(container, "✅ Completed Tasks", completedTasks, "completed", isRangeMode);

        } catch (e: any) {
            container.empty();
            container.createEl("p", { text: `Error: ${e?.message || String(e)}`, cls: "ob-task-error" });
        }
    }

    private isDateInRange(dateStr: string | null | undefined, start: string, end: string): boolean {
        if (!dateStr) return false;

        // Extract YYYY-MM-DD part
        const date = (dateStr as string).split("T")[0] || "";

        if (start && date < start) return false;
        if (end && date > end) return false;

        return true;
    }

    private renderSection(container: HTMLElement, title: string, tasks: TaskFile[], type: "created" | "completed", isRangeMode: boolean) {
        const section = container.createEl("div", { cls: "ob-task-section" });
        section.createEl("h5", { text: `${title} (${tasks.length})`, cls: "ob-task-section-title" });

        if (tasks.length === 0) {
            section.createEl("p", { text: "No tasks found.", cls: "ob-task-empty" });
            return;
        }

        const list = section.createEl("ul", { cls: "ob-task-list" });
        for (const task of tasks) {
            const li = list.createEl("li", { cls: "ob-task-item" });

            // Link to file
            const link = li.createEl("a", {
                text: task.title,
                cls: "internal-link",
                href: task.file.path
            });

            link.addEventListener("click", (e) => {
                e.preventDefault();
                this.app.workspace.openLinkText(task.file.path, "", false);
            });

            // Additional info (optional)
            if (task.money) {
                li.createEl("span", { text: ` (￥${task.money})`, cls: "ob-task-money" });
            }

            // Timestamp Badge (Last item for flex alignment)
            const dateField = type === "created" ? task.dateCreated : task.completedDate;
            const timeBadge = this.formatTimestamp(dateField, isRangeMode);
            if (timeBadge) {
                li.createEl("span", { text: timeBadge, cls: "ob-task-time-badge" });
            }
        }
    }

    private formatTimestamp(dateStr: string | null | undefined, isRangeMode: boolean): string {
        if (!dateStr) return "";

        // Try to parse the date string
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr; // Fallback to original string if invalid

        // Helper to pad
        const pad = (n: number) => n.toString().padStart(2, "0");

        const h = pad(date.getHours());
        const m = pad(date.getMinutes());
        const s = pad(date.getSeconds());
        const timeStr = `${h}:${m}:${s}`;

        if (isRangeMode) {
            const y = date.getFullYear();
            const mo = pad(date.getMonth() + 1);
            const d = pad(date.getDate());
            return `${y}-${mo}-${d} ${timeStr}`;
        } else {
            return timeStr;
        }
    }
}
