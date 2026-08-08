import * as obsidian from "obsidian";
import {
	BasesAllOptions,
	BasesDropdownOption,
	BasesPropertyId,
	BasesPropertyOption,
	BasesViewConfig,
	Keymap,
	NullValue,
	QueryController,
	TFile,
	Value,
} from "obsidian";
import { AudioTarget, getCachedContent, resolveAudioLink, resolveImageLink } from "./excerpt";

export const WATERFALL_VIEW_TYPE = "waterfall-view";
const MAX_PROPERTIES = 8;

// 运行时动态决定基类：
// - 如果 obsidian 模块未导出 BasesView（旧版 Obsidian / 移动端不包含 Bases），
//   extends undefined 会直接抛错导致整个插件加载失败。用空类兜底，
//   main.ts 里有保护逻辑不会真的去实例化它。
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
const BasesViewRuntime: any =
	typeof (obsidian as unknown as { BasesView?: unknown }).BasesView === "function"
		? (obsidian as unknown as { BasesView: unknown }).BasesView
		: class {};

// 模块级单例：整个 Obsidian 窗口所有 Waterfall 卡片共享同一当前播放项，确保同一时间只播放一个。
let activeAudio: HTMLAudioElement | null = null;

/** 暂停并重置当前正在播放的互斥音频（若它已从 DOM 分离也一并清理引用）。 */
function stopActiveAudio(removeIfDetached = false): void {
	const cur = activeAudio;
	if (!cur) return;
	try {
		if (!cur.paused) cur.pause();
		// 停止后回到 0，下次其他卡片播放不会导致"暂停了但进度条还在中间"。
		cur.currentTime = 0;
	} catch {
		/* ignore: detached / invalid element */
	}
	if (removeIfDetached && !cur.isConnected) {
		activeAudio = null;
		return;
	}
}

/** 登记一个音频元素为"当前活动音频"，播放时自动暂停上一个。 */
function registerAudioForMutualExclusion(audio: HTMLAudioElement): () => void {
	const onPlay = () => {
		if (activeAudio && activeAudio !== audio) {
			stopActiveAudio();
		}
		activeAudio = audio;
	};
	const onStop = () => {
		if (activeAudio === audio) activeAudio = null;
	};
	audio.addEventListener("play", onPlay);
	audio.addEventListener("ended", onStop);
	audio.addEventListener("emptied", onStop);
	// pause 不清全局引用（用户手动暂停后再继续应仍属同一个活动项），
	// 但"下次别的 audio 播放时"会自动把它停止，所以不会泄露。
	return () => {
		audio.removeEventListener("play", onPlay);
		audio.removeEventListener("ended", onStop);
		audio.removeEventListener("emptied", onStop);
		if (activeAudio === audio) {
			try {
				if (!audio.paused) audio.pause();
				audio.currentTime = 0;
			} catch {
				/* noop */
			}
			activeAudio = null;
		}
	};
}

export class WaterfallView extends BasesViewRuntime {
	type = WATERFALL_VIEW_TYPE;

	private rootEl: HTMLElement;
	private renderToken = 0;
	private cardEls = new Map<string, HTMLElement>();
	private audioCleanups: Array<() => void> = []; // 本视图内所有互斥监听器的卸载函数

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.rootEl = containerEl.createDiv({ cls: "bases-waterfall-root" });

		// 视图关闭/切换清理：当 rootEl 从 DOM 中分离，说明本视图被卸载，清理互斥监听器并停止仍在播放的音频。
		// - 轮询兜底（setInterval 1s）：处理快速切换、Bases 框架未触发明确 close 的情况。
		// - Monkey-patch 自身 onClose：BasesView 运行时基类存在 onClose，类型未暴露，用动态替换兜住。
		let guard: ReturnType<typeof setInterval> | null = null;
		const shutdown = () => {
			if (guard != null) {
				clearInterval(guard);
				guard = null;
			}
			this.clearAudioCleanups();
			stopActiveAudio();
		};
		// 注意：这里必须用全局标准 setInterval，不能写 window.setInterval，
		// 因为移动版 Obsidian 部分 WebView 环境里 setInterval 是 ECMAScript 全局，不应绑定到 window。
		guard = globalThis.setInterval(() => {
			if (!this.rootEl.isConnected) shutdown();
		}, 1000);

		const anyThis = this as unknown as { onClose?: () => void };
		const origClose = anyThis.onClose?.bind(this);
		anyThis.onClose = () => {
			try {
				origClose?.();
			} catch {
				/* noop */
			}
			shutdown();
		};
	}

	private clearAudioCleanups() {
		let cleanup: (() => void) | undefined;
		while ((cleanup = this.audioCleanups.pop())) {
			try {
				cleanup();
			} catch {
				/* noop */
			}
		}
	}

	onDataUpdated(): void {
		this.render();
	}

	private getStr(key: string, fallback: string): string {
		const v = this.config.get(key);
		return typeof v === "string" ? v : fallback;
	}
	private getBool(key: string, fallback: boolean): boolean {
		const v = this.config.get(key);
		return typeof v === "boolean" ? v : fallback;
	}
	private getNum(key: string, fallback: number): number {
		const v = this.config.get(key);
		return typeof v === "number" && Number.isFinite(v) ? v : fallback;
	}

	render(): void {
		// 重新渲染前：如果之前的活动音频已随旧卡片从 DOM 分离，就暂停并清掉引用，避免"看不见的卡片仍在播放"。
		this.clearAudioCleanups();
		stopActiveAudio(true);

		const token = ++this.renderToken;
		this.cardEls.clear();
		this.rootEl.empty();

		const rawEntries = this.data?.data ?? [];
		if (rawEntries.length === 0) {
			this.renderEmpty("没有可显示的笔记", "请确认该 Base 中包含文件，或调整筛选条件。");
			return;
		}

		// 按文件修改时间降序排列：最新笔记在前。
		const entries = rawEntries
			.slice()
			.sort(
				(a: { file: TFile }, b: { file: TFile }) =>
					(b.file.stat?.mtime ?? 0) - (a.file.stat?.mtime ?? 0)
			);

		const order = this.config.getOrder();
		const imagePropId = this.config.getAsPropertyId("imageProperty");
		const audioPropId = this.config.getAsPropertyId("audioProperty");
		const titlePropId = this.config.getAsPropertyId("cardTitleProperty");
		const imageFit = this.getStr("imageFit", "cover") === "contain" ? "contain" : "cover";
		const showExcerpt = this.getBool("showExcerpt", true);
		const showAudio = this.getBool("showAudio", true);
		const showProps = this.getBool("showProperties", true);
		const excerptLen = Math.round(this.getNum("excerptLength", 180));
		const cardWidth = Math.round(this.getNum("cardWidth", 260));
		this.rootEl.style.setProperty("--bases-waterfall-col", `${cardWidth}px`);

		const grid = this.rootEl.createDiv({ cls: "bases-waterfall-grid" });

		for (const entry of entries) {
			const card = grid.createDiv({ cls: "bases-waterfall-card" });
			card.setAttribute("data-path", entry.file.path);
			this.cardEls.set(entry.file.path, card);

			// 封面（来自配置的图片属性）
			if (imagePropId) {
				const coverEl = card.createDiv({ cls: `bases-waterfall-cover is-${imageFit}` });
				if (!this.renderCover(coverEl, entry, imagePropId)) {
					coverEl.remove();
				} else {
					card.classList.add("has-cover");
				}
			}

			// 同步渲染：属性指定的音频文件
			if (showAudio && audioPropId) {
				const audioTarget = this.audioFromProperty(entry, audioPropId);
				if (audioTarget) {
					const wrap = card.createDiv({ cls: "bases-waterfall-audio" });
					this.renderAudioElement(wrap, audioTarget);
					card.classList.add("has-audio");
				}
			}

			const body = card.createDiv({ cls: "bases-waterfall-body" });

			// 标题
			const titleEl = body.createDiv({ cls: "bases-waterfall-title" });
			this.renderTitle(titleEl, entry, titlePropId);

			// 属性
			if (showProps) {
				const propsEl = body.createDiv({ cls: "bases-waterfall-props" });
				let shown = 0;
				for (const propId of order) {
					if (shown >= MAX_PROPERTIES) break;
					if (
						propId === titlePropId ||
						propId === imagePropId ||
						propId === audioPropId
					)
						continue;
					const value = entry.getValue(propId);
					if (!this.isRenderableValue(value)) continue;
					const row = propsEl.createDiv({ cls: "bases-waterfall-prop" });
					row.createSpan({ cls: "bases-waterfall-prop-name", text: this.config.getDisplayName(propId) });
					const valEl = row.createSpan({ cls: "bases-waterfall-prop-value" });
					value!.renderTo(valEl, this.app.renderContext);
					shown++;
				}
				if (shown === 0) propsEl.remove();
			}

			// 摘要占位（异步填充）
			if (showExcerpt) {
				body.createDiv({ cls: "bases-waterfall-excerpt bases-waterfall-excerpt-loading" });
			}

			card.addEventListener("click", (e: MouseEvent) => {
				if (e.target instanceof Element && (e.target.closest("a") || e.target.closest("audio, video"))) return;
				this.app.workspace.openLinkText(entry.file.path, "", Keymap.isModEvent(e));
			});
		}

		// 异步补充：摘要；未配置图片属性时从正文取首图；未配置音频属性时从正文取首段音频。
		if (showExcerpt || !imagePropId || (showAudio && !audioPropId)) {
			void this.fillAsync(
				entries,
				token,
				showExcerpt,
				!imagePropId,
				showAudio && !audioPropId,
				excerptLen
			);
		}
	}

	private isRenderableValue(value: Value | null): boolean {
		if (!value || value instanceof NullValue) return false;
		const s = value.toString();
		return !!s.trim();
	}

	private renderTitle(titleEl: HTMLElement, entry: { file: TFile; getValue(id: BasesPropertyId): Value | null }, titlePropId: BasesPropertyId | null): void {
		if (!titlePropId) {
			titleEl.textContent = entry.file.basename;
			return;
		}
		const value = entry.getValue(titlePropId);
		if (!this.isRenderableValue(value)) {
			titleEl.textContent = entry.file.basename;
			return;
		}
		value!.renderTo(titleEl, this.app.renderContext);
	}

	private renderCover(coverEl: HTMLElement, entry: { file: TFile; getValue(id: BasesPropertyId): Value | null }, imagePropId: BasesPropertyId): boolean {
		const value = entry.getValue(imagePropId);
		if (!this.isRenderableValue(value)) return false;
		const raw = value!.toString().trim();
		if (!raw) return false;

		// 外链图片
		if (/^https?:\/\//i.test(raw)) {
			coverEl.createEl("img", { attr: { src: raw, alt: "", loading: "lazy" } });
			return true;
		}
		// vault 内图片：解析 wikilink 或路径
		let linkText = raw.replace(/^!\s*/, "");
		const wikiMatch = linkText.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
		if (wikiMatch) linkText = wikiMatch[1];
		linkText = linkText.trim();
		if (!linkText) return false;
		const file = resolveImageLink(linkText, entry.file, this.app);
		if (!file) return false;
		coverEl.createEl("img", { attr: { src: this.app.vault.getResourcePath(file), alt: "", loading: "lazy" } });
		return true;
	}

	/** 从 Bases 属性值解析为音频目标（vault 文件或外链 URL）。 */
	private audioFromProperty(
		entry: { file: TFile; getValue(id: BasesPropertyId): Value | null },
		audioPropId: BasesPropertyId
	): AudioTarget | null {
		const value = entry.getValue(audioPropId);
		if (!this.isRenderableValue(value)) return null;
		const raw = value!.toString().trim();
		if (!raw) return null;
		if (/^https?:\/\//i.test(raw)) {
			if (/\.(mp3|wav|m4a|flac|ogg|aac|webm|opus|m4b|wma|aiff)(\?|#|$)/i.test(raw)) {
				return { kind: "external", url: raw };
			}
			return null;
		}
		let linkText = raw.replace(/^!\s*/, "");
		const wikiMatch = linkText.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
		if (wikiMatch) linkText = wikiMatch[1];
		linkText = linkText.trim();
		if (!linkText) return null;
		const file = resolveAudioLink(linkText, entry.file, this.app);
		return file ? { kind: "file", file } : null;
	}

	/** 在指定容器内渲染 audio 控件，处理事件冒泡防止触发卡片跳转，并登记到全局互斥。 */
	private renderAudioElement(wrap: HTMLElement, target: AudioTarget): void {
		const src = target.kind === "file" ? this.app.vault.getResourcePath(target.file) : target.url;
		const audio = wrap.createEl("audio", {
			attr: { src, preload: "none", controls: true },
		});
		// 阻止 audio 内部任意交互冒泡到卡片点击。
		const stop = (e: Event) => e.stopPropagation();
		["click", "mousedown", "mouseup", "play", "pause", "seeked", "input", "change"].forEach((ev) => {
			audio.addEventListener(ev, stop);
		});
		// 加入全局互斥（同一时刻只有一个可播放），并保存卸载钩子以便重渲染/视图关闭时清理。
		const cleanup = registerAudioForMutualExclusion(audio);
		this.audioCleanups.push(cleanup);
	}

	private async fillAsync(
		entries: { file: TFile }[],
		token: number,
		showExcerpt: boolean,
		fillCover: boolean,
		fillAudio: boolean,
		excerptLen: number
	): Promise<void> {
		const queue = entries.slice();
		const app = this.app;
		const worker = async () => {
			while (queue.length > 0) {
				if (token !== this.renderToken) return;
				const entry = queue.shift();
				if (!entry) break;
				const file = entry.file;
				let cached;
				try {
					cached = await getCachedContent(app, file, excerptLen);
				} catch {
					continue;
				}
				if (token !== this.renderToken) return;
				const card = this.cardEls.get(file.path);
				if (!card || !card.isConnected) continue;

				if (showExcerpt) {
					const ex = card.querySelector<HTMLElement>(".bases-waterfall-excerpt");
					if (ex) {
						if (cached.excerpt) {
							ex.removeClass("bases-waterfall-excerpt-loading");
							ex.textContent = cached.excerpt;
						} else {
							ex.remove();
						}
					}
				}
				if (fillCover && !card.classList.contains("has-cover") && cached.firstImage) {
					const body = card.querySelector<HTMLElement>(".bases-waterfall-body");
					const cover = createDiv({ cls: "bases-waterfall-cover is-cover" });
					cover.createEl("img", { attr: { src: app.vault.getResourcePath(cached.firstImage), alt: "", loading: "lazy" } });
					if (body) card.insertBefore(cover, body);
					else card.appendChild(cover);
					card.classList.add("has-cover");
				}
				if (fillAudio && !card.classList.contains("has-audio") && cached.firstAudio) {
					const body = card.querySelector<HTMLElement>(".bases-waterfall-body");
					const wrap = createDiv({ cls: "bases-waterfall-audio" });
					this.renderAudioElement(wrap, cached.firstAudio);
					if (body) card.insertBefore(wrap, body);
					else card.appendChild(wrap);
					card.classList.add("has-audio");
				}
			}
		};
		const n = Math.min(8, entries.length);
		await Promise.all(Array.from({ length: n }, () => worker()));
	}

	private renderEmpty(text: string, hint?: string): void {
		const empty = this.rootEl.createDiv({ cls: "bases-waterfall-empty" });
		empty.createDiv({ cls: "bases-waterfall-empty-icon", text: "💧" });
		empty.createDiv({ cls: "bases-waterfall-empty-text", text });
		if (hint) empty.createDiv({ cls: "bases-waterfall-empty-hint", text: hint });
	}

	static getViewOptions(_config: BasesViewConfig): BasesAllOptions[] {
		const options: BasesAllOptions[] = [
			{
				displayName: "Card title property",
				type: "property",
				key: "cardTitleProperty",
				placeholder: "Default: file name",
			} as BasesPropertyOption,
			{
				displayName: "Image property",
				type: "property",
				key: "imageProperty",
				placeholder: "Optional: defaults to first image in note",
			} as BasesPropertyOption,
			{
				displayName: "Image fit",
				type: "dropdown",
				key: "imageFit",
				default: "cover",
				options: { cover: "Cover", contain: "Contain" },
			} as BasesDropdownOption,
			{
				displayName: "Show audio player",
				type: "toggle",
				key: "showAudio",
				default: true,
			},
			{
				displayName: "Audio property",
				type: "property",
				key: "audioProperty",
				placeholder: "Optional: defaults to first audio in note",
			} as BasesPropertyOption,
			{
				displayName: "Show excerpt",
				type: "toggle",
				key: "showExcerpt",
				default: true,
			},
			{
				displayName: "Excerpt length",
				type: "slider",
				key: "excerptLength",
				default: 180,
				min: 60,
				max: 400,
				step: 10,
			},
			{
				displayName: "Show properties",
				type: "toggle",
				key: "showProperties",
				default: true,
			},
			{
				displayName: "Card width",
				type: "slider",
				key: "cardWidth",
				default: 260,
				min: 180,
				max: 460,
				step: 10,
			},
		];
		return options;
	}
}
