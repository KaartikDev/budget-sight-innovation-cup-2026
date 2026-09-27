import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Regenerate from this folder with the bundled presentation runtime available.
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(sourceDir, '../../..');
const buildDir = path.join(sourceDir, '.build');
const outputDir = sourceDir;
const draftPath = path.join(buildDir, 'wright-mini-draft.pptx');
const finalPath = path.join(outputDir, 'deliverable', 'wright-brothers-five-slides.pptx');
const skillDir = '/Users/kaartiktejwani/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const requireFromRuntime = createRequire(path.join(process.env.RUNTIME_NODE_MODULES, '__runtime__.cjs'));
const { Presentation, PresentationFile } = await import(pathToFileURL(requireFromRuntime.resolve('@oai/artifact-tool')).href);
const { resolvePresentationFont, finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(path.dirname(finalPath), { recursive: true });
const font = resolvePresentationFont({ fontFamily: 'Helvetica Neue' });
const C = { paper: '#F7F3EA', ink: '#142437', muted: '#52616A', rust: '#B96E43', pale: '#E8E0D2', white: '#FFFFFF' };
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function addShape(slide, x, y, w, h, fill, name) {
  return slide.shapes.add({ geometry: 'rect', name, position: { left: x, top: y, width: w, height: h }, fill, line: { fill: 'none', width: 0 } });
}
function addText(slide, text, x, y, w, h, size, color = C.ink, bold = false, name = 'Text') {
  const box = slide.shapes.add({ geometry: 'textbox', name, position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { fill: 'none', width: 0 } });
  box.text = text;
  box.text.style = { typeface: font, fontSize: size, color, bold, autoFit: 'shrinkText' };
  return box;
}
async function addIllustration(slide, filename, alt, position) {
  const blob = new Uint8Array(await fs.readFile(path.join(sourceDir, 'assets', filename)));
  slide.images.add({ blob, contentType: 'image/png', alt, fit: 'cover', position, geometry: 'rect' });
}

const slides = [
  {
    section: 'THE PROBLEM', title: 'Flight needed control,\nnot just lift',
    body: 'A machine could rise into the air. The harder problem was keeping it balanced and steering it safely.',
    image: 'problem-workshop.png', alt: 'The Wright brothers studying a model glider in their workshop',
    note: 'Historical context: The Wright brothers approached flight as a control problem as well as a problem of lift and power. Source: National Park Service, Wright Brothers, https://www.nps.gov/articles/wright-brothers.htm',
  },
  {
    section: 'THE EXPERIMENTS', title: 'They learned by\nflying gliders',
    body: 'At Kitty Hawk, repeated glides gave Wilbur and Orville practical flying skill and exposed what their designs could not yet do.',
    image: 'glider-tests.png', alt: 'A Wright glider in a test flight above the Kitty Hawk dunes',
    note: 'The brothers conducted extensive glider experiments at the Outer Banks before powered flight. Source: National Park Service, The First Flight, https://www.nps.gov/wrbr/learn/historyculture/thefirstflight.htm',
  },
  {
    section: 'THE BREAKTHROUGH', title: 'A wind tunnel turned\nguesswork into data',
    body: 'Their own tests showed that published lift figures were unreliable. A small wind tunnel let them compare wing shapes and design with evidence.',
    image: 'wind-tunnel.png', alt: 'The Wright brothers testing wing models in a small wooden wind tunnel',
    note: 'The Wrights built a small wind tunnel after concluding that existing lift tables were inaccurate. Source: National Park Service, The First Flight, https://www.nps.gov/wrbr/learn/historyculture/thefirstflight.htm',
  },
  {
    section: 'THE FIRST FLIGHT', title: 'December 17, 1903\nKitty Hawk, North Carolina',
    body: 'Orville piloted the first successful powered flight. The brothers made four flights that morning, improving their distance each time.',
    image: 'first-flight.png', alt: 'The Wright Flyer rising above its launch rail as Wilbur runs alongside',
    note: 'The first flight lasted 12 seconds and covered 120 feet; four powered flights took place that day. Sources: Smithsonian National Air and Space Museum, 1903 Wright Flyer, https://airandspace.si.edu/collection-objects/wright-1903-flyer/nasm_A19610048000; National Park Service, Four Powered Flights, https://www.nps.gov/places/3-four-powered-flights.htm',
  },
  {
    section: 'THE ENDURING LESSON', title: 'Progress came from\nlearning what failed',
    body: 'They tested, measured, and redesigned before adding an engine. Careful evidence and steady iteration made controlled flight possible.',
    image: 'enduring-lesson.png', alt: 'The early Wright Flyer on the beach, with a modern airliner crossing the distant sky',
    note: 'The Wrights used wind tunnel research and flight testing as design tools, establishing a foundation for aeronautical engineering. Source: Smithsonian National Air and Space Museum, 1903 Wright Flyer, https://airandspace.si.edu/collection-objects/wright-1903-flyer/nasm_A19610048000',
  },
];

for (let i = 0; i < slides.length; i++) {
  const item = slides[i];
  const slide = deck.slides.add();
  slide.background.fill = C.paper;
  addShape(slide, 0, 0, 12, 720, C.rust, 'Accent rule');
  addText(slide, item.section, 72, 58, 490, 26, 15, C.rust, true, 'Section');
  addText(slide, item.title, 72, 114, 530, 156, 43, C.ink, true, 'Slide title');
  addShape(slide, 72, 292, 86, 4, C.rust, 'Title underline');
  addText(slide, item.body, 72, 326, 500, 142, 23, C.muted, false, 'Slide description');
  if (i === 3) {
    await addIllustration(slide, item.image, item.alt, { left: 644, top: 72, width: 564, height: 365 });
    addText(slide, '12', 650, 480, 210, 88, 66, C.ink, true, 'First flight duration');
    addText(slide, 'SECONDS', 655, 565, 200, 28, 15, C.rust, true, 'Duration label');
    addShape(slide, 876, 485, 2, 92, C.pale, 'Metric divider');
    addText(slide, '120', 912, 480, 240, 88, 66, C.ink, true, 'First flight distance');
    addText(slide, 'FEET', 918, 565, 180, 28, 15, C.rust, true, 'Distance label');
  } else {
    await addIllustration(slide, item.image, item.alt, { left: 644, top: 118, width: 564, height: 420 });
  }
  addText(slide, `${String(i + 1).padStart(2, '0')} / 05`, 1088, 660, 120, 26, 14, C.muted, false, 'Slide number');
  slide.speakerNotes.textFrame.setText(item.note);
}

const exported = await PresentationFile.exportPptx(deck);
await exported.save(draftPath);
const result = await finalizePresentation({
  explicitTotalSlideCount: 5,
  workspaceDir,
  candidatePath: draftPath,
  finalPath,
  pythonExecutable: '/Users/kaartiktejwani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python',
  integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: 'design', families: ['Helvetica Neue'] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, 'wright-mini-validation.json'),
});
console.log(JSON.stringify({ finalPath, result }, null, 2));
