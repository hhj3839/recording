import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
const load = (name) => mode.endsWith("cjs") ? require(name) : import(name);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (name, payload = Buffer.alloc(0), size = payload.length + 8) => Buffer.concat([u32(size), Buffer.from(name), payload]);
const stream = Buffer.from([255, 10, 1, 0]);
const jxl = (size) => Buffer.concat([box("JXL ", Buffer.from([13, 10, 135, 10])), box("ftyp", Buffer.from("jxl ")), box("jxlp", Buffer.concat([u32(0), stream]), size)]);
const heif = (size) => Buffer.concat([box("ftyp", Buffer.from("avif")), box("meta", Buffer.concat([u32(0), box("iprp", box("ipco", box("ispe", Buffer.concat([u32(0), u32(17), u32(23)]), size)))]))]);
const icns = (size = 8) => Buffer.concat([Buffer.from("icns"), u32(16), Buffer.from("icp4"), u32(size)]);
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000020806000000", "hex");
const gif = Buffer.from("47494638396101000200000000", "hex");
let temp;
try {
  let calculate;
  if (mode.startsWith("file")) {
    const { imageSizeFromFile } = await load("image-size/fromFile");
    temp = await mkdtemp(join(tmpdir(), "giroksam-image-security-"));
    let id = 0;
    calculate = async (bytes) => {
      const path = join(temp, `${id++}.bin`);
      await writeFile(path, bytes);
      return imageSizeFromFile(path);
    };
  } else if (mode.startsWith("direct")) {
    const { ICNS } = await load("image-size/types/icns");
    const { HEIF } = await load("image-size/types/heif");
    const { JXL } = await load("image-size/types/jxl");
    calculate = (bytes, kind) => ({ icns: ICNS, heif: HEIF, jxl: JXL })[kind].calculate(bytes);
  } else {
    calculate = (await load("image-size")).imageSize;
  }
  for (const [bytes, kind, width, height] of [
    [icns(), "icns", 16, 16], [heif(), "heif", 17, 23], [jxl(), "jxl", 8, 8],
    // Valid zero-sized ISO boxes extend to EOF, and must terminate too.
    [heif(0), "heif", 17, 23], [jxl(0), "jxl", 8, 8],
    ...(!mode.startsWith("direct") ? [[png, "png", 1, 2], [gif, "gif", 1, 2]] : []),
  ]) {
    const result = await calculate(bytes, kind);
    assert.equal(result.width, width, `${kind} width`);
    assert.equal(result.height, height, `${kind} height`);
  }
  for (const size of [0, 1, 7, 0xffffffff]) {
    await assert.rejects(async () => calculate(icns(size), "icns"));
  }
  for (const size of [1, 7]) {
    await assert.rejects(async () => calculate(heif(size), "heif"));
    await assert.rejects(async () => calculate(jxl(size), "jxl"));
  }
  // Zero-sized target boxes used to repeat forever even without valid payload.
  const zeroPartial = Buffer.concat([box("JXL ", Buffer.from([13, 10, 135, 10])), box("ftyp", Buffer.from("jxl ")), box("jxlp", u32(0), 0)]);
  await assert.rejects(async () => calculate(zeroPartial, "jxl"));
  await assert.rejects(async () => calculate(icns().subarray(0, 12), "icns"));
  process.stdout.write("image parser guards passed\n");
} finally {
  if (temp) await rm(temp, { recursive: true, force: true });
}
