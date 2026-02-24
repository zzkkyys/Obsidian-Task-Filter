// 允许 import '*.md' 文件作为字符串（esbuild text loader）
declare module "*.md" {
    const content: string;
    export default content;
}
