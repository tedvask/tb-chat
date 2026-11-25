import test from "node:test";
import assert from "node:assert/strict";
import { baseSubject, chatText, isForward, parseMessageIds, stripSubjectPrefixes, unflow } from "../src/lib/text.js";

test("subject prefixes", () => {
  assert.equal(baseSubject("Re: RE: Fwd: Поставка  оборудования"), "поставка оборудования");
  assert.equal(baseSubject("Отв: AW: Hello"), "hello");
  assert.equal(baseSubject("Re[2]: Hello"), "hello");
  assert.equal(stripSubjectPrefixes("RE: Re: [repo] Fix (#12)"), "[repo] Fix (#12)");
  assert.equal(baseSubject("Reply needed: today"), "reply needed: today");
  assert.equal(isForward("Fwd: x"), true);
  assert.equal(isForward("Re: Fwd: x"), true);
  assert.equal(isForward("Re: x"), false);
});

test("gateway tag in front of the reply prefix", () => {
  const variants = ["[EXT] Price watch — алерты", "[EXT] RE: Price watch — алерты", "Re: [EXT] RE: Price watch — алерты", "Price watch — алерты", "[EXT] RE: [EXT] RE: Price watch — алерты"];
  for (const v of variants) {
    assert.equal(baseSubject(v), "price watch — алерты", v);
    assert.equal(stripSubjectPrefixes(v), "Price watch — алерты", v);
  }
});

test("list tags stay part of the conversation", () => {
  assert.equal(baseSubject("RE: [Ticket #7] Status update"), "[ticket #7] status update");
  assert.notEqual(baseSubject("[Ticket #7] Status update"), baseSubject("[Ticket #8] Status update"));
  assert.equal(stripSubjectPrefixes("[EXT] RE: [Ticket #7] Status update"), "[Ticket #7] Status update");
  assert.equal(baseSubject("[org/repo] Re: [org/repo] Fix (#12)"), "[org/repo] fix (#12)");
  assert.equal(baseSubject("[draft]"), "[draft]");
  assert.equal(baseSubject(""), "");
});

test("message ids", () => {
  assert.deepEqual(parseMessageIds("<a@b>\n <c@d>"), ["a@b", "c@d"]);
  assert.deepEqual(parseMessageIds(undefined), []);
});

test("top-posted reply with > quote and attribution", () => {
  const t = "Подтверждаю, отгрузим в четверг.\n\nOn Mon, 21 Nov 2026 at 10:12, Анна <anna@example.test> wrote:\n> Когда?\n>\n> Спасибо\n";
  assert.equal(chatText(t), "Подтверждаю, отгрузим в четверг.");
});

test("gmail russian attribution (ends with colon, no 'wrote')", () => {
  const t = "Отлично!\n\nпн, 21 нояб. 2026 г. в 11:30, Peter Test <me@example.test>:\n> Анна, здравствуйте.\n> Подтверждаю.\n";
  assert.equal(chatText(t), "Отлично!");
});

test("attribution wrapped onto two lines", () => {
  const t = "Ok.\n\nOn Mon, 21 Nov 2026 at 10:12, Somebody With A Long Name\n<somebody@example.test> wrote:\n> q\n";
  assert.equal(chatText(t), "Ok.");
});

test("a normal line ending with colon is kept when no quote follows", () => {
  const t = "Список:\n- раз\n- два\n\nИтого:";
  assert.equal(chatText(t), t);
});

test("outlook header block", () => {
  const t = "Hi all,\nThe dock is free.\n\nFrom: Anna <anna@example.test>\nSent: Tuesday, November 22, 2026 9:12 AM\nTo: Peter\nSubject: Re: x\n\nOld text";
  assert.equal(chatText(t), "Hi all,\nThe dock is free.");
});

test("outlook header block, russian, with ruler", () => {
  const t = "Принято.\n\n________________________________\nОт: Анна\nОтправлено: 22 ноября 2026 г. 9:12\nКому: Пётр\nТема: Re: x\n\nСтарый текст";
  assert.equal(chatText(t), "Принято.");
});

test("original message marker", () => {
  const t = "Принято.\n\n-----Original Message-----\nFrom: Boris\n\nHi";
  assert.equal(chatText(t), "Принято.");
});

test("'From:' inside normal text is not a reply header", () => {
  const t = "From: the desk of nobody\nJust a line.\nAnother.";
  assert.equal(chatText(t), t);
});

test("inline replies keep the quotes in the middle", () => {
  const t = "> Когда?\nВ четверг.\n\n> Сколько?\nДвенадцать.\n\n> Спасибо";
  assert.equal(chatText(t), "> Когда?\nВ четверг.\n\n> Сколько?\nДвенадцать.");
});

test("signature is dropped", () => {
  const t = "Добрый день!\n\nС уважением,\nАнна\n-- \nАнна Петрова\nОтдел закупок";
  assert.equal(chatText(t), "Добрый день!\n\nС уважением,\nАнна");
});

test("forwarded message keeps everything", () => {
  const t = "FYI\n\n-------- Forwarded Message --------\nFrom: A\nDate: today\nSubject: x\nTo: B\n\nBody";
  assert.equal(chatText(t, { forward: true }), t);
});

test("only quotes -> falls back to the full text", () => {
  const t = "> a\n> b";
  assert.equal(chatText(t), t);
});

test("format=flowed: paragraphs and quotes are joined again", () => {
  const sent =
    "> When can you confirm the delivery? We need twelve racks and two \r\n" +
    "> switches, and a long tail so that the line does not fit into \r\n" +
    "> seventy-two characters.\r\n" +
    "> Details here\r\n" +
    "On Thursday, as agreed, and this answer is long enough to be wrapped by \r\n" +
    "the mail program as well.\r\n" +
    "\r\n" +
    "-- \r\n" +
    "Peter\r\n";
  assert.equal(
    unflow(sent),
    "> When can you confirm the delivery? We need twelve racks and two switches, and a long tail so that the line does not fit into seventy-two characters.\n" +
      "> Details here\n" +
      "On Thursday, as agreed, and this answer is long enough to be wrapped by the mail program as well.\n\n-- \nPeter\n"
  );
  assert.equal(
    chatText(sent),
    "> When can you confirm the delivery? We need twelve racks and two switches, and a long tail so that the line does not fit into seventy-two characters.\n" +
      "> Details here\n" +
      "On Thursday, as agreed, and this answer is long enough to be wrapped by the mail program as well."
  );
});

test("format=flowed: a typed '>' (space-stuffed) reads as a quote, quote levels stay apart", () => {
  const sent = " > a line typed by hand that is long enough to be wrapped by the program \nand continues here\n>> deeper \n> shallower\nplain\n";
  assert.equal(unflow(sent), "> a line typed by hand that is long enough to be wrapped by the program and continues here\n>> deeper \n> shallower\nplain\n");
});

test("text that is not flowed is left as it is", () => {
  const t = "Short line \nnext line\n  indented\n> quote \n> more";
  assert.equal(unflow(t), t);
});
