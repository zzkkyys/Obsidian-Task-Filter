import { App, TFile } from "obsidian";
import { getTaskFiles } from "./tagScanner";
import { isTaskDone } from "./projectScanner";

export interface CompletedTaskEntry {
    timeSeconds: number;     // completedDate 的时分秒（秒数），无时间则为一天结束用于排在末尾
    label: string;           // HH:mm 或 HH:mm:ss，无时间则为空
    hasTime: boolean;        // completedDate 是否带具体时间
    title: string;           // 任务标题
    priority: string;        // 优先级
    file: TFile;             // 任务文件，点击可打开
}

// completedDate 可能是 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm[:ss]"（也兼容 T 分隔）
const COMPLETED_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * 返回在指定日期（YYYY-MM-DD）被标记完成的任务，按完成时间升序。
 * 用于把“某个时间点完成的任务”合并进当天时间线，渲染得像 memo 一样。
 */
export async function getCompletedTasksForDate(app: App, dateStr: string): Promise<CompletedTaskEntry[]> {
    const allTasks = await getTaskFiles(app);
    const entries: CompletedTaskEntry[] = [];

    for (const task of allTasks) {
        if (!isTaskDone(task)) continue;
        const raw = (task.completedDate || "").trim();
        if (!raw) continue;
        const m = raw.match(COMPLETED_RE);
        if (!m) continue;

        const pad = (n: number) => String(n).padStart(2, "0");
        const day = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
        if (day !== dateStr) continue;

        const hasTime = m[4] !== undefined;
        const hours = Number(m[4] || 0);
        const minutes = Number(m[5] || 0);
        const seconds = Number(m[6] || 0);

        entries.push({
            // 无时间的任务排到当天末尾
            timeSeconds: hasTime ? hours * 3600 + minutes * 60 + seconds : 24 * 3600,
            label: hasTime
                ? (m[6] !== undefined
                    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
                    : `${pad(hours)}:${pad(minutes)}`)
                : "",
            hasTime,
            title: task.title,
            priority: task.priority,
            file: task.file,
        });
    }

    entries.sort((a, b) => a.timeSeconds - b.timeSeconds);
    return entries;
}
