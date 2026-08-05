import { get, type Unsubscriber } from 'svelte/store';
import Konva from 'konva';

import { addAnnotation } from '$lib/doc/clipOps';
import { labelSettings, labelBasePx } from '$lib/stores/labelSettings';
import type { Annotation, PlanarPoint } from '$lib/doc/types';
import { LABEL_FONT_FAMILY } from '../annotations/AnnotationRenderer';
import type { BoardProjection } from '../paths/projection';

/** Shared 2D context for measuring the in-progress text (kept module-scoped so
 * the editor doesn't allocate a canvas per keystroke). */
let measureCtx: CanvasRenderingContext2D | null = null;

function measureWidth(text: string, fontSize: number): number {
	if (!measureCtx) {
		const canvas = document.createElement('canvas');
		measureCtx = canvas.getContext('2d');
	}
	if (measureCtx) {
		measureCtx.font = `${fontSize}px ${LABEL_FONT_FAMILY}`;
		return measureCtx.measureText(text).width;
	}
	return text.length * fontSize * 0.6;
}

export interface LabelEditorDeps {
	stage: Konva.Stage;
	projection: BoardProjection;
	annotationLayer: Konva.Layer;
	/** Re-render annotations after a commit (clears the draft from the layer). */
	onCommitted: () => void;
}

/**
 * Direct-on-canvas text entry for the label tool. Replaces the old `prompt()`
 * flow: a pointerdown with the label tool armed starts an inline edit at the
 * tap point, keystrokes append to the draft (rendered live as a Konva.Text +
 * blinking caret on the annotation layer), and Enter / click-away commits while
 * Escape discards. Empty commits are dropped (no annotation, no history entry).
 *
 * The size comes from the persisted {@link labelSettings} store and is applied
 * live (changing the Font setting resizes the in-progress text); the chosen
 * size is stamped onto the committed annotation so saved boards keep it.
 */
export class LabelEditorController {
	private editing = false;
	private draftPos: PlanarPoint | null = null;
	private draftText = '';
	private group: Konva.Group | null = null;
	private textNode: Konva.Text | null = null;
	private bgNode: Konva.Rect | null = null;
	private caretNode: Konva.Rect | null = null;
	private caretVisible = true;
	private blinkId: ReturnType<typeof setInterval> | null = null;
	private settingsUnsub: Unsubscriber | null = null;

	private boundKey: ((e: KeyboardEvent) => void) | null = null;
	private boundPointer: ((e: PointerEvent) => void) | null = null;
	private boundBlur: (() => void) | null = null;

	constructor(private deps: LabelEditorDeps) {}

	/** Registers the global (window) listeners; guarded by isActive. */
	attach(): void {
		this.boundKey = (e: KeyboardEvent) => this.handleKey(e);
		this.boundPointer = () => {
			// Click-away commit: any pointerdown while editing ends the draft.
			// A canvas tap also reaches DrawingToolController afterwards (it sees
			// editing=false), starting a fresh label at the new point — the
			// intended place-multiple-labels flow. A tap on chrome (toolbar) just
			// commits with no new label.
			if (this.editing) this.commit();
		};
		this.boundBlur = () => {
			if (this.editing) this.commit();
		};
		// Capture phase so the editor sees key/pointer events before the page's
		// own handlers (undo/redo, step arrows) and can authoritatively consume
		// them while a draft is active.
		window.addEventListener('keydown', this.boundKey, true);
		window.addEventListener('pointerdown', this.boundPointer, true);
		window.addEventListener('blur', this.boundBlur);
	}

	/** Whether a draft is currently being typed (label tool edit mode). */
	isActive(): boolean {
		return this.editing;
	}

	/** Begins an inline edit at the planar (world-metre) anchor point. */
	start(planePos: PlanarPoint): void {
		if (this.editing) return;
		this.editing = true;
		this.draftPos = { ...planePos };
		this.draftText = '';
		this.caretVisible = true;

		const group = new Konva.Group({ name: 'labelDraft', listening: false });
		this.bgNode = new Konva.Rect({
			fill: 'rgba(255,255,255,0.8)',
			cornerRadius: 4,
			visible: false
		});
		this.textNode = new Konva.Text({
			text: '',
			fontFamily: LABEL_FONT_FAMILY,
			fill: '#e11d48',
			listening: false
		});
		this.caretNode = new Konva.Rect({ fill: '#e11d48', listening: false });
		group.add(this.bgNode, this.textNode, this.caretNode);
		this.group = group;
		this.deps.annotationLayer.add(group);

		// Re-render the draft when the font-size setting changes mid-typing.
		this.settingsUnsub = labelSettings.subscribe(() => this.renderDraft());

		this.blinkId = setInterval(() => {
			if (!this.editing) return;
			this.caretVisible = !this.caretVisible;
			this.caretNode?.visible(this.caretVisible);
			this.deps.annotationLayer.batchDraw();
		}, 530);

		this.renderDraft();
	}

	/** Re-positions / re-sizes the draft nodes from the current state. */
	private renderDraft(): void {
		if (
			!this.editing ||
			!this.draftPos ||
			!this.group ||
			!this.textNode ||
			!this.bgNode ||
			!this.caretNode
		) {
			return;
		}
		const scale = this.deps.stage.scaleX() || 1;
		const basePx = labelBasePx(get(labelSettings).size);
		const fontSize = Math.max(12, basePx / scale);
		const atPx = this.deps.projection.projectPoint(this.draftPos.x, this.draftPos.y);
		const pad = 4;
		const textWidth = measureWidth(this.draftText, fontSize);
		const bgHeight = fontSize * 1.4;

		this.textNode.setAttrs({
			x: atPx.x,
			y: atPx.y,
			text: this.draftText,
			fontSize
		});
		// Background only once there is text to frame.
		this.bgNode.setAttrs({
			x: atPx.x - pad,
			y: atPx.y - fontSize * 0.25,
			width: textWidth + pad * 2,
			height: bgHeight,
			visible: this.draftText.length > 0
		});
		this.caretNode.setAttrs({
			x: atPx.x + textWidth + 1,
			y: atPx.y,
			width: Math.max(1, 2 / scale),
			height: fontSize,
			visible: this.caretVisible
		});

		this.deps.annotationLayer.batchDraw();
	}

	private handleKey(e: KeyboardEvent): void {
		if (!this.editing) return;
		// Authoritatively own the keyboard while a draft is active so the page's
		// undo/redo + step-navigation shortcuts don't fire mid-typing.
		e.stopPropagation();

		if (e.key === 'Enter') {
			e.preventDefault();
			this.commit();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			this.cancel();
			return;
		}
		if (e.key === 'Backspace') {
			e.preventDefault();
			if (this.draftText.length > 0) {
				this.draftText = this.draftText.slice(0, -1);
				this.caretVisible = true;
				this.renderDraft();
			}
			return;
		}
		// Printable characters (length 1 covers letters/digits/punctuation/space).
		// Ignore pure-modifier and key combinations (Ctrl/Cmd/Meta) so OS shortcuts
		// are unaffected; also skip non-printing keys (Arrow*, Tab, Home, …).
		if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			this.draftText += e.key;
			this.caretVisible = true;
			this.renderDraft();
		}
	}

	/** Commits the draft as a label annotation (or discards it if empty). */
	commit(): void {
		if (!this.editing) return;
		const pos = this.draftPos;
		const text = this.draftText;
		const size = labelBasePx(get(labelSettings).size);
		this.teardown();

		if (pos && text.trim().length > 0) {
		// Typed as the label member (sans id) so it satisfies addAnnotation's
		// (non-distributive) Omit<Annotation,'id'> param — a fresh object
		// literal with at/text would otherwise trip excess-property checking.
		const label: Omit<Extract<Annotation, { kind: 'label' }>, 'id'> = {
			kind: 'label',
			at: { x: pos.x, y: pos.y },
			text,
			fontSize: size,
			style: { color: '#e11d48', width: 2 }
		};
			// addAnnotation triggers a doc → layer rebuild that destroys the draft
			// group synchronously; refs are already cleared by teardown.
			addAnnotation(label);
			this.deps.onCommitted();
		}
	}

	/** Discards the draft without creating an annotation. */
	cancel(): void {
		if (!this.editing) return;
		this.teardown();
		this.deps.annotationLayer.batchDraw();
	}

	/** Clears edit state and tears down draft nodes + listeners. */
	private teardown(): void {
		this.editing = false;
		this.draftPos = null;
		this.draftText = '';
		if (this.blinkId) {
			clearInterval(this.blinkId);
			this.blinkId = null;
		}
		this.settingsUnsub?.();
		this.settingsUnsub = null;
		// The draft group is inert (listening:false); destroying it directly is
		// safe because nothing else references it. On a committing path the doc
		// rebuild would destroy it too, but tearing it down here keeps cancel and
		// commit symmetric.
		this.group?.destroy();
		this.group = null;
		this.textNode = null;
		this.bgNode = null;
		this.caretNode = null;
	}

	destroy(): void {
		this.teardown();
		if (this.boundKey) window.removeEventListener('keydown', this.boundKey, true);
		if (this.boundPointer) window.removeEventListener('pointerdown', this.boundPointer, true);
		if (this.boundBlur) window.removeEventListener('blur', this.boundBlur);
		this.boundKey = null;
		this.boundPointer = null;
		this.boundBlur = null;
	}
}
