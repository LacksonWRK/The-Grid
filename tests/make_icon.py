from PIL import Image, ImageDraw, ImageFilter
S=1024
bg=Image.new('RGB',(S,S),(5,6,13))
# subtle radial glow
glow=Image.new('RGB',(S,S),(0,0,0));gd=ImageDraw.Draw(glow)
gd.ellipse((S*.1,S*.1,S*.9,S*.9),fill=(20,14,50));glow=glow.filter(ImageFilter.GaussianBlur(160))
bg=Image.blend(bg,Image.eval(glow,lambda v:v),1).point(lambda v:v) if False else Image.composite(glow,bg,Image.new('L',(S,S),255))
bg=Image.new('RGB',(S,S),(5,6,13));bg.paste(glow,(0,0))
n=4;pad=int(S*.18);step=(S-2*pad)/(n-1)
def pt(i,j):return (pad+i*step,pad+j*step)
layers=[]
def neon(draw_fn,color,blur):
    l=Image.new('RGB',(S,S),(0,0,0));d=ImageDraw.Draw(l);draw_fn(d,color);return l
cy=(0,240,255);mg=(255,43,214)
# squares
sq=Image.new('RGB',(S,S),(0,0,0));sd=ImageDraw.Draw(sq)
sd.rectangle((*pt(0,0),*pt(1,1)),fill=(0,110,120));sd.rectangle((*pt(2,1),*pt(3,2)),fill=(120,20,100));sd.rectangle((*pt(1,2),*pt(2,3)),fill=(0,110,120))
# lines
ln=Image.new('RGB',(S,S),(0,0,0));ld=ImageDraw.Draw(ln)
def L(a,b,c,w=26):
    ld.line((*pt(*a),*pt(*b)),fill=c,width=w)
for a,b,c in [((0,0),(1,0),cy),((1,0),(1,1),cy),((1,1),(0,1),cy),((0,1),(0,0),cy),
              ((2,1),(3,1),mg),((3,1),(3,2),mg),((3,2),(2,2),mg),((2,2),(2,1),mg),
              ((1,2),(2,2),cy),((1,3),(2,3),cy),((1,2),(1,3),cy),((2,2),(2,3),cy)]:
    L(a,b,c)
# extra dim guide lines
guide=Image.new('RGB',(S,S),(0,0,0));gd2=ImageDraw.Draw(guide)
for i in range(n):
    for j in range(n):
        if i<n-1:gd2.line((*pt(i,j),*pt(i+1,j)),fill=(30,45,80),width=8)
        if j<n-1:gd2.line((*pt(i,j),*pt(i,j+1)),fill=(30,45,80),width=8)
dots=Image.new('RGB',(S,S),(0,0,0));dd=ImageDraw.Draw(dots)
for i in range(n):
    for j in range(n):
        x,y=pt(i,j);dd.ellipse((x-30,y-30,x+30,y+30),fill=(220,245,255))
from PIL import ImageChops
img=bg
img=ImageChops.add(img,guide)
img=ImageChops.add(img,sq.filter(ImageFilter.GaussianBlur(6)))
for blur,k in [(46,1.0),(20,1.0)]:
    img=ImageChops.add(img,ln.filter(ImageFilter.GaussianBlur(blur)))
img=ImageChops.add(img,ln)
hot=ln.point(lambda v:min(255,int(v*1.0)+ (60 if v>200 else 0)))
img=ImageChops.add(img,dots.filter(ImageFilter.GaussianBlur(22)))
img=ImageChops.add(img,dots)
img.resize((512,512),Image.LANCZOS).save('icon.png')
img.resize((180,180),Image.LANCZOS).save('icon-180.png')
img.resize((192,192),Image.LANCZOS).save('icon-192.png')
print('icons ok')
