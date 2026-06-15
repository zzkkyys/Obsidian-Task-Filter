import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import TaskFilterPlugin from "./main";

export interface MyPluginSettings {
	hiddenTags: string[];
	pinnedProjects: string[];
	projectRootFolder: string;
	forceSettingsSidebarIcon: boolean;
	projectViewMasonry: boolean;
	projectViewPinnedOnly: boolean;
	projectViewMasonryMaxColumns: number;
	projectViewMasonryMinColumnWidth: number;
	projectViewMasonryMaxColumnWidth: number;
	mentionNotesFolder: string;
	dayTimelineShowMemos: boolean;
	dayTimelineShowTasks: boolean;
	timelineImageMaxSize: number;
	timelineHeading: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	hiddenTags: ['#task'],
	pinnedProjects: [],
	projectRootFolder: 'Projects',
	forceSettingsSidebarIcon: true,
	projectViewMasonry: true,
	projectViewPinnedOnly: false,
	projectViewMasonryMaxColumns: 4,
	projectViewMasonryMinColumnWidth: 220,
	projectViewMasonryMaxColumnWidth: 340,
	mentionNotesFolder: '',
	dayTimelineShowMemos: true,
	dayTimelineShowTasks: false,
	timelineImageMaxSize: 200,
	timelineHeading: '时间线',
}

type SettingsPanelKey = 'tags' | 'project' | 'timeline';

export class SampleSettingTab extends PluginSettingTab {
	plugin: TaskFilterPlugin;
	icon = 'tags';

	constructor(app: App, plugin: TaskFilterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: '任务过滤器设置' });

		const navEl = containerEl.createEl('div');
		navEl.style.display = 'flex';
		navEl.style.gap = '8px';
		navEl.style.flexWrap = 'wrap';
		navEl.style.marginBottom = '12px';

		const panelContainerEl = containerEl.createEl('div');
		panelContainerEl.style.borderTop = '1px solid var(--background-modifier-border)';
		panelContainerEl.style.paddingTop = '12px';

		const panelButtons = new Map<SettingsPanelKey, HTMLButtonElement>();
		const panelEls = new Map<SettingsPanelKey, HTMLElement>();

		const applyButtonStyle = (button: HTMLButtonElement, active: boolean): void => {
			button.style.borderRadius = '6px';
			button.style.padding = '6px 10px';
			button.style.cursor = 'pointer';
			button.style.border = active
				? '1px solid var(--interactive-accent)'
				: '1px solid var(--background-modifier-border)';
			button.style.backgroundColor = active
				? 'var(--interactive-accent)'
				: 'var(--background-secondary)';
			button.style.color = active
				? 'var(--text-on-accent)'
				: 'var(--text-normal)';
		};

		const setActivePanel = (activePanel: SettingsPanelKey): void => {
			for (const [key, panelEl] of panelEls) {
				panelEl.style.display = key === activePanel ? 'block' : 'none';
			}
			for (const [key, button] of panelButtons) {
				applyButtonStyle(button, key === activePanel);
			}
		};

		const createPanel = (key: SettingsPanelKey, label: string): HTMLElement => {
			const button = navEl.createEl('button', {
				text: label,
				attr: { type: 'button' },
			});
			applyButtonStyle(button, false);
			button.addEventListener('click', () => setActivePanel(key));
			panelButtons.set(key, button);

			const panelEl = panelContainerEl.createEl('div');
			panelEl.style.display = 'none';
			panelEls.set(key, panelEl);
			return panelEl;
		};

		const tagPanelEl = createPanel('tags', '标签');
		const projectPanelEl = createPanel('project', '项目与瀑布流');
		const timelinePanelEl = createPanel('timeline', '时间线');

		this.renderTagPanel(tagPanelEl);
		this.renderProjectPanel(projectPanelEl);
		this.renderTimelinePanel(timelinePanelEl);

		setActivePanel('tags');
	}

	private renderTimelinePanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '时间线设置' });

		let imageSizeValueEl: HTMLElement | null = null;
		new Setting(containerEl)
			.setName('图片缩略图最大尺寸')
			.setDesc('时间线卡片底部缩略图的最大宽度和高度（像素），点击缩略图可放大查看')
			.addSlider(slider => slider
				.setLimits(80, 480, 20)
				.setValue(this.plugin.settings.timelineImageMaxSize)
				.onChange(async (value) => {
					this.plugin.settings.timelineImageMaxSize = value;
					if (imageSizeValueEl) imageSizeValueEl.textContent = `${value}px`;
					await this.plugin.saveSettings();
					this.plugin.applyTimelineImageSize();
				}))
			.then(setting => {
				imageSizeValueEl = setting.controlEl.createEl('span', {
					text: `${this.plugin.settings.timelineImageMaxSize}px`,
				});
				imageSizeValueEl.style.marginLeft = '8px';
				imageSizeValueEl.style.color = 'var(--text-muted)';
				imageSizeValueEl.style.minWidth = '56px';
			});

		new Setting(containerEl)
			.setName('在当天时间线中显示 memos')
			.setDesc('把每日笔记里 Journal Memos 生成的 memos 按时间合并进当天时间线视图（视图导航栏的 💬 按钮也可切换）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dayTimelineShowMemos)
				.onChange(async (value) => {
					this.plugin.settings.dayTimelineShowMemos = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('在当天时间线中显示已完成任务')
			.setDesc('把 completedDate 落在当天的 #task 任务按完成时间合并进当天时间线视图（视图导航栏的 ✅ 按钮也可切换）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dayTimelineShowTasks)
				.onChange(async (value) => {
					this.plugin.settings.dayTimelineShowTasks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动创建时间线块的标题')
			.setDesc('当天时间线视图往每日笔记写入新时间线块时，在块前添加的二级标题文字')
			.addText(text => text
				.setPlaceholder('时间线')
				.setValue(this.plugin.settings.timelineHeading)
				.onChange(async (value) => {
					this.plugin.settings.timelineHeading = value.trim() || '时间线';
					await this.plugin.saveSettings();
				}));
	}

	private renderTagPanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '标签设置' });
		new Setting(containerEl)
			.setName('强制显示设置侧栏图标')
			.setDesc('实验功能：强制显示该插件在设置侧栏中的图标')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.forceSettingsSidebarIcon)
				.onChange(async (value) => {
					this.plugin.settings.forceSettingsSidebarIcon = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsSidebarIconMaybeChanged();
				}));

		new Setting(containerEl)
			.setName('隐藏的标签')
			.setDesc('在标签列表中隐藏这些标签（每行一个，包含 # 号）')
			.addTextArea(text => text
				.setPlaceholder('#task\n#hidden')
				.setValue(this.plugin.settings.hiddenTags.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.hiddenTags = value
						.split('\n')
						.map(tag => tag.trim().toLowerCase())
						.filter(tag => tag.length > 0);
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: '提及设置' });
		new Setting(containerEl)
			.setName('人物笔记目录')
			.setDesc('设置后，按住 Cmd/Ctrl 点击 @人名 会打开（或创建）该目录下对应的人物笔记，如 People/hit/zhangsan.md。留空则关闭此功能。')
			.addText(text => text
				.setPlaceholder('People')
				.setValue(this.plugin.settings.mentionNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.mentionNotesFolder = value.trim();
					await this.plugin.saveSettings();
				}));
	}

	private renderProjectPanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '项目设置' });

		new Setting(containerEl)
			.setName('项目根目录')
			.setDesc('「项目」视图在此目录下创建和扫描项目（每个项目是一个含 _index.md 的子文件夹）。留空则扫描整个库。')
			.addText(text => text
				.setPlaceholder('Projects')
				.setValue(this.plugin.settings.projectRootFolder)
				.onChange(async (value) => {
					this.plugin.settings.projectRootFolder = value.trim();
					await this.plugin.saveSettings();
					this.plugin.refreshProjectViews();
				}));

		let pendingProjectName = '';
		let projectInputEl: HTMLInputElement | null = null;

		const addPinnedProject = async (rawProjectName: string): Promise<void> => {
			const projectName = rawProjectName.trim();
			if (!projectName) return;

			const exists = this.plugin.settings.pinnedProjects
				.some(project => project.toLowerCase() === projectName.toLowerCase());
			if (exists) {
				new Notice(`项目「${projectName}」已在固定列表中`);
				return;
			}

			this.plugin.settings.pinnedProjects.push(projectName);
			this.plugin.settings.pinnedProjects.sort((a, b) => a.localeCompare(b, 'zh-CN'));
			await this.plugin.saveSettings();
			renderPinnedProjectChips();
		};

		const removePinnedProject = async (projectName: string): Promise<void> => {
			this.plugin.settings.pinnedProjects = this.plugin.settings.pinnedProjects
				.filter(project => project !== projectName);
			await this.plugin.saveSettings();
			renderPinnedProjectChips();
		};

		const pinnedProjectSetting = new Setting(containerEl)
			.setName('固定项目')
			.setDesc('以标签形式管理固定项目，可在右侧输入并添加')
			.addText(text => {
				text.setPlaceholder('输入项目名');
				projectInputEl = text.inputEl;
				text.inputEl.style.minWidth = '180px';
				text.inputEl.style.borderRadius = '8px';
				text.inputEl.style.padding = '6px 10px';
				text.onChange(value => {
					pendingProjectName = value;
				});
				text.inputEl.addEventListener('keydown', async (evt) => {
					if (evt.key !== 'Enter') return;
					evt.preventDefault();
					await addPinnedProject(pendingProjectName);
					pendingProjectName = '';
					text.setValue('');
				});
			})
			.addButton(button => button
				.setButtonText('添加')
				.setCta()
				.onClick(async () => {
					await addPinnedProject(pendingProjectName);
					pendingProjectName = '';
					if (projectInputEl) {
						projectInputEl.value = '';
						projectInputEl.focus();
					}
				}));

		pinnedProjectSetting.controlEl.style.flexWrap = 'wrap';
		pinnedProjectSetting.controlEl.style.rowGap = '8px';
		pinnedProjectSetting.controlEl.style.alignItems = 'flex-start';

		const pinnedChipContainer = containerEl.createEl('div');
		pinnedChipContainer.style.display = 'flex';
		pinnedChipContainer.style.flexWrap = 'wrap';
		pinnedChipContainer.style.alignContent = 'flex-start';
		pinnedChipContainer.style.gap = '10px';
		pinnedChipContainer.style.margin = '2px 0 14px 0';
		pinnedChipContainer.style.padding = '2px 0';
		// 最多显示两行，超出后在容器内滚动查看
		pinnedChipContainer.style.maxHeight = '68px';
		pinnedChipContainer.style.overflowY = 'hidden';
		pinnedChipContainer.style.overflowX = 'hidden';

		const updatePinnedChipContainerOverflow = (): void => {
			window.requestAnimationFrame(() => {
				const shouldScroll = pinnedChipContainer.scrollHeight > pinnedChipContainer.clientHeight + 1;
				pinnedChipContainer.style.overflowY = shouldScroll ? 'scroll' : 'hidden';
				pinnedChipContainer.style.paddingRight = shouldScroll ? '4px' : '0';
			});
		};

		const renderPinnedProjectChips = (): void => {
			pinnedChipContainer.empty();
			if (this.plugin.settings.pinnedProjects.length === 0) {
				const emptyHint = pinnedChipContainer.createEl('span', { text: '暂无固定项目' });
				emptyHint.style.display = 'inline-flex';
				emptyHint.style.alignItems = 'center';
				emptyHint.style.padding = '4px 10px';
				emptyHint.style.borderRadius = '999px';
				emptyHint.style.border = '1px dashed var(--background-modifier-border)';
				emptyHint.style.backgroundColor = 'var(--background-secondary)';
				emptyHint.style.color = 'var(--text-muted)';
				emptyHint.style.fontSize = '12px';
				updatePinnedChipContainerOverflow();
				return;
			}

			for (const projectName of this.plugin.settings.pinnedProjects) {
				const chipEl = pinnedChipContainer.createEl('span');
				chipEl.style.display = 'inline-flex';
				chipEl.style.alignItems = 'center';
				chipEl.style.gap = '7px';
				chipEl.style.padding = '4px 8px 4px 10px';
				chipEl.style.borderRadius = '999px';
				chipEl.style.border = '1px solid var(--background-modifier-border)';
				chipEl.style.backgroundColor = 'var(--background-secondary-alt)';
				chipEl.style.fontSize = '12px';
				chipEl.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.08)';

				const pinIcon = chipEl.createEl('span', { text: '📌' });
				pinIcon.style.fontSize = '11px';
				pinIcon.style.opacity = '0.85';

				const nameEl = chipEl.createEl('span', { text: projectName });
				nameEl.style.fontWeight = '500';
				nameEl.style.maxWidth = '160px';
				nameEl.style.overflow = 'hidden';
				nameEl.style.textOverflow = 'ellipsis';
				nameEl.style.whiteSpace = 'nowrap';

				const removeBtn = chipEl.createEl('button', {
					text: '×',
					attr: { type: 'button', 'aria-label': `移除固定项目 ${projectName}` },
				});
				removeBtn.style.width = '18px';
				removeBtn.style.height = '18px';
				removeBtn.style.display = 'inline-flex';
				removeBtn.style.alignItems = 'center';
				removeBtn.style.justifyContent = 'center';
				removeBtn.style.lineHeight = '1';
				removeBtn.style.fontSize = '12px';
				removeBtn.style.fontWeight = '600';
				removeBtn.style.borderRadius = '999px';
				removeBtn.style.border = '1px solid transparent';
				removeBtn.style.backgroundColor = 'var(--background-modifier-hover)';
				removeBtn.style.cursor = 'pointer';
				removeBtn.style.padding = '0';
				removeBtn.style.color = 'var(--text-muted)';
				removeBtn.style.transition = 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease';
				removeBtn.addEventListener('mouseenter', () => {
					removeBtn.style.color = 'var(--text-error)';
					removeBtn.style.borderColor = 'var(--background-modifier-border)';
				});
				removeBtn.addEventListener('mouseleave', () => {
					removeBtn.style.color = 'var(--text-muted)';
					removeBtn.style.borderColor = 'transparent';
				});
				removeBtn.addEventListener('click', async () => {
					await removePinnedProject(projectName);
				});
			}

			updatePinnedChipContainerOverflow();
		};

		renderPinnedProjectChips();
		containerEl.createEl('h3', { text: '瀑布流设置' });
		new Setting(containerEl)
			.setName('项目视图默认瀑布流')
			.setDesc('开启后，项目列将按瀑布流自动换列，减少横向滚动')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.projectViewMasonry)
				.onChange(async (value) => {
					this.plugin.settings.projectViewMasonry = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('瀑布流最大列数')
			.setDesc('限制瀑布流最多显示多少列（默认 4）')
			.addSlider(slider => slider
				.setLimits(1, 8, 1)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.projectViewMasonryMaxColumns)
				.onChange(async (value) => {
					this.plugin.settings.projectViewMasonryMaxColumns = Math.min(8, Math.max(1, Math.round(value)));
					await this.plugin.saveSettings();
				}));

		let minWidthValueEl: HTMLElement | null = null;
		let maxWidthValueEl: HTMLElement | null = null;

		new Setting(containerEl)
			.setName('瀑布流最小列宽')
			.setDesc('窗口变窄时，列宽不会小于这个值（像素）')
			.addSlider(slider => slider
				.setLimits(160, 360, 10)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.projectViewMasonryMinColumnWidth)
				.onChange(async (value) => {
					const nextMin = Math.min(360, Math.max(160, Math.round(value / 10) * 10));
					this.plugin.settings.projectViewMasonryMinColumnWidth = nextMin;
					if (this.plugin.settings.projectViewMasonryMaxColumnWidth < nextMin) {
						this.plugin.settings.projectViewMasonryMaxColumnWidth = nextMin;
						if (maxWidthValueEl) maxWidthValueEl.textContent = `${nextMin}px`;
					}
					if (minWidthValueEl) minWidthValueEl.textContent = `${nextMin}px`;
					await this.plugin.saveSettings();
				}))
			.then(setting => {
				minWidthValueEl = setting.controlEl.createEl('span', {
					text: `${this.plugin.settings.projectViewMasonryMinColumnWidth}px`,
				});
				minWidthValueEl.style.marginLeft = '8px';
				minWidthValueEl.style.color = 'var(--text-muted)';
				minWidthValueEl.style.minWidth = '56px';
			});

		new Setting(containerEl)
			.setName('瀑布流最大列宽')
			.setDesc('窗口变宽时，列宽不会大于这个值（像素）')
			.addSlider(slider => slider
				.setLimits(220, 520, 10)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.projectViewMasonryMaxColumnWidth)
				.onChange(async (value) => {
					const nextMax = Math.min(520, Math.max(220, Math.round(value / 10) * 10));
					this.plugin.settings.projectViewMasonryMaxColumnWidth = nextMax;
					if (this.plugin.settings.projectViewMasonryMinColumnWidth > nextMax) {
						this.plugin.settings.projectViewMasonryMinColumnWidth = nextMax;
						if (minWidthValueEl) minWidthValueEl.textContent = `${nextMax}px`;
					}
					if (maxWidthValueEl) maxWidthValueEl.textContent = `${nextMax}px`;
					await this.plugin.saveSettings();
				}))
			.then(setting => {
				maxWidthValueEl = setting.controlEl.createEl('span', {
					text: `${this.plugin.settings.projectViewMasonryMaxColumnWidth}px`,
				});
				maxWidthValueEl.style.marginLeft = '8px';
				maxWidthValueEl.style.color = 'var(--text-muted)';
				maxWidthValueEl.style.minWidth = '56px';
			});
	}
}
