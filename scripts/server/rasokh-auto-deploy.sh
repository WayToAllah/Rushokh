#!/usr/bin/env bash
# rasokh-auto-deploy: التحديث التلقائي للموقع على السيرفر من GitHub.
# بيشتغل كل دقيقتين (rasokh-auto-deploy.timer). لو فيه نسخة جديدة على main:
#   1) يستنى لحد ما اختبارات GitHub (tests.yml) تخلص عليها، ولو فشلت مابينزّلهاش خالص
#   2) ياخد نسخة احتياطية من قاعدة البيانات في backups/deploys
#   3) ينزّل النسخة، ويسطّب الحزم لو اتغيرت، ويعيد تشغيل الموقع
#   4) لو الموقع ماردّش بعد التحديث، يرجع للنسخة اللي قبلها لوحده
# السجل: journalctl -u rasokh-auto-deploy     تشغيل فوري: sudo systemctl start rasokh-auto-deploy
set -euo pipefail

APP=/opt/rasokh/app
APP_USER=rasokh
STATE=/var/lib/rasokh-deploy
API=https://api.github.com/repos/WayToAllah/Rushokh
WORKFLOW=.github/workflows/tests.yml
HEALTH=http://localhost:4000/api/health
KEEP_BACKUPS=20

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0

as_app() { runuser -u "$APP_USER" -- env HOME=/opt/rasokh "$@"; }
short() { echo "${1:0:7}"; }

# بيكتب الحالة في السجل مرة واحدة بس لكل نسخة، عشان "مستني الاختبارات" مايتكررش كل دقيقتين
say_once() {
  local key="$1"; shift
  if [ "$(cat "$STATE/last" 2>/dev/null)" != "$key" ]; then
    echo "$*"
    echo "$key" > "$STATE/last"
  fi
}

healthy() {
  for _ in $(seq 1 15); do
    curl -fsS -m 3 "$HEALTH" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

current=$(as_app git -C "$APP" rev-parse HEAD)
latest=$(as_app git -C "$APP" ls-remote origin refs/heads/main 2>/dev/null | cut -f1) || latest=""
[ -n "$latest" ] || { say_once "unreachable" "⚠️  مش قادر أوصل لـ GitHub، هحاول تاني."; exit 0; }
[ "$latest" = "$current" ] && exit 0
grep -qx "$latest" "$STATE/failed" 2>/dev/null && exit 0

# حالة اختبارات GitHub على النسخة دي: success | pending | failure
ci=$(curl -fsS -m 20 -H "Accept: application/vnd.github+json" "$API/actions/runs?head_sha=$latest&event=push" 2>/dev/null \
  | node -e '
      let s = "";
      process.stdin.on("data", d => (s += d)).on("end", () => {
        try {
          const runs = (JSON.parse(s).workflow_runs || []).filter(r => r.path === process.argv[1]);
          if (!runs.length) return console.log("pending");
          const last = runs.sort((a, b) => b.run_attempt - a.run_attempt || b.id - a.id)[0];
          if (last.status !== "completed") return console.log("pending");
          console.log(last.conclusion === "success" ? "success" : "failure");
        } catch { console.log("pending"); }
      });' "$WORKFLOW") || ci=pending

case "$ci" in
  pending) say_once "$latest pending" "⏳ نسخة جديدة $(short "$latest")، مستني اختبارات GitHub تخلص."; exit 0 ;;
  failure) echo "$latest" >> "$STATE/failed"
           echo "❌ اختبارات GitHub فشلت على $(short "$latest")، مش هتتنزّل. الموقع فاضل على $(short "$current")."; exit 0 ;;
esac

as_app git -C "$APP" fetch -q origin main
if ! as_app git -C "$APP" merge-base --is-ancestor "$current" "$latest"; then
  echo "$latest" >> "$STATE/failed"
  echo "❌ $(short "$latest") مش امتداد للنسخة الحالية (حد عدّل التاريخ على GitHub)، محتاجة تتنزّل يدوي."
  exit 0
fi

# نسخة احتياطية قبل التحديث (sqlite .backup آمنة والموقع شغّال)
backup="backups/deploys/before-$(date +%Y-%m-%d_%H-%M)-$(short "$latest").db"
as_app mkdir -p "$APP/backups/deploys"
as_app sqlite3 "$APP/db/rasokh.db" ".backup '$APP/$backup'"
ls -1t "$APP"/backups/deploys/before-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

deps_changed=0
as_app git -C "$APP" diff --quiet "$current" "$latest" -- package.json package-lock.json || deps_changed=1

install_deps() { (cd "$APP" && as_app npm ci --omit=dev --no-audit --no-fund --loglevel=error); }

# كل خطوة بـ || return 1، لأن set -e مابيشتغلش جوه دالة متنادية في if
deploy() {
  as_app git -C "$APP" merge -q --ff-only "$latest" || return 1
  if [ "$deps_changed" = 1 ]; then install_deps || return 1; fi
  systemctl restart rasokh || return 1
  healthy
}

if deploy; then
  echo "✅ الموقع اتحدث من $(short "$current") لـ $(short "$latest"): $(as_app git -C "$APP" log -1 --format=%s "$latest")"
  echo "$latest ok" > "$STATE/last"
  exit 0
fi

# التحديث فشل أو الموقع ماردّش: نرجع للنسخة اللي قبلها. قاعدة البيانات بتفضل زي ما هي
# (التعديلات عليها بإضافة أعمدة وجداول بس، والنسخة القديمة بتشتغل عليها)، والنسخة الاحتياطية موجودة لو احتجناها.
echo "$latest" >> "$STATE/failed"
echo "❌ التحديث لـ $(short "$latest") فشل أو الموقع ماردّش بعده، برجع لـ $(short "$current")."
journalctl -u rasokh -n 30 --no-pager -o cat || true
as_app git -C "$APP" reset -q --hard "$current"
if [ "$deps_changed" = 1 ]; then install_deps || true; fi
systemctl restart rasokh
if healthy; then
  echo "↩️  رجعت لـ $(short "$current") والموقع شغّال. النسخة الاحتياطية: $backup"
else
  echo "🚨 الموقع مش بيرد حتى بعد الرجوع. محتاج تدخل يدوي: journalctl -u rasokh -n 100"
  exit 1
fi
