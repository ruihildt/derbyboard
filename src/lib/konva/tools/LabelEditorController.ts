import { get, type Unsubscriber } from 'svelte/store';
import Konva from 'konva';

import { addAnnotation, setAnnotationText, deleteAnnotation } from '$lib/doc/clipOps';
import { labelSettings, labelBasePx } from '$lib/stores/labelSettings';
import { selectedAnnotationId } from '$lib/stores/selection';
import { toolMode } from '$lib/stores/toolMode';
import type { Annotation, PlanarPoint } from '$lib/doc/types';
import { effectiveAnchors, resolvedTransform } from '../annotationTransform';
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
	/** When set, the draft edits an EXISTING label (commit updates it) instead
	 * of creating a new one. */
	private editingId: string | null = null;
	/** The committed label group hidden while its text is being edited (so the
	 * draft doesn't double-render, and rotation is respected). */
	private hiddenGroup: Konva.Group | null = null;
	private draftPos: PlanarPoint | null = null;
	/** Rotation (radians) of the draft — matches the edited label's angle. */
	private draftAngle = 0;
	/** Caret position within {@link draftText} (0..length). */
	private caretIdx = 0;
	private draftText = '';
	private draftColor = '#e11d48';
	/** Fixed font size (CSS px) for an existing-label edit; null for new
	 * labels (which follow the live Font setting). */
	private draftFontSizeCss: number | null = null;
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
		this.editingId = null;
		this.draftColor = '#e11d48';
		this.draftFontSizeCss = null;
		this.beginDraft(planePos, '', 0, 0);
	}

	/**
	 * Begins an inline edit of an EXISTING label (double-click in Select): the
	 * draft is seeded with the label's text at its CURRENT (effective)
	 * position and angle, the committed label is hidden, and the caret is
	 * placed where the double-click landed. Commit updates the label (or
	 * deletes it if emptied); Escape cancels, restoring the original.
	 */
	editExisting(
		ann: Extract<Annotation, { kind: 'label' }>,
		clickScreen: { x: number; y: number } | null
	): void {
		if (this.editing) return;
		this.editingId = ann.id;
		this.draftColor = ann.style.color;
		this.draftFontSizeCss = ann.fontSize ?? null;
		// Edit at the label's effective (moved/rotated) position + angle, NOT
		// ann.at, so the draft overlays the label exactly.
		const pos = effectiveAnchors(ann)[0];
		const angle = resolvedTransform(ann).angle;
		// Place the caret where the double-click hit (clamped into the text).
		const caretIdx = clickScreen
			? this.caretIndexAt(ann.text, clickScreen, pos, angle)
			: ann.text.length;
		// Hide the committed label so the draft is the single source of truth.
		this.hiddenGroup =
			Array.from(this.deps.annotationLayer.find<Konva.Group>('.annotation')).find(
				(g) => g.getAttr('annId') === ann.id
			) ?? null;
		this.hiddenGroup?.visible(false);
		this.deps.annotationLayer.batchDraw();
		// Drop the selection chrome for the label being edited.
		selectedAnnotationId.set(null);
		this.beginDraft(pos, ann.text, angle, caretIdx);
	}

	/** Shared draft setup: creates the (inert) draft nodes and starts blinking. */
	private beginDraft(planePos: PlanarPoint, text: string, angle: number, caretIdx: number): void {
		this.editing = true;
		this.draftPos = { ...planePos };
		this.draftAngle = angle;
		this.caretIdx = Math.max(0, Math.min(text.length, caretIdx));
		this.draftText = text;
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
			fill: this.draftColor,
			listening: false
		});
		this.caretNode = new Konva.Rect({ fill: this.draftColor, listening: false });
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

	/** Re-positions / re-sizes the draft nodes from the current state. The
	 * draft mirrors the committed label's centre-based, rotated geometry so it
	 * overlays it exactly; the caret sits at {@link caretIdx}. */
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
		const basePx = this.draftFontSizeCss ?? labelBasePx(get(labelSettings).size);
		const fontSize = Math.max(12, basePx / scale);
		const placementPx = this.deps.projection.projectPoint(this.draftPos.x, this.draftPos.y);
		const pad = 4;
		const textWidth = measureWidth(this.draftText, fontSize);
		const bgW = textWidth + pad * 2;
		const bgH = fontSize * 1.4;
		// Centre of the text box (the rotate pivot), matching AnnotationRenderer.
		const centerPx = { x: placementPx.x + textWidth / 2, y: placementPx.y + fontSize * 0.45 };
		const deg = (this.draftAngle * 180) / Math.PI;

		// Text: drawn centred on centerPx (offset = half text box) then rotated.
		this.textNode.setAttrs({
			x: centerPx.x,
			y: centerPx.y,
			offsetX: textWidth / 2,
			offsetY: fontSize * 0.45,
			rotation: deg,
			text: this.draftText,
			fontSize,
			fill: this.draftColor
		});
		// Background only once there is text to frame.
		this.bgNode.setAttrs({
			x: centerPx.x,
			y: centerPx.y,
			offsetX: bgW / 2,
			offsetY: bgH / 2,
			rotation: deg,
			width: bgW,
			height: bgH,
			visible: this.draftText.length > 0
		});
		// Caret at caretIdx: its left edge sits at (textLeft + width-up-to-idx).
		// As a centred node that means offsetX = textWidth/2 - widthUpToCaret.
		const widthUpToCaret = measureWidth(this.draftText.slice(0, this.caretIdx), fontSize);
		this.caretNode.setAttrs({
			x: centerPx.x,
			y: centerPx.y,
			offsetX: textWidth / 2 - widthUpToCaret,
			offsetY: fontSize * 0.45,
			rotation: deg,
			width: Math.max(1, 2 / scale),
			height: fontSize,
			visible: this.caretVisible
		});

		this.deps.annotationLayer.batchDraw();
	}

	/**
	 * Resolves the caret index for a double-click at `clickScreen` (stage
	 * coords) by transforming the click into the label's local (unrotated)
	 * frame and finding the nearest character boundary.
	 */
	private caretIndexAt(
		text: string,
		clickScreen: { x: number; y: number },
		planePos: PlanarPoint,
		angle: number
	): number {
		const scale = this.deps.stage.scaleX() || 1;
		const basePx = this.draftFontSizeCss ?? labelBasePx(get(labelSettings).size);
		const fontSize = Math.max(12, basePx / scale);
		const textWidth = measureWidth(text, fontSize);
		const placementPx = this.deps.projection.projectPoint(planePos.x, planePos.y);
		const center = { x: placementPx.x + textWidth / 2, y: placementPx.y + fontSize * 0.45 };
		// Click → local frame (translate to centre, un-rotate).
		const dx = clickScreen.x - center.x;
		const dy = clickScreen.y - center.y;
		const cos = Math.cos(-angle);
		const sin = Math.sin(-angle);
		const localX = dx * cos - dy * sin;
		// Text left is at local -textWidth/2; clickRelX is relative to it.
		const clickRelX = localX + textWidth / 2;
		// First character whose midpoint is past the click → caret before it.
		for (let i = 0; i < text.length; i++) {
			const before = measureWidth(text.slice(0, i), fontSize);
			const charW = measureWidth(text[i], fontSize);
			if (clickRelX < before + charW / 2) return i;
		}
		return text.length;
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
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (this.caretIdx > 0) {
				this.caretIdx--;
				this.caretVisible = true;
				this.renderDraft();
			}
			return;
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (this.caretIdx < this.draftText.length) {
				this.caretIdx++;
				this.caretVisible = true;
				this.renderDraft();
			}
			return;
		}
		if (e.key === 'Backspace') {
			e.preventDefault();
			if (this.caretIdx > 0) {
				this.draftText =
					this.draftText.slice(0, this.caretIdx - 1) + this.draftText.slice(this.caretIdx);
				this.caretIdx--;
				this.caretVisible = true;
				this.renderDraft();
			}
			return;
		}
		// Printable characters (length 1 covers letters/digits/punctuation/space).
		// Ignore pure-modifier and key combinations (Ctrl/Cmd/Meta) so OS shortcuts
		// are unaffected; also skip non-printing keys (Tab, Home, …).
		if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			this.draftText =
				this.draftText.slice(0, this.caretIdx) + e.key + this.draftText.slice(this.caretIdx);
			this.caretIdx++;
			this.caretVisible = true;
			this.renderDraft();
		}
	}

	/** Commits the draft — creating a new label, or updating (or deleting, if
	 * emptied) the edited existing one. */
	commit(): void {
		if (!this.editing) return;
		const pos = this.draftPos;
		const text = this.draftText;
		const editingId = this.editingId;
		const size = this.draftFontSizeCss ?? labelBasePx(get(labelSettings).size);
		this.teardown();

		if (editingId) {
			// Editing an existing label: update its text, or delete if emptied.
			// The doc change rebuilds the (hidden) committed group visible.
			if (text.trim().length > 0) {
				setAnnotationText(editingId, text);
			} else {
				deleteAnnotation(editingId);
			}
			this.deps.onCommitted();
			return;
		}
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
			// A label has been placed — return to Select (matches the other
			// discrete annotation tools; the freehand tools stay armed).
			toolMode.set('select');
		}
	}

	/** Discards the draft without changing the document. */
	cancel(): void {
		if (!this.editing) return;
		this.teardown();
		this.deps.annotationLayer.batchDraw();
	}

	/** Clears edit state and tears down draft nodes + listeners. */
	private teardown(): void {
		this.editing = false;
		this.editingId = null;
		// Restore the committed label that was hidden during an existing-label
		// edit (on commit the doc re-render then updates its text in place).
		this.hiddenGroup?.visible(true);
		this.hiddenGroup = null;
		this.draftPos = null;
		this.draftAngle = 0;
		this.caretIdx = 0;
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
