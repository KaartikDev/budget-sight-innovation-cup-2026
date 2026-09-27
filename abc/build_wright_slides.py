"""Build a small, self-contained PowerPoint without third-party packages."""

from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED


OUT = Path(__file__).with_name("wright_brothers_3_slides.pptx")
W, H = 12192000, 6858000  # widescreen, EMUs


def shape(i, x, y, w, h, fill, line=None, radius=False):
    geometry = "roundRect" if radius else "rect"
    outline = f'<a:ln w="12000"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else '<a:ln><a:noFill/></a:ln>'
    return f'''<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Shape {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>
    <a:prstGeom prst="{geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>{outline}</p:spPr></p:sp>'''


def textbox(i, x, y, w, h, lines, size=28, color="142437", bold=False, align="l", margin=0):
    paras = []
    for line in lines:
        paras.append(f'''<a:p><a:pPr algn="{align}"/><a:r><a:rPr lang="en-US" sz="{size * 100}" b="{1 if bold else 0}">
        <a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr>
        <a:t>{escape(line)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>''')
    return f'''<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Text {i}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
    <p:txBody><a:bodyPr wrap="square" lIns="{margin}" tIns="0" rIns="{margin}" bIns="0" anchor="ctr"/>
    <a:lstStyle/>{''.join(paras)}</p:txBody></p:sp>'''


def slide(parts, background="F8F5EE"):
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
     xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
     <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
     <p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
     <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
     {''.join(parts)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'''


slides = []

# Slide 1: title
slides.append(slide([
    shape(2, 0, 0, 300000, H, "C27A45"),
    shape(3, 8400000, 0, W - 8400000, H, "E7E0D0"),
    textbox(4, 750000, 1050000, 7500000, 1000000, ["WILBUR & ORVILLE"], 36, "142437", True),
    textbox(5, 750000, 2100000, 7500000, 1150000, ["WRIGHT"], 62, "142437", True),
    shape(6, 760000, 3450000, 1500000, 55000, "C27A45"),
    textbox(7, 750000, 3850000, 6850000, 800000, ["Two brothers who learned how to fly"], 24),
    textbox(8, 750000, 5750000, 6800000, 400000, ["Dayton, Ohio  •  1903"], 16, "596A76"),
    textbox(9, 8600000, 2450000, 3200000, 1000000, ["IDEA"], 38, "9A6545", True, "ctr"),
    textbox(10, 8600000, 3450000, 3200000, 1000000, ["→ FLIGHT"], 38, "9A6545", True, "ctr"),
]))

# Slide 2: the method
parts = [
    shape(2, 0, 0, W, 230000, "C27A45"),
    textbox(3, 650000, 500000, 10700000, 700000, ["How they solved flight"], 38, "142437", True),
    textbox(4, 650000, 1270000, 10800000, 450000, ["They built, measured, and improved one step at a time."], 21, "596A76"),
]
cards = [
    (650000, "1", "TEST", "They learned from gliders."),
    (4350000, "2", "MEASURE", "A wind tunnel helped them study wings."),
    (8050000, "3", "BUILD", "They added control and power to the Flyer."),
]
for n, (x, num, heading, desc) in enumerate(cards):
    base = 5 + n * 4
    parts += [shape(base, x, 2300000, 3500000, 2800000, "FFFFFF", "DED8CA", True),
              textbox(base + 1, x + 230000, 2510000, 500000, 620000, [num], 31, "C27A45", True),
              textbox(base + 2, x + 230000, 3250000, 3000000, 500000, [heading], 26, "142437", True),
              textbox(base + 3, x + 230000, 3900000, 2950000, 940000, [desc], 19, "445662")]
parts.append(textbox(17, 650000, 6200000, 10900000, 350000,
                     ["Source: National Park Service, “The Road to the First Flight”"], 12, "6D777D"))
slides.append(slide(parts))

# Slide 3: first flight and legacy
slides.append(slide([
    shape(2, 0, 0, W, 230000, "C27A45"),
    textbox(3, 650000, 470000, 10600000, 700000, ["December 17, 1903"], 38, "142437", True),
    textbox(4, 650000, 1200000, 10500000, 450000, ["Near Kitty Hawk, North Carolina"], 21, "596A76"),
    shape(5, 650000, 2050000, 5200000, 2650000, "142437", radius=True),
    textbox(6, 850000, 2320000, 4800000, 850000, ["12 seconds"], 42, "FFFFFF", True, "ctr"),
    textbox(7, 850000, 3300000, 4800000, 750000, ["120 feet"], 36, "F0BB86", True, "ctr"),
    textbox(8, 6500000, 2150000, 5050000, 700000, ["Orville piloted the first flight."], 25, "142437", True),
    textbox(9, 6500000, 3050000, 5000000, 1030000, ["The brothers made four flights that day, opening a new age of aviation."], 21, "445662"),
    shape(10, 650000, 5350000, 10900000, 600000, "E7E0D0", radius=True),
    textbox(11, 850000, 5420000, 10500000, 470000, ["A small first flight changed how the world travels."], 22, "142437", True, "ctr"),
    textbox(12, 650000, 6250000, 11000000, 300000,
            ["Source: Smithsonian National Air and Space Museum, “1903 Wright Flyer”"], 12, "6D777D"),
]))


content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
''' + ''.join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1, 4)) + '</Types>'

root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

presentation = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>'''

presentation_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>'''

master = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMap accent1="c27a45" accent2="142437" accent3="e7e0d0" accent4="596a76"
accent5="9a6545" accent6="445662" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'''

master_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>'''

layout = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'''

layout_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>'''

theme = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Simple">
<a:themeElements><a:clrScheme name="Simple"><a:dk1><a:srgbClr val="142437"/></a:dk1>
<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="445662"/></a:dk2>
<a:lt2><a:srgbClr val="F8F5EE"/></a:lt2><a:accent1><a:srgbClr val="C27A45"/></a:accent1>
<a:accent2><a:srgbClr val="142437"/></a:accent2><a:accent3><a:srgbClr val="E7E0D0"/></a:accent3>
<a:accent4><a:srgbClr val="596A76"/></a:accent4><a:accent5><a:srgbClr val="9A6545"/></a:accent5>
<a:accent6><a:srgbClr val="445662"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink>
<a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Simple"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
<a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Simple"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>'''

core = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Wilbur and Orville Wright</dc:title>
<dc:creator>OpenAI</dc:creator></cp:coreProperties>'''

app = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Microsoft Office PowerPoint</Application><Slides>3</Slides></Properties>'''

with ZipFile(OUT, "w", ZIP_DEFLATED) as z:
    files = {
        "[Content_Types].xml": content_types,
        "_rels/.rels": root_rels,
        "ppt/presentation.xml": presentation,
        "ppt/_rels/presentation.xml.rels": presentation_rels,
        "ppt/slideMasters/slideMaster1.xml": master,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": master_rels,
        "ppt/slideLayouts/slideLayout1.xml": layout,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": layout_rels,
        "ppt/theme/theme1.xml": theme,
        "docProps/core.xml": core,
        "docProps/app.xml": app,
    }
    for i, content in enumerate(slides, 1):
        files[f"ppt/slides/slide{i}.xml"] = content
        files[f"ppt/slides/_rels/slide{i}.xml.rels"] = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        </Relationships>'''
    for path, content in files.items():
        z.writestr(path, content)

print(OUT)
