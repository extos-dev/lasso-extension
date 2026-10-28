#!/usr/bin/env python3
"""Generates the self-authored fixture corpus (no copyrighted content) + expected.json. Run: python3 test/make-fixtures.py"""
import json, os, random
random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(OUT, exist_ok=True)
SENT = ["The harbor town woke slowly, as it always did when the fog refused to lift before nine.",
 "Marta kept a ledger of every tide, a habit inherited from a grandfather she never met.",
 "By midweek the numbers no longer matched the stories the fishermen told at the dock.",
 "Engineers measured the current twice, then a third time, hoping the instruments were wrong.",
 "Nothing in the municipal archive explained why the old lighthouse log stopped in the spring of that year.",
 "A small cooperative formed, fragile at first, then stubborn, then quietly indispensable.",
 "Critics called the plan sentimental; the accountants called it the cheapest option on the table.",
 "When the first shipment arrived, nobody cheered, but several people stayed late to unpack it.",
 "The report concluded that patience, not funding, had been the scarce resource all along."]
def para(n=3): return ' '.join(random.choice(SENT) for _ in range(n))
def paras(k, tag='p', cls=''): return '\n'.join(f'<{tag}{(" class=%s" % chr(34)+cls+chr(34)) if cls else ""}>{para(3)}</{tag}>' for _ in range(k))
def page(body, title='Fixture', head=''): return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>{head}</head><body>{body}</body></html>'
NAV = '<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/contact">Contact</a> <a href="/archive">Archive</a> <a href="/shop">Shop</a></nav>'
FOOT = '<footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> Subscribe to our newsletter FOOTERTEXT</footer>'
F, E = {}, {}

F['article-semantic'] = page(f'''<header><a href="/">The Harbor Ledger</a>{NAV}</header>
<main><article><h1>Counting the Tide</h1>
<p class="byline">By <a rel="author" href="/a/marta">Marta Quill</a> · <time datetime="2026-03-14">March 14, 2026</time></p>
<p><img src="/img/hero.jpg" alt="Harbor at dawn"></p>
{paras(3)}<h2>The numbers</h2>{paras(3)}<h2>The cooperative</h2>{paras(3)}
<ul><li>First lesson learned</li><li>Second lesson learned</li><li>Third lesson learned</li></ul>
<div class="lesson-cards"><a href="/lessons/one">Lesson card one</a><a href="/lessons/two">Lesson card two</a></div>
<pre><code class="language-js">function tide() {{
  return 1;
}}</code></pre>
<ul><li>Outer lesson<ul><li>Inner lesson one</li><li>Inner lesson two</li></ul></li><li>Another lesson</li></ul>
<blockquote>Patience was the scarce resource.</blockquote></article>
<aside class="related"><h3>Related</h3><a href="/r1">Related story one</a> <a href="/r2">Related story two</a> <a href="/r3">Related story three</a></aside></main>{FOOT}''', 'Counting the Tide | The Harbor Ledger',
 '<meta property="og:site_name" content="The Harbor Ledger">')
E['article-semantic'] = dict(pageKind='article', regions=[dict(kind='article', title='Counting the Tide', author='Marta Quill', mustContain=['The numbers', 'Patience was the scarce resource', '## The cooperative', '](https://example.test/lessons/one) [Lesson card two]', '```js\nfunction tide() {\n  return 1;\n}\n```', '  - Inner lesson one'], mustNotContain=['FOOTERTEXT', 'Related story one'])])

F['article-divsoup'] = page(f'''<div class="css-1x2y3z"><div class="sc-header">{NAV}</div>
<div class="sc-bdVaJa"><div class="_3xk9Qa"><div class="css-t1tle9">Why Ledgers Outlive Servers</div>
<div class="sc-author9"><span class="author">Dana Reed</span> <span class="date">Jan 5, 2026</span></div></div>
<div class="css-body88">{paras(6, 'div', 'css-p123abc')}</div></div>
<div class="sc-foot">{FOOT}</div></div>''', 'Why Ledgers Outlive Servers')
E['article-divsoup'] = dict(pageKind='article', regions=[dict(kind='article', mustContain=['harbor town woke slowly'], mustNotContain=['FOOTERTEXT'])])

HID = 'HIDDENDUP-unique-string'
F['article-banner-hidden'] = page(f'''<div class="cookie-banner"><p>Accept all cookies to continue browsing this wonderful site, we use them for everything imaginable.</p><button>Accept all cookies</button></div>
<article><h1>Quiet Infrastructure</h1><p class="byline">By Lee Park</p>{paras(5)}
<p style="display:none">{HID} {para(3)}</p><p hidden>{HID}-attr {para(3)}</p><p style="opacity:0">HIDDENOPACITY {para(3)}</p><p style="content-visibility:hidden">HIDDENCONTENT {para(3)}</p><div style="visibility:hidden">HIDDENVIS <span style="visibility:visible">VISIBLECHILD</span></div>{paras(2)}</article>{FOOT}''', 'Quiet Infrastructure')
E['article-banner-hidden'] = dict(pageKind='article', regions=[dict(kind='article', mustContain=['Quiet Infrastructure', 'VISIBLECHILD'], mustNotContain=['HIDDENDUP', 'HIDDENOPACITY', 'HIDDENCONTENT', 'HIDDENVIS', 'Accept all cookies', 'FOOTERTEXT'])])

F['article-modal'] = page(f'''<main class="px-4"><article><h1>When the Modal Opens</h1><p class="byline">By Rae Holt · <time datetime="2026-03-20">March 20, 2026</time></p>
{paras(5)}<h2>The hidden page</h2>{paras(4)}</article></main>{FOOT}''', 'When the Modal Opens').replace('<body>', '<body class="modal-open">')
E['article-modal'] = dict(pageKind='article', regions=[dict(kind='article', title='When the Modal Opens', mustContain=['The hidden page', 'harbor town woke slowly'], mustNotContain=['FOOTERTEXT'])])

rows = ''.join(f'<tr><td>Region {i}</td><td>{100+i*7}</td><td>{i*3.5:.1f}%</td><td>${i*120:,}</td></tr>' for i in range(1, 9))
F['table-semantic'] = page(f'''{NAV}<h1>Quarterly Figures</h1><p>Summary of regional output for the quarter, in thousands.</p>
<table><caption>Output by region</caption><thead><tr><th>Region</th><th>Units</th><th>Growth</th><th>Revenue</th></tr></thead><tbody>{rows}</tbody></table>{FOOT}''', 'Quarterly Figures')
E['table-semantic'] = dict(regions=[dict(kind='table', rows=8, cols=4, mustContain=['Region 3', 'Revenue'], mustNotContain=['FOOTERTEXT'])])

F['table-in-article'] = page(f'''<article><h1>The Cost of Patience</h1><p class="byline">By Sam Ortiz · <time datetime="2026-02-02">Feb 2, 2026</time></p>{paras(4)}
<table><thead><tr><th>Year</th><th>Cost</th><th>Saved</th></tr></thead><tbody><tr><td>2023</td><td>120</td><td>10</td></tr><tr><td>2024</td><td>110</td><td>25</td></tr><tr><td>2025</td><td>95</td><td>40</td></tr></tbody></table>{paras(3)}</article>''', 'The Cost of Patience')
E['table-in-article'] = dict(regions=[dict(kind='article', mustContain=['| Year | Cost | Saved |']), dict(kind='table', rows=3, cols=3, nestedIn='article')])

F['aria-grid'] = page(f'''<h1>Leaderboard</h1><div role="grid"><div role="row"><span role="columnheader">Player</span><span role="columnheader">Score</span><span role="columnheader">Level</span></div>
''' + ''.join(f'<div role="row"><span role="gridcell">Player{i}</span><span role="gridcell">{9000-i*37}</span><span role="gridcell">{i%5+1}</span></div>' for i in range(1, 8)) + '</div>', 'Leaderboard')
E['aria-grid'] = dict(regions=[dict(kind='table', rows=7, cols=3, mustContain=['Player4'])])

items = ''.join(f'<div class="css-card{i}x"><a href="/products/p{i}"><img src="/img/p{i}.jpg" alt="Product {i}"></a><h3 class="_t9Xq">Product Name {i}</h3><span class="sc-price1">${i*9+5}.99</span><a class="css-btn7" href="/products/p{i}">View</a></div>' for i in range(1, 13))
F['grid-products'] = page(f'''<header>{NAV}</header><h1>Shoes</h1><div class="css-grid88">{items}</div>{FOOT}''', 'Shoes - Shop')
E['grid-products'] = dict(pageKind='listing', regions=[dict(kind='record_list', count=12, flavor='product', mustContain=['Product Name 5', '$50.99'])])

posts = ''.join(f'<li class="post"><h2><a href="/blog/post-{i}">Post number {i}: notes from the dock</a></h2><time datetime="2026-0{i%9+1}-1{i%9}">Jan {i+1}, 2026</time><p>{para(2)}</p></li>' for i in range(1, 9))
F['blog-index'] = page(f'''{NAV}<h1>Blog</h1><ul class="posts">{posts}</ul>{FOOT}''', 'Blog')
E['blog-index'] = dict(pageKind='listing', regions=[dict(kind='record_list', count=8, mustContain=['Post number 4'])], forbidKinds=['article'])

F['login'] = page('''<div class="wrap"><h1>Sign in</h1><form action="/login"><label>Email <input type="email"></label><label>Password <input type="password"></label><button>Sign in</button></form><a href="/forgot">Forgot password?</a></div>''', 'Sign in')
E['login'] = dict(pageKind='login', regions=[], forbidKinds=['article', 'table', 'record_list'])

F['landing'] = page(f'''<header>{NAV}</header><section class="hero"><h1>Build faster</h1><p>The simplest way to ship your next idea.</p><a href="/signup" class="cta">Get started</a></section>
<section class="features"><div class="f"><h3>Fast</h3><p>Really fast.</p></div><div class="f"><h3>Simple</h3><p>Really simple.</p></div><div class="f"><h3>Safe</h3><p>Really safe.</p></div></section>{FOOT}''', 'Acme')
E['landing'] = dict(pageKind='landing', regions=[], forbidKinds=['article', 'table'])

for k, v in F.items(): open(os.path.join(OUT, k + '.html'), 'w').write(v)
json.dump(E, open(os.path.join(OUT, 'expected.json'), 'w'), indent=2)
print(len(F), 'fixtures')
