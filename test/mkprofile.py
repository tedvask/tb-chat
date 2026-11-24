"""Build a throw-away Thunderbird profile with a POP3 account on localhost and a few test threads."""
import os
import sys
import time
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from datetime import datetime, timedelta, timezone

PROFILE, SPOOL = sys.argv[1], sys.argv[2]
POP_PORT, SMTP_PORT = int(sys.argv[3]), int(sys.argv[4])
FILLER = int(sys.argv[5]) if len(sys.argv) > 5 else 0

ME = "Peter Test <me@example.test>"
ANNA = "Анна Петрова <anna@example.test>"
BORIS = "Boris Smith <boris@corp.example>"
NOW = datetime.now(timezone.utc).astimezone()


def ago(**kw):
    return NOW - timedelta(**kw)


def msg(frm, to, subject, when, mid, text=None, html=None, cc=None, refs=(), attach=None):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = frm, to, subject
    if cc:
        m["Cc"] = cc
    m["Date"] = format_datetime(when)
    m["Message-ID"] = mid
    if refs:
        m["In-Reply-To"] = refs[-1]
        m["References"] = " ".join(refs)
    if text is not None:
        m.set_content(text)
        if html is not None:
            m.add_alternative(html, subtype="html")
    elif html is not None:
        m.set_content(html, subtype="html")
    if attach:
        m.add_attachment(attach[1], maintype="application", subtype="pdf", filename=attach[0])
    return m


def mbox(path, msgs):
    with open(path, "wb") as f:
        for m in msgs:
            f.write(b"From - " + time.strftime("%a %b %d %H:%M:%S %Y").encode() + b"\n")
            f.write(b"X-Mozilla-Status: " + (b"0001" if getattr(m, "seen", False) else b"0000") + b"\nX-Mozilla-Status2: 00000000\n")
            body = m.as_bytes().replace(b"\r\n", b"\n")
            f.write(body.replace(b"\nFrom ", b"\n>From ") + b"\n\n")


a = [f"<a{i}@example.test>" for i in range(8)]
SUBJ = "Поставка оборудования"
A1 = msg(ANNA, ME, SUBJ, ago(days=3, hours=2), a[1],
         text="Пётр, добрый день!\n\nКогда сможете подтвердить поставку? Нам нужно 12 стоек и два коммутатора.\nПодробности тут: https://example.test/order/4412\n\nС уважением,\nАнна\n-- \nАнна Петрова\nОтдел закупок\n")
A2 = msg(ME, ANNA, "Re: " + SUBJ, ago(days=3, hours=1), a[2], refs=[a[1]],
         text="Анна, здравствуйте.\n\nПодтверждаю, отгрузим в четверг.\n\nOn Mon, 21 Nov 2026 at 10:12, Анна Петрова <anna@example.test> wrote:\n> Пётр, добрый день!\n>\n> Когда сможете подтвердить поставку? Нам нужно 12 стоек и два коммутатора.\n> Подробности тут: https://example.test/order/4412\n")
A3 = msg(ANNA, ME, "Re: " + SUBJ, ago(days=2, hours=5), a[3], cc=BORIS, refs=[a[1], a[2]],
         text="Отлично, спасибо! Добавила Бориса — он примет груз на складе.\n\nпн, 21 нояб. 2026 г. в 11:30, Peter Test <me@example.test>:\n> Анна, здравствуйте.\n> Подтверждаю, отгрузим в четверг.\n",
         html='<div dir="ltr">Отлично, спасибо! Добавила <b>Бориса</b> — он примет груз на складе.</div><br>'
              '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">пн, 21 нояб. 2026 г. в 11:30, Peter Test &lt;<a href="mailto:me@example.test">me@example.test</a>&gt;:<br></div>'
              '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">Анна, здравствуйте.<br>Подтверждаю, отгрузим в четверг.</blockquote></div>')
A4 = msg(BORIS, ME, "RE: " + SUBJ, ago(days=1, hours=3), a[4], cc=ANNA, refs=[a[1], a[2], a[3]],
         html='<html><head><style>p.MsoNormal{margin:0;font-family:Calibri;color:red} div{border:3px solid red}</style></head><body lang="EN-US">'
              '<div class="WordSection1"><p class="MsoNormal">Hi all,</p><p class="MsoNormal">The dock is free on Thursday after 14:00. Waybill template attached.</p>'
              '<p class="MsoNormal">Boris</p>'
              '<div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal"><b>From:</b> Анна Петрова &lt;anna@example.test&gt;<br>'
              '<b>Sent:</b> Tuesday, November 22, 2026 9:12 AM<br><b>To:</b> Peter Test &lt;me@example.test&gt;<br><b>Subject:</b> Re: Поставка оборудования</p></div></div>'
              '<p class="MsoNormal">Отлично, спасибо! Добавила Бориса — он примет груз на складе.</p></div></body></html>',
         attach=("waybill-template.pdf", b"%PDF-1.4\n% test\n" + b"x" * 3000))
A5 = msg(ME, f"{ANNA}, {BORIS}", "Re: " + SUBJ, ago(hours=20), a[5], refs=[a[1], a[2], a[3], a[4]],
         text="Борис, принято: приедем в четверг к 14:30.\nМашина одна, номер пришлю утром.\n\n-----Original Message-----\nFrom: Boris Smith <boris@corp.example>\nSent: Tuesday\nSubject: RE: Поставка оборудования\n\nHi all,\nThe dock is free on Thursday after 14:00.\n")
A6 = msg(ANNA, f"{ME}, {BORIS}", "Re: " + SUBJ, NOW, a[6], refs=[a[1], a[2], a[3], a[4], a[5]],
         html='<div dir="ltr">Коллеги, груз получен, всё в порядке. Спасибо!</div><br><div class="gmail_quote"><blockquote class="gmail_quote">Борис, принято: приедем в четверг к 14:30.</blockquote></div>')
X1 = msg("Stranger <x@other.example>", ME, "Re: " + SUBJ, ago(days=2), "<x1@other.example>", refs=["<zzz@other.example>"],
         text="Это совсем другая переписка с той же темой.\n")
N1 = msg("Shop News <news@shop.example>", ME, "Скидки недели", ago(days=1), "<n1@shop.example>",
         html="<table width='600'><tr><td><h1>Скидки</h1><p>Только на этой неделе.</p></td></tr></table>")
C1 = msg(ANNA, ME, "Встреча в четверг", ago(hours=9), "<c1@example.test>", text="Пётр, в четверг в 10 удобно?\n")
C2 = msg(ANNA, ME, "Re: Встреча в четверг", ago(hours=7), "<c2@example.test>", refs=["<c1@example.test>"],
         text="И ещё: захватите, пожалуйста, договор.\n\n> Пётр, в четверг в 10 удобно?\n")
C3 = msg(ME, ANNA, "Re: Встреча в четверг", ago(hours=6), "<c3@example.test>", refs=["<c1@example.test>", "<c2@example.test>"],
         text="Да, в 10 подходит. Договор возьму.\n")

# A long conversation with a bot; the mail gateway puts "[EXT]" in front of "RE:".
BOT = "Report Bot <bot@agents.example>"
ESUBJ = "Price watch — алерты"
e_inbox, e_sent = [], []
for i in range(120):
    when = ago(hours=2 * (120 - i))
    refs = [] if i == 0 else ["<e0@agents.example>"] + (["<e%d@agents.example>" % (i - 1)] if i > 1 else [])
    if i and i % 9 == 0:
        m = msg(ME, BOT, "Re: [EXT] RE: " + ESUBJ, when, "<e%d@agents.example>" % i, refs=refs,
                text="Принял, алерт %d посмотрел.\n\nOn Mon, the bot wrote:\n> Алерт %d\n" % (i, i - 1))
        m.seen = True
        e_sent.append(m)
    else:
        if i % 2:
            # like the real bot: long plain-text reports; TBCHAT_BIG=<MB> hangs a big attachment on one of them
            big = int(os.environ.get("TBCHAT_BIG", "2"))
            m = msg(BOT, ME, "[EXT] RE: " + ESUBJ, when, "<e%d@agents.example>" % i, refs=refs,
                    text="Алерт %d: отчёт\n" % i + "".join("строка %d отчёта по алерту %d, показатель %d\n" % (k, i, k * i) for k in range(1, 40 + i % 50)),
                    attach=("dump.zip", os.urandom(big << 20)) if big and i == 115 else None)
        else:
            m = msg(BOT, ME, ("[EXT] RE: " if i else "[EXT] ") + ESUBJ, when, "<e%d@agents.example>" % i, refs=refs,
                    html="<div>Алерт %d: цена <b>%d ₽</b>, подробности <a href=\"https://example.test/alert/%d\">здесь</a>.</div>"
                         "<div class=\"moz-cite-prefix\">On Mon, Peter wrote:<br></div><blockquote type=\"cite\">Принял.</blockquote>" % (i, 1000 + i, i))
        m.seen = i < 95
        e_inbox.append(m)

# A rich HTML mail: table, picture inside the mail, remote picture, things that must not survive.
PNG = __import__("base64").b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
H1 = msg(ANNA, ME, "Отчёт за квартал", ago(hours=5), "<h1@example.test>",
         html='<html><head><style>p{color:red} td{background:#ffeecc;padding:4px}</style><script>window.pwned=1</script></head><body>'
              '<p onclick="window.pwned=2">Пётр, вот <b>сводка</b> и <a href="https://example.test/report?q=3">полный отчёт</a>.</p>'
              '<table border="1"><tr><td>Выручка</td><td>120</td></tr><tr><td>Расходы</td><td>80</td></tr></table>'
              '<p><img src="cid:chart1@example.test" width="40" height="20" alt="chart"> <img src="http://127.0.0.1:9/pixel.png" alt="remote"></p>'
              '<iframe src="https://example.test/x"></iframe><a href="javascript:alert(1)">bad</a></body></html>')
H1.add_related(PNG, maintype="image", subtype="png", cid="<chart1@example.test>")
H1.seen = True
H2 = msg(ME, ANNA, "Re: Отчёт за квартал", ago(hours=4), "<h2@example.test>", refs=["<h1@example.test>"], text="Спасибо, посмотрю.\n")
H2.seen = True

# A conversation in the first account whose incoming mail also names the address
# of the second account: replies must still leave from the first one.
ME2 = "Peter Work <me2@work.example>"
G1 = msg(BOT, f"{ME2}, {ME}", "Проект Феникс", ago(hours=30), "<g1@agents.example>", text="Начинаем проект.\n")
G2 = msg(ME, BOT, "Re: Проект Феникс", ago(hours=29), "<g2@agents.example>", refs=["<g1@agents.example>"], text="Хорошо, жду план.\n")
G3 = msg(BOT, ME2, "Re: Проект Феникс", ago(hours=28), "<g3@agents.example>", cc=ME, refs=["<g1@agents.example>", "<g2@agents.example>"], text="План во вложении нет, пришлю завтра.\n")
for m in (G1, G2, G3):
    m.seen = True

# A reply written between the quotes, composed with the ReplyWithHeader add-on.
QSTYLE = 'style="border:none !important; padding-left:0px !important; margin-left:0px !important;"'
LONG = "\n".join("строка %d исходного письма, довольно длинная, чтобы цитата не поместилась целиком" % k for k in range(1, 9))
I1 = msg(BOT, ME, "План миграции", ago(hours=3), "<i1@agents.example>", text="Шаг первый: копируем базу.\n" + LONG + "\nШаг второй: переключаем трафик.\n")
I2 = msg(ME, BOT, "Re: План миграции", ago(hours=2), "<i2@agents.example>", refs=["<i1@agents.example>"],
         html='<html><body><p></p><div class="moz-signature">-- <br>F</div><div class="moz-cite-prefix"><br><div id="rwhHeaders" style="border-top:solid #B5C4DF 1.0pt">'
              '<p>From: Report Bot</p><p>Sent: Tuesday</p><p>To: Peter</p><p>Subject: План миграции</p></div><br></div>'
              '<blockquote type="cite" %s><pre wrap="" class="moz-quote-pre">Шаг первый: копируем базу.\n%s</pre></blockquote>'
              'А сколько это займёт времени:<br><br>'
              '<blockquote type="cite" %s><pre wrap="" class="moz-quote-pre">Шаг второй: переключаем трафик.</pre></blockquote>'
              'Здесь согласен.<br>'
              '<blockquote type="cite" %s><pre wrap="" class="moz-quote-pre">остаток исходного письма</pre></blockquote></body></html>' % (QSTYLE, LONG, QSTYLE, QSTYLE))
for m in (I1, I2):
    m.seen = True

os.makedirs(SPOOL, exist_ok=True)
with open(os.path.join(SPOOL, "a6.eml"), "wb") as f:
    f.write(A6.as_bytes())

acct = os.path.join(PROFILE, "Mail", "127.0.0.1")
local = os.path.join(PROFILE, "Mail", "Local Folders")
os.makedirs(acct, exist_ok=True)
os.makedirs(local, exist_ok=True)
mbox(os.path.join(acct, "Inbox"), [A1, X1, A3, N1, A4, C1, C2, H1, G1, G3, I1] + e_inbox)
mbox(os.path.join(acct, "Sent"), [A2, A5, C3, H2, G2, I2] + e_sent)
work = os.path.join(PROFILE, "Mail", "localhost")
os.makedirs(work, exist_ok=True)
for name in ("Inbox", "Sent", "Trash"):
    open(os.path.join(work, name), "wb").close()
for name in ("Trash", "Drafts"):
    open(os.path.join(acct, name), "wb").close()
for name in ("Trash", "Unsent Messages"):
    open(os.path.join(local, name), "wb").close()
if FILLER:
    fill = []
    for i in range(FILLER):
        fill.append(msg(f"Bot {i % 50} <bot{i % 50}@tickets.example>", ME, f"[Ticket #{100000 + i}] Status update {i % 7}",
                        ago(days=5 + i % 400, minutes=i % 60), f"<t{i}@tickets.example>", text=f"Ticket body {i}\n"))
    mbox(os.path.join(acct, "Tickets"), fill)

prefs = {
    "mail.shell.checkDefaultClient": False,
    "mail.provider.suppress_dialog_on_startup": True,
    "mail.spotlight.firstRunDone": True,
    "mail.winsearch.firstRunDone": True,
    "mailnews.start_page.enabled": False,
    "mailnews.start_page_override.mstone": "ignore",
    "mail.rights.version": 1,
    "app.update.auto": False,
    "app.update.enabled": False,
    "app.donation.eoy.version.viewed": 99,
    "mail.inappnotifications.enabled": False,
    "datareporting.policy.dataSubmissionPolicyBypassNotification": True,
    "datareporting.healthreport.uploadEnabled": False,
    "toolkit.telemetry.reportingpolicy.firstRun": False,
    "browser.shell.checkDefaultBrowser": False,
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 5,
    "extensions.update.enabled": False,
    "xpinstall.signatures.required": False,
    "devtools.chrome.enabled": True,
    "browser.dom.window.dump.enabled": True,
    "mail.biff.show_alert": False,
    "mail.biff.play_sound": False,
    "mail.biff.use_system_alert": False,
    "mailnews.database.global.indexer.enabled": False,
    "calendar.timezone.local": "Europe/Vilnius",
    "calendar.integration.notify": False,
    "mail.accountmanager.accounts": "account3,account1,account2",
    "mail.accountmanager.defaultaccount": "account3",
    "mail.accountmanager.localfoldersserver": "server2",
    "mail.account.account1.server": "server1",
    "mail.account.account1.identities": "id1",
    "mail.account.account2.server": "server2",
    "mail.account.account3.server": "server3",
    "mail.account.account3.identities": "id2",
    "mail.server.server3.type": "pop3",
    "mail.server.server3.hostname": "localhost",
    "mail.server.server3.port": POP_PORT,
    "mail.server.server3.userName": "work",
    "mail.server.server3.socketType": 0,
    "mail.server.server3.authMethod": 3,
    "mail.server.server3.name": "me2@work.example",
    "mail.server.server3.directory-rel": "[ProfD]Mail/localhost",
    "mail.server.server3.check_new_mail": False,
    "mail.server.server3.login_at_startup": False,
    "mail.identity.id2.fullName": "Peter Work",
    "mail.identity.id2.useremail": "me2@work.example",
    "mail.identity.id2.valid": True,
    "mail.identity.id2.smtpServer": "smtp1",
    "mail.identity.id2.fcc": True,
    "mail.identity.id2.fcc_folder": "mailbox://work@localhost/Sent",
    "mail.identity.id2.fcc_folder_picker_mode": "1",
    "mail.identity.id2.compose_html": True,
    "mail.server.server1.type": "pop3",
    "mail.server.server1.hostname": "127.0.0.1",
    "mail.server.server1.port": POP_PORT,
    "mail.server.server1.userName": "me",
    "mail.server.server1.socketType": 0,
    "mail.server.server1.authMethod": 3,
    "mail.server.server1.name": "me@example.test",
    "mail.server.server1.directory-rel": "[ProfD]Mail/127.0.0.1",
    "mail.server.server1.check_new_mail": False,
    "mail.server.server1.login_at_startup": False,
    "mail.server.server1.download_on_biff": True,
    "mail.server.server1.leave_on_server": False,
    "mail.server.server2.type": "none",
    "mail.server.server2.hostname": "Local Folders",
    "mail.server.server2.userName": "nobody",
    "mail.server.server2.name": "Local Folders",
    "mail.server.server2.directory-rel": "[ProfD]Mail/Local Folders",
    "mail.identity.id1.fullName": "Peter Test",
    "mail.identity.id1.useremail": "me@example.test",
    "mail.identity.id1.valid": True,
    "mail.identity.id1.smtpServer": "smtp1",
    "mail.identity.id1.fcc": True,
    "mail.identity.id1.fcc_folder": "mailbox://me@127.0.0.1/Sent",
    "mail.identity.id1.fcc_folder_picker_mode": "1",
    "mail.identity.id1.reply_on_top": 1,
    "mail.identity.id1.compose_html": True,
    "mail.identity.id1.htmlSigText": "Peter Test, signature",
    "mail.smtpservers": "smtp1",
    "mail.smtp.defaultserver": "smtp1",
    "mail.smtpserver.smtp1.hostname": "127.0.0.1",
    "mail.smtpserver.smtp1.port": SMTP_PORT,
    "mail.smtpserver.smtp1.authMethod": 1,
    "mail.smtpserver.smtp1.try_ssl": 0,
    "mail.smtpserver.smtp1.type": "smtp",
    "mail.smtpserver.smtp1.username": "",
}
with open(os.path.join(PROFILE, "user.js"), "w") as f:
    for k, v in prefs.items():
        val = "true" if v is True else "false" if v is False else v if isinstance(v, int) else '"%s"' % v
        f.write(f'user_pref("{k}", {val});\n')
print("profile ready", PROFILE)
