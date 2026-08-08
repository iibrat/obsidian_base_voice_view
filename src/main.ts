import * as obsidian from "obsidian";
import { Notice, Plugin } from "obsidian";
import { WATERFALL_CSS } from "./styles";
import { WATERFALL_VIEW_TYPE, WaterfallView } from "./waterfallView";

const STYLE_ID = "bases-waterfall-view-styles";

export default class BasesWaterfallPlugin extends Plugin {
	async onload() {
		this.injectStyles();

		// 移动端兼容性防御：
		// 1. Obsidian 模块必须导出 BasesView（1.10+ 才有，手机端某些旧版本或未启用 Bases 时缺失）
		// 2. Plugin 原型必须拥有 registerBasesView（同上）
		// 两个条件任一不满足时：不注册视图，但插件照常启用（不会"无法开启"），同时给用户一个一次性提示。
		const hasBasesView = typeof (obsidian as unknown as { BasesView?: unknown }).BasesView === "function";
		const hasRegister = typeof (this as unknown as { registerBasesView?: unknown }).registerBasesView === "function";

		if (!hasBasesView || !hasRegister) {
			console.warn(
				`[bases-waterfall-view] 当前环境不支持注册自定义 Bases 视图 (BasesView=${hasBasesView}, registerBasesView=${hasRegister})。` +
					`请确认 Obsidian ≥ 1.10 且 Bases 核心插件已启用。`
			);
			try {
				new Notice(
					"Waterfall 视图：当前 Obsidian 版本或环境缺少 Bases 扩展 API（需 Obsidian 1.10+ 并启用 Bases 插件），瀑布流视图暂不显示。",
					12_000
				);
			} catch {
				/* Notice 类不存在时静默：极少数环境甚至连 Notice 都未暴露（移动版早期内测），不抛错。 */
			}
			return;
		}

		try {
			(this as unknown as {
				registerBasesView: (
					type: string,
					opts: unknown
				) => unknown;
			}).registerBasesView(WATERFALL_VIEW_TYPE, {
				name: "Waterfall",
				icon: "layout-dashboard",
				factory: (controller: unknown, containerEl: HTMLElement) =>
					new WaterfallView(controller as never, containerEl),
				options: (config: unknown) => (WaterfallView as unknown as {
					getViewOptions: (c: unknown) => unknown[];
				}).getViewOptions(config),
			});
		} catch (err) {
			console.error("[bases-waterfall-view] 注册自定义 Bases 视图失败：", err);
			try {
				new Notice("Waterfall 视图注册失败，详细信息请查看控制台。", 6000);
			} catch {
				/* noop */
			}
		}
	}

	onunload() {
		try {
			document.getElementById(STYLE_ID)?.remove();
		} catch {
			/* onunload 失败不应影响 Obsidian 退出流程。 */
		}
	}

	private injectStyles() {
		try {
			if (document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = WATERFALL_CSS;
			document.head.appendChild(style);
		} catch (err) {
			console.warn("[bases-waterfall-view] 样式注入失败：", err);
		}
	}
}
