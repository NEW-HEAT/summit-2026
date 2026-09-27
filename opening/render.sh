#!/usr/bin/env bash
set -euo pipefail

task_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_dir="$(cd "$task_dir/.." && pwd)"

cd "$workspace_dir"
node "$task_dir/render.mjs" "$@"

for argument in "$@"; do
  if [[ "$argument" == "--smoke" ]]; then
    exit 0
  fi
done

ffprobe \
  -v error \
  -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 \
  "$task_dir/newheat-authorship-intro.mp4"
