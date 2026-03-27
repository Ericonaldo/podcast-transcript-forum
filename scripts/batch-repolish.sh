#!/bin/bash
# Batch re-polish all problematic Chinese episodes sequentially
# This avoids API rate limiting and SQLite contention

cd /home/mhliu/podcast-transcript-forum

# Critical episodes first (worst avg_para, user-reported)
EPISODES=(
  # Severely broken (avg_para > 3000)
  140 139 128 109 118 566 127
  # Incomplete polish (much shorter than ASR)
  114
  # No polish yet (have ASR)
  134 113 110 115 141 104 152 156 157 158 160 161 162 163
  # Moderate issues (avg_para > 1200)
  126 102 101 122 106 568 123
  # Other podcasts with issues
  507 498 500 519 510 502 488 512 504 178 521 503
  487 485 497 483 496 518 509 523 493 515 499
  480 478 522 517 177 501 516 505 524
  # VTT-sourced episodes with issues
  223 215 245 226 212 211 239
)

TOTAL=${#EPISODES[@]}
DONE=0
FAILED=0
START=$(date +%s)

echo "=== Batch Re-polish: $TOTAL episodes ==="
echo ""

for EP in "${EPISODES[@]}"; do
  ELAPSED=$(( ($(date +%s) - START) / 60 ))
  echo "[$((DONE+FAILED+1))/$TOTAL] (${ELAPSED}m) Episode $EP"

  node scripts/repolish-quality.js --episode-id=$EP 2>&1 | grep -v dotenv

  if [ $? -eq 0 ]; then
    # Run postprocess immediately after each episode
    node scripts/postprocess-polish.js --episode-id=$EP 2>&1 | grep -v dotenv
    DONE=$((DONE + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  echo "---"
done

echo ""
echo "=== Batch complete: $DONE done, $FAILED failed in $(( ($(date +%s) - START) / 60 ))m ==="
