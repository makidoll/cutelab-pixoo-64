import * as fs from "fs/promises";

// https://github.com/makifoxgirl/hifi-things/blob/master/express-routes/3d-text/BDF.js

export class BdfFont {
	bdfData = "";

	fontBoundingBox: number[] = []; // w h x y
	fontHeight = 0;

	constructor() {}

	public async load(pathToBdf: string) {
		this.bdfData = await fs.readFile(pathToBdf, "utf8");

		const boundingBoxMatch = this.bdfData.match(
			/FONTBOUNDINGBOX (-?[0-9]+) (-?[0-9]+) (-?[0-9]+) (-?[0-9]+)/,
		);

		if (boundingBoxMatch == null) {
			throw new Error(
				"Failed to find BDF bounding box for: " + pathToBdf,
			);
		}

		this.fontBoundingBox = boundingBoxMatch.slice(1).map(n => parseInt(n));
		this.fontHeight = this.fontBoundingBox[1] + this.fontBoundingBox[3];
	}

	private ensure8WideBinaryString(binaryString: string) {
		return ("00000000" + binaryString).slice(-8);
	}

	public getChar(char: string) {
		const encoded = char.charCodeAt(0);
		const match = this.bdfData.match(
			new RegExp(
				"ENCODING " +
					encoded +
					"(?:[\\s\\S]*?)BBX([\\s\\S]*?)BITMAP([\\s\\S]*?)ENDCHAR",
			),
		);

		if (match == null)
			return {
				width: 0,
				height: 0,
				pixels: [],
			};

		const [charW, charH, charX, charY] = match[1]
			.trim()
			.split(" ")
			.map(n => parseInt(n));

		let bitmap = match[2].trim().split("\n");

		// convert hex to binary
		bitmap = bitmap
			.map(hex =>
				this.ensure8WideBinaryString(parseInt(hex, 16).toString(2)),
			)
			.slice(0, charH);

		// make sure its pushed down to fontHeight
		if (bitmap.length < this.fontHeight) {
			const emptyLines = this.fontHeight - bitmap.length;
			for (var i = 0; i < emptyLines; i++) {
				bitmap.unshift("0");
			}
		}

		// convert to Pixel[]
		const pixels: { x: number; y: number }[] = [];
		bitmap.forEach((line, y) => {
			const lines = line.split("");
			lines.forEach((pixel, x) => {
				if (parseInt(pixel) == 0) return;
				pixels.push({
					x: x,
					y: y - charY,
				});
			});
		});

		return {
			width: charW,
			height: charH,
			pixels: pixels,
		};
	}

	public getText(text: string, spaceOffset = 0, lineOffset = 0) {
		let pixels: { x: number; y: number }[] = [];

		let currentX = 0;
		let currentY = 0;

		if (spaceOffset) {
			text = text.replace(
				/ /g,
				new Array(spaceOffset + 1).fill(" ").join(""),
			);
		}

		text.split("\n").forEach(line => {
			line.split("").forEach(char => {
				const charPixels = this.getChar(char);

				charPixels.pixels.map(pixel => {
					pixel.x += currentX;
					pixel.y += currentY;
					return pixel;
				});

				pixels = pixels.concat(charPixels.pixels);
				currentX += charPixels.width + 1;
			});
			currentX = 0;
			currentY += this.fontHeight + 1;
			if (lineOffset) currentY += lineOffset;
		});

		return pixels;
	}
}
