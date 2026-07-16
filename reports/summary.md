# llama.cpp MTP + vision benchmark

Generated: 2026-07-16T07:40:14.553Z
Platform: darwin
Benchmark key: `a49f80b7cea2`

| rank | commit | mean median eval tok/s |
|---:|---|---:|
| 1 | `57fe1f07c3b6` | 95.95 |
| 2 | `2f18fe13c5dd` | 95.62 |
| 3 | `f2d1c2f3984c` | 95.61 |
| 4 | `f5525f7e7a7e` | 95.59 |
| 5 | `fdb1db877c52` | 95.58 |
| 6 | `e9fb3b3fc030` | 95.55 |
| 7 | `6ee0f65793da` | 94.18 |
| 8 | `9df06805eee8` | 84.79 |
| 9 | `c16c35b8142a` | 83.32 |
| 10 | `5a6a0dd7e1f7` | 81.19 |
| 11 | `487a6cc164d9` | 81.06 |
| 12 | `1a87dcdc452d` | 78.88 |
| 13 | `e7e3f350904c` | 78.50 |
| 14 | `ded1561b4228` | 77.52 |
| 15 | `d14ce3dab4de` | 77.18 |
| 16 | `9a532ae4bab1` | 76.80 |
| 17 | `b11f7c16bc1c` | 75.35 |

| commit | case | median eval tok/s | median acceptance | median TTFT ms | success |
|---|---|---:|---:|---:|---:|
| `6ee0f65793da` | text | 87.26 | 0.6184 | 16779 | 3/3 |
| `6ee0f65793da` | vision | 100.74 | 0.7828 | 22811 | 3/3 |
| `6ee0f65793da` | post-vision | 94.54 | 0.7028 | 23050 | 3/3 |
| `e9fb3b3fc030` | text | 90.00 | 0.6184 | 16216 | 3/3 |
| `e9fb3b3fc030` | vision | 100.63 | 0.7828 | 22842 | 3/3 |
| `e9fb3b3fc030` | post-vision | 96.01 | 0.7260 | 23189 | 3/3 |
| `9a532ae4bab1` | text | 74.70 | - | 17814 | 3/3 |
| `9a532ae4bab1` | vision | 78.20 | - | 27179 | 3/3 |
| `9a532ae4bab1` | post-vision | 77.50 | - | 27301 | 3/3 |
| `d14ce3dab4de` | text | 75.11 | 0.6384 | 17964 | 3/3 |
| `d14ce3dab4de` | vision | 78.58 | 0.7211 | 27321 | 3/3 |
| `d14ce3dab4de` | post-vision | 77.85 | 0.7095 | 27463 | 3/3 |
| `57fe1f07c3b6` | text | 89.82 | 0.6184 | 16914 | 3/3 |
| `57fe1f07c3b6` | vision | 98.80 | 0.7700 | 23031 | 3/3 |
| `57fe1f07c3b6` | post-vision | 99.24 | 0.7750 | 23273 | 3/3 |
| `f2d1c2f3984c` | text | 89.95 | 0.6184 | 16697 | 3/3 |
| `f2d1c2f3984c` | vision | 100.59 | 0.7828 | 22812 | 3/3 |
| `f2d1c2f3984c` | post-vision | 96.28 | 0.7260 | 23105 | 3/3 |
| `2f18fe13c5dd` | text | 89.99 | 0.6184 | 16683 | 3/3 |
| `2f18fe13c5dd` | vision | 100.56 | 0.7828 | 22832 | 3/3 |
| `2f18fe13c5dd` | post-vision | 96.31 | 0.7260 | 23100 | 3/3 |
| `fdb1db877c52` | text | 90.00 | 0.6184 | 16657 | 3/3 |
| `fdb1db877c52` | vision | 100.42 | 0.7828 | 22787 | 3/3 |
| `fdb1db877c52` | post-vision | 96.33 | 0.7260 | 23105 | 3/3 |
| `f5525f7e7a7e` | text | 89.94 | 0.6184 | 16648 | 3/3 |
| `f5525f7e7a7e` | vision | 100.59 | 0.7828 | 22802 | 3/3 |
| `f5525f7e7a7e` | post-vision | 96.24 | 0.7260 | 23083 | 3/3 |
| `b11f7c16bc1c` | text | 72.75 | 0.6184 | 22024 | 3/3 |
| `b11f7c16bc1c` | vision | 82.61 | 0.7828 | 31704 | 3/3 |
| `b11f7c16bc1c` | post-vision | 70.70 | 0.7260 | 31617 | 3/3 |
| `e7e3f350904c` | text | 77.53 | 0.6184 | 23120 | 3/3 |
| `e7e3f350904c` | vision | 85.33 | 0.7828 | 31118 | 3/3 |
| `e7e3f350904c` | post-vision | 72.63 | 0.7260 | 33896 | 3/3 |
| `1a87dcdc452d` | text | 74.24 | 0.6184 | 22237 | 3/3 |
| `1a87dcdc452d` | vision | 82.85 | 0.7828 | 31612 | 3/3 |
| `1a87dcdc452d` | post-vision | 79.56 | 0.7260 | 34178 | 3/3 |
| `c16c35b8142a` | text | 77.18 | 0.6184 | 22098 | 3/3 |
| `c16c35b8142a` | vision | 88.84 | 0.7828 | 29827 | 3/3 |
| `c16c35b8142a` | post-vision | 83.94 | 0.7260 | 30130 | 3/3 |
| `9df06805eee8` | text | 84.29 | 0.6184 | 21106 | 3/3 |
| `9df06805eee8` | vision | 88.64 | 0.7828 | 28759 | 3/3 |
| `9df06805eee8` | post-vision | 81.44 | 0.7260 | 29600 | 3/3 |
| `ded1561b4228` | text | 70.76 | 0.6184 | 23820 | 3/3 |
| `ded1561b4228` | vision | 86.14 | 0.7828 | 31715 | 3/3 |
| `ded1561b4228` | post-vision | 75.65 | 0.7260 | 31596 | 3/3 |
| `5a6a0dd7e1f7` | text | 79.11 | 0.6184 | 22237 | 3/3 |
| `5a6a0dd7e1f7` | vision | 79.45 | 0.7828 | 32797 | 3/3 |
| `5a6a0dd7e1f7` | post-vision | 85.02 | 0.7260 | 31586 | 3/3 |
| `487a6cc164d9` | text | 81.00 | 0.6184 | 22825 | 3/3 |
| `487a6cc164d9` | vision | 81.60 | 0.7828 | 34908 | 3/3 |
| `487a6cc164d9` | post-vision | 80.57 | 0.7260 | 34321 | 3/3 |

Ranking uses the mean of each case's median llama.cpp eval throughput. Inspect acceptance, TTFT and raw logs before declaring a winner.
