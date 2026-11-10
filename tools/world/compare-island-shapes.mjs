import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const [before, after, output] = process.argv.slice(2);
if (!before || !after || !output) throw new Error("Pass baseline.json after.json comparison.svg");
const a = JSON.parse(readFileSync(before, "utf8")).rows.filter(row => row.size === "small");
const b = JSON.parse(readFileSync(after, "utf8")).rows.filter(row => row.size === "small");
const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850"><rect width="1200" height="850" fill="#102535"/><style>text{font-family:Arial;fill:#eaf2fa}.label{font-size:19px}.sub{font-size:14px;fill:#b2cad9}</style><text x="26" y="30" class="label">Island A3 — aynı kara alanı, farklı kıyı biçimleri</text><text x="26" y="54" class="sub">Gri: A2 baseline | yeşil: A3 | Small, aynı seed</text>'];
for (let i = 0; i < b.length; i++) {
  const row = b[i], prior = a.find(old => old.seed === row.seed);
  const x = 25 + i % 3 * 395, y = 80 + Math.floor(i / 3) * 380, scale = 330 / 1024;
  svg.push(`<rect x="${x+5}" y="${y+10}" width="330" height="330" fill="#18394a" stroke="#638195"/>`);
  for (const [shape, color, opacity] of [[prior, "#afbac3", .7], [row, "#3ad8b8", .75]]) {
    const points = shape.outline.map(p => `${(x+170+p[0]*scale).toFixed(2)},${(y+175+p[1]*scale).toFixed(2)}`).join(" ");
    svg.push(`<polygon points="${points}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.2"/>`);
  }
  svg.push(`<text x="${x+8}" y="${y+363}" class="label">Seed ${row.seed}</text><text x="${x+175}" y="${y+363}" class="sub">%${row.areaPct.toFixed(3)} kara</text>`);
}
svg.push("</svg>"); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, svg.join(""));
console.log(`Wrote ${b.length} same-seed comparisons to ${output}`);
