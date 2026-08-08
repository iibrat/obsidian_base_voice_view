import { Plugin } from "obsidian";
import { WATERFALL_CSS } from "./styles";
import { WATERFALL_VIEW_TYPE, WaterfallView } from "./waterfallView";

const STYLE_ID = "bases-waterfall-view-styles";

export default class BasesWaterfallPlugin extends Plugin {
	async onload() {
		this.injectStyles();

		this.registerBasesView(WATERFALL_VIEW_TYPE, {
			name: "Waterfall",
			icon: "layout-dashboard",
			factory: (controller, containerEl) => new WaterfallView(controller, containerEl),
			options: (config) => WaterfallView.getViewOptions(config),
		});
	}

	onunload() {
		document.getElementById(STYLE_ID)?.remove();
	}

	private injectStyles() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = WATERFALL_CSS;
		document.head.appendChild(style);
	}
}
