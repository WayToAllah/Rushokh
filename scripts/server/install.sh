#!/usr/bin/env bash
# بيركّب خدمات السيرفر من الملفات دي (بعد تعديلها على GitHub): sudo bash /opt/rasokh/app/scripts/server/install.sh
# مش بيلمس قاعدة البيانات ولا .env ولا بيانات النفق.
set -euo pipefail
cd "$(dirname "$0")"
install -m 755 rasokh-auto-deploy.sh /usr/local/bin/rasokh-auto-deploy
install -m 644 rasokh.service cloudflared-rasokh.service rasokh-auto-deploy.service rasokh-auto-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable rasokh.service cloudflared-rasokh.service rasokh-auto-deploy.timer
systemctl start rasokh-auto-deploy.timer
echo "تمام. حالة التحديث التلقائي: systemctl list-timers rasokh-auto-deploy  والسجل: journalctl -u rasokh-auto-deploy"
