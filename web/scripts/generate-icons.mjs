// Rebuild the iPhone home-screen icon from the existing SVG with local libvips.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assets = fileURLToPath(new URL("../public/", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "touch-icon-"));
try {
  const rendered = path.join(temporary, "icon.png");
  execFileSync("vips", ["thumbnail", path.join(assets, "favicon.svg"), rendered, "180"]);
  execFileSync("vips", [
    "flatten", rendered, path.join(assets, "apple-touch-icon.png") + "[strip]",
    "--background=0 185 107",
  ]);
  console.log("Generated opaque apple-touch-icon.png (180 × 180)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
