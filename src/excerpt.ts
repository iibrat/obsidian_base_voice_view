import { App, TFile } from "obsidian";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "flac", "ogg", "aac", "webm", "opus", "wma", "m4b", "aiff"];

function stripWikilink(s: string): string {
	return s.replace(/^\[\[|\]\]$/g, "").replace(/\[\[([^\]]+)\]\]/g, (_, inner) => String(inner).split("|").pop() ?? inner);
}

function isImageFile(file: TFile | null): boolean {
	if (!file) return false;
	return IMAGE_EXT.includes(file.extension.toLowerCase());
}

export function isAudioFile(file: TFile | null): boolean {
	if (!file) return false;
	return AUDIO_EXT.includes(file.extension.toLowerCase());
}

/** 移除 frontmatter 块，返回正文。 */
function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).replace(/^\s*\n/, "");
}

/** 从正文里提取摘要文本（去除图片、链接、markdown 符号）。 */
export function extractExcerpt(content: string, len = 180): string {
	let body = stripFrontmatter(content);
	body = body
		.replace(/!\[\[[^\]]*\]\]/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => String(inner).split("|").pop() ?? inner)
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/[*_`>~]/g, "")
		.replace(/\n{2,}/g, "\n")
		.replace(/\s+/g, " ")
		.trim();
	return body.length > len ? body.slice(0, len) + "…" : body;
}

/** 解析一个链接/路径字符串为图片 TFile。 */
function resolveImageLink(link: string, sourceFile: TFile, app: App): TFile | null {
	const clean = stripWikilink(link).trim();
	if (!clean) return null;
	const byPath = app.vault.getAbstractFileByPath(clean);
	if (byPath instanceof TFile && isImageFile(byPath)) return byPath;
	const dest = app.metadataCache.getFirstLinkpathDest(clean, sourceFile.path);
	if (dest instanceof TFile && isImageFile(dest)) return dest;
	return null;
}

/** 解析一个链接/路径字符串为音频 TFile。 */
export function resolveAudioLink(link: string, sourceFile: TFile, app: App): TFile | null {
	const clean = stripWikilink(link).trim();
	if (!clean) return null;
	// 外链音频直接返回 null，让调用方自行处理 URL。
	if (/^https?:\/\//i.test(clean)) return null;
	const byPath = app.vault.getAbstractFileByPath(clean);
	if (byPath instanceof TFile && isAudioFile(byPath)) return byPath;
	const dest = app.metadataCache.getFirstLinkpathDest(clean, sourceFile.path);
	if (dest instanceof TFile && isAudioFile(dest)) return dest;
	return null;
}

/** 从正文里找第一张图片嵌入，返回其 TFile。 */
export function findFirstImage(content: string, file: TFile, app: App): TFile | null {
	let m: RegExpExecArray | null;
	const wikiRe = /!\[\[([^\]]+)\]\]/g;
	while ((m = wikiRe.exec(content))) {
		const target = m[1].split("|")[0].trim();
		const img = resolveImageLink(target, file, app);
		if (img) return img;
	}
	const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
	while ((m = mdRe.exec(content))) {
		const img = resolveImageLink(m[1].trim(), file, app);
		if (img) return img;
	}
	return null;
}

/** 从正文里找第一个音频嵌入，返回其 TFile。外链返回 { external: true, url: string }。 */
export type AudioTarget =
	| { kind: "file"; file: TFile }
	| { kind: "external"; url: string };

export function findFirstAudio(content: string, file: TFile, app: App): AudioTarget | null {
	let m: RegExpExecArray | null;
	const wikiRe = /!\[\[([^\]]+)\]\]/g;
	while ((m = wikiRe.exec(content))) {
		const target = m[1].split("|")[0].trim();
		const audio = resolveAudioLink(target, file, app);
		if (audio) return { kind: "file", file: audio };
	}
	const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
	while ((m = mdRe.exec(content))) {
		const raw = m[1].trim();
		if (/^https?:\/\//i.test(raw)) {
			// 粗略外链音频判断：扩展名或直接过
			if (/\.(mp3|wav|m4a|flac|ogg|aac|webm|opus|m4b|wma|aiff)(\?|#|$)/i.test(raw)) {
				return { kind: "external", url: raw };
			}
			continue;
		}
		const audio = resolveAudioLink(raw, file, app);
		if (audio) return { kind: "file", file: audio };
	}
	return null;
}

export interface ContentCacheEntry {
	mtime: number;
	excerpt: string;
	firstImage: TFile | null;
	firstAudio: AudioTarget | null;
}

/** 模块级内容缓存，按路径 + mtime 失效。 */
export const contentCache = new Map<string, ContentCacheEntry>();

/** 读取并缓存某个文件的摘要、首图、首段音频。 */
export async function getCachedContent(app: App, file: TFile, excerptLen: number): Promise<ContentCacheEntry> {
	const mtime = file.stat?.mtime ?? 0;
	const cached = contentCache.get(file.path);
	if (cached && cached.mtime === mtime) return cached;
	let content = "";
	try {
		content = await app.vault.cachedRead(file);
	} catch {
		content = "";
	}
	const entry: ContentCacheEntry = {
		mtime,
		excerpt: extractExcerpt(content, excerptLen),
		firstImage: findFirstImage(content, file, app),
		firstAudio: findFirstAudio(content, file, app),
	};
	contentCache.set(file.path, entry);
	return entry;
}

export { stripWikilink, isImageFile, resolveImageLink };
