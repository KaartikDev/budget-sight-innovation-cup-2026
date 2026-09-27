from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.dml import MSO_THEME_COLOR
from pathlib import Path

OUT = Path(__file__).parent
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# BudgetSight visual system
BG = 'F6F8F5'; INK = '132820'; MUTED = '65766E'; GREEN = '1D7656'; MINT = 'DDF1E7'
LIME = 'B8E36B'; WHITE = 'FFFFFF'; LINE = 'DEE6E0'; ORANGE = 'E5A65D'; PALE = 'EAF0EA'
FONT = 'Aptos'

def rgb(h): return RGBColor.from_string(h)
def rect(slide,x,y,w,h,fill, radius=False, line=None):
    sh=slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb=rgb(fill)
    sh.line.fill.background() if not line else None
    if line:
        sh.line.color.rgb=rgb(line); sh.line.width=Pt(1)
    if radius:
        try: sh.adjustments[0]=0.12
        except: pass
    return sh

def txt(slide,x,y,w,h,s,size=16,color=INK,bold=False,font=FONT,align=PP_ALIGN.LEFT,valign=MSO_ANCHOR.TOP,margin=0):
    box=slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf=box.text_frame; tf.clear(); tf.word_wrap=True
    tf.margin_left=tf.margin_right=Inches(margin); tf.margin_top=tf.margin_bottom=Inches(margin)
    tf.vertical_anchor=valign
    p=tf.paragraphs[0]; p.alignment=align
    r=p.add_run(); r.text=s; r.font.name=font; r.font.size=Pt(size); r.font.bold=bold; r.font.color.rgb=rgb(color)
    return box

def label(slide,x,y,s,color=GREEN): txt(slide,x,y,5,.24,s.upper(),9,color,True)
def base(kicker,title,sub=None,dark=False):
    s=prs.slides.add_slide(prs.slide_layouts[6]); s.background.fill.solid(); s.background.fill.fore_color.rgb=rgb(INK if dark else BG)
    fg=WHITE if dark else INK; muted='B7C8BF' if dark else MUTED
    label(s,.65,.42,'BUDGETSIGHT  /  '+kicker, LIME if dark else GREEN)
    txt(s,.65,.82,12, .64,title,30,fg,True)
    if sub: txt(s,.67,1.53,11.8,.48,sub,13,muted)
    txt(s,.65,7.12,5,.18,'BUDGETSIGHT  •  EXPENSE TRACKER',8,muted,True)
    txt(s,12.1,7.08,.55,.24,f'{len(prs.slides):02d}',9,muted,True,align=PP_ALIGN.RIGHT)
    return s

def bullet(slide,x,y,w,title,body,accent=GREEN):
    rect(slide,x,y+.05,.09,.09,accent,True)
    txt(slide,x+.22,y,w-.22,.28,title,15,INK,True)
    txt(slide,x+.22,y+.34,w-.22,.54,body,11,MUTED)

# 1 Problem
s=base('THE PROBLEM','Spending adds up quietly.','A lightweight tracker should make the everyday money picture easier to see.')
rect(s,.65,2.3,7.1,4.25,INK,True)
label(s,1.02,2.68,'THE EVERYDAY GAP',LIME)
txt(s,1.02,3.12,5.95,1.3,'“Where did my money\ngo this month?”',31,WHITE,True)
txt(s,1.03,4.75,5.75,.85,'Receipts, quick purchases, and small subscriptions blur together before anyone gets a clear answer.',15,'C8D5CE')
# visual trail
for i,(x,amount,what) in enumerate([(1.05,'$4.25','coffee'),(2.9,'$18.40','lunch'),(4.9,'$12.00','ride')]):
    rect(s,x,5.78,1.55,.48,'274236',True); txt(s,x+.12,5.86,.65,.25,amount,12,LIME,True); txt(s,x+.8,5.88,.65,.2,what,9,WHITE)
rect(s,8.15,2.3,4.52,4.25,WHITE,True,LINE)
label(s,8.55,2.68,'WHAT PEOPLE NEED')
bullet(s,8.55,3.12,3.65,'Fast capture','Log a purchase while it is still fresh.')
bullet(s,8.55,4.18,3.65,'A simple answer','See totals by month and category.')
bullet(s,8.55,5.24,3.65,'Control','Keep a portable record without account linking.')

# 2 Flow
s=base('PRODUCT FLOW','From purchase to a clear record.','A short, deliberate loop: log it, review it, take the data with you.')
steps=[('01','ADD','Amount · category\nDate · optional note'),('02','REVIEW','List and filter\nby month or category'),('03','UNDERSTAND','Monthly and category\ntotals at a glance'),('04','TAKE IT','Export a portable\nCSV when you need it')]
for i,(n,h,b) in enumerate(steps):
    x=.65+i*3.18
    rect(s,x,2.45,2.8,2.5,WHITE,True,LINE)
    rect(s,x+.22,2.72,.52,.48,GREEN if i<3 else 'B58B4F',True)
    txt(s,x+.22,2.83,.52,.18,n,11,WHITE,True,align=PP_ALIGN.CENTER)
    txt(s,x+.22,3.48,2.35,.32,h,15,INK,True)
    txt(s,x+.22,3.97,2.3,.65,b,12,MUTED)
    if i<3:
        txt(s,x+2.83,3.38,.35,.35,'→',22,GREEN,True,align=PP_ALIGN.CENTER)
rect(s,.65,5.45,12.02,.92,MINT,True)
txt(s,.95,5.7,11.45,.38,'No bank connection required in this demo. Start with the expenses you choose to enter.',14,GREEN,True,align=PP_ALIGN.CENTER)

# 3 Insight
s=base('CATEGORY INSIGHT','A small log can answer a useful question.','Illustrative month • sample figures only • not real customer data')
rect(s,.65,2.35,7.45,4.25,WHITE,True,LINE)
txt(s,1.02,2.7,4,.3,'SEPTEMBER SPEND',11,MUTED,True)
txt(s,1.02,3.05,4,.55,'$1,284.60',28,INK,True)
rows=[('Food & drink',486.20,'38%',GREEN),('Transport',276.40,'22%','4A9A78'),('Home',218.00,'17%',LIME),('Other',304.00,'23%','AFC0B5')]
for i,(name,val,pct,c) in enumerate(rows):
    y=3.9+i*.58
    txt(s,1.03,y,1.72,.24,name,11,INK,True)
    rect(s,2.78,y+.03,3.25,.17,PALE,True)
    rect(s,2.78,y+.03,3.25*(val/486.2),.17,c,True)
    txt(s,6.16,y,1.05,.24,f'${val:,.2f}',10,INK,True,align=PP_ALIGN.RIGHT)
    txt(s,7.28,y,.5,.24,pct,9,MUTED,False,align=PP_ALIGN.RIGHT)
rect(s,8.42,2.35,4.25,4.25,INK,True)
label(s,8.82,2.75,'THE TAKEAWAY',LIME)
txt(s,8.82,3.22,3.25,1.05,'Food & drink is the largest category.',22,WHITE,True)
txt(s,8.82,4.55,3.12,.9,'That is the kind of quick “where did it go?” answer BudgetSight makes easier to find.',13,'C8D5CE')
txt(s,8.82,5.85,3.2,.35,'FILTER  →  SUMMARIZE  →  NOTICE',9,LIME,True)

# 4 Trust
s=base('TRUST & PRIVACY','Your record stays in your hands.','A transparent starting point: local storage and straightforward export.')
rect(s,.65,2.35,5.5,4.1,INK,True)
# database icon
rect(s,1.03,2.94,1.2,1.22,'274236',True)
# simple file motif
rect(s,1.38,3.15,.52,.7,LIME,True)
for j in range(3): rect(s,1.48,3.32+j*.13,.32,.035,GREEN,True)
label(s,2.52,2.99,'DATA PATH',LIME)
txt(s,2.52,3.38,2.8,.75,'Your entries → local JSON file',18,WHITE,True)
txt(s,1.03,4.65,4.56,1.05,'This demo reads and writes the file you choose. It does not need a bank login to record expenses.',13,'C8D5CE')
rect(s,6.55,2.35,6.12,4.1,WHITE,True,LINE)
label(s,6.95,2.76,'BUILT INTO THE DEMO')
bullet(s,6.95,3.18,5.2,'Local-first','Expense data is stored in a local JSON file.')
bullet(s,6.95,4.17,5.2,'Portable','Export records to CSV for your own use.')
bullet(s,6.95,5.16,5.2,'Clear boundaries','No cloud sync or security certification is claimed.')

# 5 roadmap
s=base('ROADMAP','Grow from a reliable ledger.','A focused path that keeps clarity and user control at the center.')
road=[('NOW','Make capture dependable','Fast entry, valid records, useful filters and summaries.'),('NEXT','Make patterns easier to spot','Recurring expense cues and clearer month-over-month views.'),('LATER','Add optional convenience','Explore import and backup choices with explicit user control.')]
for i,(tag,title,body) in enumerate(road):
    y=2.4+i*1.35
    rect(s,.65,y,12.02,1.08,WHITE,True,LINE)
    rect(s,.92,y+.22,1.22,.48,GREEN if i==0 else (LIME if i==1 else 'DDE6DF'),True)
    txt(s,.92,y+.34,1.22,.18,tag,10,WHITE if i==0 else INK,True,align=PP_ALIGN.CENTER)
    txt(s,2.45,y+.19,3.6,.32,title,15,INK,True)
    txt(s,6.25,y+.2,5.9,.52,body,12,MUTED)
txt(s,.68,6.62,11.7,.22,'Roadmap concepts are exploratory; they are not current product capabilities.',9,MUTED)

# 6 CTA
s=base('NEXT STEP','Start with one week of expenses.','Try the simple loop. Keep what works. Decide what you want to see next.')
rect(s,.65,2.35,7.1,4.25,INK,True)
label(s,1.05,2.76,'BUDGETSIGHT',LIME)
txt(s,1.05,3.2,5.95,1.1,'See your spending\nwith fresh eyes.',30,WHITE,True)
txt(s,1.06,4.78,5.75,.62,'Capture a few purchases. Review the category totals. Export the record whenever you like.',14,'C8D5CE')
rect(s,1.05,5.75,2.52,.55,LIME,True)
txt(s,1.18,5.91,2.25,.2,'TRY THE TRACKER  →',10,INK,True,align=PP_ALIGN.CENTER)
rect(s,8.15,2.35,4.52,4.25,MINT,True)
label(s,8.57,2.8,'A GOOD FIRST SESSION')
for i,line in enumerate(['Add today’s expenses','Filter to this month','Check category totals','Export a CSV backup']):
    y=3.34+i*.61
    rect(s,8.57,y,.28,.28,GREEN,True)
    txt(s,8.57,y+.035,.28,.18,'✓',10,WHITE,True,align=PP_ALIGN.CENTER)
    txt(s,9.02,y-.005,2.95,.28,line,12,INK,True)
txt(s,8.57,5.98,3.6,.22,'Small steps. Clearer picture.',11,GREEN,True)

prs.core_properties.title='BudgetSight | Expense tracker product pitch'
prs.core_properties.subject='Six-slide product pitch for the BudgetSight expense tracker demo'
prs.core_properties.author='BudgetSight'
prs.save(OUT/'budgetsight_expense_pitch.pptx')
print(OUT/'budgetsight_expense_pitch.pptx')
