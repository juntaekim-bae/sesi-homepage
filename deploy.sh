#!/bin/bash
set -e
cd "$(dirname "$0")"

NCP_HOST="root@49.50.139.154"
NCP_DIR="/opt/sesisoft"
LB_IP="101.79.19.201"

# 현재 버전 번호 읽기
CURRENT_V=$(grep -oE '\?v=[0-9]+' index.html | head -1 | grep -oE '[0-9]+')
NEW_V=$((CURRENT_V + 1))
echo "Asset version: v$CURRENT_V → v$NEW_V"

# 루트 HTML 파일 버전 범프
for f in *.html; do
  sed -i '' "s/?v=[0-9]*/?v=$NEW_V/g" "$f"
done

# 변경사항 커밋 & 푸시
CHANGED=$(git status --porcelain)
if [ -n "$CHANGED" ]; then
  git add -A
  MSG="${1:-deploy: bump asset version to v$NEW_V}"
  git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  git push
else
  echo "변경된 파일 없음"
fi

echo "Deploying to NCP ($NCP_HOST)..."
rsync -az --exclude='.git' --exclude='.DS_Store' --exclude='node_modules' \
  --exclude='게임' --exclude='게임.zip' \
  ./ "$NCP_HOST:$NCP_DIR/"

ssh "$NCP_HOST" "cd $NCP_DIR && docker compose build web && docker compose up -d web"

echo ""
echo "배포 완료: http://$LB_IP"
