export interface MemoEntry {
    timeSeconds: number;     // created 的时分秒（秒数）
    dateStr: string | null;  // created 的日期部分 YYYY-MM-DD
    label: string;           // HH:mm 或 HH:mm:ss
    text: string;            // memo 正文（Markdown）
    line: number;            // 块开头 ```memos 在文件中的行号（0 基）
}

// Journal Memos 插件的块格式：
// ```memos
// created: 2026-06-11 19:47:31
// 正文内容…
// ```
const CREATED_RE = /^\s*created:\s*(.+)$/;
const TAGS_LINE_RE = /^\s*tags:\s*/i;
const CREATED_DATETIME_RE = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * 从笔记行中提取 Journal Memos 的 ```memos 块。
 */
export function extractMemos(lines: string[]): MemoEntry[] {
    const memos: MemoEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*```memos\s*$/.test(lines[i] || "")) continue;

        let end = -1;
        for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*```\s*$/.test(lines[j] || "")) {
                end = j;
                break;
            }
        }
        if (end === -1) break;

        const bodyLines = lines.slice(i + 1, end);
        const memo = parseMemoBody(bodyLines, i);
        if (memo) memos.push(memo);
        i = end;
    }

    return memos;
}

function parseMemoBody(bodyLines: string[], fenceLine: number): MemoEntry | null {
    let createdLabel: string | null = null;
    const contentLines: string[] = [];
    let inAttachments = false;

    for (const line of bodyLines) {
        // 附件注释块整体跳过（正文里的 ![[图片]] 仍保留，由 Markdown 渲染）
        if (/<!--\s*jm-attachments:start\s*-->/i.test(line)) {
            inAttachments = true;
            // 同一行内闭合的情况
            if (/<!--\s*jm-attachments:end\s*-->/i.test(line)) inAttachments = false;
            continue;
        }
        if (inAttachments) {
            if (/<!--\s*jm-attachments:end\s*-->/i.test(line)) inAttachments = false;
            continue;
        }

        const createdMatch = line.match(CREATED_RE);
        if (createdMatch && createdMatch[1] && createdLabel === null) {
            createdLabel = createdMatch[1].trim();
            continue;
        }
        if (TAGS_LINE_RE.test(line)) continue;

        contentLines.push(line);
    }

    if (!createdLabel) return null;
    const dt = createdLabel.match(CREATED_DATETIME_RE);
    if (!dt) return null;

    const pad = (n: number) => String(n).padStart(2, "0");
    const hours = Number(dt[4]);
    const minutes = Number(dt[5]);
    const seconds = Number(dt[6] || 0);

    return {
        timeSeconds: hours * 3600 + minutes * 60 + seconds,
        dateStr: `${dt[1]}-${pad(Number(dt[2]))}-${pad(Number(dt[3]))}`,
        label: dt[6] !== undefined
            ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
            : `${pad(hours)}:${pad(minutes)}`,
        text: contentLines.join("\n").trim(),
        line: fenceLine,
    };
}
