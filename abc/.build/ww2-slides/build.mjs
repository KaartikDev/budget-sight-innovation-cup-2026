import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = '/Users/kaartiktejwani/UCLA Files/Playground Code/budgetsightv3/abc';
const SKILL_DIR = '/Users/kaartiktejwani/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const buildDir = path.join(workspaceDir, '.build/ww2-slides');
const FINAL_PPTX = path.join(workspaceDir, 'output', 'history-of-world-war-ii-v2.pptx');
const RUNTIME_PYTHON = '/Users/kaartiktejwani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const { resolvePresentationFont, finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const font = resolvePresentationFont();

const C = { navy:'#131E2C', cream:'#F4F0E8', muted:'#BEC8CE', gold:'#E7B65E', red:'#C46D60' };
const pptx = Presentation.create({ slideSize:{width:1280,height:720} });

function text(slide, value, x, y, w, h, size, color=C.cream, bold=false) {
  const box=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  box.text=value;
  box.text.style={typeface:font,fontSize:size,bold,color,autoFit:'none',verticalAlignment:'middle'};
  return box;
}
function base(title, period, no, notes) {
  const slide=pptx.slides.add(); slide.background.fill=C.navy;
  text(slide,title,72,48,1100,64,40,C.cream,true);
  text(slide,period,72,131,500,36,20,C.gold,true);
  text(slide,String(no).padStart(2,'0'),1151,652,58,30,18,C.muted);
  slide.speakerNotes.textFrame.setText(notes);
  return slide;
}
function item(slide, y, heading, body) {
  text(slide,heading,355,y,800,38,25,C.gold,true);
  text(slide,body,355,y+43,800,78,24,C.cream);
}

{
  const s=pptx.slides.add(); s.background.fill=C.navy;
  text(s,'WORLD WAR II',72,180,1120,92,68,C.cream,true);
  text(s,'A short history of a global conflict',75,293,1050,48,29,C.gold);
  text(s,'1939–1945',75,548,600,50,32,C.muted);
  s.speakerNotes.textFrame.setText('Overview sources: https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf ; https://encyclopedia.ushmm.org/content/en/article/world-war-ii-in-depth');
}
{
  const s=base('Origins of the war','1919–1939',2,'Sources: https://www.nationalww2museum.org/war/articles/war-war-europe-1919-1939 ; https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf');
  text(s,'1919',73,222,245,112,87,C.gold,true);
  item(s,210,'Unstable peace','The Treaty of Versailles and the Great Depression deepened political and economic crisis in Europe.');
  item(s,364,'Expansion and appeasement','Nazi Germany rearmed and seized territory. Britain and France tried to avert another war through concessions.');
  item(s,518,'War in Asia','Japan’s invasion of China in 1937 widened a conflict already underway in East Asia.');
}
{
  const s=base('Axis expansion in Europe','1939–1941',3,'Sources: https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf ; https://encyclopedia.ushmm.org/content/en/article/world-war-ii-in-depth');
  text(s,'1939',73,222,245,112,87,C.gold,true);
  item(s,210,'September 1939','Germany invaded Poland. Britain and France declared war on Germany.');
  item(s,364,'1940','Germany conquered much of Western Europe. Britain resisted German air attacks.');
  item(s,518,'June 1941','Germany invaded the Soviet Union, opening the vast Eastern Front.');
}
{
  const s=base('The war becomes global','1941',4,'Sources: https://www.nationalww2museum.org/home-front-selected-chronology ; https://www.nationalww2museum.org/war/articles/pacific-strategy-1941-1944');
  text(s,'1941',73,222,245,112,87,C.gold,true);
  item(s,210,'Pacific war','Japan continued expanding across East and Southeast Asia.');
  item(s,364,'Pearl Harbor','Japan attacked the US naval base on 7 December. The United States entered the war.');
  item(s,518,'A worldwide conflict','Germany and Italy declared war on the United States days later.');
}
{
  const s=base('Turning points','1942–1943',5,'Sources: https://www.nationalww2museum.org/war/articles/pacific-strategy-1941-1944 ; https://www.nationalww2museum.org/sites/default/files/2024-05/WWII_2023-Annual-Report_Digital.pdf ; https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf');
  text(s,'1942',73,222,245,112,87,C.gold,true);
  item(s,210,'Midway','US forces defeated a Japanese carrier fleet in June 1942 and gained momentum in the Pacific.');
  item(s,364,'Stalingrad','The Soviet victory in February 1943 ended Germany’s offensive momentum on the Eastern Front.');
  item(s,518,'North Africa and Italy','Allied advances opened a route into southern Europe.');
}
{
  const s=base('The Holocaust','1933–1945',6,'Sources: https://encyclopedia.ushmm.org/content/en/article/world-war-ii-in-depth ; https://encyclopedia.ushmm.org/content/en/article/the-final-solution');
  text(s,'6 million',72,220,1140,113,86,C.gold,true);
  text(s,'Jewish people murdered',76,335,1030,52,36,C.cream,true);
  text(s,'Nazi Germany and its collaborators persecuted and murdered Jews across Europe. They also targeted Roma, disabled people, Poles and others. Mass shootings and killing centers made genocide central to the war.',76,441,1090,145,26,C.cream);
}
{
  const s=base('Allied advance','1944',7,'Sources: https://www.nationalww2museum.org/d-day-timeline ; https://www.nationalww2museum.org/war/topics/d-day-and-normandy-campaign ; https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf');
  text(s,'1944',73,222,245,112,87,C.gold,true);
  item(s,210,'D-Day, 6 June','Allied forces landed in Normandy and began liberating Western Europe.');
  item(s,364,'Eastern Front','Soviet forces pushed German armies westward.');
  item(s,518,'Pacific campaign','Allied forces advanced toward Japan through costly island battles.');
}
{
  const s=base('The war ends','1945',8,'Sources: https://www.nationalww2museum.org/war/topics/end-world-war-ii-1945 ; https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf');
  text(s,'1945',73,222,245,112,87,C.gold,true);
  item(s,210,'8 May','Germany surrendered. Victory in Europe followed years of fighting and occupation.');
  item(s,364,'August','The United States dropped atomic bombs on Hiroshima and Nagasaki. The Soviet Union entered the war against Japan.');
  item(s,518,'2 September','Japan formally surrendered, ending World War II.');
}
{
  const s=base('Aftermath','After 1945',9,'Sources: https://www.un.org/en/about-us/history-of-the-un ; https://history.state.gov/countries/germany ; https://history.state.gov/milestones/1945-1952/berlin-airlift ; https://www.nationalww2museum.org/sites/default/files/2017-07/timeline-full-lesson.pdf');
  text(s,'1945+',73,222,280,112,68,C.gold,true);
  item(s,210,'Rebuilding and justice','Europe and Asia faced enormous destruction. War crimes trials began in Nuremberg.');
  item(s,364,'A new world order','The United Nations formed in 1945 to support international peace.');
  item(s,518,'Cold War divisions','Germany came under Allied occupation as tensions grew between the Soviet Union and Western powers.');
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
  requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
  fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,
  receiptPath:path.join(buildDir,'validation-v2.json')
});
console.log(JSON.stringify({font,final:FINAL_PPTX,result},null,2));
