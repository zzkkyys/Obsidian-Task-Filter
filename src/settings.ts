import {App, PluginSettingTab, Setting} from "obsidian";
import TaskFilterPlugin from "./main";

export interface MyPluginSettings {
	hiddenTags: string[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	hiddenTags: ['#task']
}

export class SampleSettingTab extends PluginSettingTab {
	plugin: TaskFilterPlugin;

	constructor(app: App, plugin: TaskFilterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: '任务过滤器设置' });

		new Setting(containerEl)
			.setName('隐藏的标签')
			.setDesc('在标签列表中隐藏这些标签（每行一个，包含 # 号）')
			.addTextArea(text => text
				.setPlaceholder('#task\n#hidden')
				.setValue(this.plugin.settings.hiddenTags.join('\n'))
				.onChange(async (value) => {
					// 按行分割，过滤空行，并去除首尾空格
					this.plugin.settings.hiddenTags = value
						.split('\n')
						.map(tag => tag.trim().toLowerCase())
						.filter(tag => tag.length > 0);
					await this.plugin.saveSettings();
				}));
	}
}
