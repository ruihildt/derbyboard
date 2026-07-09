import fixWebmDuration from 'fix-webm-duration';

const PREFERRED_MIME = 'audio/webm;codecs=opus';
const FALLBACK_MIME = 'audio/webm';

function pickMimeType(): string {
	if (typeof MediaRecorder === 'undefined') return FALLBACK_MIME;
	if (MediaRecorder.isTypeSupported(PREFERRED_MIME)) return PREFERRED_MIME;
	if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME;
	return ''; // let the browser choose
}

/**
 * Captures microphone audio as an Opus/WebM blob. Shares the same clock origin
 * as the TimelineRecorder (both start at record start). When no microphone is
 * available (or the user denies it), `stop()` resolves with null and the
 * project simply has no audio track.
 */
export class AudioCapture {
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: BlobPart[] = [];
	private stream: MediaStream | null = null;
	private mimeType = '';
	private startTime = 0;

	/** Returns false if the microphone was unavailable; the caller records silently. */
	async start(): Promise<boolean> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			console.error('AudioCapture: microphone unavailable', err);
			return false;
		}

		this.chunks = [];
		this.mimeType = pickMimeType();
		this.startTime = performance.now();

		try {
			this.mediaRecorder = this.mimeType
				? new MediaRecorder(this.stream, { mimeType: this.mimeType })
				: new MediaRecorder(this.stream);
		} catch (err) {
			console.error('AudioCapture: MediaRecorder failed', err);
			this.releaseStream();
			return false;
		}

		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		this.mediaRecorder.start();
		return true;
	}

	/** Stops recording and returns the audio blob (null if no mic/none captured). */
	async stop(): Promise<Blob | null> {
		const recorder = this.mediaRecorder;
		if (!recorder) {
			this.releaseStream();
			return null;
		}

		const blob = await new Promise<Blob | null>((resolve) => {
			recorder.onstop = () => {
				if (this.chunks.length === 0) {
					resolve(null);
					return;
				}
				const type = recorder.mimeType || this.mimeType || FALLBACK_MIME;
				resolve(new Blob(this.chunks, { type }));
			};
			recorder.stop();
		});

		this.releaseStream();
		this.mediaRecorder = null;
		this.chunks = [];

		if (blob && blob.size > 0 && blob.type.includes('webm')) {
			try {
				return await fixWebmDuration(blob, performance.now() - this.startTime);
			} catch (e) {
				console.warn('AudioCapture: fixWebmDuration failed; using raw blob', e);
				return blob;
			}
		}
		return blob;
	}

	get recordedMimeType(): string {
		return this.mimeType || FALLBACK_MIME;
	}

	private releaseStream(): void {
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
	}
}
