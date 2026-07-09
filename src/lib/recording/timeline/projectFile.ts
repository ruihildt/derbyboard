import { strToU8, strFromU8, zip, unzip } from 'fflate';
import type { TimelineProject } from './types';

const PROJECT_FILE = 'project.json';
const AUDIO_FILE = 'audio.webm';
const DEFAULT_AUDIO_MIME = 'audio/webm';

function timestampName(): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const hh = String(now.getHours()).padStart(2, '0');
	const min = String(now.getMinutes()).padStart(2, '0');
	return `derbyboard-${yyyy}${mm}${dd}-${hh}${min}`;
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Copies a Uint8Array into a fresh ArrayBuffer so it satisfies the DOM
 * `BlobPart` type under TypeScript's generic `Uint8Array<ArrayBuffer>`.
 */
function toPlainBuffer(u8: Uint8Array): ArrayBuffer {
	const ab = new ArrayBuffer(u8.byteLength);
	new Uint8Array(ab).set(u8);
	return ab;
}

/**
 * Builds a single bundled project file (.zip) from a project + optional audio
 * blob and triggers a download. The archive contains `project.json` and, when
 * audio is present, `audio.webm`.
 */
export async function saveProjectFile(
	project: TimelineProject,
	audioBlob: Blob | null
): Promise<void> {
	const files: Record<string, Uint8Array> = {
		[PROJECT_FILE]: strToU8(JSON.stringify(project))
	};

	let audioMeta: TimelineProject['audio'];
	if (audioBlob && audioBlob.size > 0) {
		const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
		files[AUDIO_FILE] = audioBytes;
		audioMeta = {
			file: AUDIO_FILE,
			durationMs: project.durationMs,
			mimeType: audioBlob.type || DEFAULT_AUDIO_MIME
		};
	}

	const finalProject: TimelineProject = audioMeta
		? { ...project, audio: audioMeta }
		: { ...project, audio: undefined };

	if (audioMeta) {
		files[PROJECT_FILE] = strToU8(JSON.stringify(finalProject));
	}

	const zipped = await new Promise<Uint8Array>((resolve, reject) =>
		zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)))
	);

	const blob = new Blob([toPlainBuffer(zipped)], { type: 'application/zip' });
	triggerDownload(blob, `${timestampName()}.derby.zip`);
}

export interface LoadedProject {
	project: TimelineProject;
	audioBlob: Blob | null;
}

/**
 * Parses a bundled project file (.zip) into a project + optional audio blob.
 * Tolerates archives that contain no audio track.
 */
export async function loadProjectFile(file: File): Promise<LoadedProject> {
	const buf = new Uint8Array(await file.arrayBuffer());
	const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
		unzip(buf, (err, data) => (err ? reject(err) : resolve(data)))
	);

	// Locate project.json case-insensitively (robustness across producers).
	const projectKey =
		Object.keys(entries).find((k) => k.toLowerCase() === PROJECT_FILE) ?? PROJECT_FILE;
	const projectBytes = entries[projectKey];
	if (!projectBytes) {
		throw new Error('Invalid project file: missing project.json');
	}

	const project = JSON.parse(strFromU8(projectBytes)) as TimelineProject;
	if (!project.samples || !Array.isArray(project.samples)) {
		throw new Error('Invalid project file: malformed project.json');
	}

	const audioFile = project.audio?.file ?? AUDIO_FILE;
	const audioKey = Object.keys(entries).find((k) => k.toLowerCase() === audioFile) ?? audioFile;
	const audioBytes = entries[audioKey];
	const audioBlob = audioBytes
		? new Blob([toPlainBuffer(audioBytes)], {
				type: project.audio?.mimeType || DEFAULT_AUDIO_MIME
			})
		: null;

	return { project, audioBlob };
}
