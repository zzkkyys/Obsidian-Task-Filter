import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// 遗留代码豁免：这些文件存在大量历史写法（内联样式、innerHTML、未 await 的
		// Promise 等），逐步重构前先关闭对应规则，避免阻塞 CI。
		// 新增文件不在此列表内，保持完整规则检查。
		files: [
			"src/main.ts",
			"src/settings.ts",
			"src/skills/taskSkill.ts",
			"src/utils/tagScanner.ts",
			"src/views/TagFilterView.ts",
			"src/views/TaskBlockRenderer.ts",
			"src/views/TaskResultView.ts",
		],
		rules: {
			"obsidianmd/no-static-styles-assignment": "off",
			"obsidianmd/ui/sentence-case": "off",
			"obsidianmd/no-view-references-in-plugin": "off",
			"obsidianmd/detach-leaves": "off",
			"obsidianmd/sample-names": "off",
			"obsidianmd/settings-tab/no-manual-html-headings": "off",
			"@microsoft/sdl/no-inner-html": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-deprecated": "off",
			"no-case-declarations": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
