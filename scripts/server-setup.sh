#!/usr/bin/env bash
# تجهيز "رسوخ" على سيرفر لينكس (Oracle Cloud / Ubuntu / Oracle Linux) مرة واحدة:
#   curl -fsSL https://raw.githubusercontent.com/WayToAllah/Rushokh/main/scripts/server-setup.sh | bash
#
# بيعمل:
#   1) يسطّب Node.js 22 و git و cloudflared
#   2) ينزّل الموقع من GitHub في ~/rushokh
#   3) يشغّله كخدمة (rasokh) بتقوم لوحدها مع السيرفر وبترجع لو وقعت
#   4) تحديث تلقائي كل 5 دقايق من GitHub (rasokh-update)
#   5) يربط الدومين بـ Cloudflare Tunnel، من غير ما تفتح أي بورت في Oracle
#
# آمن إنك تشغّله أكتر من مرة: مش بيمسح قاعدة البيانات ولا بيعيد إعداد اللي اتعمل.
# لو عندك قاعدة بيانات من جهازك: ارفعها الأول لـ ~/rasokh.db وهي هتتنقل لمكانها في أول مرة بس.
set -euo pipefail

# كله جوه main عشان مع curl | bash السكريبت يتقري كله الأول
main() {

REPO="https://github.com/WayToAllah/Rushokh.git"
DOMAIN="${DOMAIN:-rusuokh.com}"
TUNNEL="${TUNNEL:-rasokh-server}"
APP_DIR="$HOME/rushokh"
APP_USER="$(id -un)"
PORT=4000

step() { echo; echo "===== $* ====="; }

if [ "$(id -u)" -eq 0 ]; then
  echo "شغّل السكريبت بالمستخدم العادي (ubuntu أو opc) مش root."; exit 1
fi

# سيرفر رسوخ الحالي (Oracle) متجهّز بطريقة تانية: الموقع في /opt/rasokh/app والتحديث التلقائي rasokh-auto-deploy.
# التشغيل هنا كان هيعمل نسخة تانية بقاعدة بيانات فاضية ويحوّل الموقع والدومين عليها، فبنوقف.
if [ -d /opt/rasokh/app ]; then
  echo "السيرفر ده متجهّز قبل كده والموقع شغّال عليه. السكريبت ده لسيرفر جديد فاضي بس، ومش هيكمّل."
  echo "التحديث هنا تلقائي من GitHub. السجل: journalctl -u rasokh-auto-deploy"
  exit 1
fi

step "1/5 تسطيب البرامج"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) CF_ARCH=amd64 ;;
  aarch64|arm64) CF_ARCH=arm64 ;;
  *) echo "نوع المعالج $ARCH مش مدعوم"; exit 1 ;;
esac

if command -v apt-get >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y git curl ca-certificates
  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
elif command -v dnf >/dev/null; then
  sudo dnf install -y git curl
  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf install -y nodejs
  fi
else
  echo "النظام ده مش مدعوم (محتاج Ubuntu أو Oracle Linux)"; exit 1
fi

if ! command -v cloudflared >/dev/null; then
  sudo curl -fsSL -o /usr/local/bin/cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH"
  sudo chmod +x /usr/local/bin/cloudflared
fi
echo "Node $(node -v) — $(cloudflared --version | head -1)"

step "2/5 تنزيل الموقع"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

if [ -f "$HOME/rasokh.db" ] && [ ! -f db/rasokh.db ]; then
  echo "لقيت قاعدة بيانات مرفوعة (~/rasokh.db)، بنقلها للموقع..."
  mv "$HOME/rasokh.db" db/rasokh.db
fi
node db/ensure-seed.js

step "3/5 تشغيل الموقع كخدمة"
sudo tee /etc/systemd/system/rasokh.service >/dev/null <<EOF
[Unit]
Description=Rasokh website
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

step "4/5 التحديث التلقائي من GitHub"
sudo tee /usr/local/bin/rasokh-update >/dev/null <<EOF
#!/usr/bin/env bash
# بيسحب آخر نسخة من GitHub، ولو فيه جديد بيسطّب الحزم ويعيد تشغيل الموقع
set -e
cd "$APP_DIR"
before=\$(git rev-parse HEAD)
git pull --ff-only -q
after=\$(git rev-parse HEAD)
if [ "\$before" != "\$after" ]; then
  npm install --omit=dev --no-audit --no-fund
  sudo systemctl restart rasokh
  echo "اتحدث من \$before لـ \$after"
fi
EOF
sudo chmod +x /usr/local/bin/rasokh-update
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart rasokh, /bin/systemctl restart rasokh" \
  | sudo tee /etc/sudoers.d/rasokh >/dev/null
sudo chmod 440 /etc/sudoers.d/rasokh

sudo tee /etc/systemd/system/rasokh-update.service >/dev/null <<EOF
[Unit]
Description=Rasokh update from GitHub
[Service]
Type=oneshot
User=$APP_USER
ExecStart=/usr/local/bin/rasokh-update
EOF
sudo tee /etc/systemd/system/rasokh-update.timer >/dev/null <<EOF
[Unit]
Description=Rasokh update every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now rasokh rasokh-update.timer
sudo systemctl restart rasokh
sleep 3
if curl -fsS "http://localhost:$PORT/api/health" >/dev/null; then
  echo "الموقع شغال على السيرفر ✓"
else
  echo "الموقع ما اشتغلش. ابعت ناتج الأمر ده:  sudo journalctl -u rasokh -n 50"; exit 1
fi

step "5/5 ربط الدومين $DOMAIN"
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo
  echo ">>> هيظهر تحت رابط طويل بيبدأ بـ https://dash.cloudflare.com/argotunnel"
  echo ">>> انسخه وافتحه في المتصفح، اختار $DOMAIN ودوس Authorize، وارجع هنا."
  echo
  cloudflared tunnel login
fi

if ! cloudflared tunnel info "$TUNNEL" >/dev/null 2>&1; then
  cloudflared tunnel create "$TUNNEL"
fi
TUNNEL_ID="$(cloudflared tunnel list -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(t?t.id:"")})' "$TUNNEL")"
[ -n "$TUNNEL_ID" ] || { echo "مش لاقي التانل $TUNNEL"; exit 1; }

cloudflared tunnel route dns --overwrite-dns "$TUNNEL" "$DOMAIN"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL" "www.$DOMAIN"

sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/$TUNNEL_ID.json" /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $DOMAIN
    service: http://localhost:$PORT
  - hostname: www.$DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
EOF

sudo tee /etc/systemd/system/rasokh-tunnel.service >/dev/null <<EOF
[Unit]
Description=Rasokh Cloudflare Tunnel
After=network-online.target rasokh.service
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rasokh-tunnel
sudo systemctl restart rasokh-tunnel

echo
echo "=============================================="
echo " خلصنا ✓  الموقع على: https://$DOMAIN"
echo " (أول مرة ممكن ياخد دقيقة أو اتنين لحد ما يفتح)"
echo " أي تعديل يترفع على GitHub بيوصل للسيرفر لوحده خلال 5 دقايق."
echo " النسخ الاحتياطية في: $APP_DIR/backups"
echo "=============================================="
}

main "$@"
