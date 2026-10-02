// lib/comments.js — قراءة مناقشة الدرس مرتّبة: المثبّت الأول، وبعدين الأقدم فالأحدث، والردود تحت كل تعليق
const db = require("../db/database");

function shape(row, studentId) {
  return {
    id: row.id,
    body: row.body,
    author: row.student_id ? (row.student_name || "طالب") : "المشرف",
    is_admin: !row.student_id,
    mine: studentId != null && row.student_id === studentId,
    pinned: !!row.pinned,
    created_at: row.created_at,
  };
}

// studentId: عشان نعلّم تعليقات الطالب نفسه (mine). المشرف بيبعته null
function commentsFor(episodeId, { studentId = null } = {}) {
  const rows = db.prepare(
    `SELECT c.*, s.full_name AS student_name
     FROM episode_comments c LEFT JOIN students s ON s.id = c.student_id
     WHERE c.episode_id = ? ORDER BY c.id ASC`
  ).all(episodeId);
  const top = rows.filter(r => !r.parent_id).map(r => ({ ...shape(r, studentId), replies: [] }));
  const byId = new Map(top.map(t => [t.id, t]));
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).replies.push(shape(r, studentId));
  }
  top.sort((a, b) => (b.pinned - a.pinned) || (a.id - b.id));
  return top;
}

module.exports = { commentsFor };
