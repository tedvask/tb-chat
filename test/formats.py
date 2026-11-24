"""Quote trimming against typical markup of other mail programs (samples written by hand, not captured mail).
usage: test/start.sh <dir>; python3 test/formats.py"""
import glob, json, sys, time
sys.path.insert(0, "test")
from h import *

OLD = "OLDTEXT previous message body that must not be shown."
def outlook_classic(frm, sent, to, subj, pad="0cm"):
    return ('<html><head><style>p.MsoNormal{margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif}</style></head><body lang="EN-US" link="#0563C1">'
            '<div class="WordSection1"><p class="MsoNormal">NEW reply text.<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>'
            '<div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt %s %s %s"><p class="MsoNormal">'
            '<b>%s</b> Anna Petrova &lt;anna@example.test&gt; <br><b>%s</b> Monday, November 23, 2026 10:12 AM<br><b>%s</b> Peter &lt;me@example.test&gt;<br><b>%s</b> RE: Delivery<o:p></o:p></p></div></div>'
            '<p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal">%s<o:p></o:p></p></div></body></html>') % (pad, pad, pad, frm, sent, to, subj, OLD)

S = []
def add(name, html, want="NEW reply text."):
    S.append({"name": name, "html": html, "want": want})

add("Outlook classic (Windows), English", outlook_classic("From:", "Sent:", "To:", "Subject:"))
add("Outlook classic, Russian", outlook_classic("От:", "Отправлено:", "Кому:", "Тема:"))
add("Outlook classic, German", outlook_classic("Von:", "Gesendet:", "An:", "Betreff:"))
add("Outlook classic, French", outlook_classic("De :", "Envoyé :", "À :", "Objet :"))
add("Outlook classic, Spanish", outlook_classic("De:", "Enviado el:", "Para:", "Asunto:"))
add("Outlook classic, Italian", outlook_classic("Da:", "Inviato:", "A:", "Oggetto:"))
add("Outlook classic, Polish", outlook_classic("Od:", "Wysłano:", "Do:", "Temat:"))
add("Outlook classic, Lithuanian", outlook_classic("Nuo:", "Išsiųsta:", "Kam:", "Tema:"))
add("Outlook new / web (OWA)",
    '<html><head><style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style></head><body dir="ltr">'
    '<div class="elementToProof" style="font-family: Aptos, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">NEW reply text.</div>'
    '<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1">'
    '<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>Nuo:</b> Anna &lt;anna@example.test&gt;<br><b>Išsiųsta:</b> 2026 m. lapkričio 23 d.<br><b>Kam:</b> Peter<br><b>Tema:</b> Re: x</font><div>&nbsp;</div></div>'
    '<div>' + OLD + '</div></body></html>')
add("Outlook mobile (iOS/Android)",
    '<html><head></head><body><div dir="ltr">NEW reply text.</div><div id="ms-outlook-mobile-signature"><div><br></div>Get <a href="https://aka.ms/o0ukef">Outlook for iOS</a></div>'
    '<hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> Anna<br><b>Sent:</b> Monday<br><b>To:</b> F<br><b>Subject:</b> Re: x</font><div>&nbsp;</div></div>'
    '<div>' + OLD + '</div></body></html>')
add("Outlook mobile, newer markup",
    '<html><body><div dir="ltr">NEW reply text.</div><div id="mail-editor-reference-message-container"><div class="ms-outlook-mobile-reference-message skipProofing">'
    '<b>From:</b> Anna<br><b>Date:</b> Monday<br><b>To:</b> F<br><b>Subject:</b> Re: x</div><div>' + OLD + '</div></div></body></html>')
add("Outlook for Mac",
    '<html><body><div class="WordSection1"><p class="MsoNormal">NEW reply text.</p></div>'
    '<span id="OLK_SRC_BODY_SECTION"><div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in"><p class="MsoNormal"><b>From: </b>Anna<br><b>Date: </b>Monday<br><b>To: </b>F<br><b>Subject: </b>Re: x</p></div><div>' + OLD + '</div></span></body></html>')
add("Outlook: comments written inside the old text",
    outlook_classic("From:", "Sent:", "To:", "Subject:").replace("NEW reply text.", "See my answers below in red.").replace(OLD, 'Question one? <span style="color:red">INLINE answer one.</span>'),
    want="See my answers below in red. … INLINE answer one.")
add("Gmail web",
    '<div dir="ltr">NEW reply text.</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Mon, Nov 23, 2026 at 10:12 AM Anna &lt;<a href="mailto:anna@example.test">anna@example.test</a>&gt; wrote:<br></div>'
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr">' + OLD + '</div></blockquote></div>')
add("Gmail with signature",
    '<div dir="ltr">NEW reply text.<div><br clear="all"><div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">Anna<br>ACME Ltd</div></div></div></div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">2026-11-23, pr, 10:12 Anna &lt;anna@example.test&gt; rašė:<br></div>'
    '<blockquote class="gmail_quote">' + OLD + '</blockquote></div>')
add("Apple Mail (macOS)",
    '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;">NEW reply text.<br id="lineBreakAtBeginningOfMessage"><div><br><blockquote type="cite"><div>On 23 Nov 2026, at 10:12, Anna &lt;anna@example.test&gt; wrote:</div><br class="Apple-interchange-newline"><div><div>' + OLD + '</div></div></blockquote></div><br></body></html>')
add("Apple Mail (iPhone)",
    '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body dir="auto">NEW reply text.<br><br><div dir="ltr">Sent from my iPhone</div><div dir="ltr"><br><blockquote type="cite">On 23 Nov 2026, at 10:12, Anna &lt;anna@example.test&gt; wrote:<br><br></blockquote></div><blockquote type="cite"><div dir="ltr">' + OLD + '</div></blockquote></body></html>',
    want="NEW reply text. Sent from my iPhone")
add("Yahoo Mail",
    '<html><head></head><body><div class="ydp7a1c4f3yahoo-style-wrap" style="font-family:Helvetica Neue, Helvetica, Arial, sans-serif;font-size:13px;"><div dir="ltr">NEW reply text.</div><div><br></div></div>'
    '<div id="yahoo_quoted_4179261545" class="yahoo_quoted"><div style="font-family:\'Helvetica Neue\', Helvetica, Arial, sans-serif;font-size:13px;color:#26282a;"><div>On Monday, November 23, 2026 at 10:12:00 AM GMT+2, Anna &lt;anna@example.test&gt; wrote:</div><div><br></div><div><br></div><div>' + OLD + '</div></div></div></body></html>')
add("Proton Mail",
    '<div style="font-family: Arial, sans-serif; font-size: 14px;">NEW reply text.</div><div class="protonmail_quote">On Monday, November 23rd, 2026 at 10:12, Anna &lt;anna@example.test&gt; wrote:<br><blockquote class="protonmail_quote" type="cite">' + OLD + '</blockquote><br></div>')
add("Thunderbird, reply above the quote",
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><p>NEW reply text.</p><div class="moz-cite-prefix">On 23/11/2026 10:12, Anna wrote:<br></div><blockquote type="cite" cite="mid:x@example.test">' + OLD + '</blockquote></body></html>')
add("Thunderbird, reply below the quote",
    '<html><body><div class="moz-cite-prefix">On 23/11/2026 10:12, Anna wrote:<br></div><blockquote type="cite" cite="mid:x@example.test">Short question?</blockquote><p>NEW reply text.</p><div class="moz-signature">-- <br>F</div></body></html>',
    want="Short question? NEW reply text.")
add("Thunderbird, replies between quotes",
    '<html><body><div class="moz-cite-prefix">On 23/11/2026 10:12, Anna wrote:<br></div><blockquote type="cite">Question one?</blockquote><p>Answer one.</p><blockquote type="cite">Question two?</blockquote><p>Answer two.</p><blockquote type="cite">Regards, Anna</blockquote></body></html>',
    want="Question one? Answer one. Question two? Answer two.")
add("Thunderbird + ReplyWithHeader",
    '<html><body><p>NEW reply text.</p><div class="moz-cite-prefix"><br><div id="rwhHeaders" style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0cm 0cm 0cm"><b>From:</b> Anna<br><b>Sent:</b> Monday<br><b>To:</b> F<br><b>Subject:</b> Re: x</div><br></div><blockquote type="cite" style="border:none !important; padding-left:0 !important">' + OLD + '</blockquote></body></html>')

T = [
 ("plain: Thunderbird/Gmail '>' quote", "NEW reply text.\n\nOn 23/11/2026 10:12, Anna wrote:\n> " + OLD + "\n> more\n", "NEW reply text."),
 ("plain: Outlook 'Original Message'", "NEW reply text.\n\n-----Original Message-----\nFrom: Anna\nSent: Monday\nTo: F\nSubject: RE: x\n\n" + OLD, "NEW reply text."),
 ("plain: Outlook header block", "NEW reply text.\n\nFrom: Anna <anna@example.test>\nSent: Monday, November 23, 2026 10:12 AM\nTo: F\nSubject: RE: x\n\n" + OLD, "NEW reply text."),
 ("plain: Outlook header block, Lithuanian", "NEW reply text.\n\nNuo: Anna <anna@example.test>\nIšsiųsta: 2026 m. lapkričio 23 d. 10:12\nKam: F\nTema: RE: x\n\n" + OLD, "NEW reply text."),
 ("plain: Lithuanian attribution + '>'", "NEW reply text.\n\n2026-11-23 10:12, Anna rašė:\n> " + OLD + "\n", "NEW reply text."),
]

tb = TB()
tb.install(glob.glob("dist/*.xpi")[0]); time.sleep(1.5)
res = tb.bg("""
  const { prepareHtml } = await import("/lib/html.js");
  const { chatText } = await import("/lib/text.js");
  const S = %s, T = %s;
  const norm = s => s.replace(/\\s+/g, " ").trim();
  const out = [];
  for (const s of S) {
    const r = prepareHtml(s.html);
    const d = new DOMParser().parseFromString(r.html, "text/html");
    out.push([s.name, norm(d.body.textContent), s.want]);
  }
  for (const [name, text, want] of T) out.push([name, norm(chatText(text)), want]);
  return out;
""" % (json.dumps(S), json.dumps(T)))
bad = 0
for name, got, want in res:
    ok = got.replace(" ", "") == want.replace(" ", "")
    bad += not ok
    print(("ok    " if ok else "DIFF  ") + name + ("" if ok else "\n        got: " + got[:230]))
print("%d of %d as expected" % (len(res) - bad, len(res)))
