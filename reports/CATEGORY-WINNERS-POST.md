# Category winners and post-vision result

The benchmark winner was `57fe1f07c3b6` (`b9620`) with **95.95 mean median eval tok/s**.

## Category winners

| Case | Fastest commit | Median eval tok/s |
|---|---|---:|
| Text | `e9fb3b3fc030` | 90.00 |
| Vision | `6ee0f65793da` | 100.74 |
| Post-vision | `57fe1f07c3b6` | 99.24 |

## Interpretation

`57fe1f07c3b6` did not win by dominating every column. It won the aggregate because its post-vision performance remained high after the multimodal turn.

For the winner:

| Case | Median eval tok/s |
|---|---:|
| Text | 89.82 |
| Vision | 98.80 |
| Post-vision | 99.24 |
| Mean | 95.95 |

This is why the result is useful for CUDA and other Apple Silicon retests: the important behavior is not only peak text or peak vision throughput, but whether MTP remains fast after vision context has been used.
