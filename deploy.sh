#!/bin/bash
set -e
cd "$(dirname "$0")"

# 현재 버전 번호 읽기
CURRENT_V=$(grep -oE '\?v=[0-9]+' index.html | head -1 | grep -oE '[0-9]+')
NEW_V=$((CURRENT_V + 1))
echo "🔢 Asset version: v$CURRENT_V → v$NEW_V"

# 모든 HTML 파일에서 ?v=숫자 일괄 업데이트
for f in *.html; do
  sed -i '' "s/?v=[0-9]*/?v=$NEW_V/g" "$f"
done

# 변경사항 확인
CHANGED=$(git status --porcelain)
if [ -n "$CHANGED" ]; then
  git add *.html Dockerfile nginx.conf *.png *.jpg *.jpeg *.gif *.svg *.webp *.ico 2>/dev/null || git add *.html
  MSG="${1:-deploy: bump asset version to v$NEW_V}"
  git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  git push
else
  echo "ℹ️  변경된 파일 없음 — 버전만 올림"
fi

echo "🚀 Deploying..."
~/.fly/bin/fly deploy --remote-only
echo "✅ 완료"
