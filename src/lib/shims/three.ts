/**
 * Minimal `three` shim for `roller-derby-track-utils`.
 *
 * The package's 2D files (constants/packFunctions/engagementZone/packDrawing2D)
 * only destructure `Vector2` and use a tiny subset of its methods. The 3D file
 * (packDrawing3D) references `Shape`/`ShapeGeometry`/`MeshBasicMaterial`, but
 * only inside function bodies we never call — they are stubbed here purely so
 * the barrel's top-level `import * as THREE` resolves.
 *
 * This module is aliased to the bare specifier `three` in vite.config.ts, so the
 * full ~600KB three.js package is never pulled into the bundle.
 */
export class Vector2 {
	x: number;
	y: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	set(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	copy(v: Vector2): this {
		this.x = v.x;
		this.y = v.y;
		return this;
	}

	clone(): Vector2 {
		return new Vector2(this.x, this.y);
	}

	add(v: Vector2): this {
		this.x += v.x;
		this.y += v.y;
		return this;
	}

	sub(v: Vector2): this {
		this.x -= v.x;
		this.y -= v.y;
		return this;
	}

	multiplyScalar(s: number): this {
		this.x *= s;
		this.y *= s;
		return this;
	}

	length(): number {
		return Math.hypot(this.x, this.y);
	}

	distanceTo(v: Vector2): number {
		return Math.hypot(this.x - v.x, this.y - v.y);
	}

	angle(): number {
		return Math.atan2(this.y, this.x);
	}
}

// 3D stubs: referenced by packDrawing3D, never invoked. Instantiating them is a
// programming error (we do not use the 3D exports), so they throw if ever hit.
const stub = (name: string) =>
	class {
		constructor() {
			throw new Error(
				`three shim: ${name} is not available (3D exports are unused in Derbyboard).`
			);
		}
	};

export const Shape = stub('Shape');
export const ShapeGeometry = stub('ShapeGeometry');
export const MeshBasicMaterial = stub('MeshBasicMaterial');
