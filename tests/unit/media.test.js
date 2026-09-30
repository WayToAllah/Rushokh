// public/media.js: تحويل روابط الفيديو والكتب لعرض جوه الموقع
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { embedFor } = require("../../public/media");

describe("روابط يوتيوب", () => {
  for (const [label, url, src] of [
    ["فيديو عادي", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"],
    ["رابط مختصر", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"],
    ["شورتس", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"],
    ["موبايل", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"],
    ["بوقت بداية", "https://youtu.be/dQw4w9WgXcQ?t=1m30s", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=90"],
    ["قائمة تشغيل", "https://www.youtube.com/playlist?list=PL1234567890", "https://www.youtube.com/embed/videoseries?rel=0&list=PL1234567890"],
  ]) {
    it(label, () => assert.deepEqual(embedFor(url), { kind: "iframe", src, ratio: "video" }));
  }
});

describe("روابط تانية", () => {
  it("Google Drive", () => {
    assert.equal(embedFor("https://drive.google.com/file/d/abcDEF123_-x/view?usp=sharing").src, "https://drive.google.com/file/d/abcDEF123_-x/preview");
    assert.equal(embedFor("https://drive.google.com/open?id=abcDEF123").src, "https://drive.google.com/file/d/abcDEF123/preview");
  });
  it("Google Docs", () => assert.equal(embedFor("https://docs.google.com/document/d/abc123/edit").src, "https://docs.google.com/document/d/abc123/preview"));
  it("Vimeo", () => assert.equal(embedFor("https://vimeo.com/123456789").src, "https://player.vimeo.com/video/123456789"));
  it("ملفات PDF وفيديو وصوت", () => {
    assert.equal(embedFor("https://x.com/book.PDF").kind, "iframe");
    assert.equal(embedFor("https://x.com/lesson.mp4").kind, "video");
    assert.equal(embedFor("https://x.com/lesson.mp3").kind, "audio");
  });
});

describe("روابط مش مدعومة أو خطيرة", () => {
  for (const url of ["https://example.com/page", "javascript:alert(1)", "data:text/html,x", "not a url", "", null, "https://evil.com/watch?v=dQw4w9WgXcQ"]) {
    it(`بترجع null: ${String(url)}`, () => assert.equal(embedFor(url), null));
  }
});
