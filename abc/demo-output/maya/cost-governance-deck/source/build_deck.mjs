import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = '/Users/kaartiktejwani/UCLA Files/Playground Code/budgetsightv3/abc';
const outDir = path.join(workspaceDir, 'demo-output/maya/cost-governance-deck');
const buildDir = path.join(outDir, '.build');
const SKILL_DIR = '/Users/kaartiktejwani/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/Presentations';
const RUNTIME_PYTHON = '/Users/kaartiktejwani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const FINAL_PPTX = path.join(outDir, 'deliverable', 'agent-cost-governance-v2.pptx');
const { resolvePresentationFont, finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const font = resolvePresentationFont();

const C = { ink:'#15283A', paper:'#F6F5F0', white:'#FFFFFF', muted:'#647585', line:'#D7DED9', teal:'#167C78', mint:'#D9EFEB', coral:'#D36A58', sand:'#E9B85F', pale:'#E9EEEA', blue:'#5C7D99', redpale:'#F7E6E0' };
const pptx = Presentation.create({ slideSize:{width:1280,height:720} });

function shape(slide, geometry, x, y, w, h, fill='none', stroke='none', sw=0) {
  return slide.shapes.add({ geometry, position:{left:x,top:y,width:w,height:h}, fill, line:{fill:stroke,width:sw} });
}
function txt(slide, value, x, y, w, h, size=24, color=C.ink, bold=false, align='left') {
  const box=shape(slide,'textbox',x,y,w,h);
  box.text=value;
  box.text.style={typeface:font,fontSize:size,bold,color,alignment:align,verticalAlignment:'middle',autoFit:'none',wrap:true};
  return box;
}
function line(slide,x1,y1,x2,y2,color=C.line,sw=2) {
  return slide.shapes.add({geometry:'line',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},fill:'none',line:{fill:color,width:sw}});
}
function base(title, takeaway, n, notes='Illustrative operating model for BudgetSight demo; no company-specific spend data is represented.') {
  const s=pptx.slides.add(); s.background.fill=C.paper;
  txt(s,`COST GOVERNANCE   /   ${String(n).padStart(2,'0')}`,68,34,600,25,14,C.teal,true);
  txt(s,title,68,75,1120,58,39,C.ink,true);
  txt(s,takeaway,70,139,1110,42,22,C.muted,false);
  line(s,68,194,1210,194,C.line,1.5);
  txt(s,'BUDGETSIGHT   •   EXECUTIVE BRIEF',68,676,600,20,13,C.muted,true);
  txt(s,String(n).padStart(2,'0'),1164,671,46,24,15,C.muted,true,'right');
  s.speakerNotes.textFrame.setText(notes);
  return s;
}
function label(slide,value,x,y,w,color=C.teal){ txt(slide,value.toUpperCase(),x,y,w,22,14,color,true); }
function chip(slide,value,x,y,w,fill,color=C.ink){ shape(slide,'roundRect',x,y,w,34,fill); txt(slide,value,x+8,y+2,w-16,28,15,color,true,'center'); }

// 1 — Visibility gap
{
  const s=base('Agent spend has a visibility gap','Costs fragment across models, tools, and teams before finance can explain the bill.',1);
  label(s,'Today: scattered signals',76,224,400,C.coral);
  const rows=[['MODEL API','$18.4k'],['TOOL CALLS','$6.2k'],['RETRIES','$4.1k'],['SHARED RUNTIME','$3.8k']];
  rows.forEach((r,i)=>{
    const y=265+i*68;
    shape(s,'rect',76,y,308,50,C.white,C.line,1);
    txt(s,r[0],92,y+8,185,33,16,C.muted,true);
    txt(s,r[1],278,y+8,92,33,18,C.ink,true,'right');
    line(s,400,y+25,525,y+25,C.coral,2);
  });
  shape(s,'roundRect',548,268,4,239,C.coral);
  txt(s,'No shared unit\nNo owner\nNo outcome link',575,320,235,130,24,C.ink,true);
  line(s,815,385,890,385,C.teal,3);
  shape(s,'chevron',872,375,24,20,C.teal);
  shape(s,'roundRect',920,252,285,248,C.ink);
  label(s,'Governed view',948,280,220,C.sand);
  txt(s,'One workload\nOne owner\nOne cost-to-outcome view',948,322,220,120,24,C.white,true);
  txt(s,'Illustrative monthly spend fragments shown for structure only.',76,570,900,25,15,C.muted,false);
}
// 2 — Normalized workloads
{
  const s=base('Normalize workloads before comparing cost','A shared unit makes unlike agent runs comparable across teams and providers.',2);
  const cols=[72,390,685,888,1070];
  label(s,'Workload',cols[0],223,260); label(s,'Usage / run',cols[1],223,240); label(s,'Cost / run',cols[2],223,180); label(s,'Owner',cols[3],223,150);
  const data=[['Support resolution','4.2k tokens · 3 tools','$0.084','Service'],['Invoice review','8.6k tokens · 2 tools','$0.126','Finance'],['Code change','12.1k tokens · 5 tools','$0.392','Engineering']];
  data.forEach((r,i)=>{
    const y=263+i*88;
    line(s,72,y+64,1208,y+64,C.line,1);
    txt(s,r[0],72,y,290,50,22,C.ink,true);
    txt(s,r[1],390,y,265,50,18,C.muted);
    txt(s,r[2],685,y,160,50,23,i===2?C.coral:C.teal,true);
    txt(s,r[3],888,y,160,50,19,C.ink);
    shape(s,'roundRect',1070,y+10,118,32,i===2?C.redpale:C.mint);
    txt(s,i===2?'Review':'Tracked',1076,y+12,106,26,14,i===2?C.coral:C.teal,true,'center');
  });
  shape(s,'roundRect',72,555,1136,72,C.ink);
  txt(s,'Unit of control',94,570,195,35,16,C.sand,true);
  txt(s,'Cost per successful task, segmented by workload and owner',294,567,860,42,23,C.white,true);
}
// 3 — Spend vs outcomes
{
  const s=base('Spend alone cannot rank agent workloads','Pair cost with task success and business value to decide where to scale, tune, or stop.',3,'Chart values below are illustrative indices for a demo workload, not measured financial or operational results.');
  const x0=170,y0=585,x1=840,y1=250;
  line(s,x0,y0,x1,y0,C.ink,2); line(s,x0,y0,x0,y1,C.ink,2);
  [0,1,2,3].forEach(i=>{ const yy=y0-i*100; line(s,x0,yy,x1,yy,C.line,1); });
  txt(s,'LOWER COST / SUCCESSFUL TASK',180,610,400,24,14,C.muted,true);
  txt(s,'HIGHER COST  →',592,610,230,24,14,C.muted,true,'right');
  txt(s,'HIGHER',92,244,72,23,13,C.muted,true);
  txt(s,'QUALITY',72,330,88,24,13,C.muted,true);
  const dots=[{x:275,y:345,l:'Support',r:18,c:C.teal},{x:510,y:430,l:'Invoice review',r:22,c:C.sand},{x:735,y:300,l:'Code change',r:25,c:C.coral},{x:420,y:530,l:'Research',r:15,c:C.blue}];
  dots.forEach(d=>{shape(s,'ellipse',d.x-d.r,d.y-d.r,d.r*2,d.r*2,d.c);txt(s,d.l,d.x+25,d.y-16,170,30,17,C.ink,true);});
  txt(s,'Decision zones',910,248,240,28,17,C.muted,true);
  shape(s,'roundRect',910,287,286,78,C.mint); txt(s,'SCALE',932,298,80,24,14,C.teal,true); txt(s,'Strong outcome · efficient',932,322,245,30,18,C.ink);
  shape(s,'roundRect',910,382,286,78,'#F7EFD9'); txt(s,'TUNE',932,393,80,24,14,'#9B6B12',true); txt(s,'Strong outcome · costly',932,417,245,30,18,C.ink);
  shape(s,'roundRect',910,477,286,78,C.redpale); txt(s,'REVIEW',932,488,90,24,14,C.coral,true); txt(s,'Weak outcome · costly',932,512,245,30,18,C.ink);
  txt(s,'Illustrative relative indices; bubble size is not a reported spend value.',171,645,850,19,14,C.muted);
}
// 4 — Coordination overlap
{
  const s=base('Coordination creates hidden overlap','Parallel agents can repeat retrieval, planning, and verification work unless handoffs are explicit.',4);
  label(s,'Shared task: prepare an account brief',78,222,520,C.teal);
  const lanes=[['Researcher',C.teal,280],['Planner',C.blue,382],['Writer',C.sand,484]];
  lanes.forEach(([name,color,y])=>{
    txt(s,name,78,y-4,165,40,20,C.ink,true);
    line(s,245,y+18,1174,y+18,C.line,1);
    shape(s,'roundRect',280,y,260,38,color); txt(s,'Retrieve account context',293,y+3,234,32,16,C.white,true);
  });
  shape(s,'roundRect',550,280,300,38,C.redpale,C.coral,1); txt(s,'Same sources retrieved again',563,283,275,32,16,C.coral,true);
  shape(s,'roundRect',550,382,300,38,'#E4EAF0',C.blue,1); txt(s,'Plan repeats research steps',563,385,275,32,16,C.blue,true);
  shape(s,'roundRect',550,484,300,38,'#F7EFD9','#B4852B',1); txt(s,'Draft starts without a check',563,487,275,32,16,'#8B6419',true);
  txt(s,'Measure overlap',78,578,196,32,19,C.ink,true);
  txt(s,'duplicate tool calls   ·   repeated tokens   ·   idle handoff time',278,578,825,32,18,C.muted);
  txt(s,'Control: assign a task owner, shared context boundary, and stop condition.',78,622,1080,30,18,C.teal,true);
}
// 5 — Validation gaps
{
  const s=base('Validation gaps hide the real cost of failure','Track quality, policy, and latency alongside dollars before a workload ships.',5);
  const steps=[['01','Spend cap','Per run + daily'],['02','Quality check','Task success'],['03','Safety check','Policy + data'],['04','Latency check','p95 target']];
  const xs=[76,356,636,916];
  steps.forEach((st,i)=>{
    shape(s,'roundRect',xs[i],270,220,124,C.white,C.line,1);
    txt(s,st[0],xs[i]+16,283,48,28,15,C.teal,true);
    txt(s,st[1],xs[i]+16,317,190,35,22,C.ink,true);
    txt(s,st[2],xs[i]+16,355,190,28,16,C.muted);
    if(i<steps.length-1){line(s,xs[i]+220,332,xs[i+1]-12,332,C.teal,2);shape(s,'chevron',xs[i+1]-18,324,18,16,C.teal);}
  });
  line(s,1026,394,1026,458,C.coral,2);
  shape(s,'roundRect',828,458,380,114,C.redpale,C.coral,1);
  txt(s,'Without a release gate',850,472,330,30,19,C.coral,true);
  txt(s,'Spend can fall while failure, rework, or policy exposure rises.',850,508,330,49,18,C.ink);
  txt(s,'Release only when all four thresholds pass; log exceptions with an owner and expiry.',76,608,1110,32,18,C.ink,true);
}
// 6 — Operating loop
{
  const s=base('An operating loop makes controls actionable','Use one monthly review rhythm, with automated limits applied at run time.',6);
  const nodes=[{x:90,y:285,n:'1',h:'Instrument',b:'Capture model, tool,\nteam, and task'},{x:375,y:285,n:'2',h:'Normalize',b:'Compare cost per\nsuccessful task'},{x:660,y:285,n:'3',h:'Set controls',b:'Budgets, quality bars,\npolicy, stop rules'},{x:945,y:285,n:'4',h:'Review & tune',b:'Explain variance;\nscale, tune, retire'}];
  nodes.forEach((q,i)=>{
    shape(s,'ellipse',q.x,q.y,58,58,i===3?C.sand:C.teal); txt(s,q.n,q.x,q.y+3,58,48,23,C.white,true,'center');
    txt(s,q.h,q.x+76,q.y+2,190,35,21,C.ink,true);
    txt(s,q.b,q.x+76,q.y+42,190,68,17,C.muted);
    if(i<3){line(s,q.x+244,q.y+29,q.x+277,q.y+29,C.teal,2);shape(s,'chevron',q.x+268,q.y+21,17,16,C.teal);}
  });
  line(s,1093,393,1093,490,C.sand,3); line(s,1093,490,118,490,C.sand,3); line(s,118,490,118,392,C.sand,3);
  shape(s,'chevron',109,389,18,16,C.sand);
  chip(s,'Run-time guardrails',80,548,215,C.mint,C.teal);
  txt(s,'Hard spend ceiling  ·  Approved model/tool list  ·  Quality and latency alerts',322,549,830,33,18,C.ink);
}
// 7 — Recommendation
{
  const s=pptx.slides.add(); s.background.fill=C.ink;
  txt(s,'COST GOVERNANCE   /   RECOMMENDATION',68,42,700,25,14,C.sand,true);
  txt(s,'Fund visibility first.\nScale on evidence.',68,105,725,155,51,C.white,true);
  txt(s,'Approve a 90-day control pilot across three representative agent workloads.',72,281,765,70,25,'#CBD5DC');
  line(s,72,382,810,382,'#516273',1.5);
  const recs=[['01','Name owners','One accountable team per workload'],['02','Set shared measures','Cost / successful task + quality + latency'],['03','Gate expansion','Review variance monthly; scale only when thresholds hold']];
  recs.forEach((r,i)=>{
    const y=420+i*78;
    txt(s,r[0],72,y,54,34,16,C.sand,true);
    txt(s,r[1],140,y,235,34,20,C.white,true);
    txt(s,r[2],385,y,475,38,17,'#CBD5DC');
  });
  shape(s,'roundRect',902,164,300,374,'#213B4F');
  label(s,'Decision requested',930,195,235,C.sand);
  txt(s,'Sponsor a 90-day pilot',930,239,242,70,28,C.white,true);
  txt(s,'Finance + platform + 3 workload owners',930,331,238,60,18,'#CBD5DC');
  line(s,930,412,1173,412,'#516273',1);
  txt(s,'Deliverable',930,433,220,26,15,C.sand,true);
  txt(s,'A cost-to-outcome baseline and a scale / tune / stop decision',930,465,238,54,18,C.white);
  txt(s,'BUDGETSIGHT   •   EXECUTIVE BRIEF',68,676,600,20,13,'#AEBCC6',true);
  txt(s,'07',1164,671,46,24,15,'#AEBCC6',true,'right');
  s.speakerNotes.textFrame.setText('Recommendation for discussion: sponsor a 90-day pilot. Scope and thresholds should be confirmed by Finance, Platform, and workload owners. All example metrics elsewhere in this deck are illustrative, not measured results.');
}

await fs.mkdir(buildDir,{recursive:true});
await fs.mkdir(path.dirname(FINAL_PPTX),{recursive:true});
const candidatePath=path.join(buildDir,'candidate.pptx');
await (await PresentationFile.exportPptx(pptx)).save(candidatePath);
const result=await finalizePresentation({
  workspaceDir,candidatePath,finalPath:FINAL_PPTX,pythonExecutable:RUNTIME_PYTHON,
  integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],
  explicitTotalSlideCount:7,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
  fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,
  receiptPath:path.join(buildDir,'validation-v2.json')
});
console.log(JSON.stringify({font,final:FINAL_PPTX,result},null,2));
