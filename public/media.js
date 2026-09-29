// public/media.js
// يحوّل روابط الفيديو والكتب لروابط تتعرض جوه الموقع نفسه.
// بيرجّع { kind: "iframe" | "video" | "audio", src, ratio } أو null لو الرابط مش مدعوم للعرض الداخلي.

(function (global) {
  function toUrl(raw) {
    try {
      const u = new URL(String(raw).trim());
      return (u.protocol === "http:" || u.protocol === "https:") ? u : null;
    } catch (e) { return null; }
  }

  // "1h2m3s" أو "90" -> ثواني
  function parseStart(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  }

  const ID_RE = /^[A-Za-z0-9_-]{6,}$/;

  function youtube(u) {
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    let id = null;
    const list = u.searchParams.get("list");
    if (host === "youtu.be") {
      id = u.pathname.slice(1).split("/")[0];
    } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1];
      else if (parts[0] === "playlist" && list) id = null;
      else return null;
    } else {
      return null;
    }

    const params = new URLSearchParams({ rel: "0" });
    if (id === "videoseries") id = null;
    if (id && ID_RE.test(id)) {
      if (list && ID_RE.test(list)) params.set("list", list);
      const start = parseStart(u.searchParams.get("t") || u.searchParams.get("start"));
      if (start) params.set("start", String(start));
      return { kind: "iframe", src: `https://www.youtube.com/embed/${id}?${params}`, ratio: "video" };
    }
    if (list && ID_RE.test(list)) {
      params.set("list", list);
      return { kind: "iframe", src: `https://www.youtube.com/embed/videoseries?${params}`, ratio: "video" };
    }
    return null;
  }

  function google(u) {
    const host = u.hostname;
    let m;
    if (host === "drive.google.com") {
      if ((m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/))) {
        return { kind: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview`, ratio: "doc" };
      }
      const id = u.searchParams.get("id");
      if (u.pathname === "/open" && id && ID_RE.test(id)) {
        return { kind: "iframe", src: `https://drive.google.com/file/d/${id}/preview`, ratio: "doc" };
      }
    }
    if (host === "docs.google.com" && (m = u.pathname.match(/^\/(document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]+)/))) {
      return { kind: "iframe", src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, ratio: "doc" };
    }
    return null;
  }

  function vimeo(u) {
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const m = u.pathname.match(/(\d{5,})/);
    return m ? { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}`, ratio: "video" } : null;
  }

  function direct(u) {
    const path = u.pathname.toLowerCase();
    if (/\.pdf$/.test(path)) return { kind: "iframe", src: u.href, ratio: "doc" };
    if (/\.(mp4|webm|ogv|mov)$/.test(path)) return { kind: "video", src: u.href, ratio: "video" };
    if (/\.(mp3|m4a|ogg|oga|wav|aac)$/.test(path)) return { kind: "audio", src: u.href, ratio: "audio" };
    return null;
  }

  function embedFor(raw) {
    const u = toUrl(raw);
    if (!u) return null;
    return youtube(u) || google(u) || vimeo(u) || direct(u);
  }

  global.RasokhMedia = { embedFor, toUrl };
  if (typeof module !== "undefined") module.exports = { embedFor, toUrl };
})(typeof window !== "undefined" ? window : globalThis);
