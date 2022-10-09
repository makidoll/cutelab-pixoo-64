import axios from "axios";
import * as path from "path";
import sharp from "sharp";
import { BdfFont } from "./bdf-font";
import { Pico8Font } from "./pico8-font";
import { CronJob } from "cron";

const size = 64;
const ip = "192.168.1.185";

let pixels = new Uint8Array(size * size * 3);
let counter = 0;

function copyUint8Array(src: Uint8Array) {
	const dst = new Uint8Array(src.length);
	for (let i = 0; i < src.length; i++) {
		dst[i] = src[i];
	}
	return dst;
}

async function getCounter() {
	try {
		const { data } = await axios.post<{ PicId: number }>(
			"http://" + ip + "/post",
			{
				Command: "Draw/GetHttpGifId",
			},
		);
		return data.PicId;
	} catch (error) {
		return 0;
	}
}

// http://doc.divoom-gz.com/web/#/12?page_id=93

async function pushPixels() {
	await axios.post("http://" + ip + "/post", {
		Command: "Draw/SendHttpGif",
		PicNum: 1,
		PicWidth: size,
		PicOffset: 0,
		PicID: ++counter,
		PicSpeed: 1000,
		PicData: Buffer.from(pixels).toString("base64"),
	});
}

async function getTivoliOnline(): Promise<{
	users: number;
	instances: number;
}> {
	try {
		const { data } = await axios.get<{ users: number; instances: number }>(
			"http://tivoli.space/api/stats/online",
		);
		return data;
	} catch (error) {
		return { users: -1, instances: -1 };
	}
}

export interface Color {
	r: number;
	g: number;
	b: number;
}

function hexColor(hexColor: string): Color {
	const hexColors = hexColor.match(
		/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
	);
	if (hexColors == null) throw new Error("Invalid color: " + hexColor);
	const [r, g, b] = hexColors
		.slice(1)
		.map(hexNumber => parseInt(hexNumber, 16)) as number[];
	return { r, g, b };
}

function rgbColor(r: number, g: number, b: number) {
	if (r < 0) r = 0;
	if (r > 255) r = 255;
	if (g < 0) g = 0;
	if (g > 255) g = 255;
	if (b < 0) b = 0;
	if (b > 255) b = 255;
	return { r, g, b };
}

function getPixel(x: number, y: number) {
	if (x < 0) return;
	if (x > size - 1) return;
	if (y < 0) return;
	if (y > size - 1) return;
	const i = (y * size + x) * 3;
	return {
		r: pixels[i],
		g: pixels[i + 1],
		b: pixels[i + 2],
	};
}

function lerpColor(c0: Color, c1: Color, n: number) {
	return {
		r: c0.r * (1 - n) + c1.r * n,
		g: c0.g * (1 - n) + c1.g * n,
		b: c0.b * (1 - n) + c1.b * n,
	};
}

function setPixel(x: number, y: number, color: Color, alpha = 1) {
	if (x < 0) return;
	if (x > size - 1) return;
	if (y < 0) return;
	if (y > size - 1) return;
	const i = (y * size + x) * 3;
	if (alpha < 1) {
		const colorBehind = getPixel(x, y);
		if (colorBehind) {
			color = lerpColor(colorBehind, color, alpha);
		}
	}
	pixels[i] = color.r;
	pixels[i + 1] = color.g;
	pixels[i + 2] = color.b;
}

const bdfFonts: { [font: string]: BdfFont } = {};
const pico8Font = new Pico8Font();

async function writeText(
	x: number,
	y: number,
	text: string,
	font: string,
	color: Color,
) {
	let pixels: { x: number; y: number }[] = [];
	if (font == "pico8") {
		pixels = pico8Font.getText(text);
	} else {
		if (bdfFonts[font] == null) {
			bdfFonts[font] = new BdfFont();
			await bdfFonts[font].load(
				path.resolve(__dirname, "fonts/" + font + ".bdf"),
			);
		}
		pixels = bdfFonts[font].getText(text);
	}
	for (const pixel of pixels) {
		setPixel(x + pixel.x, y + pixel.y, color);
	}
}

function getPixelsAsSharp() {
	return sharp(pixels, {
		raw: { width: size, height: size, channels: 3 },
	});
}

async function drawImage(
	input: sharp.Sharp,
	offsetX: number = 0,
	offsetY: number = 0,
) {
	const { data, info } = await input
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const newPixels = await getPixelsAsSharp()
		.composite([
			{
				input: data,
				raw: {
					width: info.width,
					height: info.height,
					channels: info.channels,
				},
				left: offsetX,
				top: offsetY,
			},
		])
		.removeAlpha()
		.raw()
		.toBuffer();

	for (let i = 0; i < newPixels.length; i++) {
		pixels[i] = newPixels[i];
		pixels[i + 1] = newPixels[i + 1];
		pixels[i + 2] = newPixels[i + 2];
	}
}

async function previewPixels() {
	await getPixelsAsSharp().png().toFile("output.png");
}

async function drawBox(
	x: number,
	y: number,
	width: number,
	height: number,
	color: Color,
	alpha: number,
) {
	const { data, info } = await sharp({
		create: {
			width,
			height,
			background: {
				r: color.r / 255,
				g: color.g / 255,
				b: color.b / 255,
				alpha,
			},
			channels: 4,
		},
	})
		.raw()
		.toBuffer({ resolveWithObject: true });

	const newPixels = await getPixelsAsSharp()
		.composite([
			{
				input: data,
				raw: {
					width: info.width,
					height: info.height,
					channels: info.channels,
				},
				left: x,
				top: y,
			},
		])
		.removeAlpha()
		.raw()
		.toBuffer();

	for (let i = 0; i < newPixels.length; i++) {
		pixels[i] = newPixels[i];
		pixels[i + 1] = newPixels[i + 1];
		pixels[i + 2] = newPixels[i + 2];
	}
}

(async () => {
	counter = await getCounter();
	await pico8Font.load();

	await drawImage(
		sharp(
			// path.resolve(__dirname, "./images/splash-screen-background.png"),
			path.resolve(__dirname, "./images/squirrel-strawberry.png"),
			// path.resolve(__dirname, "./images/squirrel-knothole.png"),
		).resize(size, size, {
			kernel: "lanczos3",
		}),
		0,
		0,
	);

	let yOffset = 0;
	const white = rgbColor(255, 255, 255);

	await drawBox(0, yOffset, 64, 19, hexColor("#1d1f21"), 0.3);
	await drawImage(
		sharp(path.resolve(__dirname, "./images/tivoli.png")),
		2,
		2,
	);
	yOffset += 36;

	await drawBox(0, yOffset, 64, 15, hexColor("#1d1f21"), 0.3);

	const pixelsStatic = copyUint8Array(pixels);
	const yOffsetStatic = yOffset;

	const pushPixelsWithTime = async () => {
		const currentDate = new Date();
		const hours = currentDate.getHours().toString().padStart(2, "0");
		const minutes = currentDate.getMinutes().toString().padStart(2, "0");
		const date = currentDate.getDate();
		const month = [
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Dec",
		][currentDate.getMonth()];

		pixels = copyUint8Array(pixelsStatic);
		yOffset = yOffsetStatic;

		const tivoliOnline = await getTivoliOnline();
		const users = tivoliOnline.users + " Users";
		const instances = tivoliOnline.instances + " Instances";

		await writeText(5, yOffset + 1, users, "pico8", white);
		await writeText(5, yOffset + 8, instances, "pico8", white);
		yOffset += 15;
		// yOffset += 32;

		await drawBox(0, yOffset, 64, 13, hexColor("#1d1f21"), 0.6);

		await writeText(6, yOffset, hours + ":" + minutes, "apple_kid", white);
		await writeText(33, yOffset, month + ". " + date, "apple_kid", white);

		// await previewPixels();
		await pushPixels();
	};

	new CronJob(
		"0 * * * * *",
		() => {
			pushPixelsWithTime();
		},
		null,
		true,
	);

	pushPixelsWithTime();
})();
