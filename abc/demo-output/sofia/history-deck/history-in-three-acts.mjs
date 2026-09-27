import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(workspaceDir, ".build");
const finalPath = path.join(workspaceDir, "history-in-three-acts.pptx");
const SKILL_DIR = "/Users/kaartiktejwani/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/Presentations";
const RUNTIME_NODE_MODULES = process.env.RUNTIME_NODE_MODULES ?? "/Users/kaartiktejwani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { Presentation, PresentationFile } = await import(
  pathToFileURL(path.join(RUNTIME_NODE_MODULES, "@oai/artifact-tool/dist/artifact_tool.mjs")).href,
);
const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href,
);
await fs.mkdir(buildDir, { recursive: true });

const FONT = resolvePresentationFont({ fontFamily: "Arial" });
const W = 1280;
const H = 720;
const C = {
  paper: "#F3EBDD",
  ink: "#142437",
  navy: "#11233A",
  blue: "#417589",
  rust: "#B85F43",
  gold: "#D3A451",
  muted: "#65717B",
  pale: "#D8D0C2",
  white: "#FFFDF8",
};
const deck = Presentation.create({ slideSize: { width: W, height: H } });

function text(slide, value, x, y, w, h, opts = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  box.text = value;
  box.text.style = {
    typeface: FONT,
    fontSize: opts.size ?? 25,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "middle",
    autoFit: "none",
    insets: { left: 0, right: 0, top: 0, bottom: 0 },
    wrap: "square",
  };
  return box;
}

function rect(slide, x, y, w, h, color, name) {
  return slide.shapes.add({
    geometry: "rect",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill: color,
    line: { fill: "none", width: 0 },
  });
}

function addNotes(slide, value) {
  slide.speakerNotes.textFrame.setText(value);
}

// 1. Title and ancient networks
{
  const slide = deck.slides.add();
  slide.background.fill = C.paper;
  const art = new Uint8Array(await fs.readFile(path.join(workspaceDir, "art/ancient-networks.png")));
  slide.images.add({
    blob: art,
    contentType: "image/png",
    alt: "Interpretive illustration of an ancient caravan route meeting a river port and distant city",
    prompt: "Interpretive editorial gouache and screenprint illustration of ancient trade networks, generated for this deck.",
    fit: "cover",
    position: { left: 570, top: 0, width: 710, height: 720 },
  });
  rect(slide, 0, 0, 570, 720, C.paper, "ancient-text-field");
  text(slide, "History in Three Acts", 74, 40, 450, 54, {
    size: 39, bold: true, color: C.ink,
  });
  rect(slide, 74, 111, 88, 5, C.rust, "title-rule");
  text(slide, "ACT I   /   c. 3000 BCE onward", 74, 145, 460, 30, {
    size: 17, bold: true, color: C.rust,
  });
  text(slide, "Ancient\nnetworks", 74, 195, 450, 145, {
    size: 58, bold: true, color: C.ink,
  });
  text(slide, "Trade routes linked distant ports and cities. Merchants carried techniques and beliefs along with goods.", 74, 372, 420, 112, {
    size: 26, color: C.ink,
  });
  rect(slide, 74, 536, 88, 5, C.gold, "ancient-accent-rule");
  text(slide, "Reach grew along trusted paths", 74, 563, 420, 42, {
    size: 21, color: C.muted,
  });
  addNotes(slide, "The illustration is generated interpretive artwork, not a depiction of a specific documented route or event.");
}

// 2. Industrial acceleration
{
  const slide = deck.slides.add();
  slide.background.fill = C.navy;
  text(slide, "ACT II   /   18TH–19TH CENTURIES", 76, 64, 660, 30, {
    size: 17, bold: true, color: C.gold,
  });
  text(slide, "Industrial acceleration", 76, 111, 1120, 82, {
    size: 58, bold: true, color: C.white,
  });
  text(slide, "Steam power", 76, 274, 450, 72, { size: 43, bold: true, color: C.white });
  text(slide, "Rail networks", 750, 274, 460, 72, { size: 43, bold: true, color: C.white });
  rect(slide, 76, 379, 1125, 3, C.blue, "industrial-link");
  rect(slide, 76, 367, 24, 27, C.gold, "steam-marker");
  rect(slide, 1177, 367, 24, 27, C.rust, "rail-marker");
  text(slide, "Powered machines and factory production", 76, 423, 440, 80, {
    size: 23, color: C.pale,
  });
  text(slide, "Moved people and raw materials on schedules", 750, 423, 450, 80, {
    size: 23, color: C.pale,
  });
  text(slide, "Distance took less time to cross", 76, 585, 700, 48, {
    size: 24, bold: true, color: C.gold,
  });
  addNotes(slide, "Steam-powered production and rail transport reshaped the pace and scale of movement. The graphic expresses a qualitative relationship, not a measured series.");
}

// 3. Digital turn
{
  const slide = deck.slides.add();
  slide.background.fill = C.paper;
  rect(slide, 0, 0, 18, H, C.blue, "digital-edge");
  text(slide, "ACT III   /   LATE 20TH CENTURY ONWARD", 78, 66, 750, 30, {
    size: 17, bold: true, color: C.rust,
  });
  text(slide, "The digital turn", 78, 122, 1100, 82, {
    size: 60, bold: true, color: C.ink,
  });
  text(slide, "Information became searchable at a distance", 78, 270, 1020, 150, {
    size: 48, bold: true, color: C.blue,
  });
  rect(slide, 78, 470, 190, 5, C.gold, "digital-accent-rule");
  text(slide, "Computers stored more than messages. Networked devices made information reachable across distance in seconds.", 78, 512, 1000, 94, {
    size: 27, color: C.ink,
  });
  addNotes(slide, "A broad summary of networked computing's effect on information access. The exact pace and reach varied by place, infrastructure, and period.");
}

// 4. Comparison table
{
  const slide = deck.slides.add();
  slide.background.fill = C.paper;
  text(slide, "Three systems of connection", 76, 66, 1125, 76, {
    size: 54, bold: true, color: C.ink,
  });
  text(slide, "Each era widened reach through a different medium", 78, 150, 1000, 44, {
    size: 24, color: C.muted,
  });
  const table = slide.tables.add({
    rows: 4,
    columns: 3,
    left: 76,
    top: 238,
    width: 1128,
    height: 358,
    columnWidths: [250, 330, 548],
    values: [
      ["ERA", "CONNECTIVE MEDIUM", "WHAT IT MADE EASIER"],
      ["Ancient", "Routes and ports", "Moving goods and ideas between distant settlements"],
      ["Industrial", "Steam and rail", "Moving people and materials at scale"],
      ["Digital", "Computers and networks", "Finding and sharing information across distance"],
    ],
  });
  table.borders.assign({ style: "solid", fill: "#C8C0B2", width: 1 });
  for (let r = 0; r < 4; r += 1) {
    table.rows[r].height = r === 0 ? 62 : 98;
    for (let c = 0; c < 3; c += 1) {
      const cell = table.getCell(r, c);
      cell.fill = r === 0 ? C.navy : (r % 2 === 1 ? "#FBF8F1" : "#EAE3D7");
      cell.text.style = {
        typeface: FONT,
        fontSize: r === 0 ? 17 : 23,
        bold: r === 0 || c === 0,
        color: r === 0 ? C.white : C.ink,
        verticalAlignment: "middle",
        autoFit: "none",
      };
    }
  }
  addNotes(slide, "Qualitative comparison. The periods overlap, and these media did not reach every society at the same time.");
}

// 5. Timeline
{
  const slide = deck.slides.add();
  slide.background.fill = C.navy;
  text(slide, "A short timeline", 76, 54, 760, 72, {
    size: 50, bold: true, color: C.white,
  });
  rect(slide, 120, 188, 1040, 3, C.blue, "timeline-line");
  const points = [
    { x: 120, date: "c. 3000 BCE", title: "Long routes", desc: "Trade linked settlements" },
    { x: 630, date: "18TH–19TH C.", title: "Steam and rail", desc: "Transport sped up" },
    { x: 1128, date: "LATE 20TH C.", title: "Digital networks", desc: "Information moved online" },
  ];
  for (const [i, p] of points.entries()) {
    slide.shapes.add({
      geometry: "ellipse",
      name: `timeline-marker-${i + 1}`,
      position: { left: p.x - 10, top: 178, width: 23, height: 23 },
      fill: [C.gold, C.rust, C.blue][i],
      line: { fill: C.navy, width: 1 },
    });
    const boxX = p.x === 1128 ? 790 : p.x;
    text(slide, p.date, boxX, 226, 360, 35, { size: 18, bold: true, color: C.gold });
    text(slide, p.title, boxX, 275, 400, 54, { size: 30, bold: true, color: C.white });
    text(slide, p.desc, boxX, 331, 400, 44, { size: 21, color: C.pale });
  }
  addNotes(slide, "The timeline is approximate. The historical periods overlap, and connection changed unevenly across regions.");
}

// 6. Closing takeaway
{
  const slide = deck.slides.add();
  slide.background.fill = C.paper;
  text(slide, "THE TAKEAWAY", 78, 76, 350, 32, { size: 17, bold: true, color: C.rust });
  rect(slide, 78, 137, 8, 430, C.gold, "takeaway-rule");
  text(slide, "Every leap in communication changes who can reach whom, and who controls the channel.", 122, 130, 1050, 352, {
    size: 52, bold: true, color: C.ink,
  });
  text(slide, "Ancient routes. Industrial transport. Digital networks.", 122, 532, 940, 52, {
    size: 25, color: C.muted,
  });
  addNotes(slide, "A synthesis of the examples in this overview.");
}

const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(deck)).save(candidatePath);
const validationPath = path.join(buildDir, "validation.json");
await finalizePresentation({
  explicitTotalSlideCount: 6,
  requiredNativeTableOwnerSlides: [4],
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: "/opt/homebrew/bin/python3",
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-heading-fit", "--require-native-table-slide", "4"],
  fontPolicy: { basis: "design", families: ["Arial"] },
  verifyArtifactToolImport: true,
  receiptPath: validationPath,
});
console.log(`Created ${finalPath}`);
