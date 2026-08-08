// 视图样式。内联注入到 document.head，确保即便 vault 中的 styles.css 过期也能正确渲染。
export const WATERFALL_CSS = `
.bases-waterfall-root {
	padding: var(--size-4-4);
	box-sizing: border-box;
}
.bases-waterfall-grid {
	column-gap: var(--size-4-3);
	column-width: var(--bases-waterfall-col, 260px);
}
.bases-waterfall-card {
	break-inside: avoid;
	width: 100%;
	margin-bottom: var(--size-4-3);
	background: var(--bases-cards-background);
	border: var(--bases-cards-border-width) solid var(--bases-cards-border-color, var(--background-modifier-border));
	border-radius: var(--bases-cards-radius);
	box-shadow: var(--bases-cards-shadow);
	overflow: hidden;
	cursor: pointer;
	transition: box-shadow 90ms ease, transform 90ms ease;
}
.bases-waterfall-card:hover {
	box-shadow: var(--bases-cards-shadow-hover);
	transform: translateY(-1px);
}
.bases-waterfall-cover {
	width: 100%;
	background: var(--bases-cards-cover-background);
	overflow: hidden;
}
.bases-waterfall-cover img {
	display: block;
	width: 100%;
	height: auto;
}
.bases-waterfall-cover.is-cover img { object-fit: cover; }
.bases-waterfall-cover.is-contain img { object-fit: contain; max-height: 280px; }
.bases-waterfall-body {
	padding: var(--size-4-2) var(--size-4-3) var(--size-4-3);
	display: flex;
	flex-direction: column;
	gap: var(--size-4-2);
}
.bases-waterfall-title {
	font-size: var(--font-ui-small);
	font-weight: var(--font-medium);
	color: var(--text-normal);
	line-height: 1.35;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}
.bases-waterfall-title a { color: var(--text-normal); text-decoration: none; }
.bases-waterfall-props {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.bases-waterfall-prop {
	display: flex;
	gap: var(--size-4-2);
	font-size: var(--font-smallest);
	line-height: 1.4;
	align-items: baseline;
}
.bases-waterfall-prop-name {
	color: var(--text-muted);
	flex-shrink: 0;
	max-width: 45%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.bases-waterfall-prop-value {
	color: var(--text-normal);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
.bases-waterfall-excerpt {
	font-size: var(--font-smallest);
	color: var(--text-muted);
	line-height: 1.5;
	display: -webkit-box;
	-webkit-line-clamp: 5;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.bases-waterfall-excerpt-loading { min-height: 1.5em; opacity: 0.5; }
.bases-waterfall-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--size-4-2);
	padding: var(--size-4-8);
	color: var(--text-muted);
	text-align: center;
}
.bases-waterfall-empty-icon { font-size: 32px; opacity: 0.6; }
.bases-waterfall-empty-hint { font-size: var(--font-smallest); opacity: 0.7; max-width: 360px; }
.bases-waterfall-audio {
	padding: var(--size-4-2) var(--size-4-3) 0;
	background: var(--bases-cards-background);
}
.bases-waterfall-audio audio {
	display: block;
	width: 100%;
	height: 32px;
	outline: none;
	border-radius: var(--radius-s);
	background: transparent;
	filter: hue-rotate(0deg);
}
.bases-waterfall-card.has-cover > .bases-waterfall-audio { padding-top: var(--size-4-1); padding-bottom: 0; }
.bases-waterfall-card:not(.has-cover) > .bases-waterfall-audio { padding-top: var(--size-4-2); padding-bottom: var(--size-4-1); background: var(--bases-cards-cover-background); }
`;
